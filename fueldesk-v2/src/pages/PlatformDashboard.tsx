// src/pages/PlatformDashboard.tsx
//
// Platform Owner home. Shows global rollups, lists every pump (filterable
// by search + status), and offers the New Pump flow which creates the auth
// user + pump + super_admin profile + default seed in one atomic SQL RPC.
//
// All multi-step writes go through public.create_pump_with_super_admin so
// the platform owner's session is never disturbed (the RPC runs server-side
// with SECURITY DEFINER; the only client-side auth call is the supabase
// signUp, after which we immediately restore the platform owner's session).

import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Search, TrendingUp, Activity, Loader2,
  PauseCircle, PlayCircle, Trash2, AlertTriangle, Users as UsersIcon,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import { formatINR, normalizePhone } from '../lib/utils'
import { SkeletonStatGrid, SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import type { Pump, PlatformGlobalStats, SubscriptionStatus } from '../types'

type PumpForm = {
  name: string
  address: string
  city: string
  state: string
  owner_first_name: string
  owner_last_name: string
  owner_email: string
  owner_phone: string
  owner_password: string
  subscription_plan: string
  monthly_fee: string
}

type StatusFilter = 'ALL' | SubscriptionStatus

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED', 'CANCELLED']

const PlatformDashboard: React.FC = () => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [addOpen, setAddOpen] = useState(false)
  const [suspendTarget, setSuspendTarget] = useState<Pump | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Pump | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Pump | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PumpForm>({
    defaultValues: { subscription_plan: 'BASIC', monthly_fee: '0' },
  })

  // ── Stats (single RPC round-trip) ────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['platform_stats'],
    queryFn: async (): Promise<PlatformGlobalStats> => {
      const { data, error } = await supabase.rpc('platform_global_stats')
      if (error) throw new Error(error.message)
      const row = (Array.isArray(data) ? data[0] : data) as PlatformGlobalStats | null
      return row ?? {
        total_pumps: 0, active_pumps: 0, trial_pumps: 0,
        suspended_pumps: 0, cancelled_pumps: 0, expired_pumps: 0,
        mrr: 0, total_users: 0,
      }
    },
  })

  // ── Pump list ───────────────────────────────────────────────
  const { data: pumps, isLoading: pumpsLoading } = useQuery({
    queryKey: ['all_pumps'],
    queryFn: async (): Promise<Pump[]> => {
      const { data, error } = await supabase
        .from('pumps')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as Pump[]
    },
  })

  // ── Compare pumps (cross-tenant performance) ────────────────
  // Sourced from public.v_pump_health (step3 SQL). RLS on the view admits
  // the platform owner across pumps because current_user_role()='PLATFORM_OWNER'.
  type HealthRow = {
    pump_id: string
    name: string
    subscription_status: string
    is_active: boolean
    active_users: number
    blocked_users: number
    revenue_7d: number
    profit_7d: number
    last_payment_at: string | null
    outstanding_credit: number
  }
  const { data: health } = useQuery({
    queryKey: ['pump_health_all'],
    queryFn: async (): Promise<HealthRow[]> => {
      const { data, error } = await supabase
        .from('v_pump_health')
        .select('pump_id,name,subscription_status,is_active,active_users,blocked_users,revenue_7d,profit_7d,last_payment_at,outstanding_credit')
        .order('revenue_7d', { ascending: false })
        .limit(50)
      if (error) {
        // Don't break the page — just hide the comparison.
        console.warn('[Platform] v_pump_health failed:', error.message)
        return []
      }
      return (data ?? []) as HealthRow[]
    },
  })

  // Filter client-side; pump count is small enough that fetching all and
  // filtering avoids round-trips on every keystroke.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (pumps ?? []).filter(p => {
      if (statusFilter !== 'ALL' && p.subscription_status !== statusFilter) return false
      if (!q) return true
      const hay = `${p.name} ${p.city ?? ''} ${p.state ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [pumps, search, statusFilter])

  // ── Add pump (atomic via RPC) ───────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (d: PumpForm) => {
      const password = (d.owner_password || '').trim()
      if (password.length < 6) {
        throw new Error('Owner password is required (min 6 characters)')
      }

      const phone = normalizePhone(d.owner_phone)
      if (phone && phone.length < 10) {
        throw new Error('Owner mobile number must be 10 digits')
      }

      // 1. Save platform owner session BEFORE auth.signUp so we can restore
      //    it after Supabase auto-signs-in the new user.
      const { data: { session: platformSession } } = await supabase.auth.getSession()
      if (!platformSession) throw new Error('Platform owner session not found. Please log in again.')

      // 2. Create the auth.users row for the super admin.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: d.owner_email.trim().toLowerCase(),
        password,
        options: {
          data: {
            first_name: d.owner_first_name,
            last_name: d.owner_last_name,
          },
        },
      })
      if (authError) throw new Error(authError.message)
      if (!authData.user) throw new Error('Auth signUp returned no user')

      // 3. Restore the platform owner's session immediately. If this fails,
      //    abort — the rest of the flow needs platform-owner context for
      //    the SECURITY DEFINER RPC's caller check.
      const { error: restoreError } = await supabase.auth.setSession({
        access_token: platformSession.access_token,
        refresh_token: platformSession.refresh_token,
      })
      if (restoreError) {
        throw new Error('Failed to restore platform owner session. Please log in again.')
      }

      // 4. Single SQL transaction: pump + super_admin profile + defaults.
      const { data: newPumpId, error: rpcError } = await supabase.rpc(
        'create_pump_with_super_admin',
        {
          p_name: d.name,
          p_address: d.address,
          p_city: d.city,
          p_state: d.state,
          p_subscription_plan: d.subscription_plan,
          p_monthly_fee: parseFloat(d.monthly_fee || '0') || 0,
          p_owner_auth_id: authData.user.id,
          p_owner_email: d.owner_email,
          p_owner_first_name: d.owner_first_name,
          p_owner_last_name: d.owner_last_name,
          p_owner_phone: phone || null,
        },
      )
      if (rpcError) throw new Error(rpcError.message)

      // 5. Audit (best-effort).
      void logAudit({
        action: 'pump.create',
        entity_type: 'pumps',
        entity_id: newPumpId as string,
        pump_id: newPumpId as string,
        after: {
          name: d.name,
          subscription_plan: d.subscription_plan,
          monthly_fee: parseFloat(d.monthly_fee || '0') || 0,
          owner_email: d.owner_email,
        },
      })
      void logAudit({
        action: 'users.create',
        entity_type: 'users',
        entity_id: authData.user.id,
        pump_id: newPumpId as string,
        after: { role: 'SUPER_ADMIN', email: d.owner_email },
      })

      return newPumpId as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump created with super admin', 'success')
      setAddOpen(false)
      reset()
    },
    onError: (e: Error) => toast(e.message || 'Failed to add pump', 'error'),
  })

  // ── Lifecycle mutations (suspend / restore / delete) ────────
  const suspendMutation = useMutation({
    mutationFn: async (pumpId: string) => {
      const { error } = await supabase.rpc('platform_suspend_pump', { p_pump_id: pumpId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump suspended', 'success')
      setSuspendTarget(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed to suspend', 'error'),
  })

  const restoreMutation = useMutation({
    mutationFn: async (pumpId: string) => {
      const { error } = await supabase.rpc('platform_restore_pump', { p_pump_id: pumpId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump restored', 'success')
      setRestoreTarget(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed to restore', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ id, force }: { id: string; force: boolean }) => {
      const { error } = await supabase.rpc('platform_delete_pump', { p_pump_id: id, p_force: force })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_pumps'] })
      qc.invalidateQueries({ queryKey: ['platform_stats'] })
      toast('Pump removed', 'success')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed to remove pump', 'error'),
  })

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      {statsLoading ? <SkeletonStatGrid /> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card">
            <Building2 className="w-5 h-5 text-emerald-500" />
            <span className="stat-label">Total Pumps</span>
            <span className="stat-value">{stats?.total_pumps ?? 0}</span>
          </div>
          <div className="stat-card">
            <Activity className="w-5 h-5 text-emerald-500" />
            <span className="stat-label">Active</span>
            <span className="stat-value text-emerald-600">{stats?.active_pumps ?? 0}</span>
          </div>
          <div className="stat-card">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            <span className="stat-label">MRR</span>
            <span className="stat-value text-emerald-600">{formatINR(stats?.mrr ?? 0)}</span>
          </div>
          <div className="stat-card">
            <UsersIcon className="w-5 h-5 text-emerald-500" />
            <span className="stat-label">Total Users</span>
            <span className="stat-value">{stats?.total_users ?? 0}</span>
          </div>
        </div>
      )}

      {/* Compare pumps — top 5 by 7-day revenue. Always visible to platform owner.
          Click a row to drill into that pump. Hidden when no pumps have any
          measurable activity in the last 7 days. */}
      {(health ?? []).some(h => Number(h.revenue_7d) > 0) && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-title">Top Pumps · Last 7 days</p>
            <span className="text-[10px] text-slate-400">by revenue</span>
          </div>
          <div className="space-y-1.5 text-xs">
            {(health ?? [])
              .filter(h => Number(h.revenue_7d) > 0)
              .slice(0, 5)
              .map((h, i) => (
                <button
                  key={h.pump_id}
                  onClick={() => navigate(`/platform/pump/${h.pump_id}`)}
                  className="flex items-center justify-between w-full text-left border-b border-slate-100 dark:border-slate-700 last:border-0 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-1 px-1 rounded transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{h.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {h.active_users} active · {h.subscription_status}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-emerald-600">
                      {formatINR(Number(h.revenue_7d))}
                    </p>
                    <p className={`text-[10px] ${Number(h.profit_7d) >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                      profit {formatINR(Number(h.profit_7d))}
                    </p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Search + filter + Add */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search pumps…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setAddOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Pump</span>
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                statusFilter === f
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Pump list */}
      {pumpsLoading ? <SkeletonList /> : (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="card text-center py-10 text-slate-400">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No pumps found</p>
            </div>
          ) : filtered.map(p => (
            <div key={p.id} className="card flex items-center gap-3">
              <button
                onClick={() => navigate(`/platform/pump/${p.id}`)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30
                                flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {[p.city, p.state].filter(Boolean).join(', ') || '—'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Since {p.created_at ? format(new Date(p.created_at), 'MMM yyyy') : '–'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-emerald-600">{formatINR(p.monthly_fee ?? 0)}/mo</p>
                  <Badge variant={badgeVariant(p.subscription_status)}>{p.subscription_status}</Badge>
                </div>
              </button>
              <div className="flex flex-col gap-1 flex-shrink-0">
                {p.subscription_status === 'SUSPENDED' || !p.is_active ? (
                  <button
                    onClick={() => setRestoreTarget(p)}
                    aria-label="Restore pump"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600
                               hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                  >
                    <PlayCircle className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setSuspendTarget(p)}
                    aria-label="Suspend pump"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600
                               hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <PauseCircle className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(p)}
                  aria-label="Delete pump"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600
                             hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Pump Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add New Pump">
        <form onSubmit={handleSubmit(d => addMutation.mutate(d))} className="space-y-3">
          <div>
            <label className="label">Pump Name *</label>
            <input className="input" placeholder="Sunrise Petrol Pump"
                   {...register('name', { required: 'Pump name is required' })} />
            {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" placeholder="Street address" {...register('address')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">City</label><input className="input" {...register('city')} /></div>
            <div><label className="label">State</label><input className="input" {...register('state')} /></div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Owner (Super Admin)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name *</label>
                <input className="input" {...register('owner_first_name', { required: 'Required' })} />
                {errors.owner_first_name && <p className="text-xs text-rose-500 mt-1">{errors.owner_first_name.message}</p>}
              </div>
              <div>
                <label className="label">Last Name</label>
                <input className="input" {...register('owner_last_name')} />
              </div>
            </div>
            <div className="space-y-3 mt-3">
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input"
                       {...register('owner_email', {
                         required: 'Email is required',
                         pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email' },
                       })} />
                {errors.owner_email && <p className="text-xs text-rose-500 mt-1">{errors.owner_email.message}</p>}
              </div>
              <div>
                <label className="label">Mobile</label>
                <input type="tel" className="input" placeholder="+91 9876543210"
                       {...register('owner_phone')} />
              </div>
              <div>
                <label className="label">Initial Password *</label>
                <input type="text" className="input" placeholder="Min 6 characters" autoComplete="new-password"
                       {...register('owner_password', {
                         required: 'Password is required',
                         minLength: { value: 6, message: 'Min 6 characters' },
                       })} />
                {errors.owner_password && <p className="text-xs text-rose-500 mt-1">{errors.owner_password.message}</p>}
                <p className="text-[10px] text-slate-400 mt-1">Share with owner — they can change after first login.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Subscription</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Plan</label>
                <select className="input" {...register('subscription_plan', { required: true })}>
                  <option value="BASIC">Basic</option>
                  <option value="STANDARD">Standard</option>
                  <option value="PREMIUM">Premium</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="label">Monthly Fee (₹)</label>
                <input type="number" min="0" step="1" className="input"
                       {...register('monthly_fee', { required: true })} />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setAddOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={addMutation.isPending} className="btn-primary flex-1">
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Pump'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!suspendTarget}
        title="Suspend Pump?"
        message={`${suspendTarget?.name ?? 'This pump'} will be marked SUSPENDED and its users will be unable to log in.`}
        confirmLabel="Suspend"
        danger
        onConfirm={() => suspendTarget && suspendMutation.mutate(suspendTarget.id)}
        onClose={() => setSuspendTarget(null)}
        loading={suspendMutation.isPending}
      />

      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore Pump?"
        message={`Reactivate ${restoreTarget?.name ?? 'this pump'} and allow its users to log in again.`}
        confirmLabel="Restore"
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget.id)}
        onClose={() => setRestoreTarget(null)}
        loading={restoreMutation.isPending}
      />

      <DeletePumpDialog
        target={deleteTarget}
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={force => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, force })}
      />
    </div>
  )
}

const badgeVariant = (s: SubscriptionStatus): 'success' | 'destructive' | 'secondary' => {
  if (s === 'ACTIVE') return 'success'
  if (s === 'SUSPENDED' || s === 'CANCELLED' || s === 'EXPIRED') return 'destructive'
  return 'secondary'
}

// Delete needs a typed-confirmation step because it cascades to the pump's
// users when forced. Separate component keeps the parent JSX clean.
const DeletePumpDialog: React.FC<{
  target: Pump | null
  loading: boolean
  onCancel: () => void
  onConfirm: (force: boolean) => void
}> = ({ target, loading, onCancel, onConfirm }) => {
  const [force, setForce] = useState(false)
  const [typed, setTyped] = useState('')

  React.useEffect(() => {
    if (!target) { setForce(false); setTyped('') }
  }, [target])

  if (!target) return null
  const matchesName = typed.trim().toLowerCase() === target.name.trim().toLowerCase()

  return (
    <Dialog open={!!target} onClose={onCancel} title="Delete Pump?">
      <div className="space-y-3">
        <div className="flex gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <p className="text-xs text-rose-700 dark:text-rose-300">
            This soft-deletes <strong>{target.name}</strong> and cancels its subscription.
            History (sales, payslips, audit log) is preserved. Restore via the platform list.
          </p>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="mt-0.5" />
          <span>Also deactivate every user attached to this pump (otherwise the pump cannot be deleted while it has active users).</span>
        </label>
        <div>
          <label className="label">Type the pump name to confirm</label>
          <input className="input" placeholder={target.name}
                 value={typed} onChange={e => setTyped(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={() => onConfirm(force)}
            disabled={!matchesName || loading}
            className="btn-danger flex-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export default PlatformDashboard
