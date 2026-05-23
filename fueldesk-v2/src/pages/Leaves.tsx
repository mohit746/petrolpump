// src/pages/Leaves.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format, differenceInCalendarDays } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/ui/Badge'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

interface LeaveForm { leave_type: 'PLANNED' | 'EMERGENCY'; start_date: string; end_date: string; reason: string }

const Leaves: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isEmployee } = useRoleAccess()
  const [applyOpen, setApplyOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: 'APPROVED' | 'REJECTED' } | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<LeaveForm>({
    defaultValues: { leave_type: 'PLANNED', start_date: today, end_date: today, reason: '' }
  })

  const { data: leaves, isLoading } = useQuery({
    queryKey: ['leaves', user?.pump_id, isEmployee ? user?.id : null],
    queryFn: async () => {
      let q = supabase.from('leaves').select('*, users(first_name, last_name)')
        .eq('pump_id', user!.pump_id!).order('created_at', { ascending: false })
      if (isEmployee) q = q.eq('user_id', user!.id)
      const { data } = await q
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const { data: leaveBalance } = useQuery({
    queryKey: ['leave_balance', user?.id, new Date().getFullYear()],
    queryFn: async () => {
      const currentYear = new Date().getFullYear()

      // Fetch leave policy settings
      const { data: settingsData } = await supabase
        .from('system_settings')
        .select('key, value')
        .eq('pump_id', user!.pump_id!)
        .in('key', ['casual_leaves_annual', 'sick_leaves_annual', 'earned_leaves_annual'])

      const settings: Record<string, number> = {}
      ;(settingsData ?? []).forEach((s: { key: string; value: string }) => {
        settings[s.key] = parseInt(s.value) || 0
      })

      // Count approved leaves for current year
      const { data: approvedLeaves } = await supabase
        .from('leaves')
        .select('start_date, end_date, leave_type')
        .eq('user_id', user!.id)
        .eq('pump_id', user!.pump_id!)
        .eq('status', 'APPROVED')
        .gte('start_date', `${currentYear}-01-01`)
        .lte('end_date', `${currentYear}-12-31`)

      // Calculate total days used (considering month boundaries)
      let casualUsed = 0
      let sickUsed = 0
      let earnedUsed = 0

      ;(approvedLeaves ?? []).forEach((leave: any) => {
        const start = new Date(leave.start_date)
        const end = new Date(leave.end_date)
        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

        // PLANNED → casual, EMERGENCY → sick, anything else → earned.
        // Earned leave requires a dedicated leave type to track accurately.
        if (leave.leave_type === 'PLANNED') {
          casualUsed += days
        } else if (leave.leave_type === 'EMERGENCY') {
          sickUsed += days
        } else {
          earnedUsed += days
        }
      })

      return {
        casual: {
          total: settings.casual_leaves_annual || 12,
          used: casualUsed,
          remaining: Math.max(0, (settings.casual_leaves_annual || 12) - casualUsed)
        },
        sick: {
          total: settings.sick_leaves_annual || 10,
          used: sickUsed,
          remaining: Math.max(0, (settings.sick_leaves_annual || 10) - sickUsed)
        },
        earned: {
          total: settings.earned_leaves_annual || 15,
          used: earnedUsed,
          remaining: Math.max(0, (settings.earned_leaves_annual || 15) - earnedUsed)
        }
      }
    },
    enabled: !!user?.id && isEmployee,
  })

  const applyMutation = useMutation({
    mutationFn: async (d: LeaveForm) => {
      if (d.end_date < d.start_date) throw new Error('End date cannot be before start date')
      await supabase.from('leaves').insert({
        user_id: user!.id, pump_id: user!.pump_id, leave_type: d.leave_type,
        start_date: d.start_date, end_date: d.end_date, reason: d.reason, status: 'PENDING',
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leaves'] }); toast('Leave applied', 'success'); setApplyOpen(false); reset() },
    onError: () => toast('Failed to apply leave', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      // Update leave status
      await supabase.from('leaves').update({
        status: action,
        approved_by: user!.id,
        approved_at: new Date().toISOString()
      }).eq('id', id)

      // Get leave details for notification
      const { data: leave } = await supabase
        .from('leaves')
        .select('*, users(first_name, last_name, phone)')
        .eq('id', id)
        .single()

      if (leave && leave.users) {
        // Send WhatsApp notification
        try {
          const { notifyLeaveApproval } = await import('../lib/notifications')
          await notifyLeaveApproval(
            user!.pump_id!,
            `${leave.users.first_name} ${leave.users.last_name}`,
            leave.users.phone,
            leave.leave_type,
            format(new Date(leave.start_date), 'dd MMM yyyy'),
            format(new Date(leave.end_date), 'dd MMM yyyy'),
            action === 'APPROVED'
          )
        } catch (notifError) {
          console.error('Failed to send notification:', notifError)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] })
      qc.invalidateQueries({ queryKey: ['leave_balance'] })
      toast('Leave updated and notification sent', 'success')
      setConfirmAction(null)
    },
    onError: () => toast('Failed to update leave', 'error'),
  })

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  const pending = leaves?.filter((l: { status: string }) => l.status === 'PENDING') ?? []
  const others = leaves?.filter((l: { status: string }) => l.status !== 'PENDING') ?? []

  return (
    <div className="p-4 space-y-4">
      {/* Leave Balance for Employees */}
      {isEmployee && leaveBalance && (
        <div className="card">
          <p className="section-title">Leave Balance ({new Date().getFullYear()})</p>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs text-blue-600 font-medium">Casual</p>
              <p className="text-lg font-bold text-blue-700">{leaveBalance.casual.remaining}</p>
              <p className="text-[10px] text-blue-500">{leaveBalance.casual.used}/{leaveBalance.casual.total} used</p>
            </div>
            <div className="text-center p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
              <p className="text-xs text-emerald-600 font-medium">Sick</p>
              <p className="text-lg font-bold text-emerald-700">{leaveBalance.sick.remaining}</p>
              <p className="text-[10px] text-emerald-500">{leaveBalance.sick.used}/{leaveBalance.sick.total} used</p>
            </div>
            <div className="text-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              <p className="text-xs text-amber-600 font-medium">Earned</p>
              <p className="text-lg font-bold text-amber-700">{leaveBalance.earned.remaining}</p>
              <p className="text-[10px] text-amber-500">{leaveBalance.earned.used}/{leaveBalance.earned.total} used</p>
            </div>
          </div>
        </div>
      )}

      {isEmployee && (
        <button onClick={() => setApplyOpen(true)} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Apply for Leave
        </button>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <div>
          <p className="section-title">Pending ({pending.length})</p>
          <div className="space-y-2">
            {pending.map((l: { id: string; users: { first_name: string; last_name: string }; leave_type: string; start_date: string; end_date: string; reason: string; status: string }) => (
              <div key={l.id} className="card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    {!isEmployee && <p className="text-sm font-semibold text-slate-800 dark:text-white">{l.users?.first_name} {l.users?.last_name}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <StatusBadge status={l.leave_type} />
                      <span className="text-xs text-slate-500">
                        {format(new Date(l.start_date), 'dd MMM')} – {format(new Date(l.end_date), 'dd MMM')}
                        {' '}({differenceInCalendarDays(new Date(l.end_date), new Date(l.start_date)) + 1}d)
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <p className="text-xs text-slate-500 mb-3 line-clamp-2">{l.reason}</p>
                {!isEmployee && (
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmAction({ id: l.id, action: 'APPROVED' })}
                      className="btn-primary flex-1 py-1.5 text-xs">Approve</button>
                    <button onClick={() => setConfirmAction({ id: l.id, action: 'REJECTED' })}
                      className="btn-danger flex-1 py-1.5 text-xs">Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All others */}
      {others.length > 0 && (
        <div>
          <p className="section-title">History</p>
          <div className="space-y-2">
            {others.map((l: { id: string; users: { first_name: string; last_name: string }; leave_type: string; start_date: string; end_date: string; reason: string; status: string }) => (
              <div key={l.id} className="card flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {!isEmployee && <p className="text-sm font-medium text-slate-800 dark:text-white">{l.users?.first_name} {l.users?.last_name}</p>}
                  <p className="text-xs text-slate-500 truncate">
                    {format(new Date(l.start_date), 'dd MMM')} – {format(new Date(l.end_date), 'dd MMM')} · {l.reason}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(leaves ?? []).length === 0 && (
        <div className="card text-center py-12 text-slate-400">
          <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No leave records</p>
        </div>
      )}

      {/* Apply dialog */}
      <Dialog open={applyOpen} onClose={() => setApplyOpen(false)} title="Apply for Leave">
        <form onSubmit={handleSubmit(d => applyMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Leave Type</label>
            <select className="input" {...register('leave_type')}>
              <option value="PLANNED">Planned</option>
              <option value="EMERGENCY">Emergency</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date</label>
              <input type="date" className="input" min={today} {...register('start_date', { required: true })} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input type="date" className="input" min={today} {...register('end_date', { required: true })} />
            </div>
          </div>
          <div>
            <label className="label">Reason</label>
            <textarea rows={3} className="input resize-none" placeholder="Reason for leave…"
              {...register('reason', { required: true })} />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setApplyOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={applyMutation.isPending} className="btn-primary flex-1">
              {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && updateMutation.mutate(confirmAction)}
        title={`${confirmAction?.action === 'APPROVED' ? 'Approve' : 'Reject'} Leave`}
        message="Are you sure you want to proceed?"
        confirmLabel={confirmAction?.action === 'APPROVED' ? 'Approve' : 'Reject'}
        danger={confirmAction?.action === 'REJECTED'}
        loading={updateMutation.isPending}
      />
    </div>
  )
}

export default Leaves
