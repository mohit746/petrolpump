// src/pages/FuelManagement.tsx
//
// Three tabs:
//   • Types     — manage fuel_types catalog (name, code, unit, active flag)
//   • Pricing   — set new selling/purchase price (auto-closes the previous
//                 open interval via SQL trigger close_previous_fuel_price);
//                 view full history per fuel.
//   • Purchases — record fuel_purchases (qty + rate + supplier).
//
// Backwards-compat: when a price update touches the MS or HSD fuel, we
// also upsert system_settings.{ms_rate,hsd_rate} so legacy code paths in
// Readings.tsx (which still read those keys when no fuel_prices row
// exists) keep working without a coordinated cutover.

import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Fuel as FuelIcon, Plus, Pencil, Trash2, Save, Loader2,
  History, Package, AlertTriangle,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import { supabase } from '../lib/supabase'
import { logAudit } from '../lib/audit'
import { formatINR } from '../lib/utils'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'

interface FuelType {
  id: string
  pump_id: string
  name: string
  code: string
  unit: 'LITRE' | 'KG' | 'PIECE'
  is_active: boolean
}

interface FuelPriceRow {
  id: string
  fuel_type_id: string
  purchase_price: number
  selling_price: number
  effective_from: string
  effective_to: string | null
  created_at: string
}

interface FuelPurchaseRow {
  id: string
  fuel_type_id: string
  quantity: number
  rate_per_unit: number
  total_cost: number
  supplier: string | null
  invoice_no: string | null
  purchase_date: string
  notes: string | null
  created_at: string
}

const TABS = ['Types', 'Pricing', 'Purchases'] as const
type Tab = typeof TABS[number]

const FuelManagement: React.FC = () => {
  const { user } = useAuthStore()
  const { can } = useRoleAccess()
  const [tab, setTab] = useState<Tab>('Pricing')
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
      ) : tab === 'Types' ? (
        <TypesTab pumpId={pumpId} canEdit={can('fuel_type.crud')} />
      ) : tab === 'Pricing' ? (
        <PricingTab pumpId={pumpId} canEdit={can('fuel_price.update')} />
      ) : (
        <PurchasesTab pumpId={pumpId} canCreate={can('fuel_purchase.create')} />
      )}
    </div>
  )
}

// ── Types tab ──────────────────────────────────────────────────
type TypeForm = { name: string; code: string; unit: 'LITRE' | 'KG' | 'PIECE'; is_active: boolean }

