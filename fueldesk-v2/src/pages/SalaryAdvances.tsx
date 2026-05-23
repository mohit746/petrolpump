// src/pages/SalaryAdvances.tsx
//
// Super admin (and accountants — has 'salary.advance.grant') view to:
//   1. See every employee's MTD running totals (base salary, advances taken,
//      incentives earned, projected month-end payable) sourced from
//      public.v_salary_month_summary so the numbers match the payslip engine.
//   2. Grant a new advance for any employee (any amount, any number of times
//      in a month).
//   3. Drill into a single employee to see the line-item history of advances
//      this month.
//
// All money figures are auto-computed in SQL — no client-side aggregation.

import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Loader2, Save, ChevronRight, Search,
  TrendingDown, AlertTriangle, X,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import { formatINR, getInitials } from '../lib/utils'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'

interface SummaryRow {
  user_id: string
  pump_id: string
  year: number
  month: number
  base_salary: number
  salary_type: 'MONTHLY' | 'DAILY'
  advance_total: number
  incentive_total: number
  projected_payable: number
}

interface UserLite {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  role: string
}

interface AdvanceRow {
  id: string
  user_id: string
  amount: number
  granted_on: string
  for_month: number
  for_year: number
  status: 'PENDING' | 'DEDUCTED' | 'CANCELLED'
  notes: string | null
  created_at: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const monthLabel = (m: number, y: number) =>
  format(new Date(y, m - 1, 1), 'MMM yyyy')

const SalaryAdvances: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const pumpId = user?.pump_id ?? null

  // Default to current month/year. Expose setters so the period header picker
  // can navigate to past months for reconciliation.
  const now = useMemo(() => new Date(), [])
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [search, setSearch] = useState('')
  const [grantOpen, setGrantOpen] = useState(false)
  const [drilldown, setDrilldown] = useState<UserLite | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<{ user_id: string; amount: string; notes: string }>()

