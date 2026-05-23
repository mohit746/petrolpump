// src/pages/Machines.tsx
//
// Two tabs:
//   • Machines — dispenser CRUD (name, code, display order, active flag)
//   • Nozzles  — nozzle CRUD per machine, each typed against a fuel
//
// Replaces the hard-coded 8-nozzle layout in Readings.tsx (Readings still
// renders the legacy layout when this catalog is empty so the cutover
// is non-breaking).

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wrench, Plus, Pencil, Trash2, Save, Loader2, Fuel as FuelIcon,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'

interface Machine {
  id: string
  pump_id: string
  name: string
  code: string
  display_order: number
  is_active: boolean
}

interface Nozzle {
  id: string
  pump_id: string
  machine_id: string
  fuel_type_id: string
  code: string
  display_order: number
  is_active: boolean
}

interface FuelTypeLite { id: string; code: string; name: string }

const TABS = ['Machines', 'Nozzles'] as const
type Tab = typeof TABS[number]

const Machines: React.FC = () => {
  const { user } = useAuthStore()
  const { can } = useRoleAccess()
  const [tab, setTab] = useState<Tab>('Machines')
  const pumpId = user?.pump_id ?? null

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === t
                ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {!pumpId ? (
        <div className="card text-sm text-slate-500">No pump assigned.</div>
      ) : tab === 'Machines' ? (
        <MachinesTab pumpId={pumpId} canEdit={can('machines.crud')} />
      ) : (
        <NozzlesTab pumpId={pumpId} canEdit={can('nozzles.crud')} />
      )}
    </div>
  )
}

// ── Machines tab ───────────────────────────────────────────────
type MachineForm = { name: string; code: string; display_order: string; is_active: boolean }

