// src/pages/Employees.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  PlusIcon, UserGroupIcon, MagnifyingGlassIcon,
  EllipsisVerticalIcon, ShieldExclamationIcon,
  TrashIcon, LockOpenIcon, PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'

interface Employee {
  id: string
  first_name: string
  last_name: string
  phone: string
  email: string
  role: string
  is_active: boolean
  is_blocked: boolean
  blocked_reason: string | null
  deleted_at: string | null
  base_salary: number
  date_of_joining: string
  lorry_duty_count: number
}

type FilterType = 'all' | 'active' | 'blocked'
const ROLES = ['EMPLOYEE', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN']
const emptyForm = { first_name: '', last_name: '', phone: '', email: '', role: 'EMPLOYEE', base_salary: '', date_of_joining: '', password: '' }

const Employees: React.FC = () => {
  const { t } = useTranslation()
  const { user: currentUser } = useAuthStore()
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN'
  const AVAILABLE_ROLES = isSuperAdmin ? ROLES : ROLES.filter(r => r !== 'SUPER_ADMIN')
  const { confirm, dialogProps } = useConfirm()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('active')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [actionEmp, setActionEmp] = useState<Employee | null>(null)
  const [blockModal, setBlockModal] = useState<Employee | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [modalLoading, setModalLoading] = useState(false)

  useEffect(() => { fetchEmployees() }, [currentUser])

  const fetchEmployees = async () => {
    if (!currentUser?.pump_id) return
    const { data } = await supabase.from('users')
      .select('id, first_name, last_name, phone, email, role, is_active, is_blocked, blocked_reason, deleted_at, base_salary, date_of_joining, lorry_duty_count')
      .eq('pump_id', currentUser.pump_id)
      .order('first_name')
    setEmployees(data || [])
  }

  const displayed = employees.filter(e => {
    if (e.deleted_at && !isSuperAdmin) return false
    if (!`${e.first_name} ${e.last_name} ${e.phone} ${e.email}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'active') return !e.is_blocked && !e.deleted_at && e.is_active
    if (filter === 'blocked') return e.is_blocked && !e.deleted_at
    return true // 'all' - super admin sees deleted too
  })

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowForm(true) }
  const openEdit = (emp: Employee) => {
    setEditing(emp)
    setForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      phone: emp.phone || '',
      email: emp.email || '',
      role: emp.role,
      base_salary: String(emp.base_salary),
      date_of_joining: emp.date_of_joining || '',
      password: '',
    })
    setActionEmp(null)
    setShowForm(true)
  }

  const submit = async () => {
    if (!form.first_name || !form.last_name || !form.base_salary) {
      toast.error(t('leaves.fillRequired')); return
    }
    setSubmitting(true)

    if (editing) {
      // UPDATE existing employee
      const { error } = await supabase.from('users').update({
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        role: form.role,
        base_salary: parseFloat(form.base_salary),
        date_of_joining: form.date_of_joining || null,
      }).eq('id', editing.id)
      if (error) {
        toast.error(error.message)
        setSubmitting(false)
        return
      }
      toast.success(t('employees.updated'))
      setShowForm(false)
      fetchEmployees()
    } else {
      // CREATE new employee
      if (!form.phone && !form.email) {
        toast.error('Enter at least a phone number or email'); setSubmitting(false); return
      }
      if (!form.password) {
        toast.error('Password is required'); setSubmitting(false); return
      }
      // Use real email if provided, otherwise generate from phone digits
      const authEmail = form.email.trim() ||
        `${form.phone.replace(/\D/g, '')}@pump.local`

      // ⚠️ CRITICAL: Save admin session BEFORE signUp
      // When email confirmation is OFF, signUp auto-logs-in as new user, killing admin session
      const { data: { session: adminSession } } = await supabase.auth.getSession()

      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: authEmail,
        password: form.password,
        options: { emailRedirectTo: undefined },
      })
      if (authErr || !authData.user) {
        toast.error(authErr?.message || 'Auth error'); setSubmitting(false); return
      }

      // ⚠️ Restore admin session immediately after signUp
      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        })
      }

      const { error } = await supabase.from('users').insert({
        auth_id: authData.user.id,
        email: authEmail,          // always store the auth email (real or generated)
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        role: form.role,
        base_salary: parseFloat(form.base_salary),
        date_of_joining: form.date_of_joining || null,
        pump_id: currentUser!.pump_id,
        is_active: true,
        is_blocked: false,
      })
      if (error) toast.error(error.message)
      else { toast.success(t('employees.created')); setShowForm(false); fetchEmployees() }
    }
    setSubmitting(false)
  }

  // ── Block (SUPER_ADMIN only) ──────────────────────────────────────────────
  // Block: user stays in DB, but cannot log in. Excluded from payslips, reports, notifications.
  const initiateBlock = (emp: Employee) => {
    setBlockModal(emp)
    setBlockReason('')
    setActionEmp(null)
  }

  const confirmBlock = async () => {
    if (!blockModal) return
    setModalLoading(true)
    const { error } = await supabase.from('users').update({
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: blockReason || null,
      is_active: false,
    }).eq('id', blockModal.id)
    if (error) toast.error(error.message)
    else { toast.success(t('employees.blocked')); fetchEmployees() }
    setModalLoading(false)
    setBlockModal(null)
  }

  // ── Unblock (SUPER_ADMIN only) ────────────────────────────────────────────
  const handleUnblock = async (emp: Employee) => {
    setActionEmp(null)
    const ok = await confirm({
      title: 'Restore Login Access',
      message: `Allow ${emp.first_name} ${emp.last_name} to log in again and resume normal operations?`,
      confirmLabel: 'Yes, Restore Access',
      variant: 'info',
    })
    if (!ok) return
    const { error } = await supabase.from('users').update({
      is_blocked: false, blocked_at: null, blocked_reason: null, is_active: true,
    }).eq('id', emp.id)
    if (error) toast.error(error.message)
    else { toast.success(t('employees.unblocked')); fetchEmployees() }
  }

  // ── Delete (SUPER_ADMIN only) ─────────────────────────────────────────────
  // Delete = soft delete: sets deleted_at, blocks login, moves to "Deleted" list.
  // Historical data (payslips, attendance) is preserved in the DB.
  const handleDelete = async (emp: Employee) => {
    setActionEmp(null)
    const ok = await confirm({
      title: 'Delete Employee',
      message: `Delete ${emp.first_name} ${emp.last_name}? They will be removed from all active lists and cannot log in. Their attendance and payslip history is preserved. This cannot be undone from the app.`,
      confirmLabel: 'Yes, Delete',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('users').update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      is_blocked: true,
    }).eq('id', emp.id)
    if (error) toast.error(error.message)
    else { toast.success(t('employees.deleted')); fetchEmployees() }
  }

  // ── Activate / Deactivate (admin) ─────────────────────────────────────────
  const handleToggleActive = async (emp: Employee) => {
    setActionEmp(null)
    const action = emp.is_active ? 'Deactivate' : 'Activate'
    const ok = await confirm({
      title: `${action} Employee`,
      message: emp.is_active
        ? `Deactivate ${emp.first_name}? They will not appear in shift assignments but can still log in.`
        : `Activate ${emp.first_name}? They will appear in rosters again.`,
      confirmLabel: `Yes, ${action}`,
      variant: emp.is_active ? 'warning' : 'info',
    })
    if (!ok) return
    const { error } = await supabase.from('users').update({ is_active: !emp.is_active }).eq('id', emp.id)
    if (error) toast.error(error.message)
    else { toast.success(emp.is_active ? t('employees.deactivated') : t('employees.activated')); fetchEmployees() }
  }

  const getStatusBadge = (emp: Employee) => {
    if (emp.deleted_at) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-500">Deleted</span>
    if (emp.is_blocked) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">Blocked</span>
    if (!emp.is_active) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700">Inactive</span>
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">Active</span>
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="bg-white border-b px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.employees')}</h1>
          <button onClick={openAdd} className="flex items-center gap-1 text-sm text-orange-600 font-medium">
            <PlusIcon className="h-4 w-4" /> {t('employees.add')}
          </button>
        </div>
        <div className="relative mb-3">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder={t('employees.search')} />
        </div>
        <div className="flex gap-2">
          {(['active', 'blocked', ...(isSuperAdmin ? ['all'] : [])] as FilterType[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-200'}`}>
              {t(`employees.filter${f.charAt(0).toUpperCase() + f.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="page-content">
        <p className="text-xs text-gray-400 font-medium mb-2">{displayed.length} {t('employees.total')}</p>
        {displayed.map(emp => (
          <div key={emp.id} className={`list-item relative flex-col items-start ${emp.deleted_at ? 'opacity-50' : emp.is_blocked ? 'border-l-4 border-red-400' : ''}`}>
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800">{emp.first_name} {emp.last_name}</p>
                  {getStatusBadge(emp)}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{emp.phone || emp.email} · <span className="font-medium">{emp.role}</span></p>
                <p className="text-xs text-gray-400">Rs.{emp.base_salary?.toLocaleString()} · {emp.lorry_duty_count} lorry duties</p>
                {emp.is_blocked && emp.blocked_reason && (
                  <p className="text-xs text-red-500 mt-0.5">Reason: {emp.blocked_reason}</p>
                )}
              </div>
              {!emp.deleted_at && (
                <button onClick={() => setActionEmp(actionEmp?.id === emp.id ? null : emp)}
                  className="ml-2 p-2 rounded-full hover:bg-gray-100 text-gray-400 shrink-0">
                  <EllipsisVerticalIcon className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Inline action sheet */}
            {actionEmp?.id === emp.id && (
              <div className="w-full mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
                {/* Edit — all admins */}
                <button onClick={() => openEdit(emp)}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-orange-200 text-orange-600 text-xs font-semibold">
                  <PencilSquareIcon className="h-4 w-4" /> Edit Details
                </button>

                {/* Activate / Deactivate */}
                <button onClick={() => handleToggleActive(emp)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-semibold ${emp.is_active ? 'border-yellow-200 text-yellow-700' : 'border-green-200 text-green-700'}`}>
                  {emp.is_active ? 'Deactivate' : 'Activate'}
                </button>

                {/* SUPER_ADMIN only: Block / Unblock */}
                {isSuperAdmin && !emp.is_blocked && (
                  <button onClick={() => initiateBlock(emp)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-orange-300 text-orange-700 text-xs font-semibold">
                    <ShieldExclamationIcon className="h-4 w-4" /> Block Login
                  </button>
                )}
                {isSuperAdmin && emp.is_blocked && (
                  <button onClick={() => handleUnblock(emp)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-green-200 text-green-700 text-xs font-semibold">
                    <LockOpenIcon className="h-4 w-4" /> Unblock
                  </button>
                )}

                {/* SUPER_ADMIN only: Delete */}
                {isSuperAdmin && (
                  <button onClick={() => handleDelete(emp)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-semibold">
                    <TrashIcon className="h-4 w-4" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {displayed.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <UserGroupIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>{t('employees.none')}</p>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? `Edit: ${editing.first_name} ${editing.last_name}` : t('employees.addTitle')}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-2xl leading-none">&times;</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('employees.firstName')} *</label>
                  <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">{t('employees.lastName')} *</label>
                  <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="input" />
                </div>
              </div>
              <div>
                <label className="label">{t('employees.phone')} *</label>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input" placeholder="+91 98765 43210" />
                {!editing && <p className="text-xs text-gray-400 mt-1">Employee can login with this mobile number</p>}
              </div>
              {!editing && (
                <>
                  <div>
                    <label className="label">{t('employees.email')} <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input" placeholder="optional@email.com" />
                  </div>
                  <div>
                    <label className="label">{t('employees.password')} *</label>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input" placeholder="Min. 6 characters" />
                  </div>
                </>
              )}
              <div>
                <label className="label">{t('employees.role')}</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input">
                  {AVAILABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('employees.baseSalary')} (Rs.) *</label>
                <input type="number" value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="label">{t('employees.joiningDate')}</label>
                <input type="date" value={form.date_of_joining} onChange={e => setForm(f => ({ ...f, date_of_joining: e.target.value }))} className="input" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button onClick={submit} disabled={submitting} className="btn-primary flex-1">
                  {submitting ? t('common.loading') : editing ? 'Save Changes' : 'Create Employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Block Modal — has optional reason field so needs its own sheet */}
      {blockModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
          <div className="bg-white w-full max-w-xs rounded-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-3 text-center">
              <div className="text-4xl mb-3">🚫</div>
              <h3 className="text-base font-bold text-gray-900 mb-1">Block Login</h3>
              <p className="text-sm text-gray-500 mb-1">
                <strong>{blockModal.first_name} {blockModal.last_name}</strong> will be immediately blocked from logging in and excluded from payslips, reports, leaves, and all notifications.
              </p>
            </div>
            <div className="px-5 pb-4">
              <label className="label">Reason (optional)</label>
              <input value={blockReason} onChange={e => setBlockReason(e.target.value)} className="input" placeholder="e.g. Misconduct, Absconding..." />
            </div>
            <div className="flex border-t border-gray-100">
              <button onClick={() => setBlockModal(null)} className="flex-1 py-4 text-sm font-medium text-gray-600 border-r border-gray-100 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmBlock} disabled={modalLoading} className="flex-1 py-4 text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-60">
                {modalLoading ? '...' : 'Yes, Block'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global confirm dialog */}
      {dialogProps && <ConfirmDialog {...dialogProps} />}

      {/* Dismiss action sheet on backdrop tap */}
      {actionEmp && <div className="fixed inset-0 z-10" onClick={() => setActionEmp(null)} />}
    </div>
  )
}

export default Employees
