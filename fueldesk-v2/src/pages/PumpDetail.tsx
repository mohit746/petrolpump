// src/pages/PumpDetail.tsx
//
// Per-pump platform-owner view. Drives:
//   • Header card from public.v_pump_health (single round-trip).
//   • Tabs: Health, Users, Subscription, Settings.
//   • Subscription tab edits plan / monthly_fee / status; lifecycle actions
//     (suspend, restore, delete, re-seed defaults) are all RPC calls.
//   • Every mutation logs to public.audit_log via lib/audit.

import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, CreditCard, Loader2, CheckCircle, Plus, ArrowLeft,
  PauseCircle, PlayCircle, Trash2, Sprout, AlertTriangle, Save,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import { formatINR } from '../lib/utils'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import type { Pump, PumpHealth, SubscriptionPlan, SubscriptionStatus } from '../types'

const TABS = ['Health', 'Users', 'Subscription', 'Settings'] as const
type Tab = typeof TABS[number]

type PaymentForm = { amount: string; notes: string; period_month: string; period_year: string }
type SubsForm    = { subscription_plan: SubscriptionPlan; monthly_fee: string; subscription_status: SubscriptionStatus }

const PumpDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('Health')
  const [payOpen, setPayOpen] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteForce, setDeleteForce] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')

  const { register: regPay, handleSubmit: subPay, reset: resetPay } = useForm<PaymentForm>()
  const subsForm = useForm<SubsForm>()

  // ── Pump record ────────────────────────────────────────────
  const { data: pump, isLoading } = useQuery({
    queryKey: ['pump', id],
    queryFn: async (): Promise<Pump | null> => {
      const { data, error } = await supabase.from('pumps').select('*').eq('id', id!).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as Pump | null) ?? null
    },
    enabled: !!id,
  })

  // Reset subscription form when pump loads.
  useEffect(() => {
    if (pump) {
      subsForm.reset({
        subscription_plan: (pump.subscription_plan ?? 'BASIC') as SubscriptionPlan,
        monthly_fee: String(pump.monthly_fee ?? 0),
        subscription_status: pump.subscription_status,
      })
    }
  }, [pump]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Health rollup ──────────────────────────────────────────
  const { data: health } = useQuery({
    queryKey: ['pump_health', id],
    queryFn: async (): Promise<PumpHealth | null> => {
      const { data, error } = await supabase
        .from('v_pump_health')
        .select('*')
        .eq('pump_id', id!)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as PumpHealth | null) ?? null
    },
    enabled: !!id,
  })

  // ── Pump users ─────────────────────────────────────────────
  const { data: pumpUsers } = useQuery({
    queryKey: ['pump_users', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users').select('id,first_name,last_name,email,phone,role,is_active,is_blocked')
        .eq('pump_id', id!).is('deleted_at', null).order('role')
      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: !!id && tab === 'Users',
  })

  // ── Subscription payments ──────────────────────────────────
  const { data: payments } = useQuery({
    queryKey: ['pump_payments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_payments').select('*')
        .eq('pump_id', id!).order('paid_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: !!id && tab === 'Subscription',
  })

  // ── Mutations ──────────────────────────────────────────────
  const paymentMutation = useMutation({
    mutationFn: async (d: PaymentForm) => {
      const { error: payErr } = await supabase.from('subscription_payments').insert({
        pump_id: id, amount: parseFloat(d.amount), notes: d.notes,
        period_month: parseInt(d.period_month), period_year: parseInt(d.period_year),
        paid_at: new Date().toISOString(), status: 'RECEIVED',
      })
      if (payErr) throw new Error(payErr.message)

      // Recording a payment reactivates a non-cancelled pump.
      if (pump && pump.subscription_status !== 'CANCELLED') {
        await supabase.from('pumps').update({ subscription_status: 'ACTIVE', is_active: true }).eq('id', id!)
        void logAudit({
          action: 'pump.update', entity_type: 'pumps', entity_id: id!, pump_id: id!,
          before: { subscription_status: pump.subscription_status, is_active: pump.is_active },
          after:  { subscription_status: 'ACTIVE', is_active: true, payment: parseFloat(d.amount) },
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pump_payments', id] })
      qc.invalidateQueries({ queryKey: ['pump', id] })
      qc.invalidateQueries({ queryKey: ['pump_health', id] })
      toast('Payment recorded', 'success'); setPayOpen(false); resetPay()
    },
    onError: (e: Error) => toast(e.message || 'Failed to record payment', 'error'),
  })

  const subsMutation = useMutation({
    mutationFn: async (d: SubsForm) => {
      const fee = parseFloat(d.monthly_fee)
      if (isNaN(fee) || fee < 0) throw new Error('Monthly fee must be a non-negative number')

      const before = pump ? {
        subscription_plan: pump.subscription_plan,
        monthly_fee: pump.monthly_fee,
        subscription_status: pump.subscription_status,
        is_active: pump.is_active,
      } : null

      const after = {
        subscription_plan: d.subscription_plan,
        monthly_fee: fee,
        subscription_status: d.subscription_status,
        // Status drives is_active for consistency.
        is_active: d.subscription_status === 'ACTIVE' || d.subscription_status === 'TRIAL',
      }

      const { error } = await supabase.from('pumps').update(after).eq('id', id!)
      if (error) throw new Error(error.message)

      void logAudit({
        action: 'pump.update', entity_type: 'pumps', entity_id: id!, pump_id: id!,
        before, after,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pump', id] })
      qc.invalidateQueries({ queryKey: ['pump_health', id] })
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Subscription updated', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Failed to update subscription', 'error'),
  })

  const suspendMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('platform_suspend_pump', { p_pump_id: id! })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pump', id] })
      qc.invalidateQueries({ queryKey: ['pump_health', id] })
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump suspended', 'success'); setSuspendOpen(false)
    },
    onError: (e: Error) => toast(e.message || 'Failed to suspend', 'error'),
  })

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('platform_restore_pump', { p_pump_id: id! })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pump', id] })
      qc.invalidateQueries({ queryKey: ['pump_health', id] })
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump restored', 'success'); setRestoreOpen(false)
    },
    onError: (e: Error) => toast(e.message || 'Failed to restore', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const { error } = await supabase.rpc('platform_delete_pump', { p_pump_id: id!, p_force: force })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump removed', 'success')
      navigate('/platform', { replace: true })
    },
    onError: (e: Error) => toast(e.message || 'Failed to remove pump', 'error'),
  })

  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('seed_pump_defaults', { p_pump_id: id! })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => toast('Default fuel types, machines, and settings seeded', 'success'),
    onError: (e: Error) => toast(e.message || 'Failed to seed defaults', 'error'),
  })

  if (isLoading || !pump) return (
    <div className="flex justify-center items-center h-48">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
    </div>
  )

  return (
    <div className="p-4 space-y-4">
      {/* Back nav */}
      <button onClick={() => navigate('/platform')}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> All pumps
      </button>

      {/* Header */}
      <div className="card flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-800 dark:text-white truncate">{pump.name}</h2>
          <p className="text-sm text-slate-500 truncate">
            {[pump.city, pump.state].filter(Boolean).join(', ') || '—'}
          </p>
        </div>
        <Badge variant={pump.is_active ? 'success' : 'destructive'}>
          {pump.subscription_status}
        </Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === t
                ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Health */}
      {tab === 'Health' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Active Users"   value={String(health?.active_users   ?? 0)} />
            <Stat label="Blocked Users"  value={String(health?.blocked_users  ?? 0)} />
            <Stat label="Revenue (7d)"   value={formatINR(health?.revenue_7d ?? 0)} />
            <Stat label="Profit (7d)"    value={formatINR(health?.profit_7d  ?? 0)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Outstanding Credit"
                  value={formatINR(health?.outstanding_credit ?? 0)} />
            <Stat label="Last Payment"
                  value={health?.last_payment_at
                    ? format(new Date(health.last_payment_at), 'dd MMM yyyy')
                    : '—'} />
          </div>

          <div className="card space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase">Lifecycle</p>
            <div className="grid grid-cols-2 gap-2">
              {(pump.subscription_status === 'SUSPENDED' || !pump.is_active) ? (
                <button onClick={() => setRestoreOpen(true)} className="btn-primary">
                  <PlayCircle className="w-4 h-4" /> Restore
                </button>
              ) : (
                <button onClick={() => setSuspendOpen(true)} className="btn-secondary">
                  <PauseCircle className="w-4 h-4" /> Suspend
                </button>
              )}
              <button onClick={() => seedDefaultsMutation.mutate()}
                      disabled={seedDefaultsMutation.isPending}
                      className="btn-secondary">
                {seedDefaultsMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Sprout className="w-4 h-4" /> Re-seed defaults</>}
              </button>
            </div>
            <button onClick={() => setDeleteOpen(true)} className="btn-danger w-full">
              <Trash2 className="w-4 h-4" /> Delete pump
            </button>
            <p className="text-[10px] text-slate-400">
              Re-seed adds missing fuel types / machines / settings; existing
              rows are preserved (idempotent).
            </p>
          </div>
        </div>
      )}

      {/* Users */}
      {tab === 'Users' && (
        <div className="space-y-2">
          {(pumpUsers ?? []).length === 0 ? (
            <div className="card text-center py-8 text-slate-400 text-sm">No users found</div>
          ) : (pumpUsers ?? []).map((u: { id: string; first_name: string; last_name: string; email: string; role: string; is_blocked: boolean }) => (
            <div key={u.id} className="card flex items-center gap-3">
              <div className="avatar text-xs">{(u.first_name?.[0] ?? '') + (u.last_name?.[0] ?? '')}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                  {u.first_name} {u.last_name}
                </p>
                <p className="text-xs text-slate-500 truncate">{u.email}</p>
              </div>
              <div className="flex gap-1 items-center">
                <Badge variant="secondary">{u.role}</Badge>
                {u.is_blocked && <Badge variant="destructive">Blocked</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscription */}
      {tab === 'Subscription' && (
        <div className="space-y-4">
          <form
            onSubmit={subsForm.handleSubmit(d => subsMutation.mutate(d))}
            className="card space-y-3"
          >
            <p className="text-xs font-semibold text-slate-500 uppercase">Edit Subscription</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Plan</label>
                <select className="input" {...subsForm.register('subscription_plan', { required: true })}>
                  <option value="BASIC">Basic</option>
                  <option value="STANDARD">Standard</option>
                  <option value="PREMIUM">Premium</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="label">Monthly Fee (₹)</label>
                <input type="number" min="0" step="1" className="input"
                       {...subsForm.register('monthly_fee', { required: true })} />
              </div>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" {...subsForm.register('subscription_status', { required: true })}>
                <option value="ACTIVE">Active</option>
                <option value="TRIAL">Trial</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="EXPIRED">Expired</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <button type="submit" disabled={subsMutation.isPending} className="btn-primary w-full">
              {subsMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Save className="w-4 h-4" /> Save subscription</>}
            </button>
          </form>

          <button onClick={() => setPayOpen(true)} className="btn-primary w-full">
            <Plus className="w-4 h-4" /> Record Payment
          </button>

          <div className="space-y-2">
            {(payments ?? []).length === 0 ? (
              <div className="card text-center py-8 text-slate-400 text-sm">No payments recorded</div>
            ) : (payments ?? []).map((p: { id: string; amount: number; period_month: number; period_year: number; paid_at: string; notes: string }) => (
              <div key={p.id} className="card flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{formatINR(p.amount)}</p>
                  <p className="text-xs text-slate-500 truncate">
                    Month {p.period_month}/{p.period_year}{p.notes ? ` · ${p.notes}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {p.paid_at ? format(new Date(p.paid_at), 'dd MMM yyyy') : ''}
                  </p>
                </div>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings */}
      {tab === 'Settings' && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-slate-800 dark:text-white">Pump Settings</h3>
          <p className="text-sm text-slate-500">
            Per-pump operational settings (geofence, shifts, leave quotas, fuel rates)
            are managed by the pump's Super Admin from the Settings page after they log in.
            Use Re-seed defaults on the Health tab if a pump's settings table is empty.
          </p>
          <InfoRow label="Created" value={pump.created_at ? format(new Date(pump.created_at), 'dd MMM yyyy') : '–'} />
          <InfoRow label="Address" value={pump.address ?? '—'} />
          <InfoRow label="Phone"   value={pump.phone   ?? '—'} />
          <InfoRow label="Email"   value={pump.email   ?? '—'} />
        </div>
      )}

      {/* ─── Dialogs ─── */}
      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title="Record Payment">
        <form onSubmit={subPay(d => paymentMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Amount (₹)</label>
            <input type="number" min="0" step="1" className="input"
                   {...regPay('amount', { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Month</label>
              <select className="input" {...regPay('period_month', { required: true })}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Year</label>
              <input type="number" className="input" defaultValue={new Date().getFullYear()}
                     {...regPay('period_year', { required: true })} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Payment notes…" {...regPay('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPayOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={paymentMutation.isPending} className="btn-primary flex-1">
              {paymentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={suspendOpen}
        title="Suspend Pump?"
        message={`${pump.name} will be marked SUSPENDED and its users will not be able to log in.`}
        confirmLabel="Suspend"
        danger
        onConfirm={() => suspendMutation.mutate()}
        onClose={() => setSuspendOpen(false)}
        loading={suspendMutation.isPending}
      />

      <ConfirmDialog
        open={restoreOpen}
        title="Restore Pump?"
        message={`Reactivate ${pump.name} and let its users log in again.`}
        confirmLabel="Restore"
        onConfirm={() => restoreMutation.mutate()}
        onClose={() => setRestoreOpen(false)}
        loading={restoreMutation.isPending}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Pump?">
        <div className="space-y-3">
          <div className="flex gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <p className="text-xs text-rose-700 dark:text-rose-300">
              Soft-delete <strong>{pump.name}</strong> and cancel its subscription.
              History is preserved. Restore via the platform list.
            </p>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={deleteForce}
                   onChange={e => setDeleteForce(e.target.checked)} className="mt-0.5" />
            <span>Also deactivate every user attached to this pump (otherwise the pump cannot be deleted while it has active users).</span>
          </label>
          <div>
            <label className="label">Type the pump name to confirm</label>
            <input className="input" placeholder={pump.name}
                   value={deleteTyped} onChange={e => setDeleteTyped(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setDeleteOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => deleteMutation.mutate(deleteForce)}
              disabled={
                deleteTyped.trim().toLowerCase() !== pump.name.trim().toLowerCase()
                || deleteMutation.isPending
              }
              className="btn-danger flex-1"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="stat-card">
    <span className="stat-label">{label}</span>
    <span className="stat-value">{value}</span>
  </div>
)

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
    <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-sm font-medium text-slate-800 dark:text-white">{value}</span>
  </div>
)

export default PumpDetail
