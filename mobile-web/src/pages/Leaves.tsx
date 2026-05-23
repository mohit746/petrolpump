// src/pages/Leaves.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { notifyLeaveDecision } from '../lib/notifications'

interface Leave {
  id: string
  employee_id: string
  from_date: string
  to_date: string
  leave_type: string
  reason: string
  status: string
  employee?: { first_name: string; last_name: string; phone: string | null }
}
interface Balance { total_paid_leaves: number; used: number }

const LEAVE_TYPES = ['PLANNED', 'EMERGENCY']
const statusBadge: Record<string, string> = {
  PENDING_ACCOUNTANT: 'badge-yellow',
  PENDING_SUPER_ADMIN: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
}

const Leaves: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { isAdmin, isSuperAdmin, isAccountant } = useRoleAccess()

  const [tab, setTab] = useState<'mine' | 'pending'>('mine')
  const [myLeaves, setMyLeaves] = useState<Leave[]>([])
  const [pendingLeaves, setPendingLeaves] = useState<Leave[]>([])
  const [balance, setBalance] = useState<Balance>({ total_paid_leaves: 15, used: 0 })
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ from_date: '', to_date: '', leave_type: 'PLANNED', reason: '' })

  const canApprove = isAccountant || isAdmin || isSuperAdmin

  useEffect(() => { if (user) { fetchMyLeaves(); fetchBalance(); if (canApprove) fetchPending() } }, [user])

  const fetchMyLeaves = async () => {
    const { data } = await supabase.from('leaves').select('*').eq('employee_id', user!.id).order('created_at', { ascending: false })
    setMyLeaves(data || [])
  }

  const fetchBalance = async () => {
    const { data: s } = await supabase.from('system_settings').select('paid_leaves_per_year').eq('pump_id', user!.pump_id).maybeSingle()
    const year = new Date().getFullYear()
    const { count } = await supabase.from('leaves').select('id', { count: 'exact', head: true })
      .eq('employee_id', user!.id).eq('status', 'APPROVED').eq('leave_type', 'CASUAL')
      .gte('from_date', `${year}-01-01`)
    setBalance({ total_paid_leaves: s?.paid_leaves_per_year || 15, used: count || 0 })
  }

  const fetchPending = async () => {
    const q = supabase.from('leaves').select('*, employee:users!employee_id(first_name, last_name, phone)').eq('pump_id', user!.pump_id).order('created_at')
    if (isAccountant && !isSuperAdmin) q.eq('status', 'PENDING_ACCOUNTANT')
    else if (isSuperAdmin) q.in('status', ['PENDING_ACCOUNTANT', 'PENDING_SUPER_ADMIN'])
    const { data } = await q
    setPendingLeaves(data || [])
  }

  const submitLeave = async () => {
    if (!form.from_date || !form.to_date || !form.reason) { toast.error(t('leaves.fillRequired')); return }
    setSubmitting(true)
    const { error } = await supabase.from('leaves').insert({
      employee_id: user!.id,
      pump_id: user!.pump_id,
      ...form,
      status: 'PENDING_ACCOUNTANT',
    })
    if (error) toast.error(error.message)
    else { toast.success(t('leaves.applied')); setShowForm(false); setForm({ from_date: '', to_date: '', leave_type: 'PLANNED', reason: '' }); fetchMyLeaves() }
    setSubmitting(false)
  }

  const approveLeave = async (leave: Leave) => {
    const newStatus = leave.status === 'PENDING_ACCOUNTANT' && !isSuperAdmin
      ? 'PENDING_SUPER_ADMIN'
      : 'APPROVED'
    const updateData: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'PENDING_SUPER_ADMIN') updateData.accountant_action_at = new Date().toISOString()
    if (newStatus === 'APPROVED') updateData.super_admin_action_at = new Date().toISOString()
    const { error } = await supabase.from('leaves').update(updateData).eq('id', leave.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('leaves.approved'))
    // Notify employee via WhatsApp only when fully approved
    if (newStatus === 'APPROVED' && leave.employee?.phone) {
      await notifyLeaveDecision({
        toName: `${leave.employee.first_name} ${leave.employee.last_name}`,
        toPhone: leave.employee.phone.replace(/\D/g, ''),
        decision: 'APPROVED',
        fromDate: format(new Date(leave.from_date), 'dd MMM yyyy'),
        toDate: format(new Date(leave.to_date), 'dd MMM yyyy'),
      })
    }
    fetchPending(); fetchMyLeaves()
  }

  const rejectLeave = async (leaveId: string) => {
    const leave = pendingLeaves.find(l => l.id === leaveId)
    const { error } = await supabase.from('leaves').update({ status: 'REJECTED' }).eq('id', leaveId)
    if (error) { toast.error(error.message); return }
    toast.success(t('leaves.rejected'))
    // Notify employee via WhatsApp
    if (leave?.employee?.phone) {
      await notifyLeaveDecision({
        toName: `${leave.employee.first_name} ${leave.employee.last_name}`,
        toPhone: leave.employee.phone.replace(/\D/g, ''),
        decision: 'REJECTED',
        fromDate: format(new Date(leave.from_date), 'dd MMM yyyy'),
        toDate: format(new Date(leave.to_date), 'dd MMM yyyy'),
      })
    }
    fetchPending(); fetchMyLeaves()
  }

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.leaves')}</h1>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm text-orange-600 font-medium">
            <PlusIcon className="h-4 w-4" /> {t('leaves.apply')}
          </button>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setTab('mine')} className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'mine' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400'}`}>
            {t('leaves.mine')}
          </button>
          {canApprove && (
            <button onClick={() => setTab('pending')} className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'pending' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400'}`}>
              {t('leaves.pending')} {pendingLeaves.length > 0 && <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">{pendingLeaves.length}</span>}
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        {/* Balance card */}
        {tab === 'mine' && (
          <div className="card p-4 bg-orange-50 border-orange-200">
            <p className="text-sm text-orange-700 font-medium mb-1">{t('leaves.balance')}</p>
            <div className="flex items-end gap-1">
              <span className="text-3xl font-bold text-orange-600">{balance.total_paid_leaves - balance.used}</span>
              <span className="text-sm text-orange-400 mb-1">/ {balance.total_paid_leaves} {t('leaves.days')}</span>
            </div>
            <div className="w-full bg-orange-100 rounded-full h-1.5 mt-2">
              <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${(balance.used / balance.total_paid_leaves) * 100}%` }} />
            </div>
          </div>
        )}

        {tab === 'mine' && myLeaves.map(leave => (
          <div key={leave.id} className="list-item">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-gray-800 text-sm">{leave.leave_type}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(new Date(leave.from_date), 'dd MMM')} – {format(new Date(leave.to_date), 'dd MMM yyyy')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{leave.reason}</p>
              </div>
              <span className={`${statusBadge[leave.status] || 'badge-gray'} text-xs`}>{leave.status.replace(/_/g, ' ')}</span>
            </div>
          </div>
        ))}

        {tab === 'pending' && pendingLeaves.map(leave => (
          <div key={leave.id} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold text-gray-800">{leave.employee?.first_name} {leave.employee?.last_name}</p>
                <p className="text-xs text-gray-500">{leave.leave_type} · {format(new Date(leave.from_date), 'dd MMM')} – {format(new Date(leave.to_date), 'dd MMM')}</p>
              </div>
              <span className="badge-yellow text-xs">{leave.status.replace(/_/g, ' ')}</span>
            </div>
            <p className="text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded-lg">{leave.reason}</p>
            <div className="flex gap-2">
              <button onClick={() => rejectLeave(leave.id)} className="btn-secondary flex-1 text-sm py-2 text-red-600 border-red-200">
                {t('common.reject')}
              </button>
              <button onClick={() => approveLeave(leave)} className="btn-primary flex-1 text-sm py-2">
                {leave.status === 'PENDING_ACCOUNTANT' && !isSuperAdmin ? t('leaves.forwardToAdmin') : t('common.approve')}
              </button>
            </div>
          </div>
        ))}

        {tab === 'mine' && myLeaves.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <CalendarDaysIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>{t('leaves.noLeaves')}</p>
          </div>
        )}
      </div>

      {/* Apply Leave Modal */}
      {showForm && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{t('leaves.applyTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-2xl leading-none">&times;</button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('leaves.startDate')}</label>
                  <input type="date" value={form.from_date} min={format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">{t('leaves.endDate')}</label>
                  <input type="date" value={form.to_date} min={form.from_date || format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} className="input" />
                </div>
              </div>
              <div>
                <label className="label">{t('leaves.type')}</label>
                <select value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))} className="input">
                  {LEAVE_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('leaves.reason')}</label>
                <textarea rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  className="input" placeholder={t('leaves.reasonPlaceholder')} />
              </div>
              <div className="flex gap-3 pt-2 pb-2">
                <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button onClick={submitLeave} disabled={submitting} className="btn-primary flex-1">
                  {submitting ? t('common.loading') : t('leaves.submit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Leaves
