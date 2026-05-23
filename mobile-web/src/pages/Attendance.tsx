// src/pages/Attendance.tsx
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, getDaysInMonth, startOfMonth, differenceInMinutes } from 'date-fns'
import toast from 'react-hot-toast'
import { MapPinIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { notifyShiftHandover } from '../lib/notifications'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'

interface Coords { lat: number; lng: number; accuracy: number }
interface AttendanceRecord {
  attendance_date: string
  check_in_time: string | null
  check_out_time: string | null
  status: string
  check_in_verified: boolean
}
interface Employee { id: string; first_name: string; last_name: string }

const getLocation = (): Promise<Coords> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'))
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(e),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })

const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const statusColor: Record<string, string> = {
  PRESENT: 'bg-green-500', LATE: 'bg-yellow-400', ABSENT: 'bg-red-500',
  HALF_DAY: 'bg-blue-400', PENALTY: 'bg-red-700', HOLIDAY: 'bg-gray-300',
}

const Attendance: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [tab, setTab] = useState<'today' | 'calendar'>('today')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [locError, setLocError] = useState('')
  const [locLoading, setLocLoading] = useState(false)
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([])
  const [settings, setSettings] = useState<{ pump_lat: number; pump_lng: number; geo_radius_meters: number; shift_type: string } | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const { confirm, dialogProps } = useConfirm()

  // Handover modal
  const [showHandover, setShowHandover] = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedReplacement, setSelectedReplacement] = useState('')
  const [handoverNote, setHandoverNote] = useState('')
  const [submittingHandover, setSubmittingHandover] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('system_settings').select('pump_latitude, pump_longitude, pump_radius_meters, shift_type').eq('pump_id', user.pump_id).maybeSingle()
      .then(({ data }) => setSettings(data ? {
        pump_lat: data.pump_latitude,
        pump_lng: data.pump_longitude,
        geo_radius_meters: data.pump_radius_meters,
        shift_type: data.shift_type,
      } : null))
    fetchTodayRecord()
    fetchMonthRecords()
    // Auto-request GPS on mount
    captureLocation()
  }, [user])

  const fetchTodayRecord = async () => {
    const { data } = await supabase.from('attendance').select('*')
      .eq('employee_id', user!.id).eq('attendance_date', today).maybeSingle()
    setTodayRecord(data)
  }

  const fetchMonthRecords = async () => {
    const monthStart = format(new Date(), 'yyyy-MM-01')
    const { data } = await supabase.from('attendance').select('attendance_date, check_in_time, check_out_time, status, check_in_verified')
      .eq('employee_id', user!.id).gte('attendance_date', monthStart).lte('attendance_date', today)
    setMonthRecords(data || [])
  }

  const captureLocation = async () => {
    setLocLoading(true)
    setLocError('')
    try {
      const c = await getLocation()
      setCoords(c)
    } catch {
      setLocError(t('attendance.locationError'))
    } finally {
      setLocLoading(false)
    }
  }

  const isWithinGeoFence = () => {
    if (!coords || !settings?.pump_lat) return null // null = not configured
    const dist = haversine(coords.lat, coords.lng, settings.pump_lat, settings.pump_lng)
    return dist <= (settings.geo_radius_meters || 200)
  }

  const handleCheckIn = async () => {
    if (!coords) { toast.error(t('attendance.captureFirst')); return }
    const withinFence = isWithinGeoFence()
    // If geofence IS configured and user is outside → hard block
    if (withinFence === false) {
      toast.error(`⛔ ${t('attendance.outsideGeofence')}`, { duration: 5000 })
      return
    }
    const now = new Date()
    const ok = await confirm({
      title: t('attendance.confirmCheckInTitle'),
      message: `${t('attendance.confirmCheckInMsg')} ${format(now, 'hh:mm a')}?`,
      confirmLabel: t('attendance.checkIn'),
      variant: 'info',
    })
    if (!ok) return
    setCheckingIn(true)
    const { error } = await supabase.from('attendance').upsert({
      employee_id: user!.id,
      attendance_date: today,
      check_in_time: new Date().toISOString(),
      check_in_lat: coords.lat,
      check_in_lng: coords.lng,
      check_in_accuracy: coords.accuracy,
      check_in_verified: withinFence === true,
      status: 'PRESENT',
    }, { onConflict: 'employee_id,attendance_date' })
    if (error) toast.error(error.message)
    else { toast.success(t('attendance.checkInSuccess')); fetchTodayRecord() }
    setCheckingIn(false)
  }

  const initiateCheckOut = async () => {
    // Load other employees for handover selection
    const { data } = await supabase.from('users').select('id, first_name, last_name')
      .eq('pump_id', user!.pump_id).eq('is_active', true).neq('id', user!.id)
    setEmployees(data || [])
    setShowHandover(true)
  }

  const submitHandover = async () => {
    if (!selectedReplacement) { toast.error('Select a replacement employee'); return }
    if (!coords) { toast.error(t('attendance.captureFirst')); return }
    setSubmittingHandover(true)

    const now = new Date()
    const checkInTime = todayRecord?.check_in_time ? new Date(todayRecord.check_in_time) : now
    const totalHours = Math.round((differenceInMinutes(now, checkInTime) / 60) * 100) / 100

    // Create shift handover record
    const { data: att } = await supabase.from('attendance').select('id').eq('employee_id', user!.id).eq('attendance_date', today).single()
    await supabase.from('shift_handovers').insert({
      outgoing_employee_id: user!.id,
      incoming_employee_id: selectedReplacement,
      attendance_id: att?.id,
      handover_date: today,
      planned_handover_time: format(now, 'HH:mm:ss'),
      handover_note: handoverNote,
      status: 'REQUESTED',
    })

    // Check out — also write total_hours
    const withinFence = isWithinGeoFence()
    await supabase.from('attendance').update({
      check_out_time: now.toISOString(),
      check_out_lat: coords.lat,
      check_out_lng: coords.lng,
      check_out_accuracy: coords.accuracy,
      check_out_verified: withinFence === true,
      total_hours: totalHours,
    }).eq('employee_id', user!.id).eq('attendance_date', today)

    // WhatsApp: notify incoming employee
    const incoming = employees.find(e => e.id === selectedReplacement)
    if (incoming) {
      const incomingFull = await supabase.from('users').select('phone').eq('id', selectedReplacement).single()
      if (incomingFull.data?.phone) {
        await notifyShiftHandover({
          toName: `${incoming.first_name} ${incoming.last_name}`,
          toPhone: incomingFull.data.phone.replace(/\D/g, ''),
          fromName: `${user!.first_name} ${user!.last_name}`,
          date: format(now, 'dd MMM yyyy'),
          time: format(now, 'hh:mm a'),
        })
      }
    }

    toast.success(t('attendance.checkOutSuccess'))
    setShowHandover(false)
    setSubmittingHandover(false)
    fetchTodayRecord()
  }

  // Calendar grid
  const daysInMonth = getDaysInMonth(new Date())
  const firstDay = startOfMonth(new Date()).getDay()
  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const getRecord = (day: number) => monthRecords.find(r => parseInt(r.attendance_date.split('-')[2]) === day)

  const shiftMins = settings?.shift_type === '24HR' ? 1440 : 720
  const halfMins  = shiftMins / 2
  const todayMinutes = todayRecord?.check_in_time && todayRecord?.check_out_time
    ? differenceInMinutes(new Date(todayRecord.check_out_time), new Date(todayRecord.check_in_time))
    : todayRecord?.check_in_time
    ? differenceInMinutes(new Date(), new Date(todayRecord.check_in_time))
    : 0

  return (
    <div className="page">
      <div className="bg-white border-b px-4 pt-12 pb-0">
        <h1 className="text-xl font-bold text-gray-900 mb-3">{t('nav.attendance')}</h1>
        <div className="flex gap-4">
          {(['today', 'calendar'] as const).map(t2 => (
            <button key={t2} onClick={() => setTab(t2)}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === t2 ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400'}`}>
              {t2 === 'today' ? t('attendance.today') : t('attendance.calendar')}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        {tab === 'today' && (
          <>
            {/* Location card */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-gray-700 flex items-center gap-1.5">
                  <MapPinIcon className="h-5 w-5 text-orange-500" />
                  {t('attendance.yourLocation')}
                </p>
                {coords && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isWithinGeoFence() ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {isWithinGeoFence() ? '✓ In range' : '✗ Out of range'}
                  </span>
                )}
              </div>
              {coords
                ? <p className="text-sm text-gray-500">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} · ±{Math.round(coords.accuracy)}m</p>
                : <p className="text-sm text-gray-400">{t('attendance.noLocation')}</p>}
              {locError && <p className="text-sm text-red-500 mt-1">{locError}</p>}
              <button onClick={captureLocation} disabled={locLoading} className="btn-secondary mt-3 w-full text-sm">
                {locLoading ? t('common.loading') : t('attendance.captureLocation')}
              </button>
            </div>

            {/* Shift progress */}
            {todayRecord?.check_in_time && (
              <div className="card p-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Shift Progress</p>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div className="bg-orange-500 h-2.5 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (todayMinutes / shiftMins) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{Math.floor(todayMinutes / 60)}h {todayMinutes % 60}m worked</span>
                  <span>{Math.floor(shiftMins / 60)}h total</span>
                </div>
                {todayMinutes >= halfMins && todayMinutes < shiftMins && (
                  <p className="text-xs text-blue-600 mt-1 font-medium">✓ Half day threshold reached</p>
                )}
              </div>
            )}

            {/* Check in/out buttons */}
            <div className="space-y-3">
              {!todayRecord?.check_in_time ? (
                <>
                  {coords && isWithinGeoFence() === false && (
                    <div className="card p-3 bg-red-50 border-red-200 flex items-center gap-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-500 shrink-0" />
                      <p className="text-sm text-red-700 font-medium">You are outside the pump premises. Move closer to check in.</p>
                    </div>
                  )}
                  <button
                    onClick={handleCheckIn}
                    disabled={checkingIn || !coords || isWithinGeoFence() === false}
                    className="btn-primary w-full py-4 text-base disabled:opacity-50"
                  >
                    {checkingIn ? t('common.loading') : t('attendance.checkIn')}
                  </button>
                </>
              ) : !todayRecord?.check_out_time ? (
                <>
                  <div className="card p-3 bg-green-50 border-green-200">
                    <p className="text-sm text-green-700 font-medium flex items-center gap-2">
                      <CheckCircleIcon className="h-5 w-5" />
                      Checked in at {format(new Date(todayRecord.check_in_time!), 'hh:mm a')}
                      {!todayRecord.check_in_verified && <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500 ml-auto" />}
                    </p>
                  </div>
                  <button onClick={initiateCheckOut} disabled={!coords} className="btn-danger w-full py-4 text-base">
                    {t('attendance.checkOut')}
                  </button>
                </>
              ) : (
                <div className="card p-4 text-center bg-gray-50">
                  <CheckCircleIcon className="h-10 w-10 text-green-500 mx-auto mb-2" />
                  <p className="font-semibold text-gray-700">Shift Complete</p>
                  <p className="text-sm text-gray-400">
                    {format(new Date(todayRecord.check_in_time!), 'hh:mm a')} – {format(new Date(todayRecord.check_out_time!), 'hh:mm a')}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'calendar' && (
          <div className="card p-3">
            <p className="font-semibold text-gray-700 mb-3 text-center">{format(new Date(), 'MMMM yyyy')}</p>
            {/* Day header */}
            <div className="grid grid-cols-7 mb-1">
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="text-center text-xs text-gray-400 font-medium">{d}</div>
              ))}
            </div>
            {/* Empty cells before 1st */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
              {calendarDays.map(day => {
                const rec = getRecord(day)
                const isToday = day === parseInt(today.split('-')[2])
                return (
                  <div key={day} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs ${isToday ? 'ring-2 ring-orange-500' : ''}`}>
                    <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium ${rec ? statusColor[rec.status] + ' text-white' : 'text-gray-600'}`}>
                      {day}
                    </span>
                    {rec?.check_in_time && !rec.check_in_verified && (
                      <span className="text-[8px] text-yellow-500">!</span>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t">
              {Object.entries(statusColor).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded-full ${color}`} />
                  <span className="text-xs text-gray-500">{status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Handover Modal */}
      {showHandover && (
        <div className="modal-overlay">
          <div className="bottom-sheet">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-gray-900">{t('attendance.handoverTitle')}</h2>
              <button onClick={() => setShowHandover(false)} className="text-gray-400 text-2xl leading-none">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{t('attendance.handoverSubtitle')}</p>

            <label className="label">{t('attendance.selectReplacement')}</label>
            <select value={selectedReplacement} onChange={e => setSelectedReplacement(e.target.value)}
              className="input mb-4">
              <option value="">{t('common.selectOption')}</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
              ))}
            </select>

            <label className="label">{t('attendance.handoverNote')}</label>
            <textarea value={handoverNote} onChange={e => setHandoverNote(e.target.value)}
              rows={3} className="input mb-4" placeholder={t('attendance.handoverNotePlaceholder')} />

            <div className="flex gap-3">
              <button onClick={() => setShowHandover(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
              <button onClick={submitHandover} disabled={submittingHandover} className="btn-primary flex-1">
                {submittingHandover ? t('common.loading') : t('attendance.confirmCheckout')}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  )
}

export default Attendance
