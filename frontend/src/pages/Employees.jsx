import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  PlusIcon, PencilIcon, UserIcon,
  MagnifyingGlassIcon, XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE']
const SHIFT_TYPES = ['12HR', '24HR']

// ─── API helpers ──────────────────────────────────────────────────────────────
const fetchEmployees = async (token) => {
  const res = await fetch('/api/employees', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch employees')
  return res.json()
}

const saveEmployee = async ({ data, token, id }) => {
  const res = await fetch(id ? `/api/employees/${id}` : '/api/employees', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to save employee')
  return res.json()
}

// ─── Role Badge ───────────────────────────────────────────────────────────────
const roleColors = {
  SUPER_ADMIN: 'bg-red-100 text-red-800',
  ADMIN: 'bg-orange-100 text-orange-800',
  ACCOUNTANT: 'bg-green-100 text-green-800',
  EMPLOYEE: 'bg-blue-100 text-blue-800',
}

const RoleBadge = ({ role }) => (
  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${roleColors[role] || 'bg-gray-100 text-gray-800'}`}>
    {role?.replace('_', ' ')}
  </span>
)

// ─── Employee Form Modal ───────────────────────────────────────────────────────
const EmployeeModal = ({ employee, onClose, token }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: employee || { role: 'EMPLOYEE', shift_type: '12HR', is_active: true },
  })

  const mutation = useMutation({
    mutationFn: (data) => saveEmployee({ data, token, id: employee?.id }),
    onSuccess: () => {
      toast.success(t('employees.saveSuccess'))
      queryClient.invalidateQueries(['employees'])
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            {employee ? t('employees.editEmployee') : t('employees.addEmployee')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit(mutation.mutate)} className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Basic Info</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('employees.firstName')} *</label>
                <input {...register('first_name', { required: t('errors.required') })} className="input" />
                {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name.message}</p>}
              </div>
              <div>
                <label className="label">{t('employees.lastName')} *</label>
                <input {...register('last_name', { required: t('errors.required') })} className="input" />
                {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name.message}</p>}
              </div>
              <div>
                <label className="label">{t('employees.email')} *</label>
                <input type="email" {...register('email', { required: t('errors.required') })} className="input" />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <label className="label">{t('employees.phone')}</label>
                <input type="tel" {...register('phone')} className="input" />
              </div>
              <div>
                <label className="label">{t('employees.employeeCode')}</label>
                <input {...register('employee_code')} className="input" placeholder="EMP-001" />
              </div>
              <div>
                <label className="label">{t('employees.role')} *</label>
                <select {...register('role', { required: t('errors.required') })} className="input">
                  {ROLES.map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Work Details */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Work Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('employees.shiftType')}</label>
                <select {...register('shift_type')} className="input">
                  {SHIFT_TYPES.map(s => (
                    <option key={s} value={s}>{s === '12HR' ? t('employees.shift12hr') : t('employees.shift24hr')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('employees.joiningDate')}</label>
                <input type="date" {...register('date_of_joining')} className="input" />
              </div>
              <div>
                <label className="label">{t('employees.baseSalary')}</label>
                <input type="number" step="0.01" {...register('base_salary')} className="input" placeholder="0.00" />
              </div>
              <div>
                <label className="label">{t('employees.dob')}</label>
                <input type="date" {...register('date_of_birth')} className="input" />
              </div>
            </div>
          </div>

          {/* Documents */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Documents & Bank</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('employees.aadhar')}</label>
                <input {...register('aadhar_number')} className="input" maxLength={12} placeholder="XXXXXXXXXXXX" />
              </div>
              <div>
                <label className="label">{t('employees.bank')}</label>
                <input {...register('bank_account_number')} className="input" />
              </div>
              <div>
                <label className="label">{t('employees.ifsc')}</label>
                <input {...register('bank_ifsc')} className="input" placeholder="SBIN0001234" />
              </div>
            </div>
          </div>

          {/* Emergency & Address */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Emergency & Address</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('employees.emergencyContact')}</label>
                <input {...register('emergency_contact_name')} className="input" />
              </div>
              <div>
                <label className="label">{t('employees.emergencyPhone')}</label>
                <input type="tel" {...register('emergency_contact_phone')} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('employees.address')}</label>
                <textarea {...register('address')} className="input" rows={2} />
              </div>
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
const Employees = () => {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const { isAdmin } = useRoleAccess()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [showModal, setShowModal] = useState(false)
  const [editEmployee, setEditEmployee] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees(token),
  })

  const employees = data?.data || []

  const filtered = employees.filter(emp => {
    const matchSearch = `${emp.first_name} ${emp.last_name} ${emp.email} ${emp.employee_code}`
      .toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'ALL' || emp.role === roleFilter
    return matchSearch && matchRole
  })

  const stats = {
    total: employees.length,
    active: employees.filter(e => e.is_active).length,
  }

  const openAdd = () => { setEditEmployee(null); setShowModal(true) }
  const openEdit = (emp) => { setEditEmployee(emp); setShowModal(true) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('employees.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('employees.totalEmployees')}: <strong>{stats.total}</strong> &nbsp;|&nbsp;
            {t('employees.activeEmployees')}: <strong className="text-green-600">{stats.active}</strong>
          </p>
        </div>
        {isAdmin && (
          <button onClick={openAdd} className="btn-primary flex items-center space-x-2">
            <PlusIcon className="h-5 w-5" />
            <span>{t('employees.addEmployee')}</span>
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {ROLES.map(role => {
          const count = employees.filter(e => e.role === role && e.is_active).length
          return (
            <div key={role} className={`rounded-xl p-4 ${roleColors[role].replace('text-', 'border-').replace('bg-', 'bg-')} bg-white border`}>
              <p className="text-xs font-medium text-gray-500 uppercase">{t(`roles.${role}`)}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{count}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder={t('common.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-full sm:w-48"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="ALL">{t('common.all')}</option>
          {ROLES.map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <UserIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t('employees.noEmployees')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.name')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.employeeCode')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.role')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.shiftType')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.phone')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('employees.status')}</th>
                  {isAdmin && <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('employees.actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-sm">
                          {emp.first_name?.[0]}{emp.last_name?.[0]}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                          <p className="text-xs text-gray-500">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{emp.employee_code || '—'}</td>
                    <td className="px-6 py-4"><RoleBadge role={emp.role} /></td>
                    <td className="px-6 py-4">
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-md font-medium">
                        {emp.shift_type || '12HR'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{emp.phone || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${emp.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                        {emp.is_active ? t('employees.active') : t('employees.inactive')}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openEdit(emp)}
                          className="inline-flex items-center space-x-1 text-primary-600 hover:text-primary-800 text-sm"
                        >
                          <PencilIcon className="h-4 w-4" />
                          <span>{t('common.edit')}</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <EmployeeModal
          employee={editEmployee}
          onClose={() => setShowModal(false)}
          token={token}
        />
      )}
    </div>
  )
}

export default Employees
