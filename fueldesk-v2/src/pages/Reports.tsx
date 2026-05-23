// src/pages/Reports.tsx
//
// Tenant analytics report. Pulls four RPCs in parallel for the same date
// range — tenant_analytics_daily, tenant_fuel_mix, tenant_top_employees,
// tenant_credit_aging — and renders the result as a printable report with
// CSV exports per section.
//
// All RPCs are SECURITY DEFINER with same-pump gates (step6 SQL) so the
// page is automatically tenant-isolated even if RLS is bypassed.

import React, { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  Loader2, Printer, Download, Calendar, TrendingUp, AlertTriangle,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { format, subDays, startOfMonth } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'
import { downloadCsv, toCsv, type CsvCell } from '../lib/csv'
import { useToast } from '../components/ui/Toast'

// ── RPC return types ───────────────────────────────────────────
interface DailyRow {
  on_date: string
  total_litres: number
  total_revenue: number
  total_cogs: number
  total_profit: number
  cash_total: number
  online_total: number
  credit_total: number
}
interface FuelMixRow {
  fuel_code: string
  total_litres: number
  total_revenue: number
  total_profit: number
}
interface TopEmployeeRow {
  user_id: string
  first_name: string
  last_name: string
  role: string
  completed_duties: number
  incentive_total: number
  rank_score: number
}
interface CreditAgingRow {
  bucket: string
  account_count: number
  outstanding: number
}

// ── Date range presets ─────────────────────────────────────────
type Preset = '7d' | '30d' | 'mtd' | 'custom'

const presetRange = (p: Preset, custom: { from: string; to: string }): { from: string; to: string } => {
  const today = new Date()
  if (p === '7d')   return { from: format(subDays(today, 6), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  if (p === '30d')  return { from: format(subDays(today, 29), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  if (p === 'mtd')  return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  return custom
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899']

const Reports: React.FC = () => {
  const { user } = useAuthStore()
  const { can } = useRoleAccess()
  const { toast } = useToast()
  const pumpId = user?.pump_id ?? null

  const showProfit = can('analytics.profit')

  const [preset, setPreset] = useState<Preset>('7d')
  const [custom, setCustom] = useState({
    from: format(subDays(new Date(), 6), 'yyyy-MM-dd'),
    to:   format(new Date(), 'yyyy-MM-dd'),
  })
  const range = useMemo(() => presetRange(preset, custom), [preset, custom])

  // Parallel queries — keeps the page responsive when one RPC is slow.
  const [dailyQ, fuelQ, topQ, agingQ] = useQueries({
    queries: [
      {
        queryKey: ['rpt_daily', pumpId, range.from, range.to],
        enabled: !!pumpId,
        queryFn: async (): Promise<DailyRow[]> => {
          const { data, error } = await supabase.rpc('tenant_analytics_daily', {
            p_pump_id: pumpId, p_from_date: range.from, p_to_date: range.to,
          })
          if (error) throw new Error(error.message)
          return (data ?? []) as DailyRow[]
        },
      },
      {
        queryKey: ['rpt_fuel_mix', pumpId, range.from, range.to],
        enabled: !!pumpId,
        queryFn: async (): Promise<FuelMixRow[]> => {
          const { data, error } = await supabase.rpc('tenant_fuel_mix', {
            p_pump_id: pumpId, p_from_date: range.from, p_to_date: range.to,
          })
          if (error) throw new Error(error.message)
          return (data ?? []) as FuelMixRow[]
        },
      },
      {
        queryKey: ['rpt_top_emp', pumpId, range.from, range.to],
        enabled: !!pumpId,
        queryFn: async (): Promise<TopEmployeeRow[]> => {
          const { data, error } = await supabase.rpc('tenant_top_employees', {
            p_pump_id: pumpId, p_from_date: range.from, p_to_date: range.to, p_limit: 10,
          })
          if (error) throw new Error(error.message)
          return (data ?? []) as TopEmployeeRow[]
        },
      },
      {
        queryKey: ['rpt_credit_aging', pumpId],
        enabled: !!pumpId,
        queryFn: async (): Promise<CreditAgingRow[]> => {
          const { data, error } = await supabase.rpc('tenant_credit_aging', { p_pump_id: pumpId })
          if (error) throw new Error(error.message)
          return (data ?? []) as CreditAgingRow[]
        },
      },
    ],
  })

  const daily = dailyQ.data ?? []
  const fuelMix = fuelQ.data ?? []
  const topEmployees = topQ.data ?? []
  const aging = agingQ.data ?? []

  const totals = useMemo(() => {
    let revenue = 0, cogs = 0, profit = 0, litres = 0, cash = 0, online = 0, credit = 0
    for (const d of daily) {
      revenue += Number(d.total_revenue) || 0
      cogs    += Number(d.total_cogs)    || 0
      profit  += Number(d.total_profit)  || 0
      litres  += Number(d.total_litres)  || 0
      cash    += Number(d.cash_total)    || 0
      online  += Number(d.online_total)  || 0
      credit  += Number(d.credit_total)  || 0
    }
    return { revenue, cogs, profit, litres, cash, online, credit }
  }, [daily])

  const chartData = useMemo(() => daily.map(d => ({
    label: format(new Date(d.on_date), 'dd MMM'),
    Revenue: Number(d.total_revenue) || 0,
    Profit:  Number(d.total_profit)  || 0,
  })), [daily])

  const fuelPie = useMemo(() => fuelMix.map(f => ({
    name: f.fuel_code,
    value: Number(f.total_litres) || 0,
  })), [fuelMix])

  // ── Export handlers ──
  const exportDaily = () => {
    if (daily.length === 0) { toast('Nothing to export', 'warning'); return }
    const rows: Array<Record<string, CsvCell>> = daily.map(d => ({
      date: d.on_date,
      litres: Number(d.total_litres) || 0,
      revenue: Number(d.total_revenue) || 0,
      ...(showProfit ? { cogs: Number(d.total_cogs) || 0, profit: Number(d.total_profit) || 0 } : {}),
      cash: Number(d.cash_total) || 0,
      online: Number(d.online_total) || 0,
      credit: Number(d.credit_total) || 0,
    }))
    const columns = showProfit
      ? ['date', 'litres', 'revenue', 'cogs', 'profit', 'cash', 'online', 'credit']
      : ['date', 'litres', 'revenue', 'cash', 'online', 'credit']
    const csv = toCsv(rows, {
      columns,
      headerMap: {
        date: 'Date', litres: 'Litres', revenue: 'Revenue', cogs: 'COGS', profit: 'Profit',
        cash: 'Cash', online: 'Online', credit: 'Credit',
      },
      totalsRow: {
        date: 'TOTAL',
        litres: totals.litres,
        revenue: totals.revenue,
        ...(showProfit ? { cogs: totals.cogs, profit: totals.profit } : {}),
        cash: totals.cash,
        online: totals.online,
        credit: totals.credit,
      },
    })
    downloadCsv(`daily_${range.from}_to_${range.to}.csv`, csv)
  }

  const exportTop = () => {
    if (topEmployees.length === 0) { toast('Nothing to export', 'warning'); return }
    const rows = topEmployees.map(e => ({
      name: `${e.first_name} ${e.last_name}`,
      role: e.role,
      completed_duties: e.completed_duties,
      incentive_total: Number(e.incentive_total) || 0,
      rank_score: Number(e.rank_score) || 0,
    }))
    downloadCsv(
      `top_employees_${range.from}_to_${range.to}.csv`,
      toCsv(rows, {
        columns: ['name', 'role', 'completed_duties', 'incentive_total', 'rank_score'],
        headerMap: {
          name: 'Employee', role: 'Role',
          completed_duties: 'Lorry Duties', incentive_total: 'Incentives (₹)', rank_score: 'Score',
        },
      }),
    )
  }

  const exportAging = () => {
    if (aging.length === 0) { toast('Nothing to export', 'warning'); return }
    downloadCsv(
      `credit_aging_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      toCsv(
        aging.map(a => ({ bucket: a.bucket, accounts: a.account_count, outstanding: Number(a.outstanding) || 0 })),
        {
          columns: ['bucket', 'accounts', 'outstanding'],
          headerMap: { bucket: 'Bucket', accounts: 'Accounts', outstanding: 'Outstanding (₹)' },
        },
      ),
    )
  }

  const handlePrint = () => window.print()

  if (!pumpId) {
    return <div className="p-4 card text-sm text-slate-500">No pump assigned.</div>
  }

  const anyError =
    (dailyQ.isError && (dailyQ.error as Error)?.message) ||
    (fuelQ.isError  && (fuelQ.error  as Error)?.message) ||
    (topQ.isError   && (topQ.error   as Error)?.message) ||
    (agingQ.isError && (agingQ.error as Error)?.message)

  return (
    <div className="p-4 space-y-4 printable">
      {/* Range picker + export bar — hidden on print */}
      <div className="card no-print space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 text-slate-400" />
          {(['7d', '30d', 'mtd', 'custom'] as Preset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                preset === p ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {p === '7d' ? 'Last 7 days' :
               p === '30d' ? 'Last 30 days' :
               p === 'mtd' ? 'Month to date' : 'Custom'}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">From</label>
              <input type="date" className="input" value={custom.from}
                max={custom.to}
                onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input" value={custom.to}
                min={custom.from} max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary flex-1">
            <Printer className="w-4 h-4" /> Print / PDF
          </button>
          <button onClick={exportDaily} className="btn-secondary flex-1">
            <Download className="w-4 h-4" /> Daily CSV
          </button>
        </div>
      </div>

      {/* Print-only header so the printed page has context */}
      <div className="hidden print:block">
        <p className="text-xs text-slate-500">
          Period: {range.from} to {range.to}
        </p>
      </div>

      {anyError && (
        <div className="card flex items-start gap-2 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-rose-700 dark:text-rose-300">
            One or more reports failed to load. {anyError}
          </p>
        </div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total Litres" value={totals.litres.toFixed(1) + ' L'} />
        <Stat label="Revenue"       value={formatINR(totals.revenue)} accent="emerald" />
        {showProfit && (
          <>
            <Stat label="COGS"   value={formatINR(totals.cogs)} />
            <Stat label="Profit" value={formatINR(totals.profit)}
                  accent={totals.profit >= 0 ? 'blue' : 'rose'} />
          </>
        )}
      </div>

      {/* Payment-mode split */}
      <div className="card space-y-2">
        <p className="section-title">Payment Mix</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Cash"   value={formatINR(totals.cash)} compact />
          <Stat label="Online" value={formatINR(totals.online)} compact />
          <Stat label="Credit" value={formatINR(totals.credit)} compact />
        </div>
      </div>

      {/* Daily trend chart */}
      <div className="card space-y-2">
        <p className="section-title">Daily Trend</p>
        {dailyQ.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : daily.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No data for the selected range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
              {showProfit && <Bar dataKey="Profit" fill="#3b82f6" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Fuel mix */}
      <div className="card space-y-2">
        <p className="section-title">Fuel Mix</p>
        {fuelQ.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : fuelMix.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No fuel sold in this range.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
            <div className="flex justify-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={fuelPie} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                    {fuelPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 text-xs">
              {fuelMix.map((f, i) => (
                <div key={f.fuel_code} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 last:border-0 py-1">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="font-medium text-slate-700 dark:text-slate-200">{f.fuel_code}</span>
                  </span>
                  <span className="text-slate-500">
                    {Number(f.total_litres).toFixed(1)}L · {formatINR(Number(f.total_revenue))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top employees */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <p className="section-title">Top Employees</p>
          <button onClick={exportTop} className="text-xs text-emerald-600 hover:underline no-print flex items-center gap-1">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {topQ.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : topEmployees.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No measurable activity for this range.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {topEmployees.map((e, i) => (
              <div key={e.user_id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 last:border-0 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-white truncate">
                      {e.first_name} {e.last_name}
                    </p>
                    <p className="text-[10px] text-slate-500">{e.role}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">
                    {e.completed_duties} duties · {formatINR(Number(e.incentive_total))}
                  </p>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                    <TrendingUp className="w-2.5 h-2.5" /> {Number(e.rank_score).toFixed(1)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Credit aging */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <p className="section-title">Credit Aging</p>
          <button onClick={exportAging} className="text-xs text-emerald-600 hover:underline no-print flex items-center gap-1">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {agingQ.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : aging.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No outstanding credit.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {aging.map(a => (
              <div key={a.bucket} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 last:border-0 py-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-200">{a.bucket}</span>
                <span className="text-right">
                  <span className="text-sm font-semibold text-slate-800 dark:text-white">{formatINR(Number(a.outstanding))}</span>
                  <span className="text-[10px] text-slate-400 ml-2">{a.account_count} acct</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const Stat: React.FC<{
  label: string; value: string;
  accent?: 'emerald' | 'rose' | 'blue';
  compact?: boolean
}> = ({ label, value, accent, compact }) => (
  <div className={compact ? 'rounded-lg bg-slate-50 dark:bg-slate-800 p-2' : 'stat-card'}>
    <p className={compact ? 'text-[10px] text-slate-500 uppercase tracking-wide' : 'stat-label'}>{label}</p>
    <p className={`${compact ? 'text-sm' : 'stat-value'} font-bold ${
      accent === 'emerald' ? 'text-emerald-600' :
      accent === 'rose'    ? 'text-rose-600' :
      accent === 'blue'    ? 'text-blue-600' :
      'text-slate-800 dark:text-white'
    }`}>{value}</p>
  </div>
)

export default Reports
