// src/pages/Dashboard.tsx
import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import {
  CalendarDaysIcon, TruckIcon, BanknotesIcon,
  ArrowRightOnRectangleIcon, GlobeAltIcon, BeakerIcon,
  CurrencyRupeeIcon, ExclamationTriangleIcon, CheckCircleIcon,
  UserGroupIcon, ChartBarIcon,
} from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { useConfirm } from '../hooks/useConfirm'
import ConfirmDialog from '../components/ConfirmDialog'

// ─── Types ────────────────────────────────────────────────────────────────────
interface TodayAttendance {
  check_in_time: string | null
  check_out_time: string | null
  status: string | null
}

interface DailySales {
  sale_date: string
  total_ms_litres: number
  total_hsd_litres: number
  total_expected_cash: number
  cash_collected: number
  online_collected: number
  credit_given: number
  shortfall: number
  is_locked: boolean
}

interface ReadingStatus {
  total: number
  locked: number
}

// ─── Helper ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN')}`
const fmtL = (n: number) => `${n.toLocaleString('en-IN')} L`
// Computed once at module load — not inside the component so they don't change on re-render
const TODAY     = format(new Date(), 'yyyy-MM-dd')
const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd')

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuthStore()
  const { isAdmin, isSuperAdmin, isAccountant, isEmployee, can } = useRoleAccess()
  const { confirm, dialogProps } = useConfirm()

  const isHindi   = i18n.language?.startsWith('hi')

  // Stable date refs — prevent useCallback/useEffect from re-firing on every render

  // ── Shared state ──────────────────────────────────────────────────────────
  const [pumpName, setPumpName] = useState('')

  // ── EMPLOYEE / shared state ────────────────────────────────────────────────
  const [todayAtt, setTodayAtt]         = useState<TodayAttendance | null>(null)
  const [pendingLeaves, setPendingLeaves] = useState(0)
  const [pendingLorry, setPendingLorry]   = useState(0)
  const [monthStats, setMonthStats]       = useState({ present: 0, absent: 0 })

  // ── ADMIN / SUPER_ADMIN state ─────────────────────────────────────────────
  const [lastSales, setLastSales]         = useState<DailySales | null>(null)
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>({ total: 0, locked: 0 })
  const [employeeCount, setEmployeeCount] = useState(0)
  const [todayCreditGiven, setTodayCreditGiven] = useState(0)

  // ── ACCOUNTANT state ──────────────────────────────────────────────────────
  const [creditOutstanding, setCreditOutstanding] = useState(0)
  const [creditCount, setCreditCount]             = useState(0)

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return
    const pumpId   = user.pump_id
    const role     = user.role
    const uid      = user.id
    const isAdminRole     = role === 'SUPER_ADMIN' || role === 'ADMIN'
    const isAccountantRole = role === 'ACCOUNTANT'
    const canAttendance   = role !== 'PLATFORM_OWNER'
    const canLeaves       = role !== 'PLATFORM_OWNER'
    const canLorry        = role !== 'PLATFORM_OWNER'

    // Pump name (all roles)
    if (pumpId) {
      supabase.from('system_settings').select('pump_name').eq('pump_id', pumpId).maybeSingle()
        .then(({ data }) => { if (data?.pump_name) setPumpName(data.pump_name) })
    }

    // ── EMPLOYEE / ADMIN / SUPER_ADMIN: attendance ──────────────────────────
    if (canAttendance) {
      supabase.from('attendance').select('check_in_time, check_out_time, status')
        .eq('employee_id', uid).eq('attendance_date', TODAY).maybeSingle()
        .then(({ data }) => setTodayAtt(data))

      const monthStart = format(new Date(), 'yyyy-MM-01')
      supabase.from('attendance').select('status')
        .eq('employee_id', uid).gte('attendance_date', monthStart).lte('attendance_date', TODAY)
        .then(({ data }) => {
          const present = (data || []).filter(r => ['PRESENT', 'LATE'].includes(r.status)).length
          const absent  = (data || []).filter(r => r.status === 'ABSENT').length
          setMonthStats({ present, absent })
        })
    }

    // ── Pending leaves ──────────────────────────────────────────────────────
    if (canLeaves && pumpId) {
      const q = supabase.from('leaves').select('id', { count: 'exact', head: true }).eq('pump_id', pumpId)
      if (isAdminRole) q.in('status', ['PENDING_ACCOUNTANT', 'PENDING_SUPER_ADMIN'])
      else q.eq('employee_id', uid).in('status', ['PENDING_ACCOUNTANT', 'PENDING_SUPER_ADMIN'])
      q.then(({ count }) => setPendingLeaves(count || 0))
    }

    // ── Pending lorry duties ────────────────────────────────────────────────
    if (canLorry && pumpId) {
      const q = supabase.from('lorry_duties').select('id', { count: 'exact', head: true }).eq('pump_id', pumpId)
      if (isAdminRole) q.eq('status', 'SCHEDULED')
      else q.eq('assigned_employee_id', uid).eq('status', 'SCHEDULED')
      q.then(({ count }) => setPendingLorry(count || 0))
    }

    // ── ADMIN / SUPER_ADMIN: YESTERDAY's sales ──────────────────────────────
    if (isAdminRole && pumpId) {
      supabase.from('daily_sales').select('*').eq('pump_id', pumpId).eq('sale_date', YESTERDAY).maybeSingle()
        .then(({ data }) => setLastSales(data))

      supabase.from('daily_readings').select('id, is_locked', { count: 'exact' }).eq('pump_id', pumpId).eq('reading_date', TODAY)
        .then(({ data }) => {
          const total  = data?.length || 0
          const locked = (data || []).filter(r => r.is_locked).length
          setReadingStatus({ total, locked })
        })

      supabase.from('users').select('id', { count: 'exact', head: true }).eq('pump_id', pumpId).is('deleted_at', null)
        .then(({ count }) => setEmployeeCount(count || 0))

      // Live today's credit given (fresh from credit_entries, not from saved daily_sales)
      supabase.from('credit_entries').select('amount').eq('pump_id', pumpId).eq('credit_date', TODAY)
        .then(({ data }) => {
          const total = (data || []).reduce((s, c) => s + Number(c.amount), 0)
          setTodayCreditGiven(total)
        })
    }

    // ── ACCOUNTANT: credit summary ──────────────────────────────────────────
    if (isAccountantRole && pumpId) {
      supabase.from('credit_customers').select('total_outstanding').eq('pump_id', pumpId)
        .then(({ data }) => {
          const total = (data || []).reduce((s, c) => s + (c.total_outstanding || 0), 0)
          setCreditOutstanding(total)
          setCreditCount((data || []).filter(c => c.total_outstanding > 0).length)
        })

      supabase.from('daily_sales').select('*').eq('pump_id', pumpId).eq('sale_date', YESTERDAY).maybeSingle()
        .then(({ data }) => setLastSales(data))
    }
  }, [user])  // Only re-run when user object changes — all other deps are stable

  useEffect(() => { load() }, [load])

  const handleLogout = async () => {
    const ok = await confirm({ title: 'Sign Out', message: 'Are you sure you want to sign out?', confirmLabel: 'Yes, Sign Out', variant: 'warning' })
    if (ok) logout()
  }

  const handleLangChange = async () => {
    const next = isHindi ? 'English' : 'हिंदी'
    const ok = await confirm({ title: 'Change Language', message: `Switch to ${next}?`, confirmLabel: `Switch to ${next}`, variant: 'info' })
    if (ok) i18n.changeLanguage(isHindi ? 'en' : 'hi')
  }

  const checkedIn  = !!todayAtt?.check_in_time
  const checkedOut = !!todayAtt?.check_out_time

  // ── Shortfall badge ────────────────────────────────────────────────────────
  const ShortfallBadge = ({ value }: { value: number }) => {
    if (value > 50)   return <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">↓ {fmt(value)} short</span>
    if (value < -50)  return <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">↑ {fmt(Math.abs(value))} surplus</span>
    return <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">✓ Balanced</span>
  }

  return (
    <div className="page">
      {/* ── Header (shared) ── */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 pt-12 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-orange-100 text-sm">{pumpName || 'Petrol Pump'}</p>
            <h1 className="text-2xl font-bold mt-0.5">
              {t('dashboard.greeting', { name: user?.first_name })}
            </h1>
            <p className="text-orange-100 text-sm mt-1">{format(new Date(), 'EEEE, dd MMM yyyy')}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleLangChange} className="bg-white/20 rounded-xl p-2 backdrop-blur-sm">
              <GlobeAltIcon className="h-5 w-5" />
            </button>
            <button onClick={handleLogout} className="bg-white/20 rounded-xl p-2 backdrop-blur-sm">
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Check-in pill — only for attendance-capable roles */}
        {can('attendance') && (
          <div className="mt-4">
            {checkedIn && !checkedOut
              ? <span className="bg-green-400/30 text-white text-sm px-4 py-1.5 rounded-full font-medium">
                  ✓ Checked in · {format(new Date(todayAtt!.check_in_time!), 'hh:mm a')}
                </span>
              : checkedOut
              ? <span className="bg-white/20 text-white text-sm px-4 py-1.5 rounded-full">✓ Shift complete</span>
              : <Link to="/attendance" className="bg-red-400/30 text-white text-sm px-4 py-1.5 rounded-full font-medium">
                  ● Not checked in — Tap to check in
                </Link>}
          </div>
        )}

        {/* ACCOUNTANT: role pill */}
        {isAccountant && (
          <div className="mt-4">
            <span className="bg-white/20 text-white text-sm px-4 py-1.5 rounded-full">📊 Accountant View</span>
          </div>
        )}
      </div>

      <div className="page-content -mt-2">

        {/* ══════════════════════════════════════════════════════════
            SUPER_ADMIN / ADMIN VIEW
        ══════════════════════════════════════════════════════════ */}
        {isAdmin && (
          <>
            {/* Yesterday's Sales Summary */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Yesterday's Sales · {format(new Date(YESTERDAY), 'dd MMM')}
              </p>
              {lastSales ? (
                <div className="card p-4 space-y-3">
                  {/* Litres row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-orange-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-500 mb-1">MS (Petrol)</p>
                      <p className="text-xl font-bold text-orange-600">{fmtL(lastSales.total_ms_litres)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-500 mb-1">HSD (Diesel)</p>
                      <p className="text-xl font-bold text-blue-600">{fmtL(lastSales.total_hsd_litres)}</p>
                    </div>
                  </div>
                  {/* Cash row */}
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Expected Cash</span>
                      <span className="font-semibold">{fmt(lastSales.total_expected_cash)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Cash Collected</span>
                      <span className="font-semibold text-green-600">{fmt(lastSales.cash_collected)}</span>
                    </div>
                    {lastSales.online_collected > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Online / UPI</span>
                        <span className="font-semibold text-blue-600">{fmt(lastSales.online_collected)}</span>
                      </div>
                    )}
                    {lastSales.credit_given > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Credit Given</span>
                        <span className="font-semibold text-amber-600">{fmt(lastSales.credit_given)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-sm border-t pt-2">
                      <span className="font-semibold text-gray-700">Status</span>
                      <ShortfallBadge value={lastSales.shortfall} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card p-4 bg-gray-50 border border-gray-200">
                  <p className="text-sm text-gray-500 text-center">No sales recorded for YESTERDAY</p>
                  <p className="text-xs text-gray-400 text-center mt-1">Complete TODAY's readings and close the day to see reports here</p>
                </div>
              )}
            </div>

            {/* Today's Readings Status */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Today's Readings</p>
              <Link to="/readings" className="card p-4 flex items-center gap-4 active:scale-95 transition-transform">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${readingStatus.total === 0 ? 'bg-gray-100' : readingStatus.locked === readingStatus.total ? 'bg-green-100' : 'bg-amber-100'}`}>
                  <BeakerIcon className={`h-6 w-6 ${readingStatus.total === 0 ? 'text-gray-400' : readingStatus.locked === readingStatus.total ? 'text-green-600' : 'text-amber-600'}`} />
                </div>
                <div className="flex-1">
                  {readingStatus.total === 0 ? (
                    <>
                      <p className="font-semibold text-gray-700">No readings entered yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Tap to enter TODAY's nozzle readings</p>
                    </>
                  ) : readingStatus.locked === readingStatus.total ? (
                    <>
                      <p className="font-semibold text-green-700">All readings locked ✓</p>
                      <p className="text-xs text-gray-400 mt-0.5">{readingStatus.total} nozzle{readingStatus.total !== 1 ? 's' : ''} completed</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-amber-700">In progress</p>
                      <p className="text-xs text-gray-400 mt-0.5">{readingStatus.locked} of {readingStatus.total} nozzles locked</p>
                    </>
                  )}
                </div>
                <span className="text-gray-400 text-sm">→</span>
              </Link>
            </div>

            {/* Today's Credit Given — live from credit_entries */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Today's Credit</p>
              <Link to="/credits" className="card p-4 flex items-center gap-4 active:scale-95 transition-transform">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${todayCreditGiven > 0 ? 'bg-amber-100' : 'bg-gray-100'}`}>
                  <CurrencyRupeeIcon className={`h-6 w-6 ${todayCreditGiven > 0 ? 'text-amber-600' : 'text-gray-400'}`} />
                </div>
                <div className="flex-1">
                  {todayCreditGiven > 0 ? (
                    <>
                      <p className="font-semibold text-amber-700">🤝 Credit given today</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="font-bold text-amber-800">{fmt(todayCreditGiven)}</span> — fuel dispensed on credit, not collected as cash
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-gray-700">No credit given today</p>
                      <p className="text-xs text-gray-400 mt-0.5">All fuel sold for cash</p>
                    </>
                  )}
                </div>
                <span className="text-gray-400 text-sm">→</span>
              </Link>
            </div>

            {/* Alert cards */}
            <div className="space-y-3">
              {pendingLeaves > 0 && (
                <Link to="/leaves" className="card p-4 flex items-center gap-3 bg-yellow-50 border-yellow-200">
                  <CalendarDaysIcon className="h-6 w-6 text-yellow-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-yellow-800 text-sm">{pendingLeaves} leave request{pendingLeaves !== 1 ? 's' : ''} need approval</p>
                  </div>
                  <span className="text-yellow-600 text-xs">→</span>
                </Link>
              )}
              {pendingLorry > 0 && (
                <Link to="/lorry" className="card p-4 flex items-center gap-3 bg-blue-50 border-blue-200">
                  <TruckIcon className="h-6 w-6 text-blue-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-blue-800 text-sm">{pendingLorry} lorry dut{pendingLorry !== 1 ? 'ies' : 'y'} scheduled</p>
                  </div>
                  <span className="text-blue-600 text-xs">→</span>
                </Link>
              )}
            </div>

            {/* SUPER_ADMIN only: quick stats row */}
            {isSuperAdmin && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Overview</p>
                <div className="grid grid-cols-3 gap-3">
                  <Link to="/employees" className="stat-card text-center active:scale-95 transition-transform">
                    <UserGroupIcon className="h-6 w-6 text-orange-500 mx-auto mb-1" />
                    <span className="stat-value">{employeeCount}</span>
                    <span className="stat-label">Employees</span>
                  </Link>
                  <Link to="/credits" className="stat-card text-center active:scale-95 transition-transform">
                    <CurrencyRupeeIcon className="h-6 w-6 text-red-500 mx-auto mb-1" />
                    <span className="stat-value text-sm">{creditCount}</span>
                    <span className="stat-label">Credit Accounts</span>
                  </Link>
                  <Link to="/settings" className="stat-card text-center active:scale-95 transition-transform">
                    <ChartBarIcon className="h-6 w-6 text-blue-500 mx-auto mb-1" />
                    <span className="stat-value text-sm">⚙️</span>
                    <span className="stat-label">Settings</span>
                  </Link>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            ACCOUNTANT VIEW
        ══════════════════════════════════════════════════════════ */}
        {isAccountant && (
          <>
            {/* Credit Outstanding */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Credit Outstanding</p>
              <div className="card p-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <CurrencyRupeeIcon className="h-7 w-7 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-3xl font-bold text-red-600">{fmt(creditOutstanding)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{creditCount} customer{creditCount !== 1 ? 's' : ''} with outstanding balance</p>
                  </div>
                </div>
                <Link to="/credits" className="btn-primary w-full text-center py-3 mt-3 block">
                  View Credit Management →
                </Link>
              </div>
            </div>

            {/* Yesterday's cash summary */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Yesterday's Cash · {format(new Date(YESTERDAY), 'dd MMM')}
              </p>
              {lastSales ? (
                <div className="card p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Expected Cash</span>
                    <span className="font-semibold">{fmt(lastSales.total_expected_cash)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Cash Collected</span>
                    <span className="font-semibold text-green-600">{fmt(lastSales.cash_collected)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Online / UPI</span>
                    <span className="font-semibold text-blue-600">{fmt(lastSales.online_collected)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-t pt-2">
                    <span className="font-semibold">Result</span>
                    <ShortfallBadge value={lastSales.shortfall} />
                  </div>
                </div>
              ) : (
                <div className="card p-4 bg-gray-50 text-center">
                  <p className="text-sm text-gray-400">No sales data for YESTERDAY</p>
                </div>
              )}
            </div>

            {/* Quick actions for accountant */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</p>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/credits" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                  <CurrencyRupeeIcon className="h-8 w-8 text-red-500" />
                  <span className="text-sm font-medium text-gray-700">Credit / Khata</span>
                </Link>
                <Link to="/payslip" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                  <BanknotesIcon className="h-8 w-8 text-green-500" />
                  <span className="text-sm font-medium text-gray-700">Payslips</span>
                </Link>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            EMPLOYEE VIEW
        ══════════════════════════════════════════════════════════ */}
        {isEmployee && (
          <>
            {/* Alert banners */}
            <div className="space-y-3">
              {pendingLeaves > 0 && (
                <Link to="/leaves" className="card p-4 flex items-center gap-3 bg-yellow-50 border-yellow-200">
                  <CalendarDaysIcon className="h-6 w-6 text-yellow-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-yellow-800 text-sm">{pendingLeaves} leave request{pendingLeaves !== 1 ? 's' : ''} pending</p>
                  </div>
                  <span className="text-yellow-600 text-xs">→</span>
                </Link>
              )}
              {pendingLorry > 0 && (
                <Link to="/lorry" className="card p-4 flex items-center gap-3 bg-blue-50 border-blue-200">
                  <TruckIcon className="h-6 w-6 text-blue-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-blue-800 text-sm">You have {pendingLorry} lorry dut{pendingLorry !== 1 ? 'ies' : 'y'} scheduled</p>
                  </div>
                  <span className="text-blue-600 text-xs">→</span>
                </Link>
              )}
            </div>

            {/* Quick actions */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('dashboard.quickActions')}</p>
              <div className="grid grid-cols-2 gap-3">
                {can('attendance') && (
                  <Link to="/attendance" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                    <CalendarDaysIcon className="h-8 w-8 text-orange-500" />
                    <span className="text-sm font-medium text-gray-700">{t('nav.attendance')}</span>
                  </Link>
                )}
                {can('leaves') && (
                  <Link to="/leaves" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                    <span className="text-3xl">🌴</span>
                    <span className="text-sm font-medium text-gray-700">{t('nav.leaves')}</span>
                  </Link>
                )}
                {can('lorry_duty') && (
                  <Link to="/lorry" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                    <TruckIcon className="h-8 w-8 text-blue-500" />
                    <span className="text-sm font-medium text-gray-700">{t('nav.lorry')}</span>
                  </Link>
                )}
                {can('payslip') && (
                  <Link to="/payslip" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                    <BanknotesIcon className="h-8 w-8 text-green-500" />
                    <span className="text-sm font-medium text-gray-700">{t('nav.payslip')}</span>
                  </Link>
                )}
                {can('readings') && (
                  <Link to="/readings" className="card p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform">
                    <BeakerIcon className="h-8 w-8 text-purple-500" />
                    <span className="text-sm font-medium text-gray-700">Readings</span>
                  </Link>
                )}
              </div>
            </div>

            {/* Month stats */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('dashboard.myStats')} (This Month)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="stat-card text-center">
                  <CheckCircleIcon className="h-6 w-6 text-green-500 mx-auto mb-1" />
                  <span className="stat-value text-green-600">{monthStats.present}</span>
                  <span className="stat-label">Days Present</span>
                </div>
                <div className="stat-card text-center">
                  <ExclamationTriangleIcon className="h-6 w-6 text-red-400 mx-auto mb-1" />
                  <span className="stat-value text-red-500">{monthStats.absent}</span>
                  <span className="stat-label">Days Absent</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default Dashboard