  // ── Queries ───────────────────────────────────────────────
  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['advances_employees', pumpId],
    queryFn: async () => {
      if (!pumpId) return [] as UserLite[]
      const { data, error } = await supabase
        .from('users')
        .select('id,first_name,last_name,email,phone,role')
        .eq('pump_id', pumpId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .neq('role', 'PLATFORM_OWNER')
        .order('first_name')
      if (error) throw new Error(error.message)
      return (data ?? []) as UserLite[]
    },
    enabled: !!pumpId,
  })

  const { data: summaryRows } = useQuery({
    queryKey: ['salary_summary', pumpId, year, month],
    queryFn: async () => {
      if (!pumpId) return [] as SummaryRow[]
      const { data, error } = await supabase
        .from('v_salary_month_summary')
        .select('*')
        .eq('pump_id', pumpId)
        .eq('year', year)
        .eq('month', month)
      if (error) throw new Error(error.message)
      return (data ?? []) as SummaryRow[]
    },
    enabled: !!pumpId,
  })

  // Employees in side bar use a single map by user_id for O(1) lookup.
  const summaryByUser = useMemo(() => {
    const m = new Map<string, SummaryRow>()
    for (const r of summaryRows ?? []) m.set(r.user_id, r)
    return m
  }, [summaryRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (employees ?? []).filter(e => {
      if (!q) return true
      return (`${e.first_name} ${e.last_name} ${e.email ?? ''} ${e.phone ?? ''}`).toLowerCase().includes(q)
    })
  }, [employees, search])

  // ── Grant advance ────────────────────────────────────────
  const grantMutation = useMutation({
    mutationFn: async (d: { user_id: string; amount: string; notes: string }) => {
      const amount = parseFloat(d.amount)
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be greater than 0')

      // Fetch the employee's current month summary to surface a warning if
      // the new advance pushes the projected payable below zero. The DB
      // doesn't enforce a ceiling — that's a business rule we tell the user
      // about, not a hard block.
      const summary = summaryByUser.get(d.user_id)
      if (summary && summary.base_salary > 0) {
        const nextProjection = summary.base_salary + summary.incentive_total - (summary.advance_total + amount)
        if (nextProjection < 0) {
          // Continue, but caller sees a warning toast on success.
          // We pass a marker so the onSuccess can react.
          ;(d as { _overflow?: number })._overflow = -nextProjection
        }
      }

      const { data: row, error } = await supabase.from('salary_advances').insert({
        pump_id: pumpId,
        user_id: d.user_id,
        amount,
        granted_on: format(new Date(), 'yyyy-MM-dd'),
        for_month: month,
        for_year: year,
        status: 'PENDING',
        granted_by: user!.id,
        notes: d.notes?.trim() || null,
      }).select().single()
      if (error) throw new Error(error.message)

      void logAudit({
        action: 'salary.advance.grant',
        entity_type: 'salary_advances',
        entity_id: row.id,
        after: { user_id: d.user_id, amount, for_month: month, for_year: year },
      })

      return d as { user_id: string; amount: string; notes: string; _overflow?: number }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['salary_summary'] })
      qc.invalidateQueries({ queryKey: ['advances_for_user'] })
      const overflow = result._overflow
      if (overflow && overflow > 0) {
        toast(
          `Advance recorded. Projected month-end payable would now be negative by ${formatINR(overflow)}; finance must reconcile.`,
          'warning',
        )
      } else {
        toast('Advance recorded', 'success')
      }
      setGrantOpen(false); reset()
    },
    onError: (e: Error) => toast(e.message || 'Failed to grant advance', 'error'),
  })

  if (!pumpId) return <div className="p-4 card text-sm text-slate-500">No pump assigned.</div>
  if (empLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {/* Period header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <select
            className="input w-32 text-sm"
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            className="input w-24 text-sm"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
          >
            {[now.getFullYear() - 1, now.getFullYear()].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setGrantOpen(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Grant Advance</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input className="input pl-9" placeholder="Search employees…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Employee list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card text-center py-8 text-slate-400 text-sm">No employees found.</div>
        ) : filtered.map(e => {
          const s = summaryByUser.get(e.id)
          const advance = s?.advance_total ?? 0
          const base = s?.base_salary ?? 0
          const projected = s?.projected_payable ?? Math.max(0, base - advance + (s?.incentive_total ?? 0))
          const overflow = base > 0 && (advance + 0) > (base + (s?.incentive_total ?? 0))

          return (
            <button
              key={e.id}
              onClick={() => setDrilldown(e)}
              className="card flex items-center gap-3 w-full text-left hover:shadow-md transition-shadow"
            >
              <div className="avatar text-sm">{getInitials(e.first_name, e.last_name)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                    {e.first_name} {e.last_name}
                  </span>
                  <Badge variant="secondary">{e.role}</Badge>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Base {formatINR(base)}</span>
                  <span className="text-rose-600">Advance {formatINR(advance)}</span>
                  {(s?.incentive_total ?? 0) > 0 && (
                    <span className="text-emerald-600">+ Incentive {formatINR(s!.incentive_total)}</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${overflow ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatINR(projected)}
                </p>
                <p className="text-[10px] text-slate-400">payable</p>
                {overflow && (
                  <p className="text-[10px] text-rose-500 flex items-center gap-1 justify-end">
                    <AlertTriangle className="w-3 h-3" /> over
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          )
        })}
      </div>

      {/* Grant dialog */}
      <Dialog open={grantOpen} onClose={() => setGrantOpen(false)} title={`Grant Advance — ${monthLabel(month, year)}`}>
        <form onSubmit={handleSubmit(d => grantMutation.mutate(d))} className="space-y-3">
          <div>
            <label className="label">Employee *</label>
            <select className="input" {...register('user_id', { required: 'Pick an employee' })}>
              <option value="">Select…</option>
              {(employees ?? []).map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.role})</option>
              ))}
            </select>
            {errors.user_id && <p className="text-xs text-rose-500 mt-1">{errors.user_id.message}</p>}
          </div>
          <div>
            <label className="label">Amount (₹) *</label>
            <input type="number" min="1" step="1" className="input" placeholder="500"
              {...register('amount', { required: 'Required' })} />
            {errors.amount && <p className="text-xs text-rose-500 mt-1">{errors.amount.message}</p>}
            <p className="text-[10px] text-slate-400 mt-1">
              Multiple advances per month are allowed. Each is auto-summed against month-end payable.
            </p>
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Reason / reference" {...register('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setGrantOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={grantMutation.isPending} className="btn-primary flex-1">
              {grantMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Save className="w-4 h-4" /> Record</>}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Drill-down dialog */}
      <EmployeeAdvancesDialog
        employee={drilldown}
        pumpId={pumpId}
        month={month}
        year={year}
        summary={drilldown ? summaryByUser.get(drilldown.id) : undefined}
        onClose={() => setDrilldown(null)}
      />
    </div>
  )
}

