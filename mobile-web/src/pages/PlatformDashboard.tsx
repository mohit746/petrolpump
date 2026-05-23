// src/pages/PlatformDashboard.tsx
// Exclusive to PLATFORM_OWNER — high-level view of all pumps
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BuildingStorefrontIcon, PlusCircleIcon, CheckCircleIcon,
  ExclamationTriangleIcon, XCircleIcon, CurrencyRupeeIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'

interface Pump {
  id: string
  name: string
  city: string
  state: string
  pincode: string
  phone: string | null
  subscription_status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'CANCELLED'
  subscription_plan: string
  subscription_end: string | null
  monthly_premium: number
  last_payment_date: string | null
  whatsapp_enabled: boolean
  is_active: boolean
  created_at: string
  employee_count?: number
}

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  TRIAL: 'bg-blue-100 text-blue-700',
  SUSPENDED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-600',
}

const PlatformDashboard: React.FC = () => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { confirm, dialogProps } = useConfirm()
  const [pumps, setPumps] = useState<Pump[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, active: 0, trial: 0, suspended: 0, mrr: 0 })

  useEffect(() => { fetchPumps() }, [])

  const fetchPumps = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pumps')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      // Fetch employee counts
      const enriched = await Promise.all(data.map(async (p) => {
        const { count } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('pump_id', p.id)
          .is('deleted_at', null)
        return { ...p, employee_count: count || 0 }
      }))
      setPumps(enriched)
      setStats({
        total:     enriched.length,
        active:    enriched.filter(p => p.subscription_status === 'ACTIVE').length,
        trial:     enriched.filter(p => p.subscription_status === 'TRIAL').length,
        suspended: enriched.filter(p => p.subscription_status === 'SUSPENDED').length,
        mrr:       enriched.filter(p => p.is_active).reduce((s, p) => s + (p.monthly_premium || 0), 0),
      })
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Sign Out',
      message: 'Sign out of the platform?',
      confirmLabel: 'Sign Out',
      variant: 'warning',
    })
    if (ok) logout()
  }

  const getStatusIcon = (status: string) => {
    if (status === 'ACTIVE') return <CheckCircleIcon className="h-4 w-4 text-green-600" />
    if (status === 'SUSPENDED') return <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600" />
    return <XCircleIcon className="h-4 w-4 text-red-500" />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-4 pt-12 pb-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-orange-100 text-xs font-medium uppercase tracking-wide">Platform Owner</p>
            <h1 className="text-xl font-bold">Welcome, {user?.first_name} 👋</h1>
          </div>
          <button onClick={handleLogout} className="text-xs text-orange-100 border border-orange-300 px-3 py-1.5 rounded-full">
            Sign Out
          </button>
        </div>
        {/* MRR + stats row */}
        <div className="grid grid-cols-4 gap-3 mt-2">
          {[
            { label: 'Total Pumps', value: stats.total, color: 'bg-white/20' },
            { label: 'Active', value: stats.active, color: 'bg-green-500/30' },
            { label: 'Trial', value: stats.trial, color: 'bg-blue-500/30' },
            { label: 'Suspended', value: stats.suspended, color: 'bg-yellow-500/30' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl p-2 text-center backdrop-blur-sm`}>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-[9px] text-orange-100 font-medium leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
          <CurrencyRupeeIcon className="h-5 w-5 text-orange-200" />
          <div>
            <p className="text-[10px] text-orange-200">Monthly Recurring Revenue</p>
            <p className="text-lg font-bold">₹{stats.mrr.toLocaleString()}/mo</p>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 bg-white border-b">
        <button
          onClick={() => navigate('/pumps/new')}
          className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500 text-white rounded-xl font-semibold text-sm"
        >
          <PlusCircleIcon className="h-5 w-5" />
          Add New Petrol Pump
        </button>
      </div>

      {/* Pump list */}
      <div className="px-4 py-4 space-y-3 pb-24">
        {loading && (
          <div className="text-center py-12 text-gray-400">
            <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading pumps...
          </div>
        )}
        {!loading && pumps.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <BuildingStorefrontIcon className="h-16 w-16 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No pumps registered yet.</p>
            <p className="text-sm mt-1">Tap "Add New Petrol Pump" to onboard your first client.</p>
          </div>
        )}
        {pumps.map(pump => (
          <div
            key={pump.id}
            onClick={() => navigate(`/pumps/${pump.id}`)}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 cursor-pointer active:bg-gray-50"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-900 text-base truncate">{pump.name}</h3>
                  {getStatusIcon(pump.subscription_status)}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {pump.city}{pump.state ? `, ${pump.state}` : ''} {pump.pincode || ''}
                </p>
                {pump.phone && (
                  <a
                    href={`tel:${pump.phone}`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-orange-600 mt-1"
                  >
                    <PhoneIcon className="h-3 w-3" /> {pump.phone}
                  </a>
                )}
              </div>
              <div className="text-right ml-3 shrink-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusColor[pump.subscription_status] || ''}`}>
                  {pump.subscription_status}
                </span>
                <p className="text-xs text-gray-400 mt-1">{pump.employee_count} staff</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
              <div className="text-xs text-gray-500">
                Plan: <span className="font-medium text-gray-700">{pump.subscription_plan}</span>
              </div>
              <div className="text-xs text-gray-500">
                ₹{pump.monthly_premium?.toLocaleString()}/mo
              </div>
              <div className="text-xs text-gray-500">
                {pump.whatsapp_enabled ? '✅ WhatsApp' : '❌ WhatsApp'}
              </div>
            </div>
            {pump.subscription_end && (
              <p className="text-[10px] text-gray-400 mt-1">
                Expires: {new Date(pump.subscription_end).toLocaleDateString('en-IN')}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Support footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 text-center">
        <a href="tel:+919640620555" className="text-xs text-gray-400">
          Support: <span className="text-orange-600 font-medium">+91-96406 20555</span>
        </a>
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default PlatformDashboard
