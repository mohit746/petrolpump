// src/pages/Settings.tsx
import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  MapPinIcon, Cog6ToothIcon, PlusIcon, PencilIcon,
  CheckIcon, XMarkIcon, BeakerIcon, ChevronDownIcon, ChevronRightIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import { useConfirm } from '../hooks/useConfirm'
import ConfirmDialog from '../components/ConfirmDialog'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SysSettings {
  id?: string
  pump_id?: string
  pump_name: string
  shift_type: string
  salary_type: string
  paid_leaves_per_year: number
  unapproved_absence_penalty_days: number
  pump_radius_meters: number
  pump_latitude: number | null
  pump_longitude: number | null
  whatsapp_phone_number_id: string
  whatsapp_access_token: string
  report_whatsapp_number: string
  report_email: string
  emergency_leave_is_paid: boolean
}

interface FuelType {
  id: string
  pump_id: string
  name: string
  category: string
  unit: string
  current_rate: number
  rate_updated_at: string
  is_active: boolean
}

interface DispensingUnit {
  id: string
  pump_id: string
  name: string
  fuel_type: string
  machine_number: number
  nozzle_number: number
  display_order: number
  is_active: boolean
}

const TABS = ['General', 'Fuel Types', 'Nozzles'] as const
type Tab = typeof TABS[number]

const FUEL_CATEGORIES = ['FUEL', 'INVENTORY']
const FUEL_UNITS = ['LITRE', 'PIECE', 'KG', 'GRAM', 'ML']

const DEFAULT_FUEL_TYPES = [
  { name: 'MS (Petrol)', category: 'FUEL', unit: 'LITRE', current_rate: 0 },
  { name: 'HSD (Diesel)', category: 'FUEL', unit: 'LITRE', current_rate: 0 },
]

const fuelColor = (name: string) => {
  const n = name.toLowerCase()
  if (n.includes('petrol') || n.includes('ms')) return 'bg-orange-100 border-orange-300 text-orange-800'
  if (n.includes('diesel') || n.includes('hsd')) return 'bg-blue-100 border-blue-300 text-blue-800'
  if (n.includes('cng')) return 'bg-green-100 border-green-300 text-green-800'
  if (n.includes('ev') || n.includes('electric')) return 'bg-purple-100 border-purple-300 text-purple-800'
  return 'bg-gray-100 border-gray-300 text-gray-700'
}

