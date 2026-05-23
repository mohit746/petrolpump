// src/lib/payslip.ts
import { supabase } from './supabase'
import { notifyPayslipReady } from './notifications'
import { formatINR } from './utils'

export interface PayslipCalculation {
  employeeId: string
  pumpId: string
  month: number
  year: number

  // Attendance stats
  totalWorkingDays: number
  daysPresent: number
  daysAbsent: number
  daysOnLeave: number
  daysPaidLeave: number
  daysUnpaidLeave: number
  daysHalfDay: number
  daysPenalty: number
  totalHoursWorked: number
  overtimeHours: number

  // Financial
  baseSalary: number
  salaryType: 'MONTHLY' | 'DAILY'
  dailySalary: number
  overtimeAmount: number
  incentivesTotal: number
  lorryAllowances: number
  // Deductions broken out so the payslip detail can show the audit trail.
  attendanceDeductions: number          // absences + half-days + unpaid leave + penalty
  advanceDeductions: number             // sum of PENDING+DEDUCTED salary_advances for the month
  deductions: number                    // = attendanceDeductions + advanceDeductions (legacy combined field)
  grossSalary: number
  netSalary: number
}

/**
 * Calculate payslip for an employee for a given month
 */
export async function calculatePayslip(
  employeeId: string,
  month: number,
  year: number,
  pumpId: string
): Promise<PayslipCalculation> {
  // 1. Fetch system settings with pump_id filter — schema uses key/value
  const { data: settingsData, error: settingsError } = await supabase
    .from('system_settings')
    .select('key, value')
    .eq('pump_id', pumpId)
    .in('key', ['deduction_method', 'late_grace_minutes', 'overtime_rate'])

  if (settingsError) {
    console.error('[Payslip] Error fetching settings:', settingsError)
  }

  const settings: Record<string, string> = {}
  ;(settingsData ?? []).forEach((s: { key: string; value: string }) => {
    settings[s.key] = s.value
  })

  // 2. Fetch employee details
  const { data: employee, error: empError } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, phone, salary, role, pump_id')
    .eq('id', employeeId)
    .single()

  if (empError || !employee) {
    throw new Error(`Employee not found: ${employeeId}`)
  }

  const baseSalary = employee.salary || 0
  const salaryType: 'MONTHLY' | 'DAILY' = 'MONTHLY' // Can be fetched from user profile if needed

  // 3. Calculate total working days in month
  const totalWorkingDays = getDaysInMonth(month, year)

  // 4. Fetch attendance records for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(totalWorkingDays).padStart(2, '0')}`

  const { data: attendanceRecords } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', employeeId)
    .eq('pump_id', pumpId)
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)

  // 5. Count attendance types
  const attendance = attendanceRecords || []

  let daysPresent = 0
  let daysAbsent = 0
  let daysHalfDay = 0
  let daysPenalty = 0
  let totalHoursWorked = 0
  let overtimeHours = 0

  attendance.forEach((record: any) => {
    switch (record.status) {
      case 'PRESENT':
      case 'LATE':
        daysPresent += 1
        break
      case 'HALF_DAY':
        daysHalfDay += 0.5
        daysPresent += 0.5
        break
      case 'ABSENT':
        daysAbsent += 1
        break
      case 'PENALTY':
        daysPenalty += 1
        daysAbsent += 1
        break
      case 'ON_LEAVE':
        // Don't count as present or absent - handled separately
        break
    }

    // Calculate hours worked
    if (record.check_in_time && record.check_out_time) {
      const checkIn = new Date(record.check_in_time)
      const checkOut = new Date(record.check_out_time)
      const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)
      totalHoursWorked += hours

      // Overtime (over 8 hours per day)
      if (hours > 8) {
        overtimeHours += (hours - 8)
      }
    }
  })

  // 6. Fetch approved leaves and categorize as paid/unpaid
  const { data: leaves } = await supabase
    .from('leaves')
    .select('*')
    .eq('user_id', employeeId)
    .eq('pump_id', pumpId)
    .eq('status', 'APPROVED')
    .gte('start_date', startDate)
    .lte('end_date', endDate)

  let daysPaidLeave = 0
  let daysUnpaidLeave = 0
  let daysOnLeave = 0

  ;(leaves || []).forEach((leave: any) => {
    // Calculate days in this month (leave might span multiple months)
    const leaveStart = new Date(leave.start_date)
    const leaveEnd = new Date(leave.end_date)
    const monthStart = new Date(startDate)
    const monthEnd = new Date(endDate)

    const effectiveStart = leaveStart < monthStart ? monthStart : leaveStart
    const effectiveEnd = leaveEnd > monthEnd ? monthEnd : leaveEnd

    const leaveDays = Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1

    daysOnLeave += leaveDays

    // Determine if paid or unpaid (can be enhanced with leave type logic)
    if (leave.leave_type === 'PLANNED') {
      daysPaidLeave += leaveDays
    } else if (leave.leave_type === 'EMERGENCY') {
      // Check settings for emergency_leave_is_paid
      daysUnpaidLeave += leaveDays
    }
  })

  // 7. Calculate daily salary
  const dailySalary = salaryType === 'MONTHLY' ? baseSalary / totalWorkingDays : baseSalary

  // 8. Attendance deductions (absences, unpaid leaves, half days, penalty days).
  //    Penalty multiplier is 2x as documented. Half-day uses dailySalary directly
  //    against daysHalfDay (which is already 0.5/day).
  let attendanceDeductions = 0
  attendanceDeductions += daysAbsent       * dailySalary
  attendanceDeductions += daysUnpaidLeave  * dailySalary
  attendanceDeductions += daysPenalty      * dailySalary * 2
  attendanceDeductions += daysHalfDay      * dailySalary

  // 9. Fetch incentives for the month
  const { data: incentives } = await supabase
    .from('incentives')
    .select('amount')
    .eq('user_id', employeeId)
    .eq('pump_id', pumpId)
    .gte('awarded_at', startDate)
    .lte('awarded_at', endDate)

  const incentivesTotal = (incentives || []).reduce((sum: number, inc: any) => sum + (inc.amount || 0), 0)

  // 10. Fetch completed lorry duties for the month
  const { data: lorryDuties } = await supabase
    .from('lorry_duties')
    .select('*')
    .eq('user_id', employeeId)
    .eq('pump_id', pumpId)
    .eq('status', 'COMPLETED')
    .gte('duty_date', startDate)
    .lte('duty_date', endDate)

  // Calculate lorry allowances (assume fixed amount per duty or from notes)
  const lorryAllowancePerDuty = 500 // Can be fetched from settings
  const lorryAllowances = (lorryDuties || []).length * lorryAllowancePerDuty

  // 11. Salary advances for the month (PENDING + DEDUCTED). CANCELLED is excluded
  //     so a cancelled advance doesn't keep deducting from net pay.
  const { data: advanceRows } = await supabase
    .from('salary_advances')
    .select('amount,status')
    .eq('user_id', employeeId)
    .eq('pump_id', pumpId)
    .eq('for_month', month)
    .eq('for_year', year)
    .in('status', ['PENDING', 'DEDUCTED'])

  const advanceDeductions = (advanceRows || []).reduce(
    (sum: number, a: { amount: number }) => sum + (a.amount || 0),
    0,
  )

  // 12. Calculate overtime amount
  const overtimeRate = parseFloat(settings.overtime_rate || '1.5')
  const hourlyRate = dailySalary / 8
  const overtimeAmount = overtimeHours * hourlyRate * overtimeRate

  // 13. Combine deductions and compute gross/net.
  //     `deductions` is the legacy single field stored on payslips.deductions.
  const deductions = attendanceDeductions + advanceDeductions

  const grossSalary = salaryType === 'MONTHLY'
    ? baseSalary - deductions + incentivesTotal + lorryAllowances + overtimeAmount
    : (daysPresent * dailySalary) + incentivesTotal + lorryAllowances + overtimeAmount - deductions

  const netSalary = Math.max(0, grossSalary) // Ensure non-negative

  return {
    employeeId,
    pumpId,
    month,
    year,
    totalWorkingDays,
    daysPresent,
    daysAbsent,
    daysOnLeave,
    daysPaidLeave,
    daysUnpaidLeave,
    daysHalfDay,
    daysPenalty,
    totalHoursWorked,
    overtimeHours,
    baseSalary,
    salaryType,
    dailySalary,
    overtimeAmount,
    incentivesTotal,
    lorryAllowances,
    attendanceDeductions,
    advanceDeductions,
    deductions,
    grossSalary,
    netSalary
  }
}

