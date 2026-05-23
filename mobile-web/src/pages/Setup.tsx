// src/pages/Setup.tsx
// First-run setup page — only accessible when zero users exist in the system
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'

const Setup: React.FC = () => {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [alreadySetup, setAlreadySetup] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    pump_name: '',
  })

  useEffect(() => {
    // Check if any SUPER_ADMIN already exists
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'SUPER_ADMIN')
      .then(({ count }) => {
        if (count && count > 0) setAlreadySetup(true)
        setChecking(false)
      })
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      toast.error('Please fill all required fields')
      return
    }
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (form.password !== form.confirm_password) {
      toast.error('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      // 1. Create auth user
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
      })
      if (authErr || !authData.user) throw new Error(authErr?.message || 'Failed to create auth user')

      // 2. Insert SUPER_ADMIN profile
      const { error: profileErr } = await supabase.from('users').insert({
        auth_id: authData.user.id,
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        role: 'SUPER_ADMIN',
        is_active: true,
        base_salary: 0,
        date_of_joining: new Date().toISOString().split('T')[0],
      })
      if (profileErr) throw new Error(profileErr.message)

      // 3. Optionally seed system_settings with pump name
      if (form.pump_name) {
        await supabase.from('system_settings').upsert({
          id: '00000000-0000-0000-0000-000000000001',
          pump_name: form.pump_name,
        }, { onConflict: 'id' })
      }

      toast.success('✅ Super Admin created! Please log in.')
      // Sign out the auto-session from signUp so they log in properly
      await supabase.auth.signOut()
      navigate('/login')
    } catch (err: any) {
      toast.error(err.message || 'Setup failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-orange-50">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (alreadySetup) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-orange-50 p-6">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Setup Already Complete</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          A Super Admin already exists. Please log in normally.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold"
        >
          Go to Login
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 to-orange-700 flex flex-col">
      {/* Header */}
      <div className="flex flex-col items-center pt-12 pb-6 px-6">
        <div className="h-20 w-20 bg-white rounded-3xl flex items-center justify-center mb-4 shadow-xl">
          <span className="text-4xl">⛽</span>
        </div>
        <h1 className="text-2xl font-bold text-white">PumpManager Setup</h1>
        <p className="text-orange-100 text-sm mt-1">Create your Super Admin account</p>
      </div>

      {/* Form */}
      <div className="flex-1 bg-white rounded-t-3xl px-6 py-8 overflow-y-auto">
        <div className="max-w-md mx-auto space-y-5">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
            <p className="font-semibold mb-1">👋 First-time setup</p>
            <p>This page only appears once. Create the Super Admin account that will manage the entire pump.</p>
          </div>

          {/* Pump Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pump Name (optional)</label>
            <input
              name="pump_name"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. Sharma Petrol Pump"
              value={form.pump_name}
              onChange={handleChange}
            />
          </div>

          <hr className="border-gray-200" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Super Admin Details</p>

          {/* Name Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input
                name="first_name"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Rajesh"
                value={form.first_name}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <input
                name="last_name"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Sharma"
                value={form.last_name}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              name="email"
              type="email"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="admin@mypump.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone (for WhatsApp alerts)</label>
            <input
              name="phone"
              type="tel"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="+91 98765 43210"
              value={form.phone}
              onChange={handleChange}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input
              name="password"
              type="password"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Min. 6 characters"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
            <input
              name="confirm_password"
              type="password"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Repeat password"
              value={form.confirm_password}
              onChange={handleChange}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold text-base disabled:opacity-60 mt-2"
          >
            {submitting ? 'Creating account…' : '🚀 Create Super Admin & Launch'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            After setup, this page will be locked. You can add more staff from the Employees section.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Setup
