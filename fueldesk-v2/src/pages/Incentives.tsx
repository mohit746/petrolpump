// src/pages/Incentives.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Gift, Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

const TYPES = ['OIL_SALES', 'LUBRICANT_SALES', 'LORRY_DUTY', 'FESTIVAL_BONUS', 'PERFORMANCE', 'CUSTOM']

const Incentives: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isEmployee, isManagement } = useRoleAccess()
  const [open, setOpen] = useState(false)

  const { register, handleSubmit, reset } = useForm<{ user_id: string; type: string; amount: string; description: string }>()

  const { data: incentives, isLoading } = useQuery({
    queryKey: ['incentives', user?.pump_id, isEmployee ? user?.id : null],
    queryFn: async () => {
      let q = supabase.from('incentives').select('*, users(first_name, last_name)')
        .eq('pump_id', user!.pump_id!)
        .order('awarded_at', { ascending: false })
      if (isEmployee) q = q.eq('user_id', user!.id)
      const { data } = await q
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees_simple', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,first_name,last_name')
        .eq('pump_id', user!.pump_id!).eq('is_active', true).is('deleted_at', null)
      return data ?? []
    },
    enabled: !!user?.pump_id && isManagement,
  })

  const awardMutation = useMutation({
    mutationFn: async (d: { user_id: string; type: string; amount: string; description: string }) => {
      await supabase.from('incentives').insert({
        user_id: d.user_id, pump_id: user!.pump_id, type: d.type,
        amount: parseFloat(d.amount), description: d.description,
        awarded_by: user!.id, awarded_at: new Date().toISOString(), is_paid: false,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['incentives'] }); toast('Incentive awarded', 'success'); setOpen(false); reset() },
    onError: () => toast('Failed to award incentive', 'error'),
  })

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('incentives').update({
        is_paid: true,
        paid_at: new Date().toISOString(),
      }).eq('id', id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['incentives'] }); toast('Marked as paid', 'success') },
    onError: () => toast('Failed to update', 'error'),
  })

  const totalMonth = (incentives ?? []).filter((i: { awarded_at: string }) => {
    const d = new Date(i.awarded_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).reduce((sum: number, i: { amount: number }) => sum + i.amount, 0)

  const totalUnpaid = (incentives ?? []).filter((i: { is_paid: boolean }) => !i.is_paid)
    .reduce((sum: number, i: { amount: number }) => sum + i.amount, 0)

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <span className="stat-label">This Month</span>
          <span className="stat-value text-emerald-600">{formatINR(totalMonth)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unpaid</span>
          <span className="stat-value text-amber-600">{formatINR(totalUnpaid)}</span>
        </div>
      </div>

      {isManagement && (
        <button onClick={() => setOpen(true)} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Award Incentive
        </button>
      )}

      <div className="space-y-2">
        {(incentives ?? []).length === 0 ? (
          <div className="card text-center py-10 text-slate-400">
            <Gift className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No incentives yet</p>
          </div>
        ) : (incentives ?? []).map((i: { id: string; users: { first_name: string; last_name: string }; type: string; amount: number; description: string; awarded_at: string; is_paid: boolean }) => (
          <div key={i.id} className="card flex items-center gap-3">
            <div className="avatar"><Gift className="w-4 h-4" /></div>
            <div className="flex-1 min-w-0">
              {!isEmployee && <p className="text-sm font-semibold text-slate-800 dark:text-white">{i.users?.first_name} {i.users?.last_name}</p>}
              <p className="text-xs text-slate-500 truncate">{i.type.replace(/_/g, ' ')} · {i.description}</p>
              <p className="text-[10px] text-slate-400">{format(new Date(i.awarded_at), 'dd MMM yyyy')}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-600">{formatINR(i.amount)}</p>
              <p className={`text-[10px] ${i.is_paid ? 'text-emerald-500' : 'text-amber-500'}`}>{i.is_paid ? 'Paid' : 'Pending'}</p>
              {!i.is_paid && isManagement && (
                <button
                  onClick={() => markPaidMutation.mutate(i.id)}
                  disabled={markPaidMutation.isPending}
                  className="mt-1 text-[10px] text-emerald-600 border border-emerald-200 rounded-md px-2 py-0.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                >
                  Mark Paid
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Award Incentive">
        <form onSubmit={handleSubmit(d => awardMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Employee</label>
            <select className="input" {...register('user_id', { required: true })}>
              <option value="">Select employee…</option>
              {(employees ?? []).map((e: { id: string; first_name: string; last_name: string }) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" {...register('type', { required: true })}>
              <option value="">Select type…</option>
              {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount (₹)</label>
            <input type="number" className="input" placeholder="0" {...register('amount', { required: true })} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Brief description" {...register('description')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={awardMutation.isPending} className="btn-primary flex-1">
              {awardMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Award'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

export default Incentives