/**
 * Save payslip calculation to database, then flip the matched salary
 * advances (PENDING → DEDUCTED) so the running totals on the SalaryAdvances
 * page and Dashboard reflect that the advance has been "settled" by this
 * payslip.
 *
 * The advance flip is wrapped in a try/catch — a flip failure does NOT roll
 * back the saved payslip. Mismatch is auditable later via salary_advances
 * status counts vs payslip.deductions; treating the flip as best-effort
 * keeps payslip generation forward-progressing under transient failures.
 */
export async function savePayslip(
  calculation: PayslipCalculation,
  generatedBy: string
): Promise<void> {
  const { error } = await supabase.from('payslips').upsert({
    user_id: calculation.employeeId,
    pump_id: calculation.pumpId,
    month: calculation.month,
    year: calculation.year,

    // Attendance details
    total_working_days: calculation.totalWorkingDays,
    days_present: calculation.daysPresent,
    days_absent: calculation.daysAbsent,
    days_on_leave: calculation.daysOnLeave,
    days_paid_leave: calculation.daysPaidLeave,
    days_unpaid_leave: calculation.daysUnpaidLeave,
    days_half_day: calculation.daysHalfDay,
    days_penalty: calculation.daysPenalty,
    total_hours_worked: calculation.totalHoursWorked,
    overtime_hours: calculation.overtimeHours,

    // Financial details
    basic_salary: calculation.baseSalary,
    salary_type: calculation.salaryType,
    overtime_amount: calculation.overtimeAmount,
    incentive_total: calculation.incentivesTotal,
    lorry_bonus: calculation.lorryAllowances,
    deductions: calculation.deductions,
    gross_salary: calculation.grossSalary,
    net_salary: calculation.netSalary,

    status: 'GENERATED',
    generated_by: generatedBy,
    generated_at: new Date().toISOString()
  }, {
    onConflict: 'user_id,month,year'
  })

  if (error) {
    throw new Error(`Failed to save payslip: ${error.message}`)
  }

  // Flip matched advances. Idempotent — only PENDING rows are updated;
  // re-running savePayslip on a recalc is a no-op for advances.
  if (calculation.advanceDeductions > 0) {
    try {
      const { error: flipError } = await supabase.rpc('mark_advances_deducted', {
        p_pump_id: calculation.pumpId,
        p_user_id: calculation.employeeId,
        p_month:   calculation.month,
        p_year:    calculation.year,
      })
      if (flipError) {
        console.warn('[Payslip] mark_advances_deducted failed:', flipError.message)
      }
    } catch (e) {
      console.warn('[Payslip] mark_advances_deducted threw (suppressed):', e)
    }
  }
}

