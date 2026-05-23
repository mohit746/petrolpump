// src/pages/Incentives.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { PlusIcon, GiftIcon } from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { useRoleAccess } from '../hooks/useRoleAccess'

interface Incentive {
  id: string
  employee_id: string
  incentive_type: string
  quantity: number
  rate_per_unit: number
  amount: number
  description: string
  incentive_date: string
  is_paid: boolean
  employee?: { first_name: string; last_name: string }
}
interface Employee { id: string; first_name: string; last_name: string }

const INCENTIVE_TYPES = ['OIL_SALES', 'LUBRICANT_SALES', 'LORRY_DUTY', 'FESTIVAL_BONUS', 'PERFORMANCE', 'OTHER']

const Incentives: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { isAdmin, isSuperAdmin } = useRoleAccess()
  const canManage = isAdmin || isSuperAdmin

  const [incentives, setIncentives] = useState<Incentive[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    employee_id: '', incentive_type: 'OIL_SALES', quantity: '', rate_per_unit: '',
    description: '', incentive_date: format(new Date(), 'yyyy-MM-dd'),
  })

  const amount = (parseFloat(form.quantity) || 0) * (parseFloat(form.rate_per_unit) || 0)

  useEffect(() => { if (user) { fetchIncentives(); if (canManage) fetchEmployees() } }, [user])

  const fetchIncentives = async () => {
    const q = supabase.from('incentives')
      .select('*, employee:users!employee_id(first_name, last_name)')
      .order('incentive_date', { ascending: false })
    if (!canManage) q.eq('employee_id', user!.id)
    const { data } = await q
    setIncentives(data || [])
  }

  const fetchEmployees = async () => {
    const { data } = await supabase.from('users').select('id, first_name, last_name').eq('is_active', true).order('first_name')
    setEmployees(data || [])
  }

  const submit = async () => {
    if (!form.employee_id || !form.quantity || !form.rate_per_unit) { toast.error('Fill all required fields'); return }
    setSubmitting(true)
    const incentiveDate = new Date(form.incentive_date)
    const { error } = await supabase.from('incentives').insert({
      employee_id: form.employee_id,
      incentive_type: form.incentive_type,
      quantity: parseFloat(form.quantity),
      rate_per_unit: parseFloat(form.rate_per_unit),
      amount,
      description: form.description,
      incentive_date: form.incentive_date,
      for_month: incentiveDate.getMonth() + 1,
      for_year: incentiveDate.getFullYear(),
      is_paid: false,
    })
    if (error) toast.error(error.message)
    else { toast.success(t('incentives.added')); setShowForm(false); setForm({ employee_id: '', incentive_type: 'OIL_SALES', quantity: '', rate_per_unit: '', description: '', incentive_date: format(new Date(), 'yyyy-MM-dd') }); fetchIncentives() }
    setSubmitting(false)
  }

  const markPaid = async (id: string) => {
    const { error } = await supabase.from('incentives').update({ is_paid: true, paid_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success(t('incentives.markedPaid')); fetchIncentives() }
  }

  const total = incentives.filter(i => !i.is_paid).reduce((s, i) => s + i.amount, 0)

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.incentives')}</h1>
          {canManage && (
            <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm text-orange-600 font-medium">
              <PlusIcon className="h-4 w-4" /> {t('incentives.add')}
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        {/* Unpaid total */}
        {canManage && total > 0 && (
          <div className="card p-4 bg-green-50 border-green-200">
            <p className="text-sm text-green-700">{t('incentives.unpaidTotal')}</p>
            <p className="text-2xl font-bold text-green-600">₹{total.toLocaleString()}</p>
          </div>
        )}

        {incentives.map(inc => (
          <div key={inc.id} className="list-item">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800 text-sm">{inc.incentive_type.replace(/_/g, ' ')}</p>
                  {inc.is_paid
                    ? <span className="badge-green text-xs">Paid</span>
                    : <span className="badge-yellow text-xs">Unpaid</span>}
                </div>
                {canManage && <p className="text-xs text-gray-500">{inc.employee?.first_name} {inc.employee?.last_name}</p>}
                <p className="text-xs text-gray-400">{format(new Date(inc.incentive_date), 'dd MMM yyyy')} · {inc.quantity} × ₹{inc.rate_per_unit}</p>
                {inc.description && <p className="text-xs text-gray-400 italic">{inc.description}</p>}
              </div>
              <div className="text-right ml-2">
                <p className="font-bold text-green-600">₹{inc.amount.toLocaleString()}</p>
                {!inc.is_paid && canManage && (
                  <button onClick={() => markPaid(inc.id)} className="text-xs text-orange-600 border border-orange-200 rounded-lg px-2 py-0.5 mt-1">
                    {t('incentives.markPaid')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {incentives.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <GiftIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>{t('incentives.none')}</p>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{t('incentives.addTitle')}</h2>
            <div className="space-y-4">
              <div>
                <label className="label">{t('incentives.employee')} *</label>
                <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="input">
                  <option value="">{t('common.selectOption')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('incentives.type')}</label>
                <select value={form.incentive_type} onChange={e => setForm(f => ({ ...f, incentive_type: e.target.value }))} className="input">
                  {INCENTIVE_TYPES.map(t2 => <option key={t2} value={t2}>{t2.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('incentives.quantity')} *</label>
                  <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="input" placeholder="e.g. 10" />
                </div>
                <div>
                  <label className="label">{t('incentives.ratePerUnit')} (₹) *</label>
                  <input type="number" value={form.rate_per_unit} onChange={e => setForm(f => ({ ...f, rate_per_unit: e.target.value }))} className="input" placeholder="e.g. 5" />
                </div>
              </div>
              {amount > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <p className="text-sm text-green-600">{t('incentives.calculatedAmount')}</p>
                  <p className="text-2xl font-bold text-green-700">₹{amount.toLocaleString()}</p>
                </div>
              )}
              <div>
                <label className="label">{t('incentives.description')}</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="label">{t('incentives.date')}</label>
                <input type="date" value={form.incentive_date} onChange={e => setForm(f => ({ ...f, incentive_date: e.target.value }))} className="input" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button onClick={submit} disabled={submitting} className="btn-primary flex-1">
                  {submitting ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Incentives
