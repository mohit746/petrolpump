// src/lib/attendance.ts
import { supabase } from './supabase'

export interface ShiftTiming {
  morning_shift_start: string
  morning_shift_end: string
  evening_shift_start: string
  evening_shift_end: string
  night_shift_start: string
  night_shift_end: string
  late_grace_minutes: number
}

/**
 * Determine attendance status based on check-in time and shift timings
 */
export async function calculateAttendanceStatus(
  pumpId: string,
  checkInTime: Date
): Promise<{status: 'PRESENT' | 'LATE'; shiftType: 'MORNING' | 'EVENING' | 'NIGHT'}> {
  // Fetch shift settings — schema uses system_settings(key, value)
  const { data: settingsData } = await supabase
    .from('system_settings')
    .select('key, value')
    .eq('pump_id', pumpId)
    .in('key', [
      'morning_shift_start',
      'morning_shift_end',
      'evening_shift_start',
      'evening_shift_end',
      'night_shift_start',
      'night_shift_end',
      'late_grace_minutes'
    ])

  const settings: Record<string, string> = {}
  ;(settingsData ?? []).forEach((s: { key: string; value: string }) => {
    settings[s.key] = s.value
  })

  const lateGraceMinutes = parseInt(settings.late_grace_minutes || '15')

  // Determine which shift based on check-in time
  const checkInHour = checkInTime.getHours()
  const checkInMinute = checkInTime.getMinutes()
  const checkInTotalMinutes = checkInHour * 60 + checkInMinute

  let shiftType: 'MORNING' | 'EVENING' | 'NIGHT' = 'MORNING'
  let shiftStartTime: string | null = null

  // Determine shift (simple logic - can be enhanced)
  if (checkInHour >= 6 && checkInHour < 14) {
    shiftType = 'MORNING'
    shiftStartTime = settings.morning_shift_start || '06:00'
  } else if (checkInHour >= 14 && checkInHour < 22) {
    shiftType = 'EVENING'
    shiftStartTime = settings.evening_shift_start || '14:00'
  } else {
    shiftType = 'NIGHT'
    shiftStartTime = settings.night_shift_start || '22:00'
  }

  // Parse shift start time
  if (shiftStartTime) {
    const [startHour, startMinute] = shiftStartTime.split(':').map(Number)
    const shiftStartTotalMinutes = startHour * 60 + startMinute

    // Calculate difference
    const minutesLate = checkInTotalMinutes - shiftStartTotalMinutes

    // Check if late beyond grace period
    if (minutesLate > lateGraceMinutes) {
      return { status: 'LATE', shiftType }
    }
  }

  return { status: 'PRESENT', shiftType }
}

/**
 * Calculate overtime hours for check-out
 */
export function calculateOvertimeHours(
  checkInTime: Date,
  checkOutTime: Date,
  standardShiftHours: number = 8
): number {
  const totalHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)
  const overtimeHours = Math.max(0, totalHours - standardShiftHours)
  return Math.round(overtimeHours * 100) / 100 // Round to 2 decimals
}

/**
 * Calculate total hours worked
 */
export function calculateTotalHours(
  checkInTime: Date,
  checkOutTime: Date
): number {
  const hours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)
  return Math.round(hours * 100) / 100 // Round to 2 decimals
}
