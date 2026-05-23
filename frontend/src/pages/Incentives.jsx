import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { PlusIcon, XMarkIcon, GiftIcon, CurrencyRupeeIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

const INCENTIVE_TYPES = ['PERFORMANCE', 'ATTENDANCE', 'FESTIVAL', 'OVERTIME', 'CUSTOM']
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

// ─── API ──────────────────────────────────────────────────────────────────────
const fetchIncentives = async (token, filters) => {
  const params = new URLSearchParams(filters)
  const res = await fetch(`/api/incentives?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Failed to fetch incentives')
  return res.json()
}

const addIncentive = async ({ data, token }) => {
  const res = await fetch('/api/incentives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to add incentive')
  return res.json()
}

const markPaid = async ({ id, token }) => {
  const res = await fetch(`/api/incentives/${id}/pay`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to mark as paid')
  return res.json()
}

const typeColors = {
  PERFORMANCE:  'bg-purple-100 text-purple-800',
  ATTENDANCE:   'bg-green-100 text-green-800',
  FESTIVAL:     'bg-orange-100 text-orange-800',
  OVERTIME:     'bg-blue-100 text-blue-800',
  CUSTOM:       'bg-gray-100 text-gray-700',
}

// ─── Add Incentive Modal ────────────────────────────────────────────────────────
const AddIncentiveModal = ({ employees, onClose, token }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      incentive_type: 'PERFORMANCE',
      for_month: new Date().getMonth() + 1,
      for_year: new Date().getFullYear(),
    },
  })

  const mutation = useMutation({
    mutationFn: (data) => addIncentive({ data, token }),
    onSuccess: () => {
      toast.success(t('incentives.saveSuccess'))
      queryClient.invalidateQueries(['incentives'])
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{t('incentives.addIncentive')}</h3>
          <button onClick={onClose}><XMarkIcon className="h-6 w-6 text-gray-400 hover:text-gray-600" /></button>
        </div>
        <form onSubmit={handleSubmit(mutation.mutate)} className="p-6 space-y-4">
          <div>
            <label className="label">{t('incentives.employee')} *</label>
            <select {...register('employee_id', { required: t('errors.required') })} className="input">
              <option value="">— Select —</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
              ))}
            </select>
            {errors.employee_id && <p className="text-xs text-red-600 mt-1">{errors.employee_id.message}</p>}
          </div>
          <div>
            <label className="label">{t('incentives.type')} *</label>
            <select {...register('incentive_type', { required: t('errors.required') })} className="input">
              {INCENTIVE_TYPES.map(it => (
                <option key={it} value={it}>{t(`incentives.${it.toLowerCase().replace('attendance', 'attendanceBonus')}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('incentives.amount')} *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
              <input type="number" step="0.01" min="0"
                {...register('amount', { required: t('errors.required'), min: 0 })}
                className="input pl-7" placeholder="0.00"
              />
            </div>
            {errors.amount && <p className="text-xs text-red-600 mt-1">{errors.amount.message}</p>}
          </div>
          <div>
            <label className="label">{t('incentives.description')}</label>
            <textarea {...register('description')} className="input" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('incentives.month')}</label>
              <select {...register('for_month')} className="input">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{t(`common.${m}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('incentives.year')}</label>
              <input type="number" {...register('for_year')} className="input"
                defaultValue={new Date().getFullYear()} min={2020} max={2030}
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const Incentives = () => {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const { isAdmin } = useRoleAccess()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())

  const { data, isLoading } = useQuery({
    queryKey: ['incentives', filterMonth, filterYear],
    queryFn: () => fetchIncentives(token, { month: filterMonth, year: filterYear }),
  })

  const { data: empData } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token}` } })
      return res.json()
    },
    enabled: isAdmin,
  })

  const incentives = data?.data || []
  const employees = empData?.data || []

  const totalAmount = incentives.reduce((s, i) => s + Number(i.amount), 0)
  const paidAmount = incentives.filter(i => i.is_paid).reduce((s, i) => s + Number(i.amount), 0)
  const pendingAmount = totalAmount - paidAmount

  const payMutation = useMutation({
    mutationFn: (id) => markPaid({ id, token }),
    onSuccess: () => {
      toast.success('Marked as paid!')
      queryClient.invalidateQueries(['incentives'])
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('incentives.title')}</h1>
        {isAdmin && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center space-x-2">
            <PlusIcon className="h-5 w-5" />
            <span>{t('incentives.addIncentive')}</span>
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-xs text-gray-500 uppercase font-medium">{t('incentives.totalIncentives')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">₹{totalAmount.toLocaleString('en-IN')}</p>
          <p className="text-sm text-gray-400 mt-1">{incentives.length} records</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-5">
          <p className="text-xs text-green-700 uppercase font-medium">{t('incentives.paidAmount')}</p>
          <p className="text-2xl font-bold text-green-800 mt-1">₹{paidAmount.toLocaleString('en-IN')}</p>
          <p className="text-sm text-green-600 mt-1">{incentives.filter(i => i.is_paid).length} paid</p>
        </div>
        <div className="bg-orange-50 rounded-xl border border-orange-100 p-5">
          <p className="text-xs text-orange-700 uppercase font-medium">{t('incentives.pendingAmount')}</p>
          <p className="text-2xl font-bold text-orange-800 mt-1">₹{pendingAmount.toLocaleString('en-IN')}</p>
          <p className="text-sm text-orange-600 mt-1">{incentives.filter(i => !i.is_paid).length} pending</p>
        </div>
      </div>

      {/* Month/Year filter */}
      <div className="flex space-x-3">
        <select className="input w-40" value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{t(`common.${m}`)}</option>)}
        </select>
        <input type="number" className="input w-28" value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} min={2020} max={2030} />
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : incentives.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <GiftIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t('incentives.noIncentives')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {incentives.map(inc => (
              <div key={inc.id} className="flex items-center justify-between p-5 hover:bg-gray-50">
                <div className="flex items-center space-x-4">
                  <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-sm">
                    {inc.employee?.first_name?.[0]}{inc.employee?.last_name?.[0]}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{inc.employee?.first_name} {inc.employee?.last_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColors[inc.incentive_type]}`}>
                        {inc.incentive_type}
                      </span>
                      {inc.description && <span className="text-xs text-gray-400">{inc.description}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 flex items-center">
                      <CurrencyRupeeIcon className="h-4 w-4 text-gray-400" />
                      {Number(inc.amount).toLocaleString('en-IN')}
                    </p>
                    <p className="text-xs text-gray-400">
                      {t(`common.${MONTHS[inc.for_month - 1]}`)} {inc.for_year}
                    </p>
                  </div>
                  {inc.is_paid ? (
                    <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-semibold">
                      {t('incentives.paid')}
                    </span>
                  ) : isAdmin ? (
                    <button
                      onClick={() => payMutation.mutate(inc.id)}
                      disabled={payMutation.isPending}
                      className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 font-medium"
                    >
                      {t('incentives.markPaid')}
                    </button>
                  ) : (
                    <span className="text-xs bg-orange-100 text-orange-800 px-2.5 py-1 rounded-full font-semibold">
                      {t('incentives.unpaid')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddIncentiveModal employees={employees} onClose={() => setShowModal(false)} token={token} />
      )}
    </div>
  )
}

export default Incentives