// ─── Main Component ───────────────────────────────────────────────────────────
const Settings: React.FC = () => {
  useTranslation() // keep i18n context active
  const { user } = useAuthStore()
  const { confirm, dialogProps } = useConfirm()

  const [activeTab, setActiveTab] = useState<Tab>('General')
  const [loading, setLoading] = useState(true)

  // General settings
  const [sysForm, setSysForm] = useState<Partial<SysSettings>>({})
  const [sysId, setSysId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [gettingLoc, setGettingLoc] = useState(false)

  // Fuel Types
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([])
  const [showFuelModal, setShowFuelModal] = useState(false)
  const [editingFuel, setEditingFuel] = useState<FuelType | null>(null)
  const [fuelForm, setFuelForm] = useState({ name: '', category: 'FUEL', unit: 'LITRE', current_rate: '' })
  const [savingFuel, setSavingFuel] = useState(false)

  // Rate quick-edit
  const [editingRateId, setEditingRateId] = useState<string | null>(null)
  const [newRate, setNewRate] = useState('')

  // Nozzles
  const [dispensers, setDispensers] = useState<DispensingUnit[]>([])
  const [showNozzleModal, setShowNozzleModal] = useState(false)
  const [editingNozzle, setEditingNozzle] = useState<DispensingUnit | null>(null)
  const [nozzleForm, setNozzleForm] = useState({ name: '', fuel_type: '', machine_number: '1', nozzle_number: '1' })
  const [savingNozzle, setSavingNozzle] = useState(false)
  const [expandedMachines, setExpandedMachines] = useState<Set<number>>(new Set([1, 2, 3, 4]))

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!user?.pump_id) return
    setLoading(true)

    const [sysRes, fuelRes, dispRes] = await Promise.all([
      supabase.from('system_settings').select('*').eq('pump_id', user.pump_id).maybeSingle(),
      supabase.from('fuel_types').select('*').eq('pump_id', user.pump_id).order('created_at'),
      supabase.from('dispensing_units').select('*').eq('pump_id', user.pump_id).order('machine_number').order('nozzle_number'),
    ])

    if (sysRes.data) { setSysForm(sysRes.data); setSysId(sysRes.data.id) }

    let fuels = fuelRes.data || []
    if (fuels.length === 0 && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'PLATFORM_OWNER')) {
      const seeds = DEFAULT_FUEL_TYPES.map(ft => ({ ...ft, pump_id: user.pump_id!, is_active: true }))
      const { data: inserted, error: seedErr } = await supabase.from('fuel_types').insert(seeds).select()
      if (seedErr) {
        toast.error('Could not seed fuel types: ' + seedErr.message)
      } else {
        fuels = inserted || []
        toast.success('Default fuel types (MS & HSD) added. Please set their rates.')
      }
    }
    setFuelTypes(fuels)
    setDispensers(dispRes.data || [])
    setLoading(false)
  }, [user?.pump_id, user?.role])

  useEffect(() => { loadAll() }, [loadAll])

  // ── General Settings ───────────────────────────────────────────────────────
  const saveGeneral = async () => {
    if (!user?.pump_id) return
    setSaving(true)
    const payload = { ...sysForm, pump_id: user.pump_id, updated_at: new Date().toISOString() }
    let error
    if (sysId) {
      ({ error } = await supabase.from('system_settings').update(payload).eq('id', sysId))
    } else {
      ({ error } = await supabase.from('system_settings').insert(payload))
    }
    if (error) toast.error(error.message)
    else toast.success('Settings saved!')
    setSaving(false)
  }

  const captureLocation = () => {
    setGettingLoc(true)
    navigator.geolocation.getCurrentPosition(
      p => {
        setSysForm(f => ({ ...f, pump_latitude: p.coords.latitude, pump_longitude: p.coords.longitude }))
        toast.success('Location captured!')
        setGettingLoc(false)
      },
      () => { toast.error('Could not get location'); setGettingLoc(false) },
      { enableHighAccuracy: true }
    )
  }

  // ── Fuel Types ─────────────────────────────────────────────────────────────
  const openAddFuel = () => {
    setEditingFuel(null)
    setFuelForm({ name: '', category: 'FUEL', unit: 'LITRE', current_rate: '' })
    setShowFuelModal(true)
  }

  const openEditFuel = (ft: FuelType) => {
    setEditingFuel(ft)
    setFuelForm({ name: ft.name, category: ft.category, unit: ft.unit, current_rate: String(ft.current_rate) })
    setShowFuelModal(true)
  }

  const saveFuelType = async () => {
    if (!fuelForm.name.trim()) { toast.error('Fuel name required'); return }
    if (fuelForm.current_rate === '' || +fuelForm.current_rate < 0) { toast.error('Enter a valid rate'); return }
    if (!user?.pump_id) return
    setSavingFuel(true)

    if (editingFuel) {
      if (+fuelForm.current_rate !== editingFuel.current_rate) {
        await supabase.from('fuel_rate_history').insert({
          pump_id: user.pump_id,
          fuel_type_name: editingFuel.name,
          old_rate: editingFuel.current_rate,
          new_rate: +fuelForm.current_rate,
          effective_date: new Date().toISOString().split('T')[0],
          changed_by: user.id,
        })
      }
      const { error } = await supabase.from('fuel_types').update({
        name: fuelForm.name, category: fuelForm.category, unit: fuelForm.unit,
        current_rate: +fuelForm.current_rate, rate_updated_at: new Date().toISOString(),
      }).eq('id', editingFuel.id)
      if (error) toast.error(error.message); else toast.success('Fuel type updated!')
    } else {
      const { error } = await supabase.from('fuel_types').insert({
        pump_id: user.pump_id, name: fuelForm.name, category: fuelForm.category,
        unit: fuelForm.unit, current_rate: +fuelForm.current_rate, is_active: true,
      })
      if (error) toast.error(error.message); else toast.success('Fuel type added!')
    }

    setSavingFuel(false)
    setShowFuelModal(false)
    loadAll()
  }

  const deleteFuelType = async (ft: FuelType) => {
    const ok = await confirm({
      title: `Delete ${ft.name}?`,
      message: `This will permanently delete "${ft.name}". Any nozzles using this fuel type should be updated first. This cannot be undone.`,
      confirmLabel: 'Yes, Delete',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('fuel_types').delete().eq('id', ft.id)
    if (error) toast.error(error.message)
    else { toast.success(`${ft.name} deleted`); loadAll() }
  }

  const saveRateQuick = async (ft: FuelType) => {
    if (!newRate || +newRate < 0) { toast.error('Enter valid rate'); return }
    if (+newRate === ft.current_rate) { setEditingRateId(null); return }
    await supabase.from('fuel_rate_history').insert({
      pump_id: user!.pump_id,
      fuel_type_name: ft.name,
      old_rate: ft.current_rate,
      new_rate: +newRate,
      effective_date: new Date().toISOString().split('T')[0],
      changed_by: user!.id,
    })
    await supabase.from('fuel_types').update({ current_rate: +newRate, rate_updated_at: new Date().toISOString() }).eq('id', ft.id)
    setEditingRateId(null)
    loadAll()
    toast.success(`Rate updated to ₹${newRate}`)
  }

  // ── Nozzles ────────────────────────────────────────────────────────────────
  const activeFuelTypes = fuelTypes.filter(f => f.is_active && f.category === 'FUEL')

  const openAddNozzle = () => {
    setEditingNozzle(null)
    const machines = dispensers.map(d => d.machine_number)
    const maxMachine = machines.length > 0 ? Math.max(...machines) : 1
    setNozzleForm({ name: '', fuel_type: activeFuelTypes[0]?.name || '', machine_number: String(maxMachine), nozzle_number: '1' })
    setShowNozzleModal(true)
  }

  const openEditNozzle = (d: DispensingUnit) => {
    setEditingNozzle(d)
    setNozzleForm({ name: d.name, fuel_type: d.fuel_type, machine_number: String(d.machine_number), nozzle_number: String(d.nozzle_number) })
    setShowNozzleModal(true)
  }

  const saveNozzle = async () => {
    if (!nozzleForm.name.trim()) { toast.error('Nozzle name required'); return }
    if (!nozzleForm.fuel_type) { toast.error('Select fuel type'); return }
    if (!user?.pump_id) return
    setSavingNozzle(true)

    if (editingNozzle) {
      const { error } = await supabase.from('dispensing_units').update({
        name: nozzleForm.name, fuel_type: nozzleForm.fuel_type,
        machine_number: +nozzleForm.machine_number, nozzle_number: +nozzleForm.nozzle_number,
      }).eq('id', editingNozzle.id)
      if (error) toast.error(error.message)
      else { toast.success('Nozzle updated!'); loadAll() }
    } else {
      const maxOrder = dispensers.reduce((m, d) => Math.max(m, d.display_order), 0)
      const { error } = await supabase.from('dispensing_units').insert({
        pump_id: user.pump_id, name: nozzleForm.name, fuel_type: nozzleForm.fuel_type,
        machine_number: +nozzleForm.machine_number, nozzle_number: +nozzleForm.nozzle_number,
        display_order: maxOrder + 1, is_active: true,
      })
      if (error) toast.error(error.message)
      else { toast.success('Nozzle added!'); loadAll() }
    }
    setSavingNozzle(false)
    setShowNozzleModal(false)
  }

  const deleteNozzle = async (d: DispensingUnit) => {
    const ok = await confirm({
      title: `Delete ${d.name}?`,
      message: `This will permanently delete nozzle "${d.name}" (Machine ${d.machine_number}, Nozzle ${d.nozzle_number}). Existing readings using this nozzle will not be affected.`,
      confirmLabel: 'Yes, Delete',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('dispensing_units').delete().eq('id', d.id)
    if (error) toast.error(error.message)
    else { toast.success(`${d.name} deleted`); loadAll() }
  }

  const machineGroups = dispensers.reduce((acc, d) => {
    if (!acc[d.machine_number]) acc[d.machine_number] = []
    acc[d.machine_number].push(d)
    return acc
  }, {} as Record<number, DispensingUnit[]>)

  const toggleMachine = (m: number) => {
    setExpandedMachines(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="page items-center justify-center">
      <Cog6ToothIcon className="h-10 w-10 text-gray-300 animate-spin" />
    </div>
  )

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-0">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Settings</h1>
        <div className="flex border-b">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: GENERAL ── */}
      {activeTab === 'General' && (
        <div className="page-content">
          <div className="card p-4 space-y-4">
            <p className="font-semibold text-gray-700 text-sm">⛽ Pump Identity</p>
            <div>
              <label className="label">Pump Name</label>
              <input value={sysForm.pump_name || ''} onChange={e => setSysForm(f => ({ ...f, pump_name: e.target.value }))} className="input" placeholder="e.g. Dwivedi Petrol Pump" />
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <p className="font-semibold text-gray-700 text-sm">🕐 Shift & Salary</p>
            <div>
              <label className="label">Shift Type</label>
              <div className="flex gap-2">
                {['12HR', '24HR'].map(s => (
                  <button key={s} onClick={() => setSysForm(f => ({ ...f, shift_type: s }))}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${sysForm.shift_type === s ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Salary Type</label>
              <div className="flex gap-2">
                {[['DAILY_WAGES', 'Daily Wages'], ['MONTHLY_FIXED', 'Monthly Fixed']].map(([val, label]) => (
                  <button key={val} onClick={() => setSysForm(f => ({ ...f, salary_type: val }))}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${sysForm.salary_type === val ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <p className="font-semibold text-gray-700 text-sm">🌴 Leave Policy</p>
            <div>
              <label className="label">Paid Leaves Per Year</label>
              <input type="number" value={sysForm.paid_leaves_per_year || ''} onChange={e => setSysForm(f => ({ ...f, paid_leaves_per_year: +e.target.value }))} className="input" />
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm font-medium text-gray-700">Emergency Leave is Paid</p>
                <p className="text-xs text-gray-400">Emergency leaves count as paid leaves</p>
              </div>
              <button onClick={() => setSysForm(f => ({ ...f, emergency_leave_is_paid: !f.emergency_leave_is_paid }))}
                className={`relative w-11 h-6 rounded-full transition-colors overflow-hidden flex-shrink-0 ${sysForm.emergency_leave_is_paid ? 'bg-orange-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${sysForm.emergency_leave_is_paid ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <div>
              <label className="label">Unapproved Absence Penalty (× days salary)</label>
              <input type="number" step="0.5" value={sysForm.unapproved_absence_penalty_days || ''} onChange={e => setSysForm(f => ({ ...f, unapproved_absence_penalty_days: +e.target.value }))} className="input" />
              <p className="text-xs text-gray-400 mt-1">2 = double daily salary deduction for each unapproved absence day</p>
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <p className="font-semibold text-gray-700 text-sm">📍 Geo-fence (Check-in Radius)</p>
            <div>
              <label className="label">Allowed Radius (meters)</label>
              <input type="number" value={sysForm.pump_radius_meters || ''} onChange={e => setSysForm(f => ({ ...f, pump_radius_meters: +e.target.value }))} className="input" placeholder="100" />
            </div>
            {sysForm.pump_latitude && sysForm.pump_longitude ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-sm text-green-700 font-medium flex items-center gap-1">
                  <MapPinIcon className="h-4 w-4" /> Pump Location Set ✓
                </p>
                <p className="text-xs text-green-600 mt-1">{(sysForm.pump_latitude as number)?.toFixed(6)}, {(sysForm.pump_longitude as number)?.toFixed(6)}</p>
              </div>
            ) : (
              <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-xl">⚠️ Location not set — employees can check in from anywhere</p>
            )}
            <button onClick={captureLocation} disabled={gettingLoc} className="btn-secondary w-full">
              <MapPinIcon className="h-4 w-4 inline mr-1.5" />
              {gettingLoc ? 'Getting location...' : 'Capture Pump Location (go to pump first)'}
            </button>
          </div>

          <div className="card p-4 space-y-4">
            <p className="font-semibold text-gray-700 text-sm">📲 WhatsApp Notifications</p>
            <div>
              <label className="label">WhatsApp Phone Number ID</label>
              <input value={sysForm.whatsapp_phone_number_id || ''} onChange={e => setSysForm(f => ({ ...f, whatsapp_phone_number_id: e.target.value }))} className="input font-mono text-sm" placeholder="1234567890" />
            </div>
            <div>
              <label className="label">WhatsApp Access Token</label>
              <input type="password" value={sysForm.whatsapp_access_token || ''} onChange={e => setSysForm(f => ({ ...f, whatsapp_access_token: e.target.value }))} className="input font-mono text-sm" placeholder="EAAxx..." />
            </div>
            <div>
              <label className="label">Your WhatsApp Number (for reports)</label>
              <input type="tel" value={sysForm.report_whatsapp_number || ''} onChange={e => setSysForm(f => ({ ...f, report_whatsapp_number: e.target.value }))} className="input" placeholder="+919876543210" />
            </div>
            <div>
              <label className="label">Report Email</label>
              <input type="email" value={sysForm.report_email || ''} onChange={e => setSysForm(f => ({ ...f, report_email: e.target.value }))} className="input" placeholder="you@example.com" />
            </div>
          </div>

          <button onClick={saveGeneral} disabled={saving} className="btn-primary w-full py-4 text-base">
            {saving ? 'Saving...' : '💾 Save All Settings'}
          </button>
        </div>
      )}

      {/* ── TAB: FUEL TYPES ── */}
      {activeTab === 'Fuel Types' && (
        <div className="page-content">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500">Tap the rate to quickly update it.</p>
            <button onClick={openAddFuel} className="btn-primary px-3 py-2 text-sm flex items-center gap-1">
              <PlusIcon className="h-4 w-4" /> Add Fuel
            </button>
          </div>

          {fuelTypes.length === 0 ? (
            <div className="card p-8 text-center text-gray-400">
              <BeakerIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No fuel types yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fuelTypes.map(ft => (
                <div key={ft.id} className={`card border-2 ${ft.is_active ? '' : 'opacity-50'}`}>
                  <div className={`rounded-t-2xl px-4 py-2 flex items-center gap-2 ${fuelColor(ft.name)}`}>
                    <span className="text-sm font-bold">{ft.name}</span>
                    <span className="text-xs px-2 py-0.5 bg-white/50 rounded-full">{ft.category}</span>
                    <span className="text-xs px-2 py-0.5 bg-white/50 rounded-full">per {ft.unit}</span>
                    {!ft.is_active && <span className="ml-auto text-xs font-medium bg-red-100 text-red-600 px-2 py-0.5 rounded-full">INACTIVE</span>}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 mb-1">Current Rate (₹ per {ft.unit.toLowerCase()})</p>
                        {editingRateId === ft.id ? (
                          <div className="flex gap-2">
                            <input type="number" step="0.01" value={newRate} onChange={e => setNewRate(e.target.value)}
                              className="input flex-1 text-lg font-bold py-2" autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') saveRateQuick(ft) }} />
                            <button onClick={() => saveRateQuick(ft)} className="bg-green-500 text-white px-3 rounded-xl"><CheckIcon className="h-5 w-5" /></button>
                            <button onClick={() => setEditingRateId(null)} className="bg-gray-200 text-gray-600 px-3 rounded-xl"><XMarkIcon className="h-5 w-5" /></button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingRateId(ft.id); setNewRate(String(ft.current_rate)) }}
                            className="text-2xl font-bold text-gray-900 flex items-center gap-1 hover:text-orange-600 transition-colors">
                            {ft.current_rate > 0
                              ? <>₹{ft.current_rate.toFixed(2)} <PencilIcon className="h-4 w-4 text-gray-400 ml-1" /></>
                              : <span className="text-red-400 text-base font-medium">⚠️ Tap to set rate</span>}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => openEditFuel(ft)} className="p-2 bg-gray-100 rounded-xl" title="Edit details">
                          <PencilIcon className="h-4 w-4 text-gray-600" />
                        </button>
                        <button
                          onClick={async () => {
                            const { error } = await supabase.from('fuel_types').update({ is_active: !ft.is_active }).eq('id', ft.id)
                            if (error) toast.error(error.message)
                            else { toast.success(ft.is_active ? `${ft.name} deactivated` : `${ft.name} activated`); loadAll() }
                          }}
                          className={`p-2 rounded-xl text-xs font-semibold ${ft.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                          title={ft.is_active ? 'Deactivate' : 'Activate'}>
                          {ft.is_active ? '✓' : '✗'}
                        </button>
                        <button onClick={() => deleteFuelType(ft)}
                          className="p-2 rounded-xl bg-red-50 text-red-500" title="Delete fuel type">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {ft.rate_updated_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Updated: {new Date(ft.rate_updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: NOZZLES ── */}
      {activeTab === 'Nozzles' && (
        <div className="page-content">
          {activeFuelTypes.length === 0 ? (
            <div className="card p-8 text-center text-gray-400">
              <p className="font-medium text-base">⚠️ Set up Fuel Types first</p>
              <p className="text-sm mt-1">Go to "Fuel Types" tab and add at least one active fuel before adding nozzles.</p>
              <button onClick={() => setActiveTab('Fuel Types')} className="btn-primary px-6 py-2 mt-4 text-sm">
                Go to Fuel Types →
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">Long-press edit icon to edit a nozzle.</p>
                <button onClick={openAddNozzle} className="btn-primary px-3 py-2 text-sm flex items-center gap-1">
                  <PlusIcon className="h-4 w-4" /> Add Nozzle
                </button>
              </div>

              {Object.keys(machineGroups).length === 0 ? (
                <div className="card p-8 text-center text-gray-400">
                  <p className="font-medium">No nozzles configured yet</p>
                  <p className="text-sm mt-1">Tap "Add Nozzle" to set up your first machine.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(machineGroups).sort(([a], [b]) => +a - +b).map(([machine, nozzles]) => {
                    const mNum = +machine
                    const isExpanded = expandedMachines.has(mNum)
                    return (
                      <div key={machine} className="card overflow-hidden">
                        <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 text-white" onClick={() => toggleMachine(mNum)}>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold">⛽ Machine {machine}</span>
                            <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{nozzles.length} nozzle{nozzles.length !== 1 ? 's' : ''}</span>
                          </div>
                          {isExpanded ? <ChevronDownIcon className="h-5 w-5 text-gray-300" /> : <ChevronRightIcon className="h-5 w-5 text-gray-300" />}
                        </button>
                        {isExpanded && (
                          <div className="p-3 grid grid-cols-2 gap-3">
                            {nozzles.sort((a, b) => a.nozzle_number - b.nozzle_number).map(nozzle => (
                              <div key={nozzle.id}
                                className={`border-2 rounded-2xl p-3 transition-all ${nozzle.is_active ? fuelColor(nozzle.fuel_type) : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-bold">Nozzle {nozzle.nozzle_number}</span>
                                  <span className={`w-2.5 h-2.5 rounded-full ${nozzle.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                                </div>
                                <p className="font-bold text-sm leading-tight">{nozzle.name}</p>
                                <p className="text-xs mt-1 opacity-75">{nozzle.fuel_type}</p>
                                {!nozzle.is_active && <p className="text-xs mt-1 text-gray-400 font-medium">INACTIVE</p>}
                                {/* Edit / Toggle / Delete actions */}
                                <div className="flex gap-1.5 mt-2 pt-2 border-t border-black/10">
                                  <button onClick={() => openEditNozzle(nozzle)}
                                    className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-white/60 text-gray-700 text-xs font-medium">
                                    <PencilIcon className="h-3 w-3" /> Edit
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const { error } = await supabase.from('dispensing_units').update({ is_active: !nozzle.is_active }).eq('id', nozzle.id)
                                      if (error) toast.error(error.message)
                                      else { toast.success(nozzle.is_active ? `${nozzle.name} deactivated` : `${nozzle.name} activated`); loadAll() }
                                    }}
                                    className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-medium ${nozzle.is_active ? 'bg-green-500/15 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                                    title={nozzle.is_active ? 'Deactivate' : 'Activate'}>
                                    {nozzle.is_active ? '✓ On' : '✗ Off'}
                                  </button>
                                  <button onClick={() => deleteNozzle(nozzle)}
                                    className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-red-500/10 text-red-600 text-xs font-medium">
                                    <TrashIcon className="h-3 w-3" /> Delete
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Fuel Type Modal ── */}
      {showFuelModal && (
        <div className="modal-overlay" onClick={() => setShowFuelModal(false)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editingFuel ? `Edit: ${editingFuel.name}` : 'Add Fuel / Product'}</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Name *</label>
                <input value={fuelForm.name} onChange={e => setFuelForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="e.g. MS (Petrol), CNG, Engine Oil 4T..." />
              </div>
              <div>
                <label className="label">Category *</label>
                <div className="flex gap-2">
                  {FUEL_CATEGORIES.map(c => (
                    <button key={c} onClick={() => setFuelForm(f => ({ ...f, category: c }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium border ${fuelForm.category === c ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {c === 'FUEL' ? '⛽ Fuel (nozzle)' : '📦 Inventory (counter)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Unit *</label>
                <div className="flex flex-wrap gap-2">
                  {FUEL_UNITS.map(u => (
                    <button key={u} onClick={() => setFuelForm(f => ({ ...f, unit: u }))}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border ${fuelForm.unit === u ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Current Rate (₹ per {fuelForm.unit.toLowerCase()}) *</label>
                <input type="number" step="0.01" value={fuelForm.current_rate} onChange={e => setFuelForm(f => ({ ...f, current_rate: e.target.value }))} className="input text-xl font-bold" placeholder="0.00" />
              </div>
              <button onClick={saveFuelType} disabled={savingFuel} className="btn-primary w-full py-4 text-base mt-2">
                {savingFuel ? 'Saving...' : editingFuel ? 'Update Fuel Type' : 'Add Fuel Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Nozzle Modal ── */}
      {showNozzleModal && (
        <div className="modal-overlay" onClick={() => setShowNozzleModal(false)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editingNozzle ? `Edit: ${editingNozzle.name}` : 'Add Nozzle'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Machine No. *</label>
                  <input type="number" min="1" value={nozzleForm.machine_number} onChange={e => setNozzleForm(f => ({ ...f, machine_number: e.target.value }))} className="input text-xl font-bold text-center" placeholder="1" />
                  <p className="text-xs text-gray-400 mt-1">Which physical machine?</p>
                </div>
                <div>
                  <label className="label">Nozzle No. *</label>
                  <input type="number" min="1" value={nozzleForm.nozzle_number} onChange={e => setNozzleForm(f => ({ ...f, nozzle_number: e.target.value }))} className="input text-xl font-bold text-center" placeholder="1" />
                  <p className="text-xs text-gray-400 mt-1">Position on machine</p>
                </div>
              </div>
              <div>
                <label className="label">Fuel Type *</label>
                <div className="flex flex-wrap gap-2">
                  {activeFuelTypes.map(ft => (
                    <button key={ft.id} onClick={() => setNozzleForm(f => ({ ...f, fuel_type: ft.name }))}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${nozzleForm.fuel_type === ft.name ? fuelColor(ft.name) : 'bg-white text-gray-600 border-gray-200'}`}>
                      {ft.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Nozzle Label (what employee sees) *</label>
                <input value={nozzleForm.name} onChange={e => setNozzleForm(f => ({ ...f, name: e.target.value }))} className="input"
                  placeholder={`e.g. M${nozzleForm.machine_number}-N${nozzleForm.nozzle_number} Petrol`} />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-sm text-blue-700 font-medium">Preview:</p>
                <p className="text-sm text-blue-600">
                  Machine {nozzleForm.machine_number} → Nozzle {nozzleForm.nozzle_number}
                  {nozzleForm.name ? ` · "${nozzleForm.name}"` : ''}
                  {nozzleForm.fuel_type ? ` (${nozzleForm.fuel_type})` : ''}
                </p>
              </div>
              <button onClick={saveNozzle} disabled={savingNozzle} className="btn-primary w-full py-4 text-base">
                {savingNozzle ? 'Saving...' : editingNozzle ? 'Update Nozzle' : 'Add Nozzle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default Settings
