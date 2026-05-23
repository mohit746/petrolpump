// src/pages/Employees.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Search, Shield, Ban, Trash2, Pencil, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { Can } from '../components/Can'
import { formatINR, getInitials } from '../lib/utils'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'

type EmpForm = { first_name: string; last_name: string; email: string; phone: string; role: string; salary: string; language: string; password?: string }

// Roles a SUPER_ADMIN can grant from this UI. PLATFORM_OWNER is intentionally
// omitted — only the platform-side flow can mint a platform owner.
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE']

const Employees: React.FC = () => {
  const { user } = useAuthStore()
  const { can } = useRoleAccess()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editEmp, setEditEmp] = useState<(EmpForm & { id: string }) | null>(null)
  const [blockTarget, setBlockTarget] = useState<{ id: string; is_blocked: boolean } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Per matrix: users.create/update/delete/block are SUPER_ADMIN-only. ADMIN
  // sees the list but cannot write. We compute these once so the JSX stays
  // readable.
  const canCreate = can('users.create')
  const canEdit   = can('users.update')
  const canBlock  = can('users.block')
  const canDelete = can('users.delete')
  const isReadOnly = !canCreate && !canEdit && !canBlock && !canDelete

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<EmpForm>()

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('*')
        .eq('pump_id', user!.pump_id!).is('deleted_at', null).order('first_name')
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  const addMutation = useMutation({
    mutationFn: async (d: EmpForm) => {
      const { normalizePhone } = await import('../lib/utils')
      const phone = normalizePhone(d.phone)
      if (!phone || phone.length < 10) {
        throw new Error('Enter a valid 10-digit mobile number')
      }
      const password = d.password?.trim() || ''
      if (!password || password.length < 6) {
        throw new Error('Password is required (min 6 characters)')
      }

      // BUG FIX: Save admin session before signUp to prevent session loss
      const { data: { session: adminSession } } = await supabase.auth.getSession()

      const { data: authData, error } = await supabase.auth.signUp({
        email: d.email, password,
        options: { data: { first_name: d.first_name, last_name: d.last_name } },
      })
      if (error) throw error

      // BUG FIX: Restore admin session immediately
      if (adminSession) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        })
        if (sessionError) {
          throw new Error('Failed to restore admin session. Please log in again.')
        }
      }

      await supabase.from('users').upsert({
        id: authData.user!.id, email: d.email, first_name: d.first_name, last_name: d.last_name,
        phone, role: d.role, pump_id: user!.pump_id, salary: parseFloat(d.salary),
        language: d.language, is_active: true, is_blocked: false,
      })

      // Audit (best-effort, never throws).
      void logAudit({
        action: 'users.create',
        entity_type: 'users',
        entity_id: authData.user!.id,
        after: {
          email: d.email, role: d.role, salary: parseFloat(d.salary),
          first_name: d.first_name, last_name: d.last_name, phone,
        },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast('Employee added', 'success'); setAddOpen(false); reset() },
    onError: (e: Error) => toast(e.message || 'Failed to add', 'error'),
  })

  const editMutation = useMutation({
    mutationFn: async (d: EmpForm & { id: string }) => {
      const { normalizePhone } = await import('../lib/utils')
      const phone = normalizePhone(d.phone)
      if (!phone || phone.length < 10) {
        throw new Error('Enter a valid 10-digit mobile number')
      }

      // Capture before-state for the audit trail.
      const { data: before } = await supabase
        .from('users')
        .select('first_name,last_name,phone,role,salary,language')
        .eq('id', d.id)
        .maybeSingle()

      const after = {
        first_name: d.first_name, last_name: d.last_name, phone,
        role: d.role, salary: parseFloat(d.salary), language: d.language,
      }

      await supabase.from('users').update(after).eq('id', d.id)

      void logAudit({
        action: 'users.update',
        entity_type: 'users',
        entity_id: d.id,
        before, after,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast('Employee updated', 'success'); setEditEmp(null) },
    onError: () => toast('Failed to update', 'error'),
  })

  const blockMutation = useMutation({
    mutationFn: async ({ id, is_blocked }: { id: string; is_blocked: boolean }) => {
      const newBlocked = !is_blocked
      await supabase.from('users').update({ is_blocked: newBlocked }).eq('id', id)

      void logAudit({
        action: newBlocked ? 'users.block' : 'users.unblock',
        entity_type: 'users',
        entity_id: id,
        before: { is_blocked },
        after:  { is_blocked: newBlocked },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast('Status updated', 'success'); setBlockTarget(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const deletedAt = new Date().toISOString()
      await supabase.from('users').update({
        deleted_at: deletedAt,
        is_active: false,
      }).eq('id', id)

      void logAudit({
        action: 'users.delete',
        entity_type: 'users',
        entity_id: id,
        after: { deleted_at: deletedAt, is_active: false },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast('Employee removed', 'success'); setDeleteTarget(null) },
  })

  const openEdit = (e: EmpForm & { id: string }) => {
    setEditEmp(e)
    setValue('first_name', e.first_name); setValue('last_name', e.last_name)
    setValue('email', e.email); setValue('phone', e.phone ?? '')
    setValue('role', e.role); setValue('salary', String(e.salary ?? ''))
    setValue('language', e.language ?? 'en')
  }

  const filtered = (employees ?? []).filter((e: { first_name: string; last_name: string; email: string }) =>
    `${e.first_name} ${e.last_name} ${e.email}`.toLowerCase().includes(search.toLowerCase())
  )

  const EmpForm_ = ({ onSubmit, loading, mode }: { onSubmit: (d: EmpForm) => void; loading: boolean; mode: 'add' | 'edit' }) => (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">First Name</label><input className="input" {...register('first_name', { required: true })} /></div>
        <div><label className="label">Last Name</label><input className="input" {...register('last_name', { required: true })} /></div>
      </div>
      {mode === 'add' && <div><label className="label">Email</label><input type="email" className="input" {...register('email', { required: true })} /></div>}
      {mode === 'add' && (
        <div>
          <label className="label">Initial Password <span className="text-rose-500">*</span></label>
          <input
            type="text"
            className="input"
            placeholder="Min 6 characters"
            autoComplete="new-password"
            {...register('password', { required: 'Password is required', minLength: { value: 6, message: 'Min 6 characters' } })}
          />
          {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
          <p className="text-[10px] text-slate-400 mt-1">Share this with the employee — they can change it after first login.</p>
        </div>
      )}
      <div>
        <label className="label">
          Mobile Number <span className="text-rose-500">*</span>
          <span className="text-[10px] text-slate-400 font-normal ml-1">(used for mobile login)</span>
        </label>
        <input
          type="tel"
          className="input"
          placeholder="+91 9876543210"
          {...register('phone', {
            required: 'Mobile number is required',
            pattern: {
              value: /^[+\d][\d\s\-()]{6,}$/,
              message: 'Enter a valid mobile number',
            },
          })}
        />
        {errors.phone && <p className="text-xs text-rose-500 mt-1">{errors.phone.message}</p>}
      </div>
      <div><label className="label">Role</label>
        <select className="input" {...register('role', { required: true })}>
          <option value="">Select role…</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div><label className="label">Monthly Salary (₹)</label><input type="number" className="input" {...register('salary', { required: true })} /></div>
      <div><label className="label">Language</label>
        <select className="input" {...register('language')}>
          <option value="en">English</option>
          <option value="hi">हिंदी</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => mode === 'add' ? setAddOpen(false) : setEditEmp(null)} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'add' ? 'Add Employee' : 'Save Changes'}
        </button>
      </div>
    </form>
  )

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      {isReadOnly && (
        <div className="card bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Read-only view. Only your pump's Super Admin can add, edit, block, or remove employees.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Can perm="users.create">
          <button onClick={() => setAddOpen(true)} className="btn-primary" aria-label="Add employee">
            <UserPlus className="w-4 h-4" />
          </button>
        </Can>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card text-center py-10 text-slate-400 text-sm">No employees found</div>
        ) : filtered.map((e: { id: string; first_name: string; last_name: string; email: string; phone: string; role: string; salary: number; language: string; is_active: boolean; is_blocked: boolean; employee_code: string }) => (
          <div key={e.id} className="card flex items-center gap-3">
            <div className="avatar text-sm">{getInitials(e.first_name, e.last_name)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-white">{e.first_name} {e.last_name}</span>
                {e.is_blocked && <Badge variant="destructive">Blocked</Badge>}
              </div>
              <p className="text-xs text-slate-500 truncate">{e.email}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="secondary">{e.role}</Badge>
                <span className="text-xs text-slate-400">{formatINR(e.salary ?? 0)}/mo</span>
              </div>
            </div>
            <div className="flex gap-1">
              {canEdit && (
                <button onClick={() => openEdit({ ...e, salary: String(e.salary ?? '') })}
                        aria-label="Edit employee"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {canBlock && (
                <button onClick={() => setBlockTarget({ id: e.id, is_blocked: e.is_blocked })}
                        aria-label={e.is_blocked ? 'Unblock employee' : 'Block employee'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                  {e.is_blocked ? <Shield className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                </button>
              )}
              {canDelete && (
                <button onClick={() => setDeleteTarget(e.id)}
                        aria-label="Remove employee"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modals are only mounted for users with the matching permission. This
          stops the dialogs from being open-able via stale state if a user's
          permissions change mid-session. */}
      {canCreate && (
        <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Employee">
          <EmpForm_ onSubmit={d => addMutation.mutate(d)} loading={addMutation.isPending} mode="add" />
        </Dialog>
      )}

      {canEdit && (
        <Dialog open={!!editEmp} onClose={() => setEditEmp(null)} title="Edit Employee">
          <EmpForm_ onSubmit={d => editMutation.mutate({ ...d, id: editEmp!.id })} loading={editMutation.isPending} mode="edit" />
        </Dialog>
      )}

      {canBlock && (
        <ConfirmDialog
          open={!!blockTarget}
          title={blockTarget?.is_blocked ? 'Unblock Employee?' : 'Block Employee?'}
          message={blockTarget?.is_blocked ? 'This employee will be able to log in again.' : 'This employee will not be able to log in.'}
          confirmLabel={blockTarget?.is_blocked ? 'Unblock' : 'Block'}
          danger={!blockTarget?.is_blocked}
          onConfirm={() => blockTarget && blockMutation.mutate(blockTarget)}
          onClose={() => setBlockTarget(null)}
          loading={blockMutation.isPending}
        />
      )}

      {canDelete && (
        <ConfirmDialog
          open={!!deleteTarget}
          title="Remove Employee?"
          message="This employee will be soft-deleted and won't appear in the system."
          confirmLabel="Remove"
          danger
          onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  )
}

export default Employees