/**
 * Generate payslips for all active employees in a pump
 */
export async function generateAllPayslips(
  month: number,
  year: number,
  pumpId: string,
  generatedBy: string,
  sendNotifications: boolean = false
): Promise<{ success: number; failed: number; errors: string[] }> {
  // Fetch all active employees for this pump
  const { data: employees, error: empError } = await supabase
    .from('users')
    .select('id, first_name, last_name, phone')
    .eq('pump_id', pumpId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('role', ['EMPLOYEE', 'ACCOUNTANT', 'ADMIN'])

  if (empError || !employees) {
    throw new Error('Failed to fetch employees')
  }

  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  }

  // Generate payslip for each employee
  for (const employee of employees) {
    try {
      const calculation = await calculatePayslip(employee.id, month, year, pumpId)
      await savePayslip(calculation, generatedBy)
      results.success++

      // Send WhatsApp notification if enabled
      if (sendNotifications) {
        try {
          await notifyPayslipReady(
            pumpId,
            `${employee.first_name} ${employee.last_name}`,
            employee.phone,
            getMonthName(month),
            String(year),
            formatINR(calculation.netSalary)
          )
        } catch (notifError) {
          console.error('[Payslip] Notification failed:', employee.id, notifError)
        }
      }
    } catch (error) {
      results.failed++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      results.errors.push(`${employee.first_name} ${employee.last_name}: ${errorMsg}`)
      console.error('[Payslip] Failed for employee:', employee.id, errorMsg)
    }
  }

  return results
}

/**
 * Recalculate and update an existing payslip
 */
export async function recalculatePayslip(
  payslipId: string,
  generatedBy: string
): Promise<void> {
  // Fetch existing payslip
  const { data: existingPayslip, error } = await supabase
    .from('payslips')
    .select('user_id, pump_id, month, year')
    .eq('id', payslipId)
    .single()

  if (error || !existingPayslip) {
    throw new Error('Payslip not found')
  }

  // Recalculate
  const calculation = await calculatePayslip(
    existingPayslip.user_id,
    existingPayslip.month,
    existingPayslip.year,
    existingPayslip.pump_id
  )

  // Save updated payslip
  await savePayslip(calculation, generatedBy)
}

// ============================================
// Helper functions
// ============================================

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

function getMonthName(month: number): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  return months[month - 1] || 'Unknown'
}