const MachinesTab: React.FC<{ pumpId: string; canEdit: boolean }> = ({ pumpId, canEdit }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Machine | null>(null)
  const [del, setDel] = useState<Machine | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<MachineForm>({
    defaultValues: { display_order: '0', is_active: true },
  })

  const { data: machines, isLoading } = useQuery({
    queryKey: ['machines', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('machines').select('*')
        .eq('pump_id', pumpId).order('display_order').order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as Machine[]
    },
  })

  const upsertMutation = useMutation({
    mutationFn: async (d: MachineForm & { id?: string }) => {
      const code = d.code.trim().toUpperCase()
      if (!code) throw new Error('Code is required')
      const order = parseInt(d.display_order, 10)
      if (isNaN(order)) throw new Error('Display order must be a number')

      if (d.id) {
        const { data: before } = await supabase.from('machines').select('*').eq('id', d.id).maybeSingle()
        const { error } = await supabase.from('machines').update({
          name: d.name.trim(), code, display_order: order, is_active: d.is_active,
        }).eq('id', d.id)
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'machines.crud', entity_type: 'machines', entity_id: d.id,
          before, after: { name: d.name, code, display_order: order, is_active: d.is_active },
        })
      } else {
        const { data, error } = await supabase.from('machines').insert({
          pump_id: pumpId, name: d.name.trim(), code, display_order: order, is_active: d.is_active,
        }).select().single()
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'machines.crud', entity_type: 'machines', entity_id: data.id,
          after: { name: d.name, code, display_order: order, op: 'create' },
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['machines'] })
      qc.invalidateQueries({ queryKey: ['nozzles'] })
      qc.invalidateQueries({ queryKey: ['nozzles_for_readings'] })
      toast('Saved', 'success')
      setOpen(false); setEdit(null); reset({ display_order: '0', is_active: true } as MachineForm)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Soft-deactivate. Hard delete cascades to nozzles which would lose history.
      const { error } = await supabase.from('machines').update({ is_active: false }).eq('id', id)
      if (error) throw new Error(error.message)
      void logAudit({ action: 'machines.crud', entity_type: 'machines', entity_id: id,
        after: { op: 'deactivate' } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['machines'] })
      toast('Machine deactivated', 'success'); setDel(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const openAdd = () => {
    setEdit(null); reset({ name: '', code: '', display_order: '0', is_active: true } as MachineForm); setOpen(true)
  }
  const openEdit = (m: Machine) => {
    setEdit(m)
    reset({ name: m.name, code: m.code, display_order: String(m.display_order), is_active: m.is_active })
    setOpen(true)
  }

  if (isLoading) return <SkeletonList />

  return (
    <div className="space-y-2">
      {canEdit && (
        <button onClick={openAdd} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Add Machine
        </button>
      )}

      {(machines ?? []).length === 0 ? (
        <div className="card text-center py-8 text-slate-400 text-sm">No machines yet.</div>
      ) : (machines ?? []).map(m => (
        <div key={m.id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-white">{m.name}</p>
            <p className="text-xs text-slate-500">Code {m.code} · order {m.display_order}</p>
          </div>
          {!m.is_active && <Badge variant="destructive">Inactive</Badge>}
          {canEdit && (
            <div className="flex gap-1">
              <button onClick={() => openEdit(m)} aria-label="Edit machine"
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDel(m)} aria-label="Deactivate machine"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={open} onClose={() => { setOpen(false); setEdit(null) }} title={edit ? 'Edit Machine' : 'Add Machine'}>
        <form onSubmit={handleSubmit(d => upsertMutation.mutate({ ...d, id: edit?.id }))} className="space-y-3">
          <div>
            <label className="label">Name *</label>
            <input className="input" placeholder="Dispenser 1" {...register('name', { required: 'Required' })} />
            {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Code *</label>
              <input className="input uppercase" placeholder="M1" maxLength={8}
                {...register('code', { required: 'Required' })} />
              {errors.code && <p className="text-xs text-rose-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="label">Display order</label>
              <input type="number" className="input" {...register('display_order')} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" {...register('is_active')} /> Active
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEdit(null) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={upsertMutation.isPending} className="btn-primary flex-1">
              {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!del}
        title="Deactivate Machine?"
        message={`${del?.name ?? 'This machine'} will be hidden. Nozzles attached to it will need to be re-pointed before re-use.`}
        confirmLabel="Deactivate"
        danger
        onConfirm={() => del && deleteMutation.mutate(del.id)}
        onClose={() => setDel(null)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

// ── Nozzles tab ────────────────────────────────────────────────
type NozzleForm = { machine_id: string; fuel_type_id: string; code: string; display_order: string; is_active: boolean }

const NozzlesTab: React.FC<{ pumpId: string; canEdit: boolean }> = ({ pumpId, canEdit }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Nozzle | null>(null)
  const [del, setDel] = useState<Nozzle | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<NozzleForm>({
    defaultValues: { display_order: '0', is_active: true },
  })

  const { data: machines } = useQuery({
    queryKey: ['machines', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('machines')
        .select('id,name,code,is_active')
        .eq('pump_id', pumpId).order('display_order').order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as Array<Pick<Machine, 'id' | 'name' | 'code' | 'is_active'>>
    },
  })

  const { data: fuelTypes } = useQuery({
    queryKey: ['fuel_types', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_types')
        .select('id,code,name').eq('pump_id', pumpId).eq('is_active', true).order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as FuelTypeLite[]
    },
  })

  const { data: nozzles, isLoading } = useQuery({
    queryKey: ['nozzles', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nozzles')
        .select('*, machines(name,code), fuel_types(code,name)')
        .eq('pump_id', pumpId)
        .order('display_order')
      if (error) throw new Error(error.message)
      return (data ?? []) as Array<
        Nozzle & { machines: { name: string; code: string }; fuel_types: { code: string; name: string } }
      >
    },
  })

  const upsertMutation = useMutation({
    mutationFn: async (d: NozzleForm & { id?: string }) => {
      const code = d.code.trim().toUpperCase()
      if (!code) throw new Error('Code is required')
      const order = parseInt(d.display_order, 10)
      if (isNaN(order)) throw new Error('Display order must be a number')

      if (d.id) {
        const { data: before } = await supabase.from('nozzles').select('*').eq('id', d.id).maybeSingle()
        const { error } = await supabase.from('nozzles').update({
          machine_id: d.machine_id, fuel_type_id: d.fuel_type_id,
          code, display_order: order, is_active: d.is_active,
        }).eq('id', d.id)
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'nozzles.crud', entity_type: 'nozzles', entity_id: d.id,
          before, after: { machine_id: d.machine_id, fuel_type_id: d.fuel_type_id, code, display_order: order, is_active: d.is_active },
        })
      } else {
        const { data, error } = await supabase.from('nozzles').insert({
          pump_id: pumpId,
          machine_id: d.machine_id, fuel_type_id: d.fuel_type_id,
          code, display_order: order, is_active: d.is_active,
        }).select().single()
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'nozzles.crud', entity_type: 'nozzles', entity_id: data.id,
          after: { machine_id: d.machine_id, fuel_type_id: d.fuel_type_id, code, op: 'create' },
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nozzles'] })
      qc.invalidateQueries({ queryKey: ['nozzles_for_readings'] })
      toast('Saved', 'success')
      setOpen(false); setEdit(null); reset({ display_order: '0', is_active: true } as NozzleForm)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('nozzles').update({ is_active: false }).eq('id', id)
      if (error) throw new Error(error.message)
      void logAudit({ action: 'nozzles.crud', entity_type: 'nozzles', entity_id: id,
        after: { op: 'deactivate' } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nozzles'] })
      qc.invalidateQueries({ queryKey: ['nozzles_for_readings'] })
      toast('Nozzle deactivated', 'success'); setDel(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const openAdd = () => {
    if (!machines?.length) {
      toast('Add a machine first', 'warning'); return
    }
    if (!fuelTypes?.length) {
      toast('Add a fuel type first under Fuel → Types', 'warning'); return
    }
    setEdit(null)
    reset({ machine_id: machines[0].id, fuel_type_id: fuelTypes[0].id, code: '', display_order: '0', is_active: true })
    setOpen(true)
  }
  const openEdit = (n: Nozzle) => {
    setEdit(n)
    reset({
      machine_id: n.machine_id, fuel_type_id: n.fuel_type_id,
      code: n.code, display_order: String(n.display_order), is_active: n.is_active,
    })
    setOpen(true)
  }

  if (isLoading) return <SkeletonList />

  return (
    <div className="space-y-2">
      {canEdit && (
        <button onClick={openAdd} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Add Nozzle
        </button>
      )}

      {(nozzles ?? []).length === 0 ? (
        <div className="card text-center py-8 text-slate-400 text-sm">No nozzles configured.</div>
      ) : (nozzles ?? []).map(n => (
        <div key={n.id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <FuelIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-white">
              {n.machines?.code} / {n.code}
            </p>
            <p className="text-xs text-slate-500">
              {n.fuel_types?.code} — {n.machines?.name}
            </p>
          </div>
          {!n.is_active && <Badge variant="destructive">Inactive</Badge>}
          {canEdit && (
            <div className="flex gap-1">
              <button onClick={() => openEdit(n)} aria-label="Edit nozzle"
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDel(n)} aria-label="Deactivate nozzle"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={open} onClose={() => { setOpen(false); setEdit(null) }} title={edit ? 'Edit Nozzle' : 'Add Nozzle'}>
        <form onSubmit={handleSubmit(d => upsertMutation.mutate({ ...d, id: edit?.id }))} className="space-y-3">
          <div>
            <label className="label">Machine *</label>
            <select className="input" {...register('machine_id', { required: 'Pick a machine' })}>
              {(machines ?? []).map(m => (
                <option key={m.id} value={m.id}>{m.code} — {m.name}{m.is_active ? '' : ' (inactive)'}</option>
              ))}
            </select>
            {errors.machine_id && <p className="text-xs text-rose-500 mt-1">{errors.machine_id.message}</p>}
          </div>
          <div>
            <label className="label">Fuel *</label>
            <select className="input" {...register('fuel_type_id', { required: 'Pick a fuel' })}>
              {(fuelTypes ?? []).map(f => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
            </select>
            {errors.fuel_type_id && <p className="text-xs text-rose-500 mt-1">{errors.fuel_type_id.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Code *</label>
              <input className="input uppercase" placeholder="N1" maxLength={8}
                {...register('code', { required: 'Required' })} />
              {errors.code && <p className="text-xs text-rose-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="label">Display order</label>
              <input type="number" className="input" {...register('display_order')} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" {...register('is_active')} /> Active
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEdit(null) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={upsertMutation.isPending} className="btn-primary flex-1">
              {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!del}
        title="Deactivate Nozzle?"
        message={`${del?.code ?? 'This nozzle'} will be hidden from the readings page. History is preserved.`}
        confirmLabel="Deactivate"
        danger
        onConfirm={() => del && deleteMutation.mutate(del.id)}
        onClose={() => setDel(null)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

export default Machines
