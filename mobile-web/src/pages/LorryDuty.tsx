// src/pages/LorryDuty.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { TruckIcon, PlusIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { notifyLorryDuty, notifyLorryRefused } from '../lib/notifications'

interface LorryDuty {
  id: string
  assigned_employee_id: string
  vehicle_number: string
  assigned_date: string
  status: string
  allowance_amount: number
  refusal_reason?: string
  employee?: { first_name: string; last_name: string }
}
interface Employee { id: string; first_name: string; last_name: string; phone: string | null; lorry_duty_count: number; last_lorry_duty_date: string | null }

const statusBadge: Record<string, string> = {
  SCHEDULED: 'badge-yellow', ACCEPTED: 'badge-blue', DEPARTED: 'badge-blue',
  ARRIVED: 'badge-blue', COMPLETED: 'badge-green',
  REFUSED: 'badge-red', CANCELLED: 'badge-gray',
}

const LorryDuty: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { isAdmin, isSuperAdmin } = useRoleAccess()
  const canManage = isAdmin || isSuperAdmin

  const [duties, setDuties] = useState<LorryDuty[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [suggestedEmployee, setSuggestedEmployee] = useState<Employee | null>(null)
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [showRefuseModal, setShowRefuseModal] = useState<string | null>(null)
  const [refusalReason, setRefusalReason] = useState('')
  const [form, setForm] = useState({ vehicle_number: '', assigned_date: format(new Date(), 'yyyy-MM-dd'), allowance_amount: '500', employee_id: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (user) { fetchDuties(); if (canManage) fetchEmployees() } }, [user])

  const fetchDuties = async () => {
    const q = supabase.from('lorry_duties').select('*, employee:users!assigned_employee_id(first_name, last_name)').eq('pump_id', user!.pump_id).order('scheduled_date', { ascending: false })
    if (!canManage) q.eq('assigned_employee_id', user!.id)
    const { data } = await q
    setDuties(data || [])
  }

  const fetchEmployees = async () => {
    const { data } = await supabase.from('users').select('id, first_name, last_name, phone, lorry_duty_count, last_lorry_duty_date')
      .eq('pump_id', user!.pump_id).eq('is_active', true).eq('role', 'EMPLOYEE').order('lorry_duty_count')
    setEmployees(data || [])

    // Rotation suggestion: least count, not currently on duty
    const { data: activeDuties } = await supabase.from('lorry_duties').select('assigned_employee_id').eq('pump_id', user!.pump_id).eq('status', 'IN_PROGRESS')
    const activIds = new Set((activeDuties || []).map(d => d.assigned_employee_id))
    const available = (data || []).filter(e => !activIds.has(e.id))
    setSuggestedEmployee(available[0] || null)
  }

  const assignDuty = async () => {
    if (!form.vehicle_number || !form.employee_id) { toast.error('Fill all required fields'); return }
    setSubmitting(true)
    const tripNumber = `TRIP-${Date.now()}`
    const { error } = await supabase.from('lorry_duties').insert({
      trip_number: tripNumber,
      assigned_employee_id: form.employee_id,
      vehicle_number: form.vehicle_number,
      assigned_date: form.assigned_date,
      allowance_amount: parseFloat(form.allowance_amount),
      pump_id: user!.pump_id,
      status: 'SCHEDULED',
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }

    // Increment lorry_duty_count
    await supabase.rpc('increment_lorry_count', { emp_id: form.employee_id })

    // WhatsApp notify the assigned employee
    const emp = employees.find(e => e.id === form.employee_id)
    if (emp?.phone) {
      await notifyLorryDuty({
        toName: `${emp.first_name} ${emp.last_name}`,
        toPhone: emp.phone.replace(/\D/g, ''),
        date: format(new Date(form.assigned_date), 'dd MMM yyyy'),
        terminal: 'Fuel Terminal',
        allowance: form.allowance_amount,
      })
    }

    toast.success(t('lorry.assigned'))
    setShowAssignForm(false)
    fetchDuties()
    setSubmitting(false)
  }

  const startDuty = async (id: string) => {
    const { error } = await supabase.from('lorry_duties').update({ status: 'DEPARTED', departed_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success(t('lorry.started')); fetchDuties() }
  }

  const completeDuty = async (id: string) => {
    const { error } = await supabase.from('lorry_duties').update({ status: 'COMPLETED', arrived_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success(t('lorry.completed')); fetchDuties() }
  }

  const refuseDuty = async (id: string) => {
    if (!refusalReason.trim()) { toast.error('Please provide a reason'); return }
    const duty = duties.find(d => d.id === id)
    const { error } = await supabase.from('lorry_duties').update({
      status: 'REFUSED', refused_at: new Date().toISOString(), refusal_reason: refusalReason,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }

    // WhatsApp notify the admin about refusal
    const { data: settings } = await supabase.from('system_settings').select('report_whatsapp_number').eq('pump_id', user!.pump_id).maybeSingle()
    if (settings?.report_whatsapp_number) {
      // find next available employee as backup suggestion
      const nextAvailable = employees.find(e => e.id !== duty?.assigned_employee_id)
      await notifyLorryRefused({
        toName: 'Admin',
        toPhone: settings.report_whatsapp_number.replace(/\D/g, ''),
        refusedBy: user ? `${user.first_name} ${user.last_name}` : 'Employee',
        date: duty ? format(new Date(duty.assigned_date), 'dd MMM yyyy') : '',
        backupName: nextAvailable ? `${nextAvailable.first_name} ${nextAvailable.last_name}` : undefined,
      })
    }

    toast.success(t('lorry.refused_msg'))
    setShowRefuseModal(null)
    setRefusalReason('')
    fetchDuties()
  }

  const useSuggestion = () => {
    if (suggestedEmployee) setForm(f => ({ ...f, employee_id: suggestedEmployee.id }))
  }

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.lorry')}</h1>
          {canManage && (
            <button onClick={() => setShowAssignForm(true)} className="flex items-center gap-1 text-sm text-orange-600 font-medium">
              <PlusIcon className="h-4 w-4" /> {t('lorry.assign')}
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        {/* Rotation table (admin only) */}
        {canManage && employees.length > 0 && (
          <div className="card p-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">{t('lorry.rotationTable')}</p>
            <div className="space-y-2">
              {employees.slice(0, 5).map((e, i) => (
                <div key={e.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${i === 0 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                    <span className="text-sm text-gray-700">{e.first_name} {e.last_name}</span>
                    {i === 0 && <span className="badge-green text-xs">Suggested</span>}
                  </div>
                  <span className="text-xs text-gray-400">{e.lorry_duty_count} duties</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!suggestedEmployee && canManage && (
          <div className="card p-3 bg-yellow-50 border-yellow-200 flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 flex-shrink-0" />
            <p className="text-sm text-yellow-700">{t('lorry.noAvailable')}</p>
          </div>
        )}

        {duties.map(duty => (
          <div key={duty.id} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold text-gray-800 flex items-center gap-2">
                  <TruckIcon className="h-4 w-4 text-blue-500" />
                  {duty.vehicle_number}
                </p>
                {canManage && <p className="text-xs text-gray-500 mt-0.5">{duty.employee?.first_name} {duty.employee?.last_name}</p>}
                <p className="text-xs text-gray-400">{format(new Date(duty.assigned_date), 'dd MMM yyyy')}</p>
              </div>
              <div className="text-right">
                <span className={`${statusBadge[duty.status] || 'badge-gray'} text-xs`}>{duty.status}</span>
                <p className="text-sm font-bold text-green-600 mt-1">₹{duty.allowance_amount}</p>
              </div>
            </div>
            {duty.refusal_reason && (
              <p className="text-xs text-red-500 mb-2 bg-red-50 p-2 rounded">{duty.refusal_reason}</p>
            )}
            {/* Actions */}
            <div className="flex gap-2">
              {duty.assigned_employee_id === user!.id && duty.status === 'SCHEDULED' && (
                <>
                  <button onClick={() => setShowRefuseModal(duty.id)} className="btn-secondary flex-1 text-sm py-2 text-red-600 border-red-200">{t('lorry.refuse')}</button>
                  <button onClick={() => startDuty(duty.id)} className="btn-primary flex-1 text-sm py-2">{t('lorry.start')}</button>
                </>
              )}
              {duty.assigned_employee_id === user!.id && duty.status === 'DEPARTED' && (
                <button onClick={() => completeDuty(duty.id)} className="btn-primary flex-1 text-sm py-2">{t('lorry.complete')}</button>
              )}
            </div>
          </div>
        ))}

        {duties.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <TruckIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>{t('lorry.noDuties')}</p>
          </div>
        )}
      </div>

      {/* Assign Modal */}
      {showAssignForm && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{t('lorry.assignTitle')}</h2>
            <div className="space-y-4">
              <div>
                <label className="label">{t('lorry.employee')}</label>
                {suggestedEmployee && (
                  <div className="mb-2 p-2.5 bg-orange-50 border border-orange-200 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-orange-700">{t('lorry.suggested')}: {suggestedEmployee.first_name} {suggestedEmployee.last_name}</p>
                      <p className="text-xs text-orange-400">{suggestedEmployee.lorry_duty_count} previous duties</p>
                    </div>
                    <button onClick={useSuggestion} className="text-xs text-orange-600 font-semibold border border-orange-300 rounded-lg px-2 py-1">Use</button>
                  </div>
                )}
                <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="input">
                  <option value="">{t('common.selectOption')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.lorry_duty_count})</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('lorry.lorryNumber')}</label>
                <input type="text" value={form.vehicle_number} onChange={e => setForm(f => ({ ...f, vehicle_number: e.target.value }))}
                  className="input" placeholder="UP 78 AT 1234" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('lorry.date')}</label>
                  <input type="date" value={form.assigned_date} onChange={e => setForm(f => ({ ...f, assigned_date: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">{t('lorry.allowance')} (₹)</label>
                  <input type="number" value={form.allowance_amount} onChange={e => setForm(f => ({ ...f, allowance_amount: e.target.value }))} className="input" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowAssignForm(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button onClick={assignDuty} disabled={submitting} className="btn-primary flex-1">
                  {submitting ? t('common.loading') : t('lorry.assign')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refuse Modal */}
      {showRefuseModal && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <h2 className="text-lg font-bold text-gray-900 mb-2">{t('lorry.refuseTitle')}</h2>
            <p className="text-sm text-gray-500 mb-4">{t('lorry.refuseSubtitle')}</p>
            <textarea rows={3} value={refusalReason} onChange={e => setRefusalReason(e.target.value)}
              className="input mb-4" placeholder={t('lorry.refusePlaceholder')} />
            <div className="flex gap-3">
              <button onClick={() => setShowRefuseModal(null)} className="btn-secondary flex-1">{t('common.cancel')}</button>
              <button onClick={() => refuseDuty(showRefuseModal)} className="btn-danger flex-1">{t('lorry.confirmRefuse')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LorryDuty
