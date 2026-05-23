// src/pages/PumpDetail.tsx
import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeftIcon, BuildingStorefrontIcon, UserCircleIcon,
  CreditCardIcon, DevicePhoneMobileIcon, TrashIcon,
  LockClosedIcon, LockOpenIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PumpForm {
  name: string; address: string; city: string; state: string
  country: string; pincode: string; phone: string; email: string
  subscription_plan: string; monthly_premium: string
  subscription_end: string; whatsapp_enabled: boolean
  reports_enabled: boolean; max_employees: string; notes: string
}
interface SuperAdminForm {
  first_name: string; last_name: string; email: string; phone: string; password: string
}

const PLANS  = ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']
const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
]

const emptyPump: PumpForm = {
  name: '', address: '', city: '', state: '', country: 'India', pincode: '',
  phone: '', email: '', subscription_plan: 'BASIC', monthly_premium: '999',
  subscription_end: '', whatsapp_enabled: false, reports_enabled: true,
  max_employees: '20', notes: '',
}
const emptyAdmin: SuperAdminForm = {
  first_name: '', last_name: '', email: '', phone: '', password: '',
}

// ─── Component ────────────────────────────────────────────────────────────────
const PumpDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { confirm, dialogProps } = useConfirm()

  const [pump, setPump]           = useState<any>(null)
  const [form, setForm]           = useState<PumpForm>(emptyPump)
  const [adminForm, setAdminForm] = useState<SuperAdminForm>(emptyAdmin)
  const [superAdmin, setSuperAdmin] = useState<any>(null)
  const [tab, setTab]             = useState<'details' | 'subscription' | 'owner'>('details')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading]     = useState(!isNew)

  useEffect(() => { if (!isNew) fetchPump() }, [id])

  const fetchPump = async () => {
    setLoading(true)
    const { data: pumpData } = await supabase.from('pumps').select('*').eq('id', id).single()
    if (pumpData) {
      setPump(pumpData)
      setForm({
        name: pumpData.name || '', address: pumpData.address || '',
        city: pumpData.city || '', state: pumpData.state || '',
        country: pumpData.country || 'India', pincode: pumpData.pincode || '',
        phone: pumpData.phone || '', email: pumpData.email || '',
        subscription_plan: pumpData.subscription_plan || 'BASIC',
        monthly_premium: String(pumpData.monthly_premium || 999),
        subscription_end: pumpData.subscription_end || '',
        whatsapp_enabled: pumpData.whatsapp_enabled || false,
        reports_enabled: pumpData.reports_enabled ?? true,
        max_employees: String(pumpData.max_employees || 20),
        notes: pumpData.notes || '',
      })
    }
    const { data: sa } = await supabase.from('users').select('*')
      .eq('pump_id', id).eq('role', 'SUPER_ADMIN').is('deleted_at', null).maybeSingle()
    if (sa) setSuperAdmin(sa)
    setLoading(false)
  }

  const f = (field: keyof PumpForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  // ── Step 1: Create / Save pump ───────────────────────────────────────────
  const savePump = async () => {
    if (!form.name.trim() || !form.city.trim()) {
      toast.error('Pump name and city are required'); return
    }
    setSubmitting(true)
    const payload = {
      name: form.name, address: form.address || null, city: form.city,
      state: form.state || null, country: form.country,
      pincode: form.pincode || null, phone: form.phone || null,
      email: form.email || null, subscription_plan: form.subscription_plan,
      monthly_premium: parseFloat(form.monthly_premium) || 999,
      subscription_end: form.subscription_end || null,
      whatsapp_enabled: form.whatsapp_enabled, reports_enabled: form.reports_enabled,
      max_employees: parseInt(form.max_employees) || 20,
      notes: form.notes || null, updated_at: new Date().toISOString(),
    }
    if (isNew) {
      // Validate super admin fields too
      if (!adminForm.first_name.trim()) { toast.error('Super Admin first name is required'); setSubmitting(false); return }
      if (!adminForm.phone.trim() && !adminForm.email.trim()) { toast.error('Super Admin needs a phone or email'); setSubmitting(false); return }
      if (!adminForm.password || adminForm.password.length < 8) { toast.error('Password must be at least 8 characters'); setSubmitting(false); return }

      // 1. Create pump
      const { data: newPump, error: pumpErr } = await supabase.from('pumps')
        .insert({ ...payload, subscription_status: 'TRIAL', is_active: true })
        .select().single()
      if (pumpErr) { toast.error(pumpErr.message); setSubmitting(false); return }

      // 2. Create Super Admin auth user
      const authEmail = adminForm.email.trim() || `${adminForm.phone.replace(/\D/g, '')}@pump.local`

      // Save platform owner session — signUp replaces it when email confirm is OFF
      const { data: { session: ownerSession } } = await supabase.auth.getSession()

      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: authEmail, password: adminForm.password,
        options: { emailRedirectTo: undefined },
      })
      if (authErr || !authData.user) {
        toast.error(authErr?.message || 'Auth signup error'); setSubmitting(false); return
      }

      // Restore platform owner session immediately
      if (ownerSession) {
        await supabase.auth.setSession({
          access_token: ownerSession.access_token,
          refresh_token: ownerSession.refresh_token,
        })
      }

      // 3. Insert Super Admin into users table linked to new pump
      const { error: dbErr } = await supabase.from('users').insert({
        auth_id: authData.user.id,
        email: authEmail,
        phone: adminForm.phone.trim() || null,
        first_name: adminForm.first_name,
        last_name: adminForm.last_name || '',
        role: 'SUPER_ADMIN',
        pump_id: newPump.id,   // ← linked to the pump just created
        is_active: true,
        is_blocked: false,
        base_salary: 0,
      })
      if (dbErr) { toast.error(dbErr.message); setSubmitting(false); return }

      toast.success(`✓ Pump "${newPump.name}" and Super Admin created!`)
      navigate(`/pumps/${newPump.id}`, { replace: true })
    } else {
      const { error } = await supabase.from('pumps').update(payload).eq('id', id)
      if (error) toast.error(error.message)
      else { toast.success('Pump updated!'); fetchPump() }
    }
    setSubmitting(false)
  }

  // ── Create Super Admin for EXISTING pump (from Super Admin tab) ───────────
  const createSuperAdmin = async (targetPumpId: string) => {
    if (!adminForm.first_name.trim()) { toast.error('First name is required'); return }
    if (!adminForm.phone.trim() && !adminForm.email.trim()) {
      toast.error('Enter at least a phone number or email'); return
    }
    if (!adminForm.password || adminForm.password.length < 8) {
      toast.error('Password must be at least 8 characters'); return
    }

    const authEmail = adminForm.email.trim() ||
      `${adminForm.phone.replace(/\D/g, '')}@pump.local`

    setSubmitting(true)
    const { data: { session: ownerSession } } = await supabase.auth.getSession()

    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: authEmail, password: adminForm.password,
      options: { emailRedirectTo: undefined },
    })
    if (authErr || !authData.user) {
      toast.error(authErr?.message || 'Auth error'); setSubmitting(false); return
    }

    if (ownerSession) {
      await supabase.auth.setSession({
        access_token: ownerSession.access_token,
        refresh_token: ownerSession.refresh_token,
      })
    }
    const { error: dbErr } = await supabase.from('users').insert({
      auth_id: authData.user.id,
      email: authEmail,
      phone: adminForm.phone.trim() || null,
      first_name: adminForm.first_name,
      last_name: adminForm.last_name || '',
      role: 'SUPER_ADMIN',
      pump_id: targetPumpId,
      is_active: true,
      is_blocked: false,
      base_salary: 0,
    })
    if (dbErr) { toast.error(dbErr.message); setSubmitting(false); return }
    toast.success('Super Admin created!')
    setAdminForm(emptyAdmin); fetchPump()
    setSubmitting(false)
  }

  const handleDeactivatePump = async () => {
    const ok = await confirm({
      title: 'Suspend Pump', variant: 'warning',
      message: `Suspend "${pump?.name}"? All employees will lose app access.`,
      confirmLabel: 'Yes, Suspend',
    })
    if (!ok) return
    await supabase.from('pumps').update({ is_active: false, subscription_status: 'SUSPENDED', deactivated_at: new Date().toISOString() }).eq('id', id)
    toast.success('Pump suspended.'); fetchPump()
  }

  const handleActivatePump = async () => {
    await supabase.from('pumps').update({ is_active: true, subscription_status: 'ACTIVE', deactivated_at: null }).eq('id', id)
    toast.success('Pump reactivated.'); fetchPump()
  }

  const handleDeletePump = async () => {
    const ok = await confirm({
      title: 'Delete Pump Permanently', variant: 'danger',
      message: `Delete "${pump?.name}"? All data will be permanently removed. This CANNOT be undone.`,
      confirmLabel: 'Yes, Delete Forever',
    })
    if (!ok) return
    await supabase.from('pumps').delete().eq('id', id)
    toast.success('Pump deleted.'); navigate('/', { replace: true })
  }

  const recordPayment = async () => {
    const amount = prompt(`Enter payment received from "${pump?.name}" (₹):`)
    if (!amount || isNaN(Number(amount))) return
    await supabase.from('pump_payments').insert({ pump_id: id, amount: parseFloat(amount), payment_date: new Date().toISOString().split('T')[0] })
    await supabase.from('pumps').update({ last_payment_date: new Date().toISOString().split('T')[0], last_payment_amount: parseFloat(amount), subscription_status: 'ACTIVE' }).eq('id', id)
    toast.success(`₹${amount} payment recorded.`); fetchPump()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // NEW PUMP — Single combined form (pump + super admin together)
  // ════════════════════════════════════════════════════════════
  if (isNew) return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b px-4 pt-12 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-gray-500">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">New Petrol Pump</h1>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Pump Info */}
        <div className="bg-white rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <BuildingStorefrontIcon className="h-4 w-4" /> Pump Information
          </h3>
          <div>
            <label className="label">Pump Name *</label>
            <input value={form.name} onChange={f('name')} className="input" placeholder="e.g. Shri Ram Petrol Pump" />
          </div>
          <div>
            <label className="label">Address / Locality</label>
            <textarea value={form.address} onChange={f('address')} className="input" rows={2} placeholder="Street / locality" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">City *</label>
              <input value={form.city} onChange={f('city')} className="input" placeholder="Lucknow" />
            </div>
            <div>
              <label className="label">Pincode</label>
              <input type="number" value={form.pincode} onChange={f('pincode')} className="input" placeholder="226001" />
            </div>
          </div>
          <div>
            <label className="label">State</label>
            <select value={form.state} onChange={f('state')} className="input">
              <option value="">Select state</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Pump Phone</label>
            <input type="tel" value={form.phone} onChange={f('phone')} className="input" placeholder="+91 98765 43210" />
          </div>
        </div>

        {/* Subscription */}
        <div className="bg-white rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <CreditCardIcon className="h-4 w-4" /> Subscription Plan
          </h3>
          <div className="flex gap-2">
            {PLANS.map(p => (
              <button key={p} onClick={() => setForm(prev => ({ ...prev, subscription_plan: p }))}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl border ${form.subscription_plan === p ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                {p}
              </button>
            ))}
          </div>
          <div>
            <label className="label">Monthly Premium (₹)</label>
            <input type="number" value={form.monthly_premium} onChange={f('monthly_premium')} className="input" />
          </div>
        </div>

        {/* Super Admin */}
        <div className="bg-white rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <DevicePhoneMobileIcon className="h-4 w-4" /> Super Admin (Pump Owner) Account
          </h3>
          <p className="text-xs text-gray-400">This person will manage the pump and can login with their mobile number.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First Name *</label>
              <input value={adminForm.first_name}
                onChange={e => setAdminForm(p => ({ ...p, first_name: e.target.value }))}
                className="input" placeholder="Ramesh" />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input value={adminForm.last_name}
                onChange={e => setAdminForm(p => ({ ...p, last_name: e.target.value }))}
                className="input" placeholder="Sharma" />
            </div>
          </div>
          <div>
            <label className="label">Mobile Number *</label>
            <input type="tel" value={adminForm.phone}
              onChange={e => setAdminForm(p => ({ ...p, phone: e.target.value }))}
              className="input" placeholder="9876543210" />
            <p className="text-xs text-gray-400 mt-1">Owner will login with this number</p>
          </div>
          <div>
            <label className="label">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="email" value={adminForm.email}
              onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))}
              className="input" placeholder="owner@pump.com" />
          </div>
          <div>
            <label className="label">Login Password * <span className="text-gray-400 font-normal">(min 8 chars)</span></label>
            <input type="password" value={adminForm.password}
              onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))}
              className="input" placeholder="Share securely with owner" />
          </div>
        </div>

        <button onClick={savePump} disabled={submitting} className="btn-primary w-full py-4 text-base">
          {submitting ? 'Creating pump & admin...' : '⛽ Create Pump & Super Admin'}
        </button>
      </div>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // EXISTING PUMP — 3-tab edit view
  // ════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b px-4 pt-12 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-gray-500">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">{form.name || 'Edit Pump'}</h1>
            {pump && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                pump.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
              }`}>{pump.subscription_status}</span>
            )}
          </div>
        </div>
        <div className="flex gap-1 mt-3 bg-gray-100 rounded-xl p-1">
          {[
            { key: 'details', label: '📍 Details' },
            { key: 'subscription', label: '💳 Subscription' },
            { key: 'owner', label: '👤 Super Admin' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* ── DETAILS TAB ── */}
        {tab === 'details' && (
          <>
            <div className="bg-white rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <BuildingStorefrontIcon className="h-4 w-4" /> Pump Information
              </h3>
              <div>
                <label className="label">Pump Name *</label>
                <input value={form.name} onChange={f('name')} className="input" />
              </div>
              <div>
                <label className="label">Address</label>
                <textarea value={form.address} onChange={f('address')} className="input" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">City *</label>
                  <input value={form.city} onChange={f('city')} className="input" />
                </div>
                <div>
                  <label className="label">Pincode</label>
                  <input type="number" value={form.pincode} onChange={f('pincode')} className="input" />
                </div>
              </div>
              <div>
                <label className="label">State</label>
                <select value={form.state} onChange={f('state')} className="input">
                  <option value="">Select state</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone</label>
                  <input type="tel" value={form.phone} onChange={f('phone')} className="input" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" value={form.email} onChange={f('email')} className="input" />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea value={form.notes} onChange={f('notes')} className="input" rows={2} />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Feature Controls</h3>
              {[
                { field: 'whatsapp_enabled' as const, label: 'WhatsApp Notifications', desc: 'Allow WhatsApp messages' },
                { field: 'reports_enabled' as const, label: 'Monthly Reports', desc: 'Generate and send monthly reports' },
              ].map(feat => (
                <div key={feat.field} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{feat.label}</p>
                    <p className="text-xs text-gray-400">{feat.desc}</p>
                  </div>
                  <button onClick={() => setForm(p => ({ ...p, [feat.field]: !p[feat.field] }))}
                    className={`relative w-11 h-6 rounded-full transition-colors overflow-hidden flex-shrink-0 ${form[feat.field] ? 'bg-orange-500' : 'bg-gray-200'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form[feat.field] ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
              <div>
                <label className="label">Max Employees</label>
                <input type="number" value={form.max_employees} onChange={f('max_employees')} className="input" min="1" />
              </div>
            </div>

            <button onClick={savePump} disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>

            <div className="bg-white rounded-2xl p-4 border border-red-100 space-y-2">
              <h3 className="text-sm font-semibold text-red-600">Danger Zone</h3>
              {pump?.is_active ? (
                <button onClick={handleDeactivatePump}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-yellow-300 text-yellow-700 text-sm font-semibold">
                  <LockClosedIcon className="h-4 w-4" /> Suspend Pump
                </button>
              ) : (
                <button onClick={handleActivatePump}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-green-300 text-green-700 text-sm font-semibold">
                  <LockOpenIcon className="h-4 w-4" /> Reactivate Pump
                </button>
              )}
              <button onClick={handleDeletePump}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold">
                <TrashIcon className="h-4 w-4" /> Delete Pump Permanently
              </button>
            </div>
          </>
        )}

        {/* ── SUBSCRIPTION TAB ── */}
        {tab === 'subscription' && (
          <div className="bg-white rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <CreditCardIcon className="h-4 w-4" /> Subscription Details
            </h3>
            <div>
              <label className="label">Plan</label>
              <select value={form.subscription_plan} onChange={f('subscription_plan')} className="input">
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Monthly Premium (₹)</label>
              <input type="number" value={form.monthly_premium} onChange={f('monthly_premium')} className="input" />
            </div>
            <div>
              <label className="label">Subscription End Date</label>
              <input type="date" value={form.subscription_end} onChange={f('subscription_end')} className="input" />
            </div>
            {pump && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Last payment: {pump.last_payment_date
                  ? `₹${pump.last_payment_amount?.toLocaleString()} on ${new Date(pump.last_payment_date).toLocaleDateString('en-IN')}`
                  : 'No payments recorded'}</p>
              </div>
            )}
            <button onClick={savePump} disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Saving...' : 'Save Subscription'}
            </button>
            <button onClick={recordPayment}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-green-300 text-green-700 font-semibold text-sm">
              <CheckCircleIcon className="h-4 w-4" /> Record Payment Received
            </button>
          </div>
        )}

        {/* ── SUPER ADMIN TAB ── */}
        {tab === 'owner' && (
          <>
            {superAdmin ? (
              <div className="bg-white rounded-2xl p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <UserCircleIcon className="h-4 w-4" /> Current Super Admin
                </h3>
                <div className="bg-orange-50 rounded-xl p-3">
                  <p className="font-bold text-gray-900">{superAdmin.first_name} {superAdmin.last_name}</p>
                  {superAdmin.email && <p className="text-xs text-gray-500">{superAdmin.email}</p>}
                  {superAdmin.phone && <p className="text-xs text-gray-500">📱 {superAdmin.phone}</p>}
                  <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    superAdmin.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>{superAdmin.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                <p className="text-xs text-gray-400 text-center">To change, block the current admin in Employees and create a new one below.</p>
              </div>
            ) : (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                <p className="text-sm font-medium text-orange-700">No Super Admin yet.</p>
                <p className="text-xs text-orange-500">Create one below to activate this pump.</p>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <DevicePhoneMobileIcon className="h-4 w-4" />
                {superAdmin ? 'Add Another Admin' : 'Create Super Admin'}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name *</label>
                  <input value={adminForm.first_name}
                    onChange={e => setAdminForm(p => ({ ...p, first_name: e.target.value }))}
                    className="input" placeholder="Ramesh" />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input value={adminForm.last_name}
                    onChange={e => setAdminForm(p => ({ ...p, last_name: e.target.value }))}
                    className="input" placeholder="Sharma" />
                </div>
              </div>
              <div>
                <label className="label">Mobile Number *</label>
                <input type="tel" value={adminForm.phone}
                  onChange={e => setAdminForm(p => ({ ...p, phone: e.target.value }))}
                  className="input" placeholder="+91 98765 43210" />
                <p className="text-xs text-gray-400 mt-1">Can login with this mobile number</p>
              </div>
              <div>
                <label className="label">Email (optional)</label>
                <input type="email" value={adminForm.email}
                  onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))}
                  className="input" placeholder="owner@pump.com" />
              </div>
              <div>
                <label className="label">Password * (min 8 characters)</label>
                <input type="password" value={adminForm.password}
                  onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))}
                  className="input" placeholder="Share securely with owner" />
              </div>
              <button onClick={() => createSuperAdmin(id!)} disabled={submitting} className="btn-primary w-full">
                {submitting ? 'Creating...' : 'Create Super Admin Account'}
              </button>
            </div>
          </>
        )}
      </div>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default PumpDetail
