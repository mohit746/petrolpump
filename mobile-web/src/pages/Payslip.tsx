// src/pages/Payslip.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, subMonths } from 'date-fns'
import toast from 'react-hot-toast'
import { BanknotesIcon } from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { generateAllPayslips } from '../lib/payslip'

interface Payslip {
  id: string
  employee_id: string
  month: number
  year: number
  days_present: number
  days_absent: number
  base_salary: number
  deductions: number
  incentives_total: number
  lorry_allowances: number
  gross_salary: number
  generated_at: string
  employee?: { first_name: string; last_name: string }
}

const Payslip: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { isAdmin, isSuperAdmin } = useRoleAccess()
  const canManage = isAdmin || isSuperAdmin

  const prev = subMonths(new Date(), 1)
  const [month, setMonth] = useState(prev.getMonth() + 1)
  const [year, setYear] = useState(prev.getFullYear())
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [selected, setSelected] = useState<Payslip | null>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => { if (user) fetchPayslips() }, [user, month, year])

  const fetchPayslips = async () => {
    const q = supabase.from('monthly_payslips')
      .select('*, employee:users!employee_id(first_name, last_name)')
      .eq('month', month).eq('year', year).eq('pump_id', user!.pump_id)
    if (!canManage) q.eq('employee_id', user!.id)
    const { data } = await q
    setPayslips(data || [])
    if (!canManage && data?.length) setSelected(data[0])
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      // Try edge function first (faster, server-side, sends WhatsApp report)
      const { data: { session } } = await supabase.auth.getSession()
      const edgeRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/monthly-report`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ month, year }),
        }
      )
      if (edgeRes.ok) {
        toast.success(t('payslip.generated'))
      } else {
        // Fallback: calculate client-side
        await generateAllPayslips(month, year)
        toast.success(t('payslip.generated'))
      }
      fetchPayslips()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error generating payslips')
    } finally {
      setGenerating(false)
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: format(new Date(2000, i, 1), 'MMMM') }))

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.payslip')}</h1>
          {canManage && (
            <button onClick={handleGenerate} disabled={generating} className="text-sm text-orange-600 font-medium">
              {generating ? t('common.loading') : t('payslip.generate')}
            </button>
          )}
        </div>
        {/* Month/Year selector */}
        <div className="flex gap-2">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="input flex-1 text-sm py-2">
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)} className="input flex-1 text-sm py-2">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="page-content">
        {canManage ? (
          <>
            {payslips.map(p => (
              <button key={p.id} onClick={() => setSelected(p === selected ? null : p)} className="list-item w-full text-left">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">{p.employee?.first_name} {p.employee?.last_name}</p>
                    <p className="text-xs text-gray-500">{p.days_present}d present · {p.days_absent}d absent</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">₹{p.gross_salary.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">net</p>
                  </div>
                </div>
                {selected?.id === p.id && <PayslipDetail payslip={p} />}
              </button>
            ))}
            {payslips.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <BanknotesIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>{t('payslip.noData')}</p>
                <button onClick={handleGenerate} disabled={generating} className="btn-primary mt-4 px-6">
                  {t('payslip.generateNow')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {selected ? <PayslipDetail payslip={selected} showHeader /> : (
              <div className="text-center py-12 text-gray-400">
                <BanknotesIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>{t('payslip.notGenerated')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const PayslipDetail: React.FC<{ payslip: Payslip; showHeader?: boolean }> = ({ payslip: p, showHeader }) => (
  <div className={`${showHeader ? 'card p-4' : 'mt-3 pt-3 border-t'}`}>
    {showHeader && (
      <div className="text-center mb-4 pb-3 border-b">
        <p className="font-bold text-lg text-gray-900">{p.employee?.first_name} {p.employee?.last_name}</p>
        <p className="text-sm text-gray-500">{format(new Date(p.year, p.month - 1, 1), 'MMMM yyyy')} Payslip</p>
      </div>
    )}
    <div className="space-y-1.5 text-sm">
      <div className="flex justify-between"><span className="text-gray-500">Days Present</span><span className="font-medium">{p.days_present}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Days Absent</span><span className="font-medium text-red-500">{p.days_absent}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Basic Salary</span><span className="font-medium">₹{p.base_salary.toLocaleString()}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Incentives</span><span className="font-medium text-green-600">+₹{p.incentives_total.toLocaleString()}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Lorry Allowance</span><span className="font-medium text-green-600">+₹{p.lorry_allowances.toLocaleString()}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Deductions</span><span className="font-medium text-red-500">-₹{p.deductions.toLocaleString()}</span></div>
      <div className="flex justify-between border-t pt-1.5 mt-1.5">
        <span className="font-bold text-gray-800">Net Salary</span>
        <span className="font-bold text-green-600 text-base">₹{p.gross_salary.toLocaleString()}</span>
      </div>
    </div>
    {p.generated_at && <p className="text-xs text-gray-300 mt-2 text-right">Generated {format(new Date(p.generated_at), 'dd MMM yyyy')}</p>}
  </div>
)

export default Payslip