const EmployeeAdvancesDialog: React.FC<{
  employee: UserLite | null
  pumpId: string
  month: number
  year: number
  summary: SummaryRow | undefined
  onClose: () => void
}> = ({ employee, pumpId, month, year, summary, onClose }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [cancelTarget, setCancelTarget] = useState<AdvanceRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['advances_for_user', pumpId, employee?.id, year, month],
    queryFn: async () => {
      if (!employee) return [] as AdvanceRow[]
      const { data, error } = await supabase
        .from('salary_advances')
        .select('*')
        .eq('pump_id', pumpId)
        .eq('user_id', employee.id)
        .eq('for_year', year)
        .eq('for_month', month)
        .order('granted_on', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as AdvanceRow[]
    },
    enabled: !!employee,
  })

  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      // The cancel_advance RPC enforces:
      //   - caller is in the same pump (or platform owner)
      //   - target is PENDING (DEDUCTED rows refuse with P0001)
      // and audit-logs the cancellation.
      const { error } = await supabase.rpc('cancel_advance', {
        p_advance_id: id,
        p_reason: reason || null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances_for_user'] })
      qc.invalidateQueries({ queryKey: ['salary_summary'] })
      qc.invalidateQueries({ queryKey: ['emp_salary_summary'] })
      toast('Advance cancelled', 'success')
      setCancelTarget(null); setCancelReason('')
    },
    onError: (e: Error) => toast(e.message || 'Failed to cancel', 'error'),
  })

  // Reset cancel reason whenever the drill-down dialog reopens for a fresh employee.
  React.useEffect(() => {
    if (!employee) { setCancelTarget(null); setCancelReason('') }
  }, [employee])

  return (
    <Dialog open={!!employee} onClose={onClose} title={employee ? `${employee.first_name} ${employee.last_name}` : ''}>
      <div className="space-y-3">
        {summary && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Base"          value={formatINR(summary.base_salary)} />
            <Stat label="Incentives"    value={formatINR(summary.incentive_total)} accent="emerald" />
            <Stat label="Advance taken" value={formatINR(summary.advance_total)} accent="rose" />
            <Stat label="Projected payable" value={formatINR(summary.projected_payable)} accent="emerald" />
          </div>
        )}
        <p className="text-xs font-semibold text-slate-500 uppercase">Advances this month</p>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-emerald-500" /></div>
        ) : (rows ?? []).length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No advances yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(rows ?? []).map(r => (
              <div key={r.id} className="flex items-start justify-between border-b border-slate-100 dark:border-slate-700 last:border-0 py-1.5 gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-rose-600 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> {formatINR(r.amount)}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {format(new Date(r.granted_on), 'dd MMM yyyy')}{r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge variant={r.status === 'DEDUCTED' ? 'success' : r.status === 'CANCELLED' ? 'destructive' : 'secondary'}>
                    {r.status}
                  </Badge>
                  {r.status === 'PENDING' && (
                    <button
                      onClick={() => setCancelTarget(r)}
                      aria-label="Cancel advance"
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Inline cancel confirmation. Embedded in the same dialog so the
            user keeps the context of which advance they're cancelling. */}
        {cancelTarget && (
          <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-800 dark:text-rose-300">
                Cancel <strong>{formatINR(cancelTarget.amount)}</strong> advance from{' '}
                {format(new Date(cancelTarget.granted_on), 'dd MMM yyyy')}? This cannot be
                undone — record a reverse incentive instead if it was already paid out.
              </p>
            </div>
            <input
              className="input text-xs"
              placeholder="Reason (optional, recorded in audit log)"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setCancelTarget(null); setCancelReason('') }}
                className="btn-secondary flex-1 text-xs py-1.5"
              >
                Keep
              </button>
              <button
                onClick={() => cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason })}
                disabled={cancelMutation.isPending}
                className="btn-danger flex-1 text-xs py-1.5"
              >
                {cancelMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : 'Cancel advance'}
              </button>
            </div>
          </div>
        )}

        <button onClick={onClose} className="btn-secondary w-full">Close</button>
      </div>
    </Dialog>
  )
}

const Stat: React.FC<{ label: string; value: string; accent?: 'emerald' | 'rose' }> = ({ label, value, accent }) => (
  <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
    <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
    <p className={`text-sm font-bold ${
      accent === 'rose' ? 'text-rose-600' :
      accent === 'emerald' ? 'text-emerald-600' :
      'text-slate-800 dark:text-white'
    }`}>{value}</p>
  </div>
)

export default SalaryAdvances
