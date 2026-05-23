import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import {
  PlusIcon, XMarkIcon, CheckIcon, XCircleIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

const LEAVE_TYPES = ['PLANNED', 'EMERGENCY', 'SICK', 'CASUAL']

const statusColors = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
}

// ─── API ───────────────────────────────────────────────────────────────────────
const fetchLeaves = async (token) => {
  const res = await fetch('/api/leaves', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Failed to fetch leaves')
  return res.json()
}

const fetchEmployees = async (token) => {
  const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { data: [] }
  return res.json()
}

const fetchLeaveBalance = async (token) => {
  const res = await fetch('/api/leaves/balance', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { data: null }
  return res.json()
}

const applyLeave = async ({ data, token }) => {
  const res = await fetch('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to apply leave')
  return res.json()
}

const updateLeave = async ({ id, action, reason, token }) => {
  const res = await fetch(`/api/leaves/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, reason }),
  })
  if (!res.ok) throw new Error('Failed to update leave')
  return res.json()
}

// ─── Leave Balance Card ────────────────────────────────────────────────────────
const LeaveBalanceCard = ({ token }) => {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['leave-balance'],
    queryFn: () => fetchLeaveBalance(token),
  })
  const balance = data?.data

  if (!balance) return null

  const types = [
    { key: 'planned',   label: t('leaves.planned'),   total: balance.planned_total,   used: balance.planned_used },
    { key: 'sick',      label: t('leaves.sick'),       total: balance.sick_total,      used: balance.sick_used },
    { key: 'casual',    label: t('leaves.casual'),     total: balance.casual_total,    used: balance.casual_used },
    { key: 'emergency', label: t('leaves.emergency'),  total: balance.emergency_total, used: balance.emergency_used },
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{t('leaves.balance')} — {balance.year}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {types.map(({ key, label, total, used }) => {
          const available = total - used
          const pct = total > 0 ? (used / total) * 100 : 0
          return (
            <div key={key} className="text-center">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <div className="relative mx-auto h-14 w-14 mb-2">
                <svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#6366f1" strokeWidth="3"
                    strokeDasharray={`${pct * 0.942} 94.2`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-gray-900">{available}</span>
                </div>
              </div>
              <p className="text-xs text-gray-400">{used} {t('leaves.used')}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Apply Leave Modal ─────────────────────────────────────────────────────────
const ApplyLeaveModal = ({ employees, onClose, token }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { leave_type: 'PLANNED' },
  })

  const fromDate = watch('from_date')

  const mutation = useMutation({
    mutationFn: (data) => applyLeave({ data, token }),
    onSuccess: () => {
      toast.success(t('leaves.applySuccess'))
      queryClient.invalidateQueries(['leaves'])
      queryClient.invalidateQueries(['leave-balance'])
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{t('leaves.applyLeave')}</h3>
          <button onClick={onClose}><XMarkIcon className="h-6 w-6 text-gray-400 hover:text-gray-600" /></button>
        </div>
        <form onSubmit={handleSubmit(mutation.mutate)} className="p-6 space-y-4">
          <div>
            <label className="label">{t('leaves.leaveType')} *</label>
            <select {...register('leave_type', { required: t('errors.required') })} className="input">
              {LEAVE_TYPES.map(lt => (
                <option key={lt} value={lt}>{t(`leaves.${lt.toLowerCase()}`)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('leaves.fromDate')} *</label>
              <input type="date" {...register('from_date', { required: t('errors.required') })} className="input" />
            </div>
            <div>
              <label className="label">{t('leaves.toDate')} *</label>
              <input type="date"
                {...register('to_date', {
                  required: t('errors.required'),
                  validate: v => !fromDate || v >= fromDate || 'End date must be after start date',
                })}
                className="input"
                min={fromDate}
              />
              {errors.to_date && <p className="text-xs text-red-600 mt-1">{errors.to_date.message}</p>}
            </div>
          </div>
          <div>
            <label className="label">{t('leaves.reason')} *</label>
            <textarea {...register('reason', { required: t('errors.required') })} className="input" rows={3} />
            {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason.message}</p>}
          </div>
          <div>
            <label className="label">{t('leaves.backup')}</label>
            <select {...register('backup_employee_id')} className="input">
              <option value="">— {t('common.select', { defaultValue: 'Select' })} —</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('leaves.backupNotes')}</label>
            <input {...register('backup_notes')} className="input" />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? t('common.loading') : t('common.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const Leaves = () => {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const { isAdmin } = useRoleAccess()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['leaves'],
    queryFn: () => fetchLeaves(token),
  })

  const { data: empData } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees(token),
  })

  const leaves = data?.data || []
  const employees = empData?.data || []

  const filtered = statusFilter === 'ALL' ? leaves : leaves.filter(l => l.status === statusFilter)

  const actionMutation = useMutation({
    mutationFn: ({ id, action, reason }) => updateLeave({ id, action, reason, token }),
    onSuccess: (_, vars) => {
      toast.success(vars.action === 'APPROVE' ? t('leaves.approveSuccess') : t('leaves.rejectSuccess'))
      queryClient.invalidateQueries(['leaves'])
      setRejectingId(null)
      setRejectReason('')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('leaves.title')}</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center space-x-2">
          <PlusIcon className="h-5 w-5" />
          <span>{t('leaves.applyLeave')}</span>
        </button>
      </div>

      <LeaveBalanceCard token={token} />

      {/* Filter */}
      <div className="flex space-x-2 overflow-x-auto pb-1">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'ALL' ? t('common.all') : t(`leaves.${s.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {/* Leave list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border">
            <CalendarDaysIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">{t('leaves.noLeaves')}</p>
          </div>
        ) : (
          filtered.map(leave => (
            <div key={leave.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-gray-900">
                        {leave.employee?.first_name} {leave.employee?.last_name}
                      </span>
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[leave.status]}`}>
                        {t(`leaves.${leave.status.toLowerCase()}`)}
                      </span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {t(`leaves.${leave.leave_type.toLowerCase()}`)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      <CalendarDaysIcon className="inline h-4 w-4 mr-1" />
                      {format(new Date(leave.from_date), 'dd MMM')} → {format(new Date(leave.to_date), 'dd MMM yyyy')}
                      <span className="ml-2 text-gray-400">({leave.total_days} {leave.total_days === 1 ? 'day' : 'days'})</span>
                    </p>
                    <p className="text-sm text-gray-500 mt-1">📝 {leave.reason}</p>
                    {leave.backup_employee && (
                      <p className="text-xs text-blue-600 mt-1">
                        🔄 Backup: {leave.backup_employee.first_name} {leave.backup_employee.last_name}
                      </p>
                    )}
                  </div>

                  {/* Admin actions */}
                  {isAdmin && leave.status === 'PENDING' && (
                    <div className="flex space-x-2 flex-shrink-0">
                      <button
                        onClick={() => actionMutation.mutate({ id: leave.id, action: 'APPROVE' })}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm hover:bg-green-100"
                      >
                        <CheckIcon className="h-4 w-4" />
                        <span>{t('leaves.approve')}</span>
                      </button>
                      <button
                        onClick={() => setRejectingId(leave.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm hover:bg-red-100"
                      >
                        <XCircleIcon className="h-4 w-4" />
                        <span>{t('leaves.reject')}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Reject reason input */}
                {rejectingId === leave.id && (
                  <div className="mt-4 p-3 bg-red-50 rounded-lg space-y-2">
                    <input
                      className="input text-sm"
                      placeholder={t('leaves.rejectionReason')}
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={() => actionMutation.mutate({ id: leave.id, action: 'REJECT', reason: rejectReason })}
                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectReason('') }}
                        className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <ApplyLeaveModal
          employees={employees}
          onClose={() => setShowModal(false)}
          token={token}
        />
      )}
    </div>
  )
}

export default Leaves
