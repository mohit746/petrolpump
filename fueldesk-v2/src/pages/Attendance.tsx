// src/pages/Attendance.tsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { MapPin, Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import useAuthStore from '../stores/useAuthStore'
import { supabase } from '../lib/supabase'
import { calculateDistance, formatTime } from '../lib/utils'
import { StatusBadge } from '../components/ui/Badge'
import { SkeletonList } from '../components/ui/SkeletonCard'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { useRoleAccess } from '../hooks/useRoleAccess'

// ── Employee GPS Check-In/Out ────────────────────────────────
const EmployeeAttendance: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'error'>('idle')
  const [confirm, setConfirm] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [selectedHandover, setSelectedHandover] = useState('')
  const [handoverNote, setHandoverNote] = useState('')

  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: todayRecord } = useQuery({
    queryKey: ['attendance_today', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('attendance').select('*')
        .eq('user_id', user!.id).eq('shift_date', today).maybeSingle()
      return data
    },
    refetchInterval: 30_000,
    enabled: !!user?.id,
  })

  const { data: monthRecords } = useQuery({
    queryKey: ['attendance_month', user?.id],
    queryFn: async () => {
      const from = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
      const { data } = await supabase.from('attendance').select('*')
        .eq('user_id', user!.id).gte('shift_date', from).order('shift_date', { ascending: false })
      return data ?? []
    },
    enabled: !!user?.id,
  })

  const { data: availableEmployees } = useQuery({
    queryKey: ['handover_employees', user?.pump_id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, first_name, last_name')
        .eq('pump_id', user!.pump_id!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .neq('id', user!.id) // Exclude current user
      return data ?? []
    },
    enabled: !!user?.pump_id && handoverOpen,
  })

  const checkInMutation = useMutation({
    mutationFn: async (pos: { lat: number; lng: number; acc: number }) => {
      // Fetch geofence settings — column names match `system_settings(key,value)`
      // schema (see database/migrations.sql) and key names match Settings.tsx writes.
      const { data: settings } = await supabase.from('system_settings')
        .select('key,value')
        .eq('pump_id', user!.pump_id!)
        .in('key', ['pump_latitude', 'pump_longitude', 'geofence_radius'])

      const geo: Record<string, number> = {}
      ;(settings ?? []).forEach((s: { key: string; value: string }) => {
        const n = parseFloat(s.value)
        if (!Number.isNaN(n)) geo[s.key] = n
      })

      // Geofence is only enforced when both lat AND lng are configured (non-zero).
      // If not configured → allow check-in without verification.
      const hasGeofence =
        typeof geo.pump_latitude === 'number' &&
        typeof geo.pump_longitude === 'number' &&
        geo.pump_latitude !== 0 && geo.pump_longitude !== 0

      const radius = geo.geofence_radius || 200
      let verified = false

      if (hasGeofence) {
        const dist = calculateDistance(pos.lat, pos.lng, geo.pump_latitude, geo.pump_longitude)
        if (dist > radius) throw new Error(t('attendance.outside', { dist: Math.round(dist), radius }))
        verified = true
      }

      if (todayRecord) {
        // Check out - open handover dialog first
        setHandoverOpen(true)
        return { requiresHandover: true }
      } else {
        // Check in - calculate status (PRESENT or LATE)
        const { calculateAttendanceStatus } = await import('../lib/attendance')
        const { status: attendanceStatus } = await calculateAttendanceStatus(
          user!.pump_id!,
          new Date()
        )

        await supabase.from('attendance').insert({
          user_id: user!.id,
          pump_id: user!.pump_id,
          shift_date: today,
          check_in_time: new Date().toISOString(),
          check_in_lat: pos.lat,
          check_in_lng: pos.lng,
          check_in_accuracy: pos.acc,
          check_in_verified: verified,
          status: attendanceStatus,
        })
        return { requiresHandover: false }
      }
    },
    onSuccess: (result) => {
      if (!result.requiresHandover) {
        qc.invalidateQueries({ queryKey: ['attendance_today'] })
        qc.invalidateQueries({ queryKey: ['attendance_month'] })
        toast(t('attendance.checkedInSuccess'), 'success')
        setPendingAction(null)
      }
      // When requiresHandover=true the handover dialog is now open.
      // Keep pendingAction alive so handoverMutation can write the GPS
      // coordinates; it will clear pendingAction in its own onSuccess.
      setConfirm(false)
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const handoverMutation = useMutation({
    mutationFn: async () => {
      if (!selectedHandover) throw new Error('Please select incoming employee')

      const checkOutTime = new Date()
      const checkInTime = new Date(todayRecord!.check_in_time)

      // Calculate total hours and overtime using helper functions
      const { calculateTotalHours, calculateOvertimeHours } = await import('../lib/attendance')
      const totalHours = calculateTotalHours(checkInTime, checkOutTime)
      const overtimeHours = calculateOvertimeHours(checkInTime, checkOutTime)

      // Update attendance with check-out, GPS, total hours, and overtime
      await supabase.from('attendance').update({
        check_out_time: checkOutTime.toISOString(),
        check_out_lat: pendingAction?.lat ?? null,
        check_out_lng: pendingAction?.lng ?? null,
        check_out_accuracy: pendingAction?.acc ?? null,
        total_hours: totalHours,
        overtime_hours: overtimeHours
      }).eq('id', todayRecord!.id)

      // Create shift handover record
      await supabase.from('shift_handovers').insert({
        pump_id: user!.pump_id,
        attendance_id: todayRecord!.id,
        outgoing_employee_id: user!.id,
        incoming_employee_id: selectedHandover,
        handover_date: today,
        planned_handover_time: checkOutTime,
        handover_note: handoverNote || null,
        status: 'CONFIRMED'
      })

      // Get incoming employee details for notification
      const { data: incomingEmp } = await supabase
        .from('users')
        .select('first_name, last_name, phone')
        .eq('id', selectedHandover)
        .single()

      // Send WhatsApp notification to incoming employee
      if (incomingEmp) {
        try {
          const { notifyShiftHandover } = await import('../lib/notifications')
          await notifyShiftHandover(
            user!.pump_id!,
            `${incomingEmp.first_name} ${incomingEmp.last_name}`,
            incomingEmp.phone,
            `${user!.first_name} ${user!.last_name}`,
            format(new Date(), 'h:mm a'),
            handoverNote
          )
        } catch (notifError) {
          console.error('Failed to send handover notification:', notifError)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance_today'] })
      qc.invalidateQueries({ queryKey: ['attendance_month'] })
      toast(t('attendance.checkedOutSuccess'), 'success')
      setHandoverOpen(false)
      setSelectedHandover('')
      setHandoverNote('')
      setPendingAction(null)
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const handleGps = () => {
    setGpsStatus('fetching')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsStatus('idle')
        setPendingAction({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
        setConfirm(true)
      },
      () => { setGpsStatus('error'); toast(t('attendance.gpsUnavailable'), 'error') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const statusColors: Record<string, string> = {
    PRESENT: 'bg-emerald-100 dark:bg-emerald-900/30',
    ABSENT: 'bg-rose-100 dark:bg-rose-900/30',
    LATE: 'bg-amber-100 dark:bg-amber-900/30',
    ON_LEAVE: 'bg-blue-100 dark:bg-blue-900/30',
    HALF_DAY: 'bg-orange-100 dark:bg-orange-900/30',
    PENALTY: 'bg-purple-100 dark:bg-purple-900/30',
  }

  const isCheckedIn = !!todayRecord && !todayRecord.check_out_time

  return (
    <div className="p-4 space-y-4">
      {/* Check-in card */}
      <div className="card text-center space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('attendance.todayStatus')}</p>
          {todayRecord
            ? <p className="text-base font-semibold text-slate-800 dark:text-white">
                {todayRecord.check_out_time
                  ? t('attendance.shiftComplete', { from: formatTime(todayRecord.check_in_time), to: formatTime(todayRecord.check_out_time) })
                  : t('attendance.checkedInAt', { at: formatTime(todayRecord.check_in_time) })}
              </p>
            : <p className="text-base text-slate-500 dark:text-slate-400">{t('attendance.notCheckedIn')}</p>
          }
        </div>

        <button
          onClick={handleGps}
          disabled={gpsStatus === 'fetching' || checkInMutation.isPending}
          className={`w-full py-4 rounded-xl font-semibold text-white text-base transition-all
            ${isCheckedIn
              ? 'bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-200 dark:shadow-rose-900/30'
              : 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30'
            } disabled:opacity-50`}
        >
          {gpsStatus === 'fetching' || checkInMutation.isPending
            ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> {t('attendance.gettingLocation')}</span>
            : <span className="flex items-center justify-center gap-2">
                <MapPin className="w-5 h-5" />
                {isCheckedIn ? t('attendance.checkOut') : t('attendance.checkIn')}
              </span>
          }
        </button>

        {gpsStatus === 'error' && (
          <p className="text-xs text-rose-500 flex items-center justify-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {t('attendance.gpsUnavailable')}
          </p>
        )}
      </div>

      {/* Monthly calendar */}
      {monthRecords && monthRecords.length > 0 && (
        <div className="card">
          <p className="section-title">{t('attendance.thisMonth')}</p>
          <div className="space-y-2">
            {monthRecords.map((r: { id: string; shift_date: string; status: string; check_in_time: string; check_out_time: string | null }) => (
              <div key={r.id}
                className={`flex items-center justify-between p-2.5 rounded-lg ${statusColors[r.status] ?? 'bg-slate-50 dark:bg-slate-700/50'}`}>
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {format(new Date(r.shift_date), 'dd MMM, EEE')}
                  </p>
                  {r.check_in_time && (
                    <p className="text-xs text-slate-500">
                      {formatTime(r.check_in_time)}{r.check_out_time ? ` – ${formatTime(r.check_out_time)}` : ' (ongoing)'}
                    </p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => { setConfirm(false); setPendingAction(null) }}
        onConfirm={() => pendingAction && checkInMutation.mutate(pendingAction)}
        title={isCheckedIn ? t('attendance.confirmCheckOutTitle') : t('attendance.confirmCheckInTitle')}
        message={t('attendance.confirmTime', {
          action: isCheckedIn ? t('attendance.checkOut') : t('attendance.checkIn'),
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        })}
        loading={checkInMutation.isPending}
      />

      {/* Shift Handover Dialog */}
      <Dialog open={handoverOpen} onClose={() => setHandoverOpen(false)} title={t('attendance.handoverTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('attendance.handoverIntro')}
          </p>
          <div>
            <label className="label">{t('attendance.incomingEmployee')} *</label>
            <select
              className="input"
              value={selectedHandover}
              onChange={e => setSelectedHandover(e.target.value)}
            >
              <option value="">{t('attendance.selectEmployee')}</option>
              {(availableEmployees ?? []).map((emp: { id: string; first_name: string; last_name: string }) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('attendance.handoverNotes')}</label>
            <textarea
              rows={3}
              className="input resize-none"
              placeholder={t('attendance.handoverPlaceholder')}
              value={handoverNote}
              onChange={e => setHandoverNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setHandoverOpen(false)}
              className="btn-secondary flex-1"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => handoverMutation.mutate()}
              disabled={handoverMutation.isPending || !selectedHandover}
              className="btn-primary flex-1"
            >
              {handoverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('attendance.completeHandover')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ── Admin Attendance View ─────────────────────────────────────
const AdminAttendance: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const { data, isLoading } = useQuery({
    queryKey: ['attendance_all', user?.pump_id, date],
    queryFn: async () => {
      const { data } = await supabase.from('attendance')
        .select('*, users(first_name, last_name)')
        .eq('pump_id', user!.pump_id!)
        .eq('shift_date', date)
        .order('check_in_time', { ascending: true })
      return data ?? []
    },
    enabled: !!user?.pump_id,
  })

  if (isLoading) return <div className="p-4"><SkeletonList /></div>

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" value={date} max={format(new Date(), 'yyyy-MM-dd')}
          onChange={e => setDate(e.target.value)}
          className="input flex-1" />
      </div>

      <div className="space-y-2">
        {(data ?? []).length === 0 ? (
          <div className="card text-center py-10 text-slate-400">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{t('attendance.noRecords')}</p>
          </div>
        ) : (data ?? []).map((r: { id: string; users: { first_name: string; last_name: string }; check_in_time: string; check_out_time: string | null; status: string }) => (
          <div key={r.id} className="card flex items-center gap-3">
            <div className="avatar">{r.users?.first_name?.[0]}{r.users?.last_name?.[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-white truncate">
                {r.users?.first_name} {r.users?.last_name}
              </p>
              <p className="text-xs text-slate-400">
                {r.check_in_time ? formatTime(r.check_in_time) : '—'}
                {r.check_out_time ? ` → ${formatTime(r.check_out_time)}` : ''}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

const Attendance: React.FC = () => {
  const { isEmployee } = useRoleAccess()
  return isEmployee ? <EmployeeAttendance /> : <AdminAttendance />
}

export default Attendance
