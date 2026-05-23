// src/pages/Payslip.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Download, ChevronDown, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import { formatINR } from '../lib/utils'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

const currentYear = new Date().getFullYear()
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const Payslip: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isEmployee, isManagement } = useRoleAccess()
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(currentYear)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: payslips, isLoading } = useQuery({
    queryKey: ['payslips', user?.pump_id, user?.id, month, year, isEmployee],
    queryFn: async () => {
      let q = supabase.from('payslips').select('*, users(first_name,last_name)')
        .eq('pump_id', user!.pump_id!).eq('month', month).eq('year', year)
        .order('created_at', { ascending: false })
      if (isEmployee) q = q.eq('user_id', user!.id)
      const { data } = await q
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const { data: detail } = useQuery({
    queryKey: ['payslip_detail', detailId],
    queryFn: async () => {
      const { data } = await supabase.from('payslips').select('*, users(first_name,last_name,phone,employee_code)')
        .eq('id', detailId!).single()
      return data
    },
    enabled: !!detailId,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees_simple', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,first_name,last_name,salary,role')
        .eq('pump_id', user!.pump_id!).eq('is_active', true).is('deleted_at', null)
      return data ?? []
    },
    enabled: !!user?.pump_id && isManagement,
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Import payslip calculation engine
      const { generateAllPayslips } = await import('../lib/payslip')

      // Generate payslips with calculations for all employees
      const results = await generateAllPayslips(
        month,
        year,
        user!.pump_id!,
        user!.id,
        true // Send WhatsApp notifications
      )

      if (results.failed > 0) {
        throw new Error(`${results.success} succeeded, ${results.failed} failed`)
      }

      return results
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      toast(`${results.success} payslips generated successfully`, 'success')
    },
    onError: (error: Error) => toast(error.message || 'Failed to generate', 'error'),
  })

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {/* Period selector */}
      <div className="flex gap-2">
        <select className="input flex-1" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="input w-28" value={year} onChange={e => setYear(Number(e.target.value))}>
          {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {isManagement && (
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="btn-primary">
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {(payslips ?? []).length === 0 ? (
          <div className="card text-center py-10 text-slate-400">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No payslips for {MONTHS[month - 1]} {year}</p>
          </div>
        ) : (payslips ?? []).map((p: { id: string; users: { first_name: string; last_name: string }; net_salary: number; status: string; basic_salary: number }) => (
          <div key={p.id} className="card flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailId(p.id)}>
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <FileText className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              {!isEmployee && <p className="text-sm font-semibold text-slate-800 dark:text-white">{p.users?.first_name} {p.users?.last_name}</p>}
              <p className="text-xs text-slate-500">Basic: {formatINR(p.basic_salary)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-600">{formatINR(p.net_salary)}</p>
              <Badge variant={p.status === 'PAID' ? 'success' : 'secondary'}>{p.status}</Badge>
            </div>
          </div>
        ))}
      </div>

      {/* Detail modal */}
      <Dialog open={!!detailId} onClose={() => setDetailId(null)} title="Payslip Detail">
        {detail ? (
          <div className="space-y-4">
            <div className="text-center pb-2 border-b border-slate-200 dark:border-slate-700">
              <p className="font-bold text-slate-800 dark:text-white text-lg">{detail.users?.first_name} {detail.users?.last_name}</p>
              <p className="text-sm text-slate-500">{MONTHS[detail.month - 1]} {detail.year}</p>
              {detail.users?.employee_code && <p className="text-xs text-slate-400">Code: {detail.users.employee_code}</p>}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-600 dark:text-slate-400">Basic Salary</span><span className="font-medium">{formatINR(detail.basic_salary)}</span></div>
              {(detail.incentive_total > 0) && <div className="flex justify-between text-emerald-600"><span>Incentives</span><span>+{formatINR(detail.incentive_total)}</span></div>}
              {(detail.lorry_bonus > 0) && <div className="flex justify-between text-emerald-600"><span>Lorry Allowance</span><span>+{formatINR(detail.lorry_bonus)}</span></div>}
              {(detail.overtime_amount > 0) && <div className="flex justify-between text-emerald-600"><span>Overtime</span><span>+{formatINR(detail.overtime_amount)}</span></div>}
              <div className="flex justify-between text-red-500"><span>Deductions</span><span>-{formatINR(detail.deductions ?? 0)}</span></div>
              <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between font-bold text-base">
                <span>Net Salary</span><span className="text-emerald-600">{formatINR(detail.net_salary)}</span>
              </div>
            </div>
            {detail.paid_at && (
              <p className="text-xs text-slate-400 text-center">Paid on {format(new Date(detail.paid_at), 'dd MMM yyyy')}</p>
            )}
            <button className="btn-secondary w-full" onClick={() => window.print()}>
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        ) : (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
        )}
      </Dialog>
    </div>
  )
}

export default Payslip
