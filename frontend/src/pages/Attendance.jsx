import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday } from 'date-fns'
import {
  MapPinIcon, ClockIcon, CheckCircleIcon,
  ExclamationTriangleIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

// ─── Geo helper ───────────────────────────────────────────────────────────────
const getGeoLocation = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── API helpers ──────────────────────────────────────────────────────────────
const fetchAttendance = async ({ token, month, year, employeeId }) => {
  const params = new URLSearchParams({ month, year, ...(employeeId && { employeeId }) })
  const res = await fetch(`/api/attendance?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch attendance')
  return res.json()
}

const fetchTodayAttendance = async (token) => {
  const res = await fetch('/api/attendance/today', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch today attendance')
  return res.json()
}

const fetchPumpLocation = async (token) => {
  const res = await fetch('/api/pump-location', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { data: null }
  return res.json()
}

const markAttendance = async ({ type, geo, token }) => {
  const res = await fetch('/api/attendance/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, ...geo }),
  })
  if (!res.ok) throw new Error('Failed to mark attendance')
  return res.json()
}

// ─── Status badge ─────────────────────────────────────────────────────────────
const statusColors = {
  PRESENT: 'bg-green-100 text-green-800',
  ABSENT: 'bg-red-100 text-red-800',
  LATE: 'bg-yellow-100 text-yellow-800',
  HALF_DAY: 'bg-orange-100 text-orange-800',
  ON_LEAVE: 'bg-blue-100 text-blue-800',
}

const StatusBadge = ({ status, label }) => (
  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[status] || 'bg-gray-100 text-gray-600'}`}>
    {label || status}
  </span>
)

// ─── Geo Capture Button ────────────────────────────────────────────────────────
const GeoButton = ({ onCapture, label, loading }) => {
  const { t } = useTranslation()
  const [gettingGeo, setGettingGeo] = useState(false)
  const [geoStatus, setGeoStatus] = useState(null) // null | 'ok' | 'outside'

  const handle = async () => {
    setGettingGeo(true)
    setGeoStatus(null)
    try {
      const geo = await getGeoLocation()
      setGeoStatus('ok')
      toast.success(t('attendance.locationSuccess'))
      onCapture(geo)
    } catch {
      toast.error(t('attendance.locationError'))
    } finally {
      setGettingGeo(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={gettingGeo || loading}
      className="flex items-center space-x-2 px-4 py-2 rounded-lg border border-primary-300 text-primary-700 hover:bg-primary-50 text-sm font-medium disabled:opacity-50 transition-colors"
    >
      <MapPinIcon className={`h-4 w-4 ${gettingGeo ? 'animate-bounce' : ''}`} />
      <span>{gettingGeo ? t('attendance.gettingLocation') : label}</span>
      {geoStatus === 'ok' && <CheckCircleIcon className="h-4 w-4 text-green-500" />}
    </button>
  )
}

// ─── Today's Attendance Card ───────────────────────────────────────────────────
const TodayCard = ({ token, pumpLocation }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [geo, setGeo] = useState(null)
  const [geoWarning, setGeoWarning] = useState(false)

  const { data: todayData, isLoading } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: () => fetchTodayAttendance(token),
  })

  const today = todayData?.data

  const mutation = useMutation({
    mutationFn: (type) => markAttendance({ type, geo, token }),
    onSuccess: () => {
      toast.success(t('attendance.saveSuccess'))
      queryClient.invalidateQueries(['attendance-today'])
      queryClient.invalidateQueries(['attendance'])
      setGeo(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const handleCapture = useCallback((captured) => {
    setGeo(captured)
    if (pumpLocation) {
      const dist = haversineDistance(
        captured.latitude, captured.longitude,
        pumpLocation.latitude, pumpLocation.longitude,
      )
      setGeoWarning(dist > pumpLocation.allowed_radius_meters)
    }
  }, [pumpLocation])

  const canCheckIn = !today?.check_in_time
  const canCheckOut = today?.check_in_time && !today?.check_out_time

  if (isLoading) return (
    <div className="bg-white rounded-xl shadow-sm border p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3" />
    </div>
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b bg-gradient-to-r from-primary-50 to-blue-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t('attendance.todayAttendance')}</h2>
            <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, dd MMM yyyy')}</p>
          </div>
          {today?.status && <StatusBadge status={today.status} label={t(`attendance.${today.status.toLowerCase().replace('_', '')}`) || today.status} />}
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Check-in / Check-out times */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{t('attendance.checkInTime')}</p>
            <p className="text-sm font-semibold text-gray-900">
              {today?.check_in_time ? format(new Date(today.check_in_time), 'hh:mm a') : '—'}
            </p>
            {today?.check_in_verified !== undefined && (
              <p className={`text-xs mt-1 ${today.check_in_verified ? 'text-green-600' : 'text-yellow-600'}`}>
                {today.check_in_verified ? `✓ ${t('attendance.verified')}` : `⚠ ${t('attendance.notVerified')}`}
              </p>
            )}
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{t('attendance.checkOutTime')}</p>
            <p className="text-sm font-semibold text-gray-900">
              {today?.check_out_time ? format(new Date(today.check_out_time), 'hh:mm a') : '—'}
            </p>
            {today?.total_hours && (
              <p className="text-xs text-gray-500 mt-1">{today.total_hours.toFixed(1)} hrs</p>
            )}
          </div>
        </div>

        {/* Geo warning */}
        {geoWarning && (
          <div className="flex items-center space-x-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-yellow-800 text-sm">
            <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
            <span>{t('attendance.outsideRadius')}</span>
          </div>
        )}

        {/* Geo & action buttons */}
        {(canCheckIn || canCheckOut) && (
          <div className="space-y-3">
            <GeoButton
              onCapture={handleCapture}
              label={t('fuelLoads.captureGeo')}
              loading={mutation.isPending}
            />
            {geo && (
              <p className="text-xs text-gray-500">
                📍 {geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)} (±{geo.accuracy?.toFixed(0)}m)
              </p>
            )}
            <div className="flex space-x-3">
              {canCheckIn && (
                <button
                  onClick={() => mutation.mutate('CHECK_IN')}
                  disabled={!geo || mutation.isPending}
                  className="flex-1 btn-primary flex items-center justify-center space-x-2"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  <span>{t('attendance.checkIn')}</span>
                </button>
              )}
              {canCheckOut && (
                <button
                  onClick={() => mutation.mutate('CHECK_OUT')}
                  disabled={!geo || mutation.isPending}
                  className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center justify-center space-x-2 disabled:opacity-50 text-sm font-medium"
                >
                  <ClockIcon className="h-5 w-5" />
                  <span>{t('attendance.checkOut')}</span>
                </button>
              )}
            </div>
            {!geo && (
              <p className="text-xs text-gray-400 text-center">
                📍 Capture your location first to {canCheckIn ? 'check in' : 'check out'}
              </p>
            )}
          </div>
        )}

        {!canCheckIn && !canCheckOut && today && (
          <div className="text-center py-2 text-sm text-gray-500">
            ✓ Shift complete — {today.total_hours?.toFixed(1)} hrs worked
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Monthly Calendar ──────────────────────────────────────────────────────────
const MonthlyCalendar = ({ token, selectedEmployee }) => {
  const { t } = useTranslation()
  const [month, setMonth] = useState(new Date())

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', format(month, 'yyyy-MM'), selectedEmployee],
    queryFn: () => fetchAttendance({
      token,
      month: month.getMonth() + 1,
      year: month.getFullYear(),
      employeeId: selectedEmployee,
    }),
  })

  const records = data?.data || []
  const recordMap = Object.fromEntries(records.map(r => [r.attendance_date, r]))

  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month),
  })

  const dayStatus = {
    PRESENT: 'bg-green-500',
    ABSENT: 'bg-red-400',
    LATE: 'bg-yellow-400',
    HALF_DAY: 'bg-orange-400',
    ON_LEAVE: 'bg-blue-400',
  }

  const summary = {
    present: records.filter(r => r.status === 'PRESENT').length,
    absent: records.filter(r => r.status === 'ABSENT').length,
    late: records.filter(r => r.status === 'LATE').length,
    leave: records.filter(r => r.status === 'ON_LEAVE').length,
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{t('attendance.monthlyReport')}</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}
              className="p-1 rounded hover:bg-gray-100"
            >←</button>
            <span className="text-sm font-medium text-gray-700 w-32 text-center">
              {format(month, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}
              className="p-1 rounded hover:bg-gray-100"
            >→</button>
          </div>
        </div>

        {/* Summary pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="text-xs bg-green-100 text-green-800 px-3 py-1 rounded-full">✓ Present: {summary.present}</span>
          <span className="text-xs bg-red-100 text-red-800 px-3 py-1 rounded-full">✗ Absent: {summary.absent}</span>
          <span className="text-xs bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full">⏰ Late: {summary.late}</span>
          <span className="text-xs bg-blue-100 text-blue-800 px-3 py-1 rounded-full">🏖 Leave: {summary.leave}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="p-6">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for first day offset */}
            {Array(days[0].getDay()).fill(null).map((_, i) => (
              <div key={`e-${i}`} />
            ))}
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const rec = recordMap[dateStr]
              const isFuture = day > new Date()
              return (
                <div
                  key={dateStr}
                  title={rec ? `${rec.status} • ${rec.check_in_time ? format(new Date(rec.check_in_time), 'hh:mm a') : 'No check-in'}` : ''}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs cursor-default
                    ${isToday(day) ? 'ring-2 ring-primary-500 ring-offset-1' : ''}
                    ${isFuture ? 'opacity-30' : ''}
                    ${rec ? `${dayStatus[rec.status] || 'bg-gray-200'} text-white` : 'bg-gray-100 text-gray-500'}
                  `}
                >
                  <span className="font-semibold">{day.getDate()}</span>
                  {rec?.total_hours && (
                    <span className="text-[9px] opacity-90">{rec.total_hours.toFixed(0)}h</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t">
            {Object.entries(dayStatus).map(([s, cls]) => (
              <div key={s} className="flex items-center space-x-1">
                <div className={`h-3 w-3 rounded-sm ${cls}`} />
                <span className="text-xs text-gray-500">{s.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const Attendance = () => {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const { isAdmin } = useRoleAccess()
  const [selectedEmployee, setSelectedEmployee] = useState(null)

  const { data: pumpData } = useQuery({
    queryKey: ['pump-location'],
    queryFn: () => fetchPumpLocation(token),
  })

  const { data: empData } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token}` } })
      return res.json()
    },
    enabled: isAdmin,
  })

  const employees = empData?.data || []
  const pumpLocation = pumpData?.data

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('attendance.title')}</h1>
          <p className="text-sm text-gray-500">
            <CalendarDaysIcon className="inline h-4 w-4 mr-1" />
            {format(new Date(), 'EEEE, dd MMMM yyyy')}
          </p>
        </div>
        {isAdmin && employees.length > 0 && (
          <select
            className="input w-full sm:w-56"
            value={selectedEmployee || ''}
            onChange={e => setSelectedEmployee(e.target.value || null)}
          >
            <option value="">My Attendance</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TodayCard token={token} pumpLocation={pumpLocation} />
        <MonthlyCalendar token={token} selectedEmployee={selectedEmployee} />
      </div>
    </div>
  )
}

export default Attendance