const TypesTab: React.FC<{ pumpId: string; canEdit: boolean }> = ({ pumpId, canEdit }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<FuelType | null>(null)
  const [del, setDel] = useState<FuelType | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<TypeForm>({ defaultValues: { unit: 'LITRE', is_active: true } })

  const { data: types, isLoading } = useQuery({
    queryKey: ['fuel_types', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_types').select('*')
        .eq('pump_id', pumpId).order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as FuelType[]
    },
  })

  const upsertMutation = useMutation({
    mutationFn: async (d: TypeForm & { id?: string }) => {
      const code = d.code.trim().toUpperCase()
      if (!code) throw new Error('Code is required')

      if (d.id) {
        const { data: before } = await supabase.from('fuel_types').select('*').eq('id', d.id).maybeSingle()
        const { error } = await supabase.from('fuel_types').update({
          name: d.name.trim(), code, unit: d.unit, is_active: d.is_active,
        }).eq('id', d.id)
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'fuel_type.update', entity_type: 'fuel_types', entity_id: d.id,
          before, after: { name: d.name, code, unit: d.unit, is_active: d.is_active },
        })
      } else {
        const { data, error } = await supabase.from('fuel_types').insert({
          pump_id: pumpId, name: d.name.trim(), code, unit: d.unit, is_active: d.is_active,
        }).select().single()
        if (error) throw new Error(error.message)
        void logAudit({
          action: 'fuel_type.create', entity_type: 'fuel_types', entity_id: data.id,
          after: { name: d.name, code, unit: d.unit },
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel_types'] })
      toast('Saved', 'success')
      setOpen(false); setEdit(null); reset({ unit: 'LITRE', is_active: true } as TypeForm)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Don't physically delete — flip is_active. fuel_prices / nozzles may
      // still reference the type; ON DELETE RESTRICT would block anyway.
      const { error } = await supabase.from('fuel_types').update({ is_active: false }).eq('id', id)
      if (error) throw new Error(error.message)
      void logAudit({ action: 'fuel_type.delete', entity_type: 'fuel_types', entity_id: id })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel_types'] })
      toast('Fuel type deactivated', 'success'); setDel(null)
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  const openAdd = () => { setEdit(null); reset({ name: '', code: '', unit: 'LITRE', is_active: true } as TypeForm); setOpen(true) }
  const openEdit = (ft: FuelType) => {
    setEdit(ft)
    reset({ name: ft.name, code: ft.code, unit: ft.unit, is_active: ft.is_active })
    setOpen(true)
  }

  if (isLoading) return <SkeletonList />

  return (
    <div className="space-y-2">
      {canEdit && (
        <button onClick={openAdd} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Add Fuel Type
        </button>
      )}

      {(types ?? []).length === 0 ? (
        <div className="card text-center py-8 text-slate-400 text-sm">No fuel types yet.</div>
      ) : (types ?? []).map(t => (
        <div key={t.id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <FuelIcon className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.name}</p>
            <p className="text-xs text-slate-500">Code {t.code} · {t.unit}</p>
          </div>
          {!t.is_active && <Badge variant="destructive">Inactive</Badge>}
          {canEdit && (
            <div className="flex gap-1">
              <button onClick={() => openEdit(t)} aria-label="Edit fuel type"
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDel(t)} aria-label="Deactivate fuel type"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={open} onClose={() => { setOpen(false); setEdit(null) }} title={edit ? 'Edit Fuel Type' : 'Add Fuel Type'}>
        <form onSubmit={handleSubmit(d => upsertMutation.mutate({ ...d, id: edit?.id }))} className="space-y-3">
          <div>
            <label className="label">Name *</label>
            <input className="input" placeholder="Petrol" {...register('name', { required: 'Name is required' })} />
            {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Code *</label>
            <input className="input uppercase" placeholder="MS" maxLength={8}
              {...register('code', { required: 'Code is required' })} />
            {errors.code && <p className="text-xs text-rose-500 mt-1">{errors.code.message}</p>}
            <p className="text-[10px] text-slate-400 mt-1">Short identifier (e.g. MS, HSD, CNG, XP).</p>
          </div>
          <div>
            <label className="label">Unit</label>
            <select className="input" {...register('unit')}>
              <option value="LITRE">Litre</option>
              <option value="KG">Kilogram</option>
              <option value="PIECE">Piece</option>
            </select>
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
        title="Deactivate Fuel Type?"
        message={`${del?.name ?? 'This fuel'} will be hidden from the catalog. History is preserved.`}
        confirmLabel="Deactivate"
        danger
        onConfirm={() => del && deleteMutation.mutate(del.id)}
        onClose={() => setDel(null)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

// ── Pricing tab ────────────────────────────────────────────────
type PriceForm = { fuel_type_id: string; purchase_price: string; selling_price: string }

const PricingTab: React.FC<{ pumpId: string; canEdit: boolean }> = ({ pumpId, canEdit }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [historyFor, setHistoryFor] = useState<FuelType | null>(null)
  const { register, handleSubmit, reset, watch, formState: { errors } } =
    useForm<PriceForm>({ defaultValues: { fuel_type_id: '', purchase_price: '', selling_price: '' } })

  const { data: types, isLoading: typesLoading } = useQuery({
    queryKey: ['fuel_types', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_types').select('*')
        .eq('pump_id', pumpId).eq('is_active', true).order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as FuelType[]
    },
  })

  // For each fuel, fetch the *currently effective* price (effective_to IS NULL).
  const { data: currentPrices } = useQuery({
    queryKey: ['fuel_prices_current', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_prices')
        .select('*').eq('pump_id', pumpId).is('effective_to', null)
      if (error) throw new Error(error.message)
      const map: Record<string, FuelPriceRow> = {}
      for (const r of (data ?? []) as FuelPriceRow[]) map[r.fuel_type_id] = r
      return map
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (d: PriceForm) => {
      const purchase = parseFloat(d.purchase_price)
      const selling = parseFloat(d.selling_price)
      if (isNaN(purchase) || purchase < 0) throw new Error('Purchase price must be a non-negative number')
      if (isNaN(selling) || selling < 0) throw new Error('Selling price must be a non-negative number')
      if (selling < purchase) throw new Error('Selling price below purchase price would mean every sale is a loss')

      const ft = (types ?? []).find(t => t.id === d.fuel_type_id)
      if (!ft) throw new Error('Pick a fuel')

      // Insert new price row. SQL trigger close_previous_fuel_price closes
      // the previous open interval automatically.
      const { data: inserted, error } = await supabase.from('fuel_prices').insert({
        pump_id: pumpId,
        fuel_type_id: d.fuel_type_id,
        purchase_price: purchase,
        selling_price: selling,
      }).select().single()
      if (error) throw new Error(error.message)

      // Backwards-compat: keep system_settings.ms_rate / hsd_rate in sync so
      // legacy reads in Readings.tsx still work for pumps that haven't fully
      // migrated yet.
      const legacyKey =
        ft.code === 'MS' ? 'ms_rate' :
        ft.code === 'HSD' ? 'hsd_rate' : null
      if (legacyKey) {
        await supabase.from('system_settings').upsert(
          { pump_id: pumpId, key: legacyKey, value: String(selling) },
          { onConflict: 'pump_id,key' }
        )
      }

      void logAudit({
        action: 'fuel_price.update',
        entity_type: 'fuel_prices',
        entity_id: inserted.id,
        before: currentPrices?.[d.fuel_type_id]
          ? { selling: currentPrices[d.fuel_type_id].selling_price,
              purchase: currentPrices[d.fuel_type_id].purchase_price }
          : null,
        after: { selling, purchase, fuel_code: ft.code },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel_prices_current'] })
      qc.invalidateQueries({ queryKey: ['fuel_prices_history'] })
      qc.invalidateQueries({ queryKey: ['fuel_rates'] }) // legacy Readings cache
      toast('Price updated', 'success')
      reset({ fuel_type_id: '', purchase_price: '', selling_price: '' })
    },
    onError: (e: Error) => toast(e.message || 'Failed to update price', 'error'),
  })

  const selectedTypeId = watch('fuel_type_id')

  if (typesLoading) return <SkeletonList />

  return (
    <div className="space-y-3">
      {(types ?? []).length === 0 ? (
        <div className="card text-center py-8 text-slate-400 text-sm">
          Add fuel types first under the <strong>Types</strong> tab.
        </div>
      ) : (
        <>
          {canEdit && (
            <form onSubmit={handleSubmit(d => updateMutation.mutate(d))} className="card space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase">Set New Price</p>
              <div>
                <label className="label">Fuel</label>
                <select className="input" {...register('fuel_type_id', { required: 'Pick a fuel' })}>
                  <option value="">Select…</option>
                  {(types ?? []).map(t => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
                </select>
                {errors.fuel_type_id && <p className="text-xs text-rose-500 mt-1">{errors.fuel_type_id.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Purchase Price</label>
                  <input type="number" step="0.01" min="0" className="input" placeholder="89.50"
                    {...register('purchase_price', { required: 'Required' })} />
                  {errors.purchase_price && <p className="text-xs text-rose-500 mt-1">{errors.purchase_price.message}</p>}
                </div>
                <div>
                  <label className="label">Selling Price</label>
                  <input type="number" step="0.01" min="0" className="input" placeholder="103.50"
                    {...register('selling_price', { required: 'Required' })} />
                  {errors.selling_price && <p className="text-xs text-rose-500 mt-1">{errors.selling_price.message}</p>}
                </div>
              </div>
              {selectedTypeId && currentPrices?.[selectedTypeId] && (
                <p className="text-xs text-slate-500">
                  Current: {formatINR(currentPrices[selectedTypeId].selling_price)}/unit selling
                  {' · '}{formatINR(currentPrices[selectedTypeId].purchase_price)}/unit purchase
                </p>
              )}
              <button type="submit" disabled={updateMutation.isPending} className="btn-primary w-full">
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Update Price</>}
              </button>
              <p className="text-[10px] text-slate-400 text-center">
                Saving creates a new price interval starting now. Previous sales remain priced at their original rate.
              </p>
            </form>
          )}

          {/* Current prices table */}
          <div className="card space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase">Current Prices</p>
            {(types ?? []).map(t => {
              const p = currentPrices?.[t.id]
              return (
                <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-white">{t.code} — {t.name}</p>
                    {p ? (
                      <p className="text-xs text-slate-500">
                        Sell {formatINR(p.selling_price)} · Buy {formatINR(p.purchase_price)}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No price set
                      </p>
                    )}
                  </div>
                  <button onClick={() => setHistoryFor(t)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                    aria-label="Show history">
                    <History className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      <PriceHistoryDialog fuel={historyFor} pumpId={pumpId} onClose={() => setHistoryFor(null)} />
    </div>
  )
}

const PriceHistoryDialog: React.FC<{ fuel: FuelType | null; pumpId: string; onClose: () => void }> =
({ fuel, pumpId, onClose }) => {
  const { data: history } = useQuery({
    queryKey: ['fuel_prices_history', pumpId, fuel?.id],
    queryFn: async () => {
      if (!fuel) return [] as FuelPriceRow[]
      const { data, error } = await supabase.from('fuel_prices').select('*')
        .eq('pump_id', pumpId).eq('fuel_type_id', fuel.id).order('effective_from', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as FuelPriceRow[]
    },
    enabled: !!fuel,
  })

  return (
    <Dialog open={!!fuel} onClose={onClose} title={`Price History — ${fuel?.code ?? ''}`}>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {(history ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No price history.</p>
        ) : (history ?? []).map(p => (
          <div key={p.id} className="border border-slate-100 dark:border-slate-700 rounded-lg p-2.5 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-white">
                Sell {formatINR(p.selling_price)} · Buy {formatINR(p.purchase_price)}
              </span>
              {p.effective_to === null && <Badge variant="success">Current</Badge>}
            </div>
            <p className="text-slate-500">
              From {format(new Date(p.effective_from), 'dd MMM yyyy h:mm a')}
              {p.effective_to ? ` until ${format(new Date(p.effective_to), 'dd MMM yyyy h:mm a')}` : ' (ongoing)'}
            </p>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

// ── Purchases tab ──────────────────────────────────────────────
type PurchaseForm = {
  fuel_type_id: string; quantity: string; rate_per_unit: string;
  supplier: string; invoice_no: string; purchase_date: string; notes: string;
}

const PurchasesTab: React.FC<{ pumpId: string; canCreate: boolean }> = ({ pumpId, canCreate }) => {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])
  const { register, handleSubmit, reset, formState: { errors } } = useForm<PurchaseForm>({
    defaultValues: { purchase_date: today, fuel_type_id: '', quantity: '', rate_per_unit: '' },
  })

  const { data: types } = useQuery({
    queryKey: ['fuel_types', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_types').select('id,code,name,unit')
        .eq('pump_id', pumpId).eq('is_active', true).order('code')
      if (error) throw new Error(error.message)
      return (data ?? []) as Array<Pick<FuelType, 'id' | 'code' | 'name' | 'unit'>>
    },
  })

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['fuel_purchases', pumpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_purchases')
        .select('*, fuel_types!inner(code, name)')
        .eq('pump_id', pumpId).order('purchase_date', { ascending: false }).limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as Array<FuelPurchaseRow & { fuel_types: { code: string; name: string } }>
    },
  })

  const createMutation = useMutation({
    mutationFn: async (d: PurchaseForm) => {
      const qty = parseFloat(d.quantity)
      const rate = parseFloat(d.rate_per_unit)
      if (isNaN(qty) || qty <= 0) throw new Error('Quantity must be greater than 0')
      if (isNaN(rate) || rate < 0) throw new Error('Rate must be non-negative')

      const { data, error } = await supabase.from('fuel_purchases').insert({
        pump_id: pumpId,
        fuel_type_id: d.fuel_type_id,
        quantity: qty,
        rate_per_unit: rate,
        total_cost: qty * rate,
        supplier: d.supplier?.trim() || null,
        invoice_no: d.invoice_no?.trim() || null,
        purchase_date: d.purchase_date,
        notes: d.notes?.trim() || null,
      }).select().single()
      if (error) throw new Error(error.message)
      void logAudit({
        action: 'fuel_purchase.create', entity_type: 'fuel_purchases', entity_id: data.id,
        after: { quantity: qty, rate_per_unit: rate, supplier: d.supplier, purchase_date: d.purchase_date },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel_purchases'] })
      toast('Purchase recorded', 'success')
      setOpen(false); reset({ purchase_date: today, fuel_type_id: '', quantity: '', rate_per_unit: '' })
    },
    onError: (e: Error) => toast(e.message || 'Failed', 'error'),
  })

  if (isLoading) return <SkeletonList />

  return (
    <div className="space-y-2">
      {canCreate && (
        <button onClick={() => setOpen(true)} className="btn-primary w-full">
          <Plus className="w-4 h-4" /> Record Purchase
        </button>
      )}

      {(purchases ?? []).length === 0 ? (
        <div className="card text-center py-8 text-slate-400 text-sm">No purchases recorded.</div>
      ) : (purchases ?? []).map(p => (
        <div key={p.id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Package className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-white">
              {p.fuel_types?.code} — {Number(p.quantity).toFixed(2)} units @ {formatINR(p.rate_per_unit)}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {p.supplier ?? 'No supplier'}{p.invoice_no ? ` · #${p.invoice_no}` : ''}
            </p>
            <p className="text-[10px] text-slate-400">
              {format(new Date(p.purchase_date), 'dd MMM yyyy')}
            </p>
          </div>
          <p className="text-sm font-bold text-emerald-600">{formatINR(p.total_cost)}</p>
        </div>
      ))}

      <Dialog open={open} onClose={() => setOpen(false)} title="Record Fuel Purchase">
        <form onSubmit={handleSubmit(d => createMutation.mutate(d))} className="space-y-3">
          <div>
            <label className="label">Fuel *</label>
            <select className="input" {...register('fuel_type_id', { required: 'Pick a fuel' })}>
              <option value="">Select…</option>
              {(types ?? []).map(t => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </select>
            {errors.fuel_type_id && <p className="text-xs text-rose-500 mt-1">{errors.fuel_type_id.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantity *</label>
              <input type="number" step="0.01" min="0" className="input"
                {...register('quantity', { required: 'Required' })} />
              {errors.quantity && <p className="text-xs text-rose-500 mt-1">{errors.quantity.message}</p>}
            </div>
            <div>
              <label className="label">Rate / unit *</label>
              <input type="number" step="0.01" min="0" className="input"
                {...register('rate_per_unit', { required: 'Required' })} />
              {errors.rate_per_unit && <p className="text-xs text-rose-500 mt-1">{errors.rate_per_unit.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Supplier</label>
              <input className="input" {...register('supplier')} />
            </div>
            <div>
              <label className="label">Invoice #</label>
              <input className="input" {...register('invoice_no')} />
            </div>
          </div>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" {...register('purchase_date', { required: true })} />
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" {...register('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

export default FuelManagement
