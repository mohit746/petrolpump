// src/pages/Readings.tsx
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { format, subDays, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import {
  BeakerIcon, LockClosedIcon, LockOpenIcon,
  ArrowPathIcon, CheckCircleIcon, CogIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'

// ── Types ───────────────────────────────────────────────────────────
interface NozzleEntry {
  dispenser_id: string
  name: string
  fuel_type: string
  machine_number: number
  nozzle_number: number
  current_rate: number
  start_reading: string
  start_editable: boolean   // true only if no previous reading found
  end_reading: string
  testing_litres: string
  is_locked: boolean
  record_id: string | null
}

interface DayClose {
  id: string | null
  cash_collected: string
  online_collected: string
  notes: string
  is_locked: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────
const getReadingDate = (): string => {
  const now = new Date()
  // Accounts close at 6am — before 6am still belongs to yesterday
  if (now.getHours() < 6) return format(subDays(now, 1), 'yyyy-MM-dd')
  return format(now, 'yyyy-MM-dd')
}

const n = (s: string) => parseFloat(s) || 0
const fmt2 = (v: number) => v.toFixed(2)
const fmtRs = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const calcSale = (e: NozzleEntry) =>
  Math.max(n(e.end_reading) - n(e.start_reading) - n(e.testing_litres), 0)

const calcExpected = (e: NozzleEntry) => calcSale(e) * e.current_rate

const fuelBadge = (ft: string) => {
  const u = ft?.toUpperCase()
  if (u === 'MS') return 'bg-yellow-100 text-yellow-700'
  if (u === 'HSD') return 'bg-green-100 text-green-700'
  return 'bg-blue-100 text-blue-700'
}

// ── Component ────────────────────────────────────────────────────────
const Readings: React.FC = () => {
  const { user } = useAuthStore()
  const { isSuperAdmin, isAdmin } = useRoleAccess()
  const { confirm, dialogProps } = useConfirm()

  const readingDate = useMemo(() => getReadingDate(), [])
  const displayDate = format(parseISO(readingDate), 'dd MMM yyyy')
  const isYesterday = new Date().getHours() < 6

  const [tab, setTab]           = useState<'today' | 'dayclose' | 'history'>('today')
  const [entries, setEntries]   = useState<NozzleEntry[]>([])
  const [dayClose, setDayClose] = useState<DayClose>({ id: null, cash_collected: '', online_collected: '', notes: '', is_locked: false })
  const [creditToday, setCreditToday] = useState({ given: 0, settled: 0 })
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [noUnits, setNoUnits]   = useState(false)
  const [historyDate, setHistoryDate] = useState(readingDate)
  const [historyRows, setHistoryRows] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // ── Data load ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    const pumpId = user?.pump_id
    if (!pumpId) { setLoading(false); return }

    // Dispensing units
    const { data: units } = await supabase
      .from('dispensing_units').select('*')
      .eq('pump_id', pumpId).eq('is_active', true)
      .order('machine_number').order('nozzle_number')

    if (!units?.length) { setNoUnits(true); setLoading(false); return }
    setNoUnits(false)

    // Fuel type rates
    const { data: fuelTypes } = await supabase
      .from('fuel_types').select('name,current_rate')
      .eq('pump_id', pumpId).eq('is_active', true)
    const rateMap: Record<string, number> = {}
    ;(fuelTypes || []).forEach(ft => { rateMap[ft.name.toUpperCase()] = ft.current_rate })

    // Today's existing readings
    const { data: todayR } = await supabase
      .from('daily_readings').select('*')
      .in('dispenser_id', units.map(u => u.id))
      .eq('reading_date', readingDate)
    const todayMap: Record<string, any> = {}
    ;(todayR || []).forEach(r => { todayMap[r.dispenser_id] = r })

    // Previous end readings for units without today's record
    const needPrev = units.filter(u => !todayMap[u.id])
    const prevMap: Record<string, number | null> = {}
    await Promise.all(needPrev.map(async u => {
      const { data } = await supabase
        .from('daily_readings').select('end_reading')
        .eq('dispenser_id', u.id).lt('reading_date', readingDate)
        .order('reading_date', { ascending: false }).limit(1).single()
      prevMap[u.id] = data?.end_reading ?? null
    }))

    // Build state
    setEntries(units.map(u => {
      const today = todayMap[u.id]
      const rate  = rateMap[u.fuel_type?.toUpperCase()] ?? 0
      if (today) return {
        dispenser_id: u.id, name: u.name, fuel_type: u.fuel_type,
        machine_number: u.machine_number, nozzle_number: u.nozzle_number,
        current_rate: today.fuel_rate ?? rate,
        start_reading: String(today.start_reading ?? ''),
        start_editable: false,
        end_reading: String(today.end_reading ?? ''),
        testing_litres: String(today.testing_litres ?? 0),
        is_locked: today.is_locked, record_id: today.id,
      }
      const prevEnd = prevMap[u.id]
      return {
        dispenser_id: u.id, name: u.name, fuel_type: u.fuel_type,
        machine_number: u.machine_number, nozzle_number: u.nozzle_number,
        current_rate: rate,
        start_reading: prevEnd != null ? String(prevEnd) : '',
        start_editable: prevEnd === null,
        end_reading: '', testing_litres: '0',
        is_locked: false, record_id: null,
      }
    }))

    // Day close record
    const { data: ds } = await supabase
      .from('daily_sales').select('*')
      .eq('pump_id', pumpId).eq('sale_date', readingDate).single()
    if (ds) setDayClose({ id: ds.id, cash_collected: String(ds.cash_collected || ''), online_collected: String(ds.online_collected || ''), notes: ds.notes || '', is_locked: ds.is_locked })
    else     setDayClose({ id: null, cash_collected: '', online_collected: '', notes: '', is_locked: false })

    // Credit totals for today
    const [ceRes, csRes] = await Promise.all([
      supabase.from('credit_entries').select('amount').eq('pump_id', pumpId).eq('credit_date', readingDate),
      supabase.from('credit_settlements').select('amount_settled').eq('pump_id', pumpId).eq('settlement_date', readingDate),
    ])
    if (ceRes.error) console.error('[Readings] credit_entries RLS error:', ceRes.error.message)
    if (csRes.error) console.error('[Readings] credit_settlements RLS error:', csRes.error.message)
    setCreditToday({
      given:   (ceRes.data || []).reduce((s, c) => s + Number(c.amount), 0),
      settled: (csRes.data || []).reduce((s, c) => s + Number(c.amount_settled), 0),
    })

    setLoading(false)
  }, [user?.pump_id, readingDate])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Totals ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let ms = 0, hsd = 0, other = 0, expectedCash = 0
    entries.forEach(e => {
      const sale = calcSale(e)
      const ft = e.fuel_type?.toUpperCase()
      if (ft === 'MS') ms += sale
      else if (ft === 'HSD') hsd += sale
      else other += sale
      expectedCash += sale * e.current_rate
    })
    return { ms, hsd, other, expectedCash }
  }, [entries])

  const cashIn    = n(dayClose.cash_collected)
  const onlineIn  = n(dayClose.online_collected)
  const netCash   = cashIn + onlineIn + creditToday.settled
  const cashExpected = totals.expectedCash - creditToday.given
  const shortfall = cashExpected - netCash

  // ── Entry update ───────────────────────────────────────────────────
  const update = (id: string, field: keyof NozzleEntry, val: string) =>
    setEntries(p => p.map(e => e.dispenser_id === id ? { ...e, [field]: val } : e))

  // ── Save single reading ────────────────────────────────────────────
  const saveReading = async (entry: NozzleEntry): Promise<boolean> => {
    if (entry.start_editable && !entry.start_reading) {
      toast.error(`Enter opening reading for ${entry.name}`); return false
    }
    if (!entry.end_reading) {
      toast.error(`Enter end reading for ${entry.name}`); return false
    }
    const startVal = n(entry.start_reading)
    const endVal   = n(entry.end_reading)
    if (endVal < startVal) {
      toast.error(`End reading cannot be less than start for ${entry.name}`); return false
    }
    const payload = {
      pump_id: user!.pump_id!, dispenser_id: entry.dispenser_id,
      reading_date: readingDate,
      start_reading: startVal, end_reading: endVal,
      testing_litres: n(entry.testing_litres),
      fuel_rate: entry.current_rate,
      entered_by: user!.id, updated_at: new Date().toISOString(),
    }
    if (entry.record_id) {
      const { error } = await supabase.from('daily_readings').update(payload).eq('id', entry.record_id)
      if (error) { toast.error(error.message); return false }
    } else {
      const { data, error } = await supabase.from('daily_readings').insert(payload).select('id').single()
      if (error) { toast.error(error.message); return false }
      setEntries(p => p.map(e => e.dispenser_id === entry.dispenser_id ? { ...e, record_id: data.id } : e))
    }
    return true
  }

  // ── Save + lock all ────────────────────────────────────────────────
  const handleLockAll = async () => {
    const incomplete = entries.filter(e => !e.end_reading)
    if (incomplete.length) { toast.error(`${incomplete.length} nozzle(s) still need end readings`); return }
    const ok = await confirm({
      title: 'Lock All Readings',
      message: `Lock all nozzle readings for ${displayDate}? Edits after locking require Admin approval.`,
      confirmLabel: 'Lock All', variant: 'warning',
    })
    if (!ok) return
    setSaving(true)
    for (const entry of entries) {
      if (!entry.is_locked) { const saved = await saveReading(entry); if (!saved) { setSaving(false); return } }
    }
    const ids = entries.filter(e => e.record_id).map(e => e.record_id!)
    if (ids.length) await supabase.from('daily_readings').update({ is_locked: true, locked_at: new Date().toISOString() }).in('id', ids)
    setEntries(p => p.map(e => ({ ...e, is_locked: true })))
    toast.success('All readings locked!'); setSaving(false)
    setTab('dayclose')
  }

  // ── Clear all unsaved readings ─────────────────────────────────────
  const handleClearAll = async () => {
    const unsaved = entries.filter(e => !e.is_locked)
    if (!unsaved.length) { toast('All readings are already locked'); return }
    const ok = await confirm({
      title: 'Clear All Readings?',
      message: `This will reset end readings, testing litres, and delete any unsaved DB records for ${displayDate}. Locked readings will NOT be affected.`,
      confirmLabel: 'Yes, Clear',
      variant: 'danger',
    })
    if (!ok) return

    // Delete unsaved DB records
    const idsToDelete = unsaved.filter(e => e.record_id).map(e => e.record_id!)
    if (idsToDelete.length) {
      const { error } = await supabase.from('daily_readings').delete().in('id', idsToDelete)
      if (error) { toast.error(error.message); return }
    }

    // Reset local state for unlocked entries
    setEntries(p => p.map(e =>
      e.is_locked ? e : { ...e, end_reading: '', testing_litres: '0', record_id: null }
    ))
    toast.success('Unsaved readings cleared')
  }

  // ── Admin unlock ───────────────────────────────────────────────────
  const handleUnlock = async (entry: NozzleEntry) => {
    if (!entry.record_id) return
    const { error } = await supabase.from('daily_readings')
      .update({ is_locked: false, unlock_approved_by: user!.id }).eq('id', entry.record_id)
    if (error) toast.error(error.message)
    else { setEntries(p => p.map(e => e.dispenser_id === entry.dispenser_id ? { ...e, is_locked: false } : e)); toast.success(`${entry.name} unlocked`) }
  }

  // ── Day Close submit ───────────────────────────────────────────────
  const handleDayClose = async () => {
    if (!dayClose.cash_collected && !dayClose.online_collected) {
      toast.error('Enter at least cash or online amount'); return
    }
    const ok = await confirm({
      title: 'Save Day Summary', variant: 'info',
      message: `Save daily sales summary for ${displayDate}?`, confirmLabel: 'Save',
    })
    if (!ok) return
    setSaving(true)
    const payload = {
      pump_id: user!.pump_id!, sale_date: readingDate,
      total_ms_litres: totals.ms, total_hsd_litres: totals.hsd, total_other_litres: totals.other,
      total_expected_cash: totals.expectedCash,
      cash_collected: cashIn, online_collected: onlineIn,
      credit_given: creditToday.given, credit_settled: creditToday.settled,
      shortfall, notes: dayClose.notes,
      submitted_by: user!.id, submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (dayClose.id) {
      const { error } = await supabase.from('daily_sales').update(payload).eq('id', dayClose.id)
      if (error) { toast.error(error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase.from('daily_sales').insert(payload).select('id').single()
      if (error) { toast.error(error.message); setSaving(false); return }
      setDayClose(p => ({ ...p, id: data.id }))
    }
    toast.success('Day summary saved!'); setSaving(false)
  }

  // ── Refresh credit totals only (called when switching to Day Close) ──
  const refreshCreditTotals = useCallback(async () => {
    const pumpId = user?.pump_id; if (!pumpId) return
    const [ceRes, csRes] = await Promise.all([
      supabase.from('credit_entries').select('amount').eq('pump_id', pumpId).eq('credit_date', readingDate),
      supabase.from('credit_settlements').select('amount_settled').eq('pump_id', pumpId).eq('settlement_date', readingDate),
    ])
    if (ceRes.error) {
      toast.error(`Cannot read credit entries: ${ceRes.error.message} — RLS policy may be missing. Run the SQL from the instructions.`)
      return
    }
    const given   = (ceRes.data || []).reduce((s, c) => s + Number(c.amount), 0)
    const settled = (csRes.data || []).reduce((s, c) => s + Number(c.amount_settled), 0)
    setCreditToday({ given, settled })
    toast.success(
      given > 0 || settled > 0
        ? `Credits synced — Given: ₹${given.toLocaleString('en-IN')}, Settled: ₹${settled.toLocaleString('en-IN')}`
        : 'No credits found for today',
      { id: 'credit-refresh', duration: 4000 }
    )
  }, [user?.pump_id, readingDate])

  // Refresh credits every time the Day Close tab is opened
  useEffect(() => {
    if (tab === 'dayclose') refreshCreditTotals()
  }, [tab, refreshCreditTotals])

  // ── History ────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async (date: string) => {
    const pumpId = user?.pump_id; if (!pumpId) return
    setHistoryLoading(true)
    const { data } = await supabase
      .from('daily_readings')
      .select('*, dispensing_units(name, fuel_type, machine_number, nozzle_number)')
      .eq('pump_id', pumpId).eq('reading_date', date)
      .order('dispenser_id')
    setHistoryRows(data || []); setHistoryLoading(false)
  }, [user?.pump_id])

  useEffect(() => { if (tab === 'history') fetchHistory(historyDate) }, [tab, historyDate, fetchHistory])

  // ── Group by machine ───────────────────────────────────────────────
  const byMachine = useMemo(() => {
    const map = new Map<number, NozzleEntry[]>()
    entries.forEach(e => { if (!map.has(e.machine_number)) map.set(e.machine_number, []); map.get(e.machine_number)!.push(e) })
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [entries])

  const allLocked   = entries.length > 0 && entries.every(e => e.is_locked)
  const filledCount = entries.filter(e => e.end_reading).length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="page">
      {/* Header */}
      <div className="bg-white border-b px-4 pt-12 pb-4 sticky top-0 z-30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Meter Readings</h1>
            <p className="text-xs text-orange-600 font-medium mt-0.5">
              📅 {displayDate} {isYesterday && <span className="text-gray-400 ml-1">(yesterday's account)</span>}
            </p>
          </div>
          <button onClick={fetchData} className="p-2 text-gray-400 hover:text-orange-500">
            <ArrowPathIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[{ key: 'today', label: '📊 Readings' }, { key: 'dayclose', label: '💰 Day Close' }, { key: 'history', label: '📋 History' }]
            .map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>
                {t.label}
              </button>
            ))}
        </div>
      </div>

      {/* ── TODAY TAB ── */}
      {tab === 'today' && (
        <div className="px-4 py-4 space-y-4 pb-32">
          {noUnits ? (
            <div className="text-center py-16 text-gray-400">
              <CogIcon className="h-16 w-16 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-gray-700">No nozzles configured</p>
              <p className="text-sm mt-1 text-gray-400">
                {isSuperAdmin || isAdmin ? 'Go to Settings → Configure Dispensing Units.' : 'Ask your Super Admin to configure nozzles.'}
              </p>
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{filledCount} of {entries.length} nozzles filled</span>
                <div className="flex items-center gap-2">
                  {allLocked && <span className="text-green-600 font-medium flex items-center gap-1"><CheckCircleIcon className="h-4 w-4" /> All Locked</span>}
                  {!allLocked && entries.some(e => !e.is_locked) && (
                    <button onClick={handleClearAll}
                      className="text-xs text-red-500 border border-red-200 px-2.5 py-1 rounded-xl font-medium hover:bg-red-50 transition-colors">
                      🗑 Clear All
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className="bg-orange-500 h-1.5 rounded-full transition-all" style={{ width: `${entries.length ? (filledCount / entries.length) * 100 : 0}%` }} />
              </div>

              {/* Nozzle cards grouped by machine */}
              {byMachine.map(([machineNo, machineEntries]) => (
                <div key={machineNo} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                  <div className="bg-orange-50 px-4 py-2.5 border-b border-orange-100 flex items-center gap-2">
                    <BeakerIcon className="h-4 w-4 text-orange-500" />
                    <p className="text-xs font-bold text-orange-700 uppercase tracking-wide">Dispenser / Machine {machineNo}</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {machineEntries.map(entry => {
                      const sale     = calcSale(entry)
                      const expected = calcExpected(entry)
                      return (
                        <div key={entry.dispenser_id} className={`p-4 ${entry.is_locked ? 'bg-green-50/40' : ''}`}>
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="font-semibold text-gray-800 text-sm">{entry.name}</p>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold mt-0.5 inline-block ${fuelBadge(entry.fuel_type)}`}>
                                {entry.fuel_type} · ₹{entry.current_rate}/L
                              </span>
                            </div>
                            {entry.is_locked
                              ? (isSuperAdmin || isAdmin)
                                ? <button onClick={() => handleUnlock(entry)}
                                    className="flex items-center gap-1 text-xs text-orange-600 border border-orange-200 px-2.5 py-1.5 rounded-xl font-medium">
                                    <LockOpenIcon className="h-3 w-3" /> Unlock
                                  </button>
                                : <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                    <LockClosedIcon className="h-3 w-3" /> Locked
                                  </span>
                              : null
                            }
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: 'Start Reading', key: 'start_reading' as const, disabled: !entry.start_editable || entry.is_locked, hint: entry.start_editable ? 'First day — enter opening' : '' },
                              { label: 'End Reading *', key: 'end_reading' as const, disabled: entry.is_locked, hint: '' },
                              { label: 'Testing (L)', key: 'testing_litres' as const, disabled: entry.is_locked, hint: '' },
                            ].map(field => (
                              <div key={field.key}>
                                <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{field.label}</label>
                                {field.hint && <p className="text-[9px] text-orange-500">{field.hint}</p>}
                                <input
                                  type="number" step="0.01" min="0"
                                  value={entry[field.key] as string}
                                  onChange={e => update(entry.dispenser_id, field.key, e.target.value)}
                                  disabled={field.disabled}
                                  className={`input text-sm mt-0.5 ${field.disabled ? 'bg-gray-50 text-gray-400' : field.key === 'end_reading' ? 'border-orange-200' : ''}`}
                                  placeholder="0.00"
                                />
                              </div>
                            ))}
                          </div>

                          {entry.end_reading && (
                            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-50 text-xs">
                              <span className="text-gray-400">Sale: <strong className="text-gray-800">{fmt2(sale)} L</strong></span>
                              <span className="text-gray-400">Expected: <strong className="text-orange-700">{fmtRs(expected)}</strong></span>
                              {!entry.is_locked && (
                                <button onClick={async () => { const ok = await saveReading(entry); if (ok) toast.success(`${entry.name} saved`) }}
                                  className="ml-auto text-orange-600 font-semibold">
                                  Save ↗
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* Lock All / Proceed */}
              {!allLocked
                ? <button onClick={handleLockAll} disabled={saving || filledCount < entries.length}
                    className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
                    <LockClosedIcon className="h-4 w-4" />
                    {saving ? 'Saving...' : `Lock All Readings (${filledCount}/${entries.length} filled)`}
                  </button>
                : <button onClick={() => setTab('dayclose')} className="btn-primary w-full">
                    Proceed to Day Close →
                  </button>
              }
            </>
          )}
        </div>
      )}

      {/* ── DAY CLOSE TAB ── */}
      {tab === 'dayclose' && (
        <div className="px-4 py-4 space-y-4 pb-32">

          {/* Fuel totals */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-yellow-50 rounded-2xl p-3 border border-yellow-100">
              <p className="text-xs text-yellow-600 font-medium">MS — Petrol</p>
              <p className="text-2xl font-bold text-gray-900">{fmt2(totals.ms)}</p>
              <p className="text-xs text-gray-400">litres sold</p>
            </div>
            <div className="bg-green-50 rounded-2xl p-3 border border-green-100">
              <p className="text-xs text-green-600 font-medium">HSD — Diesel</p>
              <p className="text-2xl font-bold text-gray-900">{fmt2(totals.hsd)}</p>
              <p className="text-xs text-gray-400">litres sold</p>
            </div>
          </div>

          {/* Revenue breakdown */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700">Revenue Breakdown</h3>
              <button onClick={refreshCreditTotals}
                className="flex items-center gap-1 text-xs text-orange-600 border border-orange-200 px-2 py-1 rounded-lg">
                <ArrowPathIcon className="h-3 w-3" /> Sync Credits
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total fuel expected</span>
              <span className="font-semibold text-gray-900">{fmtRs(totals.expectedCash)}</span>
            </div>
            {creditToday.given > 0
              ? (
                <div className="flex justify-between text-sm bg-amber-50 -mx-4 px-4 py-1.5 rounded">
                  <span className="text-amber-700 font-medium">🤝 Credit given today (fuel taken on credit − not collected in cash)</span>
                  <span className="font-bold text-red-600">−{fmtRs(creditToday.given)}</span>
                </div>
              )
              : (
                <div className="flex justify-between text-sm text-gray-400">
                  <span>Credit given today</span>
                  <span>₹0 — tap "Sync Credits" if you added credits</span>
                </div>
              )
            }
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="font-bold text-gray-700">Cash in hand expected</span>
              <span className="font-bold text-orange-700">{fmtRs(cashExpected)}</span>
            </div>
          </div>

          {/* Cash entry */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-bold text-gray-700">Cash Collected</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cash (₹)</label>
                <input type="number" min="0" value={dayClose.cash_collected}
                  onChange={e => setDayClose(p => ({ ...p, cash_collected: e.target.value }))}
                  disabled={dayClose.is_locked} className="input" placeholder="0.00" />
              </div>
              <div>
                <label className="label">Online / UPI (₹)</label>
                <input type="number" min="0" value={dayClose.online_collected}
                  onChange={e => setDayClose(p => ({ ...p, online_collected: e.target.value }))}
                  disabled={dayClose.is_locked} className="input" placeholder="0.00" />
              </div>
            </div>
            {creditToday.settled > 0 && (
              <div className="flex justify-between text-sm text-green-600 bg-green-50 -mx-4 px-4 py-1.5 rounded">
                <span className="font-medium">✅ Credit settled today (cash received for old credit)</span>
                <span className="font-semibold">{fmtRs(creditToday.settled)}</span>
              </div>

            )}
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="font-bold text-gray-700">Total net collected</span>
              <span className="font-bold text-gray-900">{fmtRs(netCash)}</span>
            </div>
          </div>

          {/* Shortfall / surplus */}
          <div className={`rounded-2xl p-4 border-2 ${shortfall > 50 ? 'bg-red-50 border-red-300' : shortfall < -50 ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  {shortfall > 50
                    ? <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
                    : <CheckCircleIcon className="h-5 w-5 text-green-500" />}
                  <p className="font-bold text-gray-800">
                    {shortfall > 50 ? 'Shortfall' : shortfall < -50 ? 'Surplus' : 'Balanced ✓'}
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {shortfall > 50
                    ? creditToday.given === 0
                      ? '⚠️ If you gave credit today, tap "Sync Credits" above first'
                      : 'Money is missing — investigate'
                    : shortfall < -50 ? 'More collected than expected' : 'Cash matches perfectly'}
                </p>
                {shortfall > 50 && creditToday.given === 0 && (
                  <button onClick={refreshCreditTotals}
                    className="mt-2 flex items-center gap-1 text-xs text-orange-700 bg-orange-100 px-2.5 py-1 rounded-lg font-medium">
                    <ArrowPathIcon className="h-3 w-3" /> Sync Credits Now
                  </button>
                )}
              </div>
              <p className={`text-3xl font-bold ${shortfall > 50 ? 'text-red-600' : shortfall < -50 ? 'text-blue-600' : 'text-green-600'}`}>
                {shortfall > 0 ? '−' : shortfall < 0 ? '+' : ''}{fmtRs(Math.abs(shortfall))}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <label className="label">Notes</label>
            <textarea value={dayClose.notes} rows={2} placeholder="Any remarks for this day..."
              onChange={e => setDayClose(p => ({ ...p, notes: e.target.value }))}
              disabled={dayClose.is_locked} className="input" />
          </div>

          {!dayClose.is_locked
            ? <button onClick={handleDayClose} disabled={saving} className="btn-primary w-full">
                {saving ? 'Saving...' : 'Save Day Summary'}
              </button>
            : <div className="text-center text-sm text-green-600 flex items-center justify-center gap-2 py-3">
                <CheckCircleIcon className="h-5 w-5" /> Day summary saved
              </div>
          }
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div className="px-4 py-4 space-y-4 pb-32">
          <div>
            <label className="label">Date</label>
            <input type="date" value={historyDate} max={readingDate}
              onChange={e => setHistoryDate(e.target.value)} className="input" />
          </div>
          {historyLoading
            ? <div className="text-center py-8 text-gray-400">Loading...</div>
            : historyRows.length === 0
              ? <div className="text-center py-12 text-gray-400">
                  <BeakerIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No readings for {format(parseISO(historyDate), 'dd MMM yyyy')}</p>
                </div>
              : <div className="space-y-2">
                  {historyRows.map((r: any) => {
                    const sale = Math.max((r.end_reading || 0) - (r.start_reading || 0) - (r.testing_litres || 0), 0)
                    return (
                      <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-semibold text-sm text-gray-800">{r.dispensing_units?.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${fuelBadge(r.dispensing_units?.fuel_type)}`}>
                              {r.dispensing_units?.fuel_type}
                            </span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${r.is_locked ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {r.is_locked ? '🔒 Locked' : 'Draft'}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {[['Start', r.start_reading], ['End', r.end_reading], ['Testing', `${r.testing_litres ?? 0}L`], ['Sale', `${fmt2(sale)}L`]].map(([l, v]) => (
                            <div key={l}><p className="text-gray-400">{l}</p><p className="font-bold text-gray-800">{v}</p></div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          Rate: ₹{r.fuel_rate}/L · Expected: {fmtRs(sale * (r.fuel_rate || 0))}
                          {r.testing_litres > 0 && ` · Testing: ${r.testing_litres}L`}
                        </p>
                      </div>
                    )
                  })}
                </div>
          }
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default Readings
