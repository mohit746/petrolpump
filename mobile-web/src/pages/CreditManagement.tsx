// src/pages/CreditManagement.tsx
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import {
  MagnifyingGlassIcon, PlusIcon, UserGroupIcon,
  CurrencyRupeeIcon, CheckCircleIcon, ClockIcon,
  ArrowPathIcon, XMarkIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'
interface Customer {
  id: string; name: string; phone: string; vehicle_number: string
  address: string | null; credit_limit: number; total_outstanding: number; notes: string | null
}
interface CreditEntry {
  id: string; customer_id: string; customer_name?: string; fuel_type: string | null
  litres: number | null; rate_per_litre: number | null; amount: number
  outstanding_amount: number; credit_date: string; receiver_name: string | null
  vehicle_number: string | null; is_fully_settled: boolean; given_by_name?: string
}
interface Settlement {
  id: string; credit_entry_id: string; amount_settled: number
  payment_mode: string; payer_name: string; settlement_date: string
}
interface FuelType { id: string; name: string; current_rate: number }

const MODES = ['CASH', 'UPI', 'NEFT', 'CARD', 'OTHER']
const today = format(new Date(), 'yyyy-MM-dd')
const fmtRs = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Component ────────────────────────────────────────────────────────
const CreditManagement: React.FC = () => {
  const { user } = useAuthStore()
  const { isSuperAdmin, isAdmin, isAccountant } = useRoleAccess()
  const canManageCustomers = isSuperAdmin || isAdmin
  const readOnly = isAccountant
  const { dialogProps } = useConfirm()
  const pumpId = user?.pump_id!

  const [tab, setTab]                   = useState<'credits' | 'customers' | 'history'>('credits')
  const [customers, setCustomers]       = useState<Customer[]>([])
  const [entries, setEntries]           = useState<CreditEntry[]>([])
  const [fuelTypes, setFuelTypes]       = useState<FuelType[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [custSearch, setCustSearch]     = useState('')
  const [historyDate, setHistoryDate]   = useState(today)
  const [historyEntries, setHistoryEntries] = useState<CreditEntry[]>([])
  const [histSettlements, setHistSettlements] = useState<Settlement[]>([])

  // Add Credit modal
  const [showCreditModal, setShowCreditModal] = useState(false)
  const [creditForm, setCreditForm] = useState({
    customer_id: '', customer_search: '', fuel_type: '', litres: '', rate: '', amount: '', receiver_name: '', vehicle_number: '', notes: '',
  })
  const [creditSaving, setCreditSaving] = useState(false)

  // Settle modal
  const [settleEntry, setSettleEntry] = useState<CreditEntry | null>(null)
  const [settleForm, setSettleForm]   = useState({ amount: '', mode: 'CASH', payer_name: '', notes: '' })
  const [settleSaving, setSettleSaving] = useState(false)

  // Add Customer modal
  const [showCustModal, setShowCustModal] = useState(false)
  const [custForm, setCustForm] = useState({ name: '', phone: '', vehicle_number: '', address: '', credit_limit: '', notes: '' })
  const [custSaving, setCustSaving] = useState(false)

  // ── Load data ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!pumpId) return
    setLoading(true)

    const [{ data: custs }, { data: ents }, { data: fts }] = await Promise.all([
      supabase.from('credit_customers').select('*').eq('pump_id', pumpId).eq('is_active', true).order('name'),
      supabase.from('credit_entries').select('*, credit_customers(name), users!given_by(first_name,last_name)')
        .eq('pump_id', pumpId).eq('is_fully_settled', false).order('created_at', { ascending: false }),
      supabase.from('fuel_types').select('id,name,current_rate').eq('pump_id', pumpId).eq('is_active', true).eq('category', 'FUEL'),
    ])

    setCustomers(custs || [])
    setEntries((ents || []).map(e => ({
      ...e,
      customer_name: (e.credit_customers as any)?.name,
      given_by_name: (e.users as any) ? `${(e.users as any).first_name} ${(e.users as any).last_name}` : null,
    })))
    setFuelTypes(fts || [])
    setLoading(false)
  }, [pumpId])

  useEffect(() => { fetchData() }, [fetchData])

  // ── History load ───────────────────────────────────────────────────
  const fetchHistory = useCallback(async (date: string) => {
    if (!pumpId) return
    const [{ data: he }, { data: hs }] = await Promise.all([
      supabase.from('credit_entries').select('*, credit_customers(name)')
        .eq('pump_id', pumpId).eq('credit_date', date).order('created_at', { ascending: false }),
      supabase.from('credit_settlements').select('*')
        .eq('pump_id', pumpId).eq('settlement_date', date).order('created_at', { ascending: false }),
    ])
    setHistoryEntries((he || []).map(e => ({ ...e, customer_name: (e.credit_customers as any)?.name })))
    setHistSettlements(hs || [])
  }, [pumpId])

  useEffect(() => { if (tab === 'history') fetchHistory(historyDate) }, [tab, historyDate, fetchHistory])

  // ── Customer search in credit form ────────────────────────────────
  const matchedCustomers = useMemo(() => {
    const q = creditForm.customer_search.toLowerCase()
    if (!q || creditForm.customer_id) return []
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.vehicle_number.toLowerCase().includes(q)
    ).slice(0, 6)
  }, [creditForm.customer_search, creditForm.customer_id, customers])

  const selectedCustomer = useMemo(() =>
    customers.find(c => c.id === creditForm.customer_id) ?? null
  , [customers, creditForm.customer_id])

  // Auto-fill rate when fuel type changes
  const handleFuelTypeChange = (name: string) => {
    const ft = fuelTypes.find(f => f.name === name)
    setCreditForm(p => ({ ...p, fuel_type: name, rate: ft ? String(ft.current_rate) : p.rate }))
  }

  // Auto-calc amount from litres × rate
  const creditAmount = useMemo(() => {
    const l = parseFloat(creditForm.litres) || 0
    const r = parseFloat(creditForm.rate) || 0
    return l && r ? l * r : parseFloat(creditForm.amount) || 0
  }, [creditForm.litres, creditForm.rate, creditForm.amount])

  // ── Add Credit Entry ───────────────────────────────────────────────
  const handleAddCredit = async () => {
    if (!creditForm.customer_id) { toast.error('Select a customer'); return }
    if (!creditForm.amount && !creditAmount) { toast.error('Enter amount'); return }

    // Credit limit check
    if (selectedCustomer && selectedCustomer.credit_limit > 0) {
      const newOutstanding = selectedCustomer.total_outstanding + creditAmount
      if (newOutstanding > selectedCustomer.credit_limit) {
        toast.error(`This would exceed ${selectedCustomer.name}'s credit limit of ${fmtRs(selectedCustomer.credit_limit)} (currently ${fmtRs(selectedCustomer.total_outstanding)} outstanding)`)
        return
      }
    }

    setCreditSaving(true)
    const finalAmount = creditAmount || parseFloat(creditForm.amount) || 0

    const { error } = await supabase.from('credit_entries').insert({
      pump_id: pumpId,
      customer_id: creditForm.customer_id,
      fuel_type: creditForm.fuel_type || null,
      litres: parseFloat(creditForm.litres) || null,
      rate_per_litre: parseFloat(creditForm.rate) || null,
      amount: finalAmount,
      outstanding_amount: finalAmount,
      credit_date: today,
      given_by: user!.id,
      receiver_name: creditForm.receiver_name || null,
      vehicle_number: creditForm.vehicle_number || null,
      notes: creditForm.notes || null,
    })
    if (error) { toast.error(error.message); setCreditSaving(false); return }

    // Update customer outstanding
    await supabase.from('credit_customers').update({
      total_outstanding: (selectedCustomer?.total_outstanding || 0) + finalAmount,
      updated_at: new Date().toISOString(),
    }).eq('id', creditForm.customer_id)

    toast.success('Credit entry added!')
    setShowCreditModal(false)
    setCreditForm({ customer_id: '', customer_search: '', fuel_type: '', litres: '', rate: '', amount: '', receiver_name: '', vehicle_number: '', notes: '' })
    setCreditSaving(false)
    fetchData()
  }

  // ── Settle credit ──────────────────────────────────────────────────
  const handleSettle = async () => {
    if (!settleEntry) return
    const amt = parseFloat(settleForm.amount)
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return }
    if (amt > settleEntry.outstanding_amount) { toast.error(`Cannot settle more than outstanding: ${fmtRs(settleEntry.outstanding_amount)}`); return }
    if (!settleForm.payer_name.trim()) { toast.error('Enter payer name'); return }

    setSettleSaving(true)
    const newOutstanding = settleEntry.outstanding_amount - amt
    const isFullySettled = newOutstanding <= 0.01

    // 1. Save settlement record
    const { error: sErr } = await supabase.from('credit_settlements').insert({
      pump_id: pumpId,
      credit_entry_id: settleEntry.id,
      customer_id: settleEntry.customer_id,
      amount_settled: amt,
      payment_mode: settleForm.mode,
      received_by: user!.id,
      payer_name: settleForm.payer_name,
      settlement_date: today,
      notes: settleForm.notes || null,
    })
    if (sErr) { toast.error(sErr.message); setSettleSaving(false); return }

    // 2. Update credit entry outstanding
    await supabase.from('credit_entries').update({
      outstanding_amount: Math.max(newOutstanding, 0),
      is_fully_settled: isFullySettled,
    }).eq('id', settleEntry.id)

    // 3. Update customer total_outstanding
    const cust = customers.find(c => c.id === settleEntry.customer_id)
    if (cust) {
      await supabase.from('credit_customers').update({
        total_outstanding: Math.max((cust.total_outstanding || 0) - amt, 0),
        updated_at: new Date().toISOString(),
      }).eq('id', settleEntry.customer_id)
    }

    toast.success(`₹${amt.toLocaleString('en-IN')} settlement recorded!`)
    setSettleEntry(null)
    setSettleForm({ amount: '', mode: 'CASH', payer_name: '', notes: '' })
    setSettleSaving(false)
    fetchData()
  }

  // ── Add Customer ───────────────────────────────────────────────────
  const handleAddCustomer = async () => {
    if (!custForm.name.trim()) { toast.error('Customer name is required'); return }
    if (!custForm.phone.trim()) { toast.error('Phone number is required'); return }
    if (!custForm.vehicle_number.trim()) { toast.error('Vehicle number is required'); return }

    setCustSaving(true)
    const { error } = await supabase.from('credit_customers').insert({
      pump_id: pumpId,
      name: custForm.name.trim(),
      phone: custForm.phone.trim(),
      vehicle_number: custForm.vehicle_number.trim().toUpperCase(),
      address: custForm.address || null,
      credit_limit: parseFloat(custForm.credit_limit) || 0,
      notes: custForm.notes || null,
      added_by: user!.id,
    })
    if (error) { toast.error(error.message); setCustSaving(false); return }

    toast.success('Customer added!')
    setShowCustModal(false)
    setCustForm({ name: '', phone: '', vehicle_number: '', address: '', credit_limit: '', notes: '' })
    setCustSaving(false)
    fetchData()
  }

  // ── Filtered display ───────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      e.customer_name?.toLowerCase().includes(q) ||
      e.vehicle_number?.toLowerCase().includes(q) ||
      e.fuel_type?.toLowerCase().includes(q)
    )
  }, [entries, search])

  const filteredCustomers = useMemo(() => {
    const q = custSearch.toLowerCase()
    if (!q) return customers
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.vehicle_number.toLowerCase().includes(q)
    )
  }, [customers, custSearch])

  const totalOutstanding = useMemo(() =>
    customers.reduce((s, c) => s + (c.total_outstanding || 0), 0), [customers])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="page">
      {/* Header */}
      <div className="bg-white border-b px-4 pt-12 pb-4 sticky top-0 z-30">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-gray-900">Credit / Khata</h1>
          <button onClick={fetchData} className="p-2 text-gray-400 hover:text-orange-500">
            <ArrowPathIcon className="h-5 w-5" />
          </button>
        </div>
        {/* Outstanding summary */}
        <div className="flex items-center gap-2 mb-3">
          <CurrencyRupeeIcon className="h-4 w-4 text-red-500" />
          <span className="text-sm text-gray-500">Total outstanding:</span>
          <span className="text-sm font-bold text-red-600">{fmtRs(totalOutstanding)}</span>
          <span className="text-xs text-gray-400">across {customers.length} customers</span>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[{ key: 'credits', label: '📋 Credits' }, { key: 'customers', label: '👥 Customers' }, { key: 'history', label: '🕐 History' }]
            .map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>
                {t.label}
              </button>
            ))}
        </div>
      </div>

      {/* ── CREDITS TAB ── */}
      {tab === 'credits' && (
        <div className="px-4 py-4 space-y-3 pb-32">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-9" placeholder="Search customer, vehicle..." />
            </div>
            {!readOnly && (
              <button onClick={() => setShowCreditModal(true)}
                className="flex items-center gap-1 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold shrink-0">
                <PlusIcon className="h-4 w-4" /> Add
              </button>
            )}
          </div>

          {filteredEntries.length === 0
            ? <div className="text-center py-12 text-gray-400">
                <CurrencyRupeeIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>No open credit entries</p>
              </div>
            : filteredEntries.map(entry => (
                <div key={entry.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900">{entry.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {entry.vehicle_number && <span className="mr-2">🚗 {entry.vehicle_number}</span>}
                        {entry.receiver_name && <span>Recd by: {entry.receiver_name}</span>}
                      </p>
                      {entry.fuel_type && (
                        <p className="text-xs text-gray-500 mt-1">
                          {entry.fuel_type} · {entry.litres ? `${entry.litres}L` : ''} · ₹{entry.rate_per_litre}/L
                        </p>
                      )}
                      <p className="text-xs text-gray-400">{format(new Date(entry.credit_date), 'dd MMM yyyy')}</p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="text-lg font-bold text-red-600">{fmtRs(entry.outstanding_amount)}</p>
                      <p className="text-xs text-gray-400">of {fmtRs(entry.amount)}</p>
                    </div>
                  </div>
                  {!readOnly && (
                    <button onClick={() => { setSettleEntry(entry); setSettleForm({ amount: '', mode: 'CASH', payer_name: '', notes: '' }) }}
                      className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-green-300 text-green-700 text-sm font-semibold">
                      <CheckCircleIcon className="h-4 w-4" /> Record Settlement
                    </button>
                  )}
                </div>
              ))
          }
        </div>
      )}

      {/* ── CUSTOMERS TAB ── */}
      {tab === 'customers' && (
        <div className="px-4 py-4 space-y-3 pb-32">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={custSearch} onChange={e => setCustSearch(e.target.value)}
                className="input pl-9" placeholder="Name, phone, vehicle..." />
            </div>
            {canManageCustomers && (
              <button onClick={() => setShowCustModal(true)}
                className="flex items-center gap-1 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold shrink-0">
                <PlusIcon className="h-4 w-4" /> New
              </button>
            )}
          </div>

          {filteredCustomers.length === 0
            ? <div className="text-center py-12 text-gray-400">
                <UserGroupIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>No customers found</p>
              </div>
            : filteredCustomers.map(c => (
                <div key={c.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">📱 {c.phone} · 🚗 {c.vehicle_number}</p>
                      {c.address && <p className="text-xs text-gray-400 truncate">{c.address}</p>}
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      {c.total_outstanding > 0
                        ? <p className="text-base font-bold text-red-600">{fmtRs(c.total_outstanding)}</p>
                        : <p className="text-xs font-medium text-green-600">✓ Clear</p>
                      }
                      {c.credit_limit > 0 && (
                        <p className="text-[10px] text-gray-400">Limit: {fmtRs(c.credit_limit)}</p>
                      )}
                    </div>
                  </div>
                  {c.credit_limit > 0 && c.total_outstanding > 0 && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-100 rounded-full h-1">
                        <div className="bg-red-400 h-1 rounded-full" style={{ width: `${Math.min((c.total_outstanding / c.credit_limit) * 100, 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{Math.round((c.total_outstanding / c.credit_limit) * 100)}% of limit used</p>
                    </div>
                  )}
                </div>
              ))
          }
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div className="px-4 py-4 space-y-4 pb-32">
          <div>
            <label className="label">Date</label>
            <input type="date" value={historyDate} max={today}
              onChange={e => setHistoryDate(e.target.value)} className="input" />
          </div>

          {historyEntries.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Credits Given</p>
              <div className="space-y-2">
                {historyEntries.map(e => (
                  <div key={e.id} className="bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex justify-between">
                      <p className="font-semibold text-sm text-gray-800">{e.customer_name}</p>
                      <p className="font-bold text-red-600">{fmtRs(e.amount)}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {e.fuel_type && `${e.fuel_type} · `}{e.litres && `${e.litres}L · `}{e.receiver_name && `Rcvd: ${e.receiver_name}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {histSettlements.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Settlements Received</p>
              <div className="space-y-2">
                {histSettlements.map(s => (
                  <div key={s.id} className="bg-white rounded-xl p-3 border border-green-100">
                    <div className="flex justify-between">
                      <p className="font-semibold text-sm text-gray-800">{s.payer_name}</p>
                      <p className="font-bold text-green-600">{fmtRs(s.amount_settled)}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{s.payment_mode}</p>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t pt-2">
                  <span className="text-gray-700">Total settled today</span>
                  <span className="text-green-600">{fmtRs(histSettlements.reduce((s, r) => s + r.amount_settled, 0))}</span>
                </div>
              </div>
            </div>
          )}

          {historyEntries.length === 0 && histSettlements.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <ClockIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>No credit activity on this date</p>
            </div>
          )}
        </div>
      )}

      {/* ── ADD CREDIT MODAL ── */}
      {showCreditModal && (
        <div className="modal-overlay" onClick={() => setShowCreditModal(false)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">New Credit Entry</h2>
              <button onClick={() => setShowCreditModal(false)} className="text-gray-400 text-2xl leading-none"><XMarkIcon className="h-6 w-6" /></button>
            </div>
            <div className="space-y-3">
              {/* Customer search */}
              <div>
                <label className="label">Customer *</label>
                {creditForm.customer_id
                  ? <div className="flex items-center justify-between input bg-orange-50 border-orange-200">
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{selectedCustomer?.name}</p>
                        <p className="text-xs text-gray-500">{selectedCustomer?.phone} · {selectedCustomer?.vehicle_number}</p>
                        {(selectedCustomer?.total_outstanding || 0) > 0 && (
                          <p className="text-xs text-red-500">Outstanding: {fmtRs(selectedCustomer!.total_outstanding)}</p>
                        )}
                      </div>
                      <button onClick={() => setCreditForm(p => ({ ...p, customer_id: '', customer_search: '' }))}
                        className="text-gray-400 ml-2"><XMarkIcon className="h-4 w-4" /></button>
                    </div>
                  : <>
                      <input value={creditForm.customer_search}
                        onChange={e => setCreditForm(p => ({ ...p, customer_search: e.target.value }))}
                        className="input" placeholder="Search by name, phone, vehicle..." />
                      {matchedCustomers.length > 0 && (
                        <div className="border border-gray-200 rounded-xl mt-1 overflow-hidden">
                          {matchedCustomers.map(c => (
                            <button key={c.id} onClick={() => setCreditForm(p => ({ ...p, customer_id: c.id, customer_search: c.name, vehicle_number: p.vehicle_number || c.vehicle_number }))}
                              className="w-full text-left px-3 py-2 hover:bg-orange-50 border-b last:border-0">
                              <p className="text-sm font-medium text-gray-800">{c.name}</p>
                              <p className="text-xs text-gray-400">{c.phone} · {c.vehicle_number}
                                {c.total_outstanding > 0 && <span className="text-red-500 ml-1"> · ₹{c.total_outstanding.toLocaleString('en-IN')} outstanding</span>}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                      {creditForm.customer_search && matchedCustomers.length === 0 && (
                        <p className="text-xs text-gray-400 mt-1 px-1">
                          No customer found.
                          {canManageCustomers
                            ? <button onClick={() => { setShowCreditModal(false); setShowCustModal(true) }} className="text-orange-500 ml-1 font-medium">Add new customer →</button>
                            : ' Ask your Admin to add a new customer.'}
                        </p>
                      )}
                    </>
                }
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Fuel Type</label>
                  <select value={creditForm.fuel_type} onChange={e => handleFuelTypeChange(e.target.value)} className="input">
                    <option value="">Select...</option>
                    {fuelTypes.map(ft => <option key={ft.id} value={ft.name}>{ft.name} (₹{ft.current_rate}/L)</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Litres</label>
                  <input type="number" step="0.01" value={creditForm.litres}
                    onChange={e => setCreditForm(p => ({ ...p, litres: e.target.value }))}
                    className="input" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Rate/L (₹)</label>
                  <input type="number" step="0.01" value={creditForm.rate}
                    onChange={e => setCreditForm(p => ({ ...p, rate: e.target.value }))}
                    className="input" placeholder="Auto-filled" />
                </div>
                <div>
                  <label className="label">Amount (₹) *</label>
                  <input type="number" step="0.01"
                    value={creditForm.litres && creditForm.rate ? creditAmount.toFixed(2) : creditForm.amount}
                    onChange={e => setCreditForm(p => ({ ...p, amount: e.target.value, litres: '', rate: '' }))}
                    className="input font-bold" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Received by (name)</label>
                  <input value={creditForm.receiver_name}
                    onChange={e => setCreditForm(p => ({ ...p, receiver_name: e.target.value }))}
                    className="input" placeholder="Who received fuel?" />
                </div>
                <div>
                  <label className="label">Vehicle No.</label>
                  <input value={creditForm.vehicle_number}
                    onChange={e => setCreditForm(p => ({ ...p, vehicle_number: e.target.value }))}
                    className="input" placeholder="UP16 AB 1234" />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <input value={creditForm.notes} onChange={e => setCreditForm(p => ({ ...p, notes: e.target.value }))}
                  className="input" placeholder="Optional remarks" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowCreditModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={handleAddCredit} disabled={creditSaving} className="btn-primary flex-1">
                  {creditSaving ? 'Saving...' : 'Save Credit Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTLE MODAL ── */}
      {settleEntry && (
        <div className="modal-overlay" onClick={() => setSettleEntry(null)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Record Settlement</h2>
              <button onClick={() => setSettleEntry(null)} className="text-gray-400"><XMarkIcon className="h-6 w-6" /></button>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 mb-4">
              <p className="font-bold text-gray-800">{settleEntry.customer_name}</p>
              <p className="text-sm text-orange-700">Outstanding: <strong>{fmtRs(settleEntry.outstanding_amount)}</strong></p>
              {settleEntry.fuel_type && <p className="text-xs text-gray-500 mt-0.5">{settleEntry.fuel_type} · {settleEntry.litres}L · {format(new Date(settleEntry.credit_date), 'dd MMM')}</p>}
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount Received (₹) *</label>
                  <input type="number" step="0.01" max={settleEntry.outstanding_amount}
                    value={settleForm.amount} onChange={e => setSettleForm(p => ({ ...p, amount: e.target.value }))}
                    className="input font-bold" placeholder={String(settleEntry.outstanding_amount)} />
                  <p className="text-xs text-gray-400 mt-0.5">Max: {fmtRs(settleEntry.outstanding_amount)}</p>
                </div>
                <div>
                  <label className="label">Payment Mode *</label>
                  <select value={settleForm.mode} onChange={e => setSettleForm(p => ({ ...p, mode: e.target.value }))} className="input">
                    {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Paid by (name) *</label>
                <input value={settleForm.payer_name} onChange={e => setSettleForm(p => ({ ...p, payer_name: e.target.value }))}
                  className="input" placeholder="Who physically gave the money?" />
              </div>
              <div>
                <label className="label">Notes</label>
                <input value={settleForm.notes} onChange={e => setSettleForm(p => ({ ...p, notes: e.target.value }))}
                  className="input" placeholder="Optional" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setSettleEntry(null)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={handleSettle} disabled={settleSaving} className="btn-primary flex-1">
                  {settleSaving ? 'Saving...' : 'Confirm Settlement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD CUSTOMER MODAL (Admin/Super Admin only) ── */}
      {showCustModal && canManageCustomers && (
        <div className="modal-overlay" onClick={() => setShowCustModal(false)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">New Credit Customer</h2>
              <button onClick={() => setShowCustModal(false)} className="text-gray-400"><XMarkIcon className="h-6 w-6" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Full Name *</label>
                <input value={custForm.name} onChange={e => setCustForm(p => ({ ...p, name: e.target.value }))} className="input" placeholder="Customer's full name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone *</label>
                  <input type="tel" value={custForm.phone} onChange={e => setCustForm(p => ({ ...p, phone: e.target.value }))} className="input" placeholder="+91 98765 43210" />
                </div>
                <div>
                  <label className="label">Vehicle No. *</label>
                  <input value={custForm.vehicle_number} onChange={e => setCustForm(p => ({ ...p, vehicle_number: e.target.value.toUpperCase() }))} className="input" placeholder="UP16 AB 1234" />
                </div>
              </div>
              <div>
                <label className="label">Address</label>
                <input value={custForm.address} onChange={e => setCustForm(p => ({ ...p, address: e.target.value }))} className="input" placeholder="Village / town" />
              </div>
              <div>
                <label className="label">Credit Limit (₹) <span className="font-normal text-gray-400">— 0 = unlimited</span></label>
                <input type="number" value={custForm.credit_limit} onChange={e => setCustForm(p => ({ ...p, credit_limit: e.target.value }))} className="input" placeholder="0" />
              </div>
              <div>
                <label className="label">Notes</label>
                <input value={custForm.notes} onChange={e => setCustForm(p => ({ ...p, notes: e.target.value }))} className="input" placeholder="Any details about this customer" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowCustModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={handleAddCustomer} disabled={custSaving} className="btn-primary flex-1">
                  {custSaving ? 'Saving...' : 'Add Customer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default CreditManagement
