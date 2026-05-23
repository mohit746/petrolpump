// src/pages/Dashboard.tsx
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Gauge, Clock, CalendarDays, Users, TrendingUp, TrendingDown, ArrowRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { formatINR, formatTime } from '../lib/utils'
import { StatusBadge } from '../components/ui/Badge'
import { SkeletonStatGrid, SkeletonList } from '../components/ui/SkeletonCard'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }
const item = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }

// ── Admin / Super Admin Dashboard ───────────────────────────
const AdminDashboard: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const navigate = useNavigate()

  // Compute dates inside component to avoid stale values after midnight
  const today = React.useMemo(() => new Date().toISOString().split('T')[0], [])

  const { data: todaySales, isLoading: salesLoading } = useQuery({
    queryKey: ['daily_sales_today', user?.pump_id, today],
    queryFn: async () => {
      const { data } = await supabase.from('daily_sales')
        .select('*').eq('pump_id', user!.pump_id!).eq('sale_date', today).maybeSingle()
      return data
    },
    refetchInterval: 30_000,
    enabled: !!user?.pump_id,
  })

  const { data: weekSales } = useQuery({
    queryKey: ['week_sales', user?.pump_id, today],
    queryFn: async () => {
      const from = new Date(); from.setDate(from.getDate() - 6)
      const { data } = await supabase.from('daily_sales').select('sale_date,total_ms_litres,total_hsd_litres,total_expected_cash')
        .eq('pump_id', user!.pump_id!)
        .gte('sale_date', from.toISOString().split('T')[0])
        .order('sale_date')
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const { data: pendingLeaves } = useQuery({
    queryKey: ['pending_leaves', user?.pump_id],
    queryFn: async () => {
      const { count } = await supabase.from('leaves').select('*', { count: 'exact', head: true })
        .eq('pump_id', user!.pump_id!).eq('status', 'PENDING')
      return count ?? 0
    },
    enabled: !!user?.pump_id,
  })

  const { data: activeEmployees } = useQuery({
    queryKey: ['active_emp', user?.pump_id],
    queryFn: async () => {
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true })
        .eq('pump_id', user!.pump_id!).eq('is_active', true).is('deleted_at', null)
      return count ?? 0
    },
    enabled: !!user?.pump_id,
  })

  // Today's performance — pricing-aware revenue/cogs/profit and the
  // cash/online/credit split. Sourced from public.day_profit() so the
  // numbers align with v_readings_priced exactly (no client-side maths).
  type DayProfit = {
    pump_id: string; on_date: string;
    total_litres: number; total_revenue: number; total_cogs: number; total_profit: number;
    cash_total: number; online_total: number; credit_total: number;
  }
  const { data: dayProfit } = useQuery({
    queryKey: ['day_profit', user?.pump_id, today],
    queryFn: async (): Promise<DayProfit | null> => {
      const { data, error } = await supabase.rpc('day_profit', {
        p_pump_id: user!.pump_id!, p_date: today,
      })
      if (error) {
        // Don't block the dashboard if the function isn't deployed yet —
        // the rest of the page still works on the legacy daily_sales totals.
        console.warn('[Dashboard] day_profit RPC failed:', error.message)
        return null
      }
      const row = (Array.isArray(data) ? data[0] : data) as DayProfit | null
      return row ?? null
    },
    enabled: !!user?.pump_id,
  })

  const shortfall = todaySales?.shortfall ?? 0
  const PIE_DATA = [
    { name: 'MS', value: todaySales?.total_ms_litres ?? 0, color: '#10b981' },
    { name: 'HSD', value: todaySales?.total_hsd_litres ?? 0, color: '#3b82f6' },
  ]

  const chartData = (weekSales ?? []).map((d: { sale_date: string; total_ms_litres: number; total_hsd_litres: number }) => ({
    date: new Date(d.sale_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    MS: d.total_ms_litres, HSD: d.total_hsd_litres,
  }))

  if (salesLoading) return <div className="p-4 space-y-4"><SkeletonStatGrid /><SkeletonList count={2} /></div>

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="p-4 space-y-4">
      {/* Stat grid */}
      <motion.div variants={item} className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.todaySales')}</span>
          <span className="stat-value">{formatINR(todaySales?.total_expected_cash ?? 0)}</span>
          <span className="text-xs text-slate-400">{(todaySales?.total_ms_litres ?? 0).toFixed(1)}L MS · {(todaySales?.total_hsd_litres ?? 0).toFixed(1)}L HSD</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.cashVariance')}</span>
          <span className={`stat-value ${shortfall >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatINR(Math.abs(shortfall))}
          </span>
          <span className={`text-xs flex items-center gap-1 ${shortfall >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {shortfall >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {shortfall >= 0 ? 'Surplus' : 'Shortfall'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.pendingApprovals')}</span>
          <span className="stat-value">{pendingLeaves}</span>
          <span className="text-xs text-slate-400">Leaves pending</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.activeEmployees')}</span>
          <span className="stat-value">{activeEmployees}</span>
          <span className="text-xs text-slate-400">Staff members</span>
        </div>
      </motion.div>

      {/* Today's performance — pricing-aware (revenue, COGS, profit) +
          the payment-mode split. Only render when there's measurable
          activity so the dashboard stays clean on a fresh pump. */}
      {dayProfit && (dayProfit.total_litres > 0 || dayProfit.total_revenue > 0) && (
        <motion.div variants={item} className="card space-y-3">
          <p className="section-title">{t('dashboard.todayPerformance')}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 py-2.5">
              <p className="text-[10px] text-emerald-600 uppercase font-medium">{t('dashboard.revenue')}</p>
              <p className="text-sm font-bold text-emerald-700">{formatINR(dayProfit.total_revenue)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 py-2.5">
              <p className="text-[10px] text-slate-500 uppercase font-medium">{t('dashboard.cogs')}</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{formatINR(dayProfit.total_cogs)}</p>
            </div>
            <div className={`rounded-lg py-2.5 ${
              dayProfit.total_profit >= 0
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'bg-rose-50 dark:bg-rose-900/20'
            }`}>
              <p className={`text-[10px] uppercase font-medium ${
                dayProfit.total_profit >= 0 ? 'text-blue-600' : 'text-rose-600'
              }`}>{t('dashboard.profit')}</p>
              <p className={`text-sm font-bold ${
                dayProfit.total_profit >= 0 ? 'text-blue-700' : 'text-rose-700'
              }`}>{formatINR(dayProfit.total_profit)}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px] uppercase font-medium pt-2 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-slate-500">{t('dashboard.cash')}</p>
              <p className="text-sm font-semibold text-slate-800 dark:text-white normal-case">
                {formatINR(dayProfit.cash_total)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">{t('dashboard.online')}</p>
              <p className="text-sm font-semibold text-slate-800 dark:text-white normal-case">
                {formatINR(dayProfit.online_total)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">{t('dashboard.credit')}</p>
              <p className="text-sm font-semibold text-slate-800 dark:text-white normal-case">
                {formatINR(dayProfit.credit_total)}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">{t('dashboard.pricedNote')}</p>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div variants={item} className="grid grid-cols-3 gap-2">
        {[
          { label: t('dashboard.enterReadings'), path: '/readings', icon: <Gauge className="w-5 h-5" /> },
          { label: t('dashboard.viewAttendance'), path: '/attendance', icon: <Clock className="w-5 h-5" /> },
          { label: t('dashboard.manageLeaves'), path: '/leaves', icon: <CalendarDays className="w-5 h-5" /> },
        ].map(a => (
          <button key={a.path} onClick={() => navigate(a.path)}
            className="card flex flex-col items-center gap-2 py-4 hover:bg-emerald-50
                       dark:hover:bg-emerald-900/20 hover:border-emerald-200 transition-all group">
            <span className="text-emerald-500 group-hover:scale-110 transition-transform">{a.icon}</span>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 text-center leading-tight">{a.label}</span>
          </button>
        ))}
      </motion.div>

      {/* Charts */}
      {chartData.length > 0 && (
        <motion.div variants={item} className="card">
          <p className="section-title mb-3">{t('dashboard.last7DaysSales')}</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="MS" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="HSD" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {(todaySales?.total_ms_litres || todaySales?.total_hsd_litres) ? (
        <motion.div variants={item} className="card">
          <p className="section-title mb-2">{t('dashboard.fuelBreakdown')}</p>
          <div className="flex items-center gap-4">
            <PieChart width={100} height={100}>
              <Pie data={PIE_DATA} cx={45} cy={45} outerRadius={40} dataKey="value">
                {PIE_DATA.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
            <div className="space-y-2">
              {PIE_DATA.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ background: d.color }} />
                  <span className="text-sm text-slate-600 dark:text-slate-300">{d.name}: {d.value.toFixed(1)}L</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : null}
    </motion.div>
  )
}

// ── Employee Dashboard ───────────────────────────────────────
const EmployeeDashboard: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const navigate = useNavigate()

  // Compute date inside component to avoid stale values after midnight
  const todayDate = React.useMemo(() => new Date().toISOString().split('T')[0], [])

  const { data: today } = useQuery({
    queryKey: ['today_attendance', user?.id, todayDate],
    queryFn: async () => {
      const date = todayDate
      const { data } = await supabase.from('attendance').select('*')
        .eq('user_id', user!.id).eq('shift_date', date).maybeSingle()
      return data
    },
    refetchInterval: 60_000,
    enabled: !!user?.id,
  })

  const { data: lorryCount } = useQuery({
    queryKey: ['lorry_pending', user?.id],
    queryFn: async () => {
      const { count } = await supabase.from('lorry_duties').select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id).eq('status', 'SCHEDULED')
      return count ?? 0
    },
    enabled: !!user?.id,
  })

  // ── Salary snapshot (current month) ──
  // Single row from v_salary_month_summary keyed on (user, year, month).
  // Source-of-truth for "advance taken so far" + "projected payable".
  const monthCursor = React.useMemo(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() + 1 }
  }, [])
  const { data: salary } = useQuery({
    queryKey: ['emp_salary_summary', user?.id, monthCursor.y, monthCursor.m],
    queryFn: async () => {
      if (!user?.id || !user?.pump_id) return null
      const { data, error } = await supabase
        .from('v_salary_month_summary')
        .select('base_salary,advance_total,incentive_total,projected_payable')
        .eq('pump_id', user.pump_id)
        .eq('user_id', user.id)
        .eq('year', monthCursor.y)
        .eq('month', monthCursor.m)
        .maybeSingle()
      if (error) {
        console.warn('[Dashboard] salary summary lookup failed:', error.message)
        return null
      }
      return data as { base_salary: number; advance_total: number; incentive_total: number; projected_payable: number } | null
    },
    enabled: !!user?.id && !!user?.pump_id,
  })

  const hoursWorked = today?.check_in_time
    ? ((today.check_out_time
        ? new Date(today.check_out_time).getTime()
        : Date.now()) - new Date(today.check_in_time).getTime()) / 3600000
    : 0

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="p-4 space-y-4">
      {/* Check-in status */}
      <motion.div variants={item} className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{t('dashboard.todayStatus')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {today
                ? (today.check_out_time ? t('dashboard.shiftComplete') : t('dashboard.checkedIn'))
                : t('dashboard.notCheckedIn')}
            </p>
          </div>
          {today && <StatusBadge status={today.status} />}
        </div>
        {today?.check_in_time && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-400 uppercase">{t('dashboard.checkIn')}</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{formatTime(today.check_in_time)}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-400 uppercase">{t('dashboard.hoursWorked')}</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{hoursWorked.toFixed(1)}h</p>
            </div>
          </div>
        )}
        <button onClick={() => navigate('/attendance')} className="btn-primary w-full">
          {today && !today.check_out_time
            ? t('dashboard.checkOut')
            : today
              ? t('dashboard.viewAttendance')
              : t('dashboard.checkIn')}
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>

      {/* Quick stats */}
      <motion.div variants={item} className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.lorryDuties')}</span>
          <span className="stat-value">{lorryCount}</span>
          <span className="text-xs text-amber-500">{t('dashboard.pendingLabel')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.advanceTaken')}</span>
          <span className="stat-value text-rose-600">{formatINR(salary?.advance_total ?? 0)}</span>
          <span className="text-xs text-slate-400">{format(new Date(), 'MMM yyyy')}</span>
        </div>
      </motion.div>

      {/* Salary snapshot: only useful if we know the base. */}
      {(salary?.base_salary ?? 0) > 0 && (
        <motion.div variants={item} className="card space-y-2">
          <p className="section-title">{t('dashboard.monthEndPayable')}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-600">
              {formatINR(salary?.projected_payable ?? 0)}
            </span>
            <span className="text-xs text-slate-400">
              {t('dashboard.ofBase', { base: formatINR(salary?.base_salary ?? 0) })}
            </span>
          </div>
          <div className="grid grid-cols-3 text-center text-[10px] uppercase font-medium gap-2">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg py-1.5">
              <p className="text-slate-500">{t('dashboard.base')}</p>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">
                {formatINR(salary?.base_salary ?? 0)}
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg py-1.5">
              <p className="text-emerald-600">+ {t('dashboard.incentive')}</p>
              <p className="text-sm font-semibold text-emerald-700">
                {formatINR(salary?.incentive_total ?? 0)}
              </p>
            </div>
            <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg py-1.5">
              <p className="text-rose-600">− {t('dashboard.advance')}</p>
              <p className="text-sm font-semibold text-rose-700">
                {formatINR(salary?.advance_total ?? 0)}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">{t('dashboard.payableNote')}</p>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div variants={item} className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate('/leaves')} className="card flex items-center gap-3 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all">
          <CalendarDays className="w-5 h-5 text-emerald-500" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('dashboard.applyLeave')}</span>
        </button>
        <button onClick={() => navigate('/payslip')} className="card flex items-center gap-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all">
          <Users className="w-5 h-5 text-blue-500" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('dashboard.viewPayslip')}</span>
        </button>
      </motion.div>
    </motion.div>
  )
}

// ── Accountant Dashboard ─────────────────────────────────────
const AccountantDashboard: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()

  const { data: creditData } = useQuery({
    queryKey: ['credit_summary', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('credit_accounts').select('outstanding_balance')
        .eq('pump_id', user!.pump_id!).eq('is_active', true)
      const total = (data ?? []).reduce((sum: number, a: { outstanding_balance: number }) => sum + (a.outstanding_balance ?? 0), 0)
      return { total, count: data?.length ?? 0 }
    },
    enabled: !!user?.pump_id,
  })

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="p-4 space-y-4">
      <motion.div variants={item} className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.outstandingCredit')}</span>
          <span className="stat-value text-rose-600">{formatINR(creditData?.total ?? 0)}</span>
          <span className="text-xs text-slate-400">{t('dashboard.accounts', { count: creditData?.count ?? 0 })}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('dashboard.activeAccounts')}</span>
          <span className="stat-value">{creditData?.count ?? 0}</span>
          <span className="text-xs text-slate-400">{t('dashboard.creditCustomers')}</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Root component ───────────────────────────────────────────
const Dashboard: React.FC = () => {
  const { isManagement, isAccountant } = useRoleAccess()
  if (isManagement) return <AdminDashboard />
  if (isAccountant) return <AccountantDashboard />
  return <EmployeeDashboard />
}

export default Dashboard
