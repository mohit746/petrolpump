// src/pages/Settings.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2, MapPin, Clock, Wallet, CalendarDays, MessageSquare, Fuel, Settings2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import useAuthStore from '../stores/useAuthStore'
import { useToast } from '../components/ui/Toast'

const TABS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'geofence', label: 'Geofence', icon: MapPin },
  { id: 'shifts', label: 'Shifts', icon: Clock },
  { id: 'salary', label: 'Salary', icon: Wallet },
  { id: 'leaves', label: 'Leaves', icon: CalendarDays },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'fuel', label: 'Fuel Rates', icon: Fuel },
]

const Settings: React.FC = () => {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState('general')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('system_settings').select('*').eq('pump_id', user!.pump_id!)
      const map: Record<string, string> = {}
      for (const s of data ?? []) map[s.key] = s.value
      setForm(map)
      return map
    },
    enabled: !!user?.pump_id,
  })

  const val = (key: string) => form[key] ?? (settings as Record<string, string> | undefined)?.[key] ?? ''
  const set = (key: string, v: string) => setForm(prev => ({ ...prev, [key]: v }))

  const save = async (keys: string[]) => {
    setSaving(true)
    try {
      const rows = keys.map(k => ({
        pump_id: user!.pump_id,
        key: k,
        value: (form[k] ?? (settings as Record<string, string> | undefined)?.[k] ?? ''),
      }))
      // Schema has UNIQUE(pump_id, key) — must specify onConflict to avoid duplicates
      const { error } = await supabase
        .from('system_settings')
        .upsert(rows, { onConflict: 'pump_id,key' })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast('Settings saved', 'success')
    } catch (e) {
      console.error(e)
      toast('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const Field = ({ label, settingKey, type = 'text', placeholder = '' }: { label: string; settingKey: string; type?: string; placeholder?: string }) => (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" placeholder={placeholder} value={val(settingKey)} onChange={e => set(settingKey, e.target.value)} />
    </div>
  )

  const SaveBtn = ({ keys }: { keys: string[] }) => (
    <button onClick={() => save(keys)} disabled={saving} className="btn-primary">
      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      Save
    </button>
  )

  if (isLoading) return (
    <div className="p-4 flex justify-center pt-12">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
    </div>
  )

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Tab list */}
      <div className="flex md:flex-col gap-1 p-3 md:w-44 md:border-r border-slate-200 dark:border-slate-700 overflow-x-auto md:overflow-visible">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${tab === t.id ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              <Icon className="w-4 h-4 shrink-0" />{t.label}
            </button>
          )
        })}
      </div>

      {/* Tab panels */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {tab === 'general' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">General Settings</h3>
            <Field label="Pump Name" settingKey="pump_name" placeholder="My Petrol Pump" />
            <Field label="Address" settingKey="pump_address" placeholder="Full address" />
            <Field label="Contact Phone" settingKey="contact_phone" type="tel" />
            <Field label="GST Number" settingKey="gst_number" placeholder="22AAAAA0000A1Z5" />
            <SaveBtn keys={['pump_name', 'pump_address', 'contact_phone', 'gst_number']} />
          </div>
        )}

        {tab === 'geofence' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Geofence Settings</h3>
            <p className="text-xs text-slate-500">Set the pump location and radius for attendance check-in validation.</p>
            <Field label="Latitude" settingKey="pump_latitude" type="number" placeholder="28.6139" />
            <Field label="Longitude" settingKey="pump_longitude" type="number" placeholder="77.2090" />
            <Field label="Radius (meters)" settingKey="geofence_radius" type="number" placeholder="200" />
            <SaveBtn keys={['pump_latitude', 'pump_longitude', 'geofence_radius']} />
          </div>
        )}

        {tab === 'shifts' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Shift Settings</h3>
            <Field label="Morning Shift Start" settingKey="morning_shift_start" type="time" />
            <Field label="Morning Shift End" settingKey="morning_shift_end" type="time" />
            <Field label="Evening Shift Start" settingKey="evening_shift_start" type="time" />
            <Field label="Evening Shift End" settingKey="evening_shift_end" type="time" />
            <Field label="Night Shift Start" settingKey="night_shift_start" type="time" />
            <Field label="Night Shift End" settingKey="night_shift_end" type="time" />
            <SaveBtn keys={['morning_shift_start','morning_shift_end','evening_shift_start','evening_shift_end','night_shift_start','night_shift_end']} />
          </div>
        )}

        {tab === 'salary' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Salary Settings</h3>
            <Field label="Payslip Generation Day" settingKey="payslip_day" type="number" placeholder="25" />
            <div>
              <label className="label">Deduction Method</label>
              <select className="input" value={val('deduction_method')} onChange={e => set('deduction_method', e.target.value)}>
                <option value="per_day">Per Day</option>
                <option value="per_half_day">Per Half Day</option>
              </select>
            </div>
            <Field label="Late Arrival Grace (minutes)" settingKey="late_grace_minutes" type="number" placeholder="15" />
            <SaveBtn keys={['payslip_day', 'deduction_method', 'late_grace_minutes']} />
          </div>
        )}

        {tab === 'leaves' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Leave Policy</h3>
            <Field label="Annual Casual Leaves" settingKey="casual_leaves_annual" type="number" placeholder="12" />
            <Field label="Annual Sick Leaves" settingKey="sick_leaves_annual" type="number" placeholder="10" />
            <Field label="Annual Earned Leaves" settingKey="earned_leaves_annual" type="number" placeholder="15" />
            <Field label="Max Consecutive Leaves" settingKey="max_consecutive_leaves" type="number" placeholder="7" />
            <SaveBtn keys={['casual_leaves_annual','sick_leaves_annual','earned_leaves_annual','max_consecutive_leaves']} />
          </div>
        )}

        {tab === 'whatsapp' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">WhatsApp Notifications</h3>
            <Field label="WhatsApp API Token" settingKey="whatsapp_token" placeholder="Bearer token…" />
            <Field label="WhatsApp Phone ID" settingKey="whatsapp_phone_id" placeholder="Phone number ID" />
            <Field label="Admin WhatsApp Number" settingKey="admin_whatsapp" type="tel" placeholder="+91XXXXXXXXXX" />
            <div className="flex items-center gap-3">
              <input type="checkbox" id="wa_attendance" checked={val('wa_attendance_notify') === 'true'} onChange={e => set('wa_attendance_notify', String(e.target.checked))} className="w-4 h-4 accent-emerald-500" />
              <label htmlFor="wa_attendance" className="text-sm text-slate-700 dark:text-slate-300">Notify on attendance check-in/out</label>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="wa_payslip" checked={val('wa_payslip_notify') === 'true'} onChange={e => set('wa_payslip_notify', String(e.target.checked))} className="w-4 h-4 accent-emerald-500" />
              <label htmlFor="wa_payslip" className="text-sm text-slate-700 dark:text-slate-300">Send payslip via WhatsApp</label>
            </div>
            <SaveBtn keys={['whatsapp_token','whatsapp_phone_id','admin_whatsapp','wa_attendance_notify','wa_payslip_notify']} />
          </div>
        )}

        {tab === 'fuel' && (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Fuel Rates</h3>
            <Field label="MS (Petrol) Rate ₹/L" settingKey="ms_rate" type="number" placeholder="103.50" />
            <Field label="HSD (Diesel) Rate ₹/L" settingKey="hsd_rate" type="number" placeholder="89.90" />
            <Field label="XP (Premium Petrol) Rate ₹/L" settingKey="xp_rate" type="number" placeholder="112.00" />
            <p className="text-xs text-slate-400">Rates used for daily sales calculations and reports.</p>
            <SaveBtn keys={['ms_rate', 'hsd_rate', 'xp_rate']} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings
