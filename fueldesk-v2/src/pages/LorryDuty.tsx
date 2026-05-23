// src/pages/LorryDuty.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/ui/Badge'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

const STATUS_FLOW: Record<string, string> = {
  ACCEPTED: 'DEPARTED', DEPARTED: 'ARRIVED', ARRIVED: 'COMPLETED',
}

const LorryDuty: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isEmployee, isManagement } = useRoleAccess()
  const [assignOpen, setAssignOpen] = useState(false)
  const [refuseTarget, setRefuseTarget] = useState<string | null>(null)
  const [refuseReason, setRefuseReason] = useState('')
  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, reset } = useForm<{ user_id: string; duty_date: string; notes: string }>()

  const { data: duties, isLoading } = useQuery({
    queryKey: ['lorry_duties', user?.pump_id, isEmployee ? user?.id : null],
    queryFn: async () => {
      let q = supabase.from('lorry_duties').select('*, users(first_name, last_name)')
        .eq('pump_id', user!.pump_id!).order('duty_date', { ascending: false })
      if (isEmployee) q = q.eq('user_id', user!.id)
      const { data } = await q
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const { data: employees } = useQuery({
    queryKey: ['active_employees', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,first_name,last_name')
        .eq('pump_id', user!.pump_id!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('role', ['EMPLOYEE', 'ADMIN'])
      return data ?? []
    },
    enabled: !!user?.pump_id && isManagement,
  })

  const assignMutation = useMutation({
    mutationFn: async (d: { user_id: string; duty_date: string; notes: string }) => {
      await supabase.from('lorry_duties').insert({
        ...d,
        pump_id: user!.pump_id,
        status: 'SCHEDULED',
        assigned_by: user!.id
      })

      // Get employee details for notification
      const { data: employee } = await supabase
        .from('users')
        .select('first_name, last_name, phone')
        .eq('id', d.user_id)
        .single()

      // Send WhatsApp notification
      if (employee) {
        try {
          const { notifyLorryDuty } = await import('../lib/notifications')
          await notifyLorryDuty(
            user!.pump_id!,
            `${employee.first_name} ${employee.last_name}`,
            employee.phone,
            format(new Date(d.duty_date), 'dd MMM yyyy'),
            d.notes
          )
        } catch (notifError) {
          console.error('Failed to send lorry duty notification:', notifError)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lorry_duties'] })
      toast('Duty assigned and notification sent', 'success')
      setAssignOpen(false)
      reset()
    },
    onError: () => toast('Failed to assign duty', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, refusal_reason }: { id: string; status: string; refusal_reason?: string }) => {
      const patch: Record<string, unknown> = { status }
      if (status === 'REFUSED' && refusal_reason) patch.refusal_reason = refusal_reason
      if (status === 'DEPARTED')  patch.departed_at = new Date().toISOString()
      if (status === 'ARRIVED')   patch.arrived_at  = new Date().toISOString()
      // COMPLETED does not overwrite arrived_at — that timestamp was already set
      // in the ARRIVED step and must not be clobbered.

      // Find the duty so we increment the correct user — never assume it's the
      // current session user (an admin may complete on someone else's behalf).
      const duty = (duties ?? []).find((d: { id: string; user_id: string }) => d.id === id)

      await supabase.from('lorry_duties').update(patch).eq('id', id)

      if (status === 'COMPLETED' && duty?.user_id) {
        // RPC signature in migrations.sql: increment_lorry_count(uid UUID)
        try { await supabase.rpc('increment_lorry_count', { uid: duty.user_id }) } catch { /* ignore */ }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lorry_duties'] }); toast('Status updated', 'success') },
    onError: () => toast('Failed to update status', 'error'),
  })

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {isManagement && (
        <button onClick={() => setAssignOpen(true)} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Assign Duty
        </button>
      )}

      <div className="space-y-2">
        {(duties ?? []).length === 0 ? (
          <div className="card text-center py-10 text-slate-400">
            <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No lorry duties</p>
          </div>
        ) : (duties ?? []).map((d: { id: string; users: { first_name: string; last_name: string }; duty_date: string; status: string; notes: string | null }) => (
          <div key={d.id} className="card">
            <div className="flex items-center justify-between mb-2">
              <div>
                {!isEmployee && <p className="text-sm font-semibold text-slate-800 dark:text-white">{d.users?.first_name} {d.users?.last_name}</p>}
                <p className="text-xs text-slate-500">{format(new Date(d.duty_date), 'dd MMM yyyy, EEE')}</p>
                {d.notes && <p className="text-xs text-slate-400 mt-0.5">{d.notes}</p>}
              </div>
              <StatusBadge status={d.status} />
            </div>

            {isEmployee && d.status === 'SCHEDULED' && (
              <div className="flex gap-2 mt-2">
                <button onClick={() => updateMutation.mutate({ id: d.id, status: 'ACCEPTED' })}
                  className="btn-primary flex-1 py-1.5 text-xs">Accept</button>
                <button onClick={() => { setRefuseTarget(d.id); setRefuseReason('') }}
                  className="btn-danger flex-1 py-1.5 text-xs">Refuse</button>
              </div>
            )}
            {isEmployee && STATUS_FLOW[d.status] && (
              <button onClick={() => updateMutation.mutate({ id: d.id, status: STATUS_FLOW[d.status] })}
                className="btn-secondary w-full py-1.5 text-xs mt-2">
                Mark {STATUS_FLOW[d.status]}
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Lorry Duty">
        <form onSubmit={handleSubmit(d => assignMutation.mutate(d))} className="space-y-4">
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
            <label className="label">Duty Date</label>
            <input type="date" className="input" defaultValue={today} {...register('duty_date', { required: true })} />
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea rows={2} className="input resize-none" {...register('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAssignOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={assignMutation.isPending} className="btn-primary flex-1">
              {assignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Assign'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Refuse duty dialog — captures required refusal_reason */}
      <Dialog open={!!refuseTarget} onClose={() => setRefuseTarget(null)} title="Refuse Lorry Duty">
        <div className="space-y-4">
          <div>
            <label className="label">Reason <span className="text-rose-500">*</span></label>
            <textarea rows={3} className="input resize-none" placeholder="Why are you refusing this duty?"
              value={refuseReason} onChange={e => setRefuseReason(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRefuseTarget(null)} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => {
                if (!refuseReason.trim()) { toast('Please provide a reason', 'error'); return }
                updateMutation.mutate({ id: refuseTarget!, status: 'REFUSED', refusal_reason: refuseReason.trim() })
                setRefuseTarget(null); setRefuseReason('')
              }}
              disabled={updateMutation.isPending}
              className="btn-danger flex-1"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refuse'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default LorryDuty
