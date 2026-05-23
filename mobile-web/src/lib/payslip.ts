// src/lib/payslip.ts
// Monthly payslip calculation engine
// All rules come from system_settings — no hardcoded values

import { supabase } from './supabase'
import { getDaysInMonth } from 'date-fns'

export interface PayslipResult {
  employee_id: string
  month: number
  year: number
  total_working_days: number
  days_present: number
  days_absent: number
  days_on_leave: number        // approved paid leave
  days_unpaid_leave: number    // approved but unpaid
  days_penalized: number       // unapproved absence (counts as 2x deduction)
  total_hours_worked: number
  overtime_hours: number
  base_salary: number
  deductions: number
  incentives_total: number
  lorry_allowances: number
  gross_salary: number
  salary_type: string
  shift_type: string
}

export async function calculatePayslip(employeeId: string, month: number, year: number): Promise<PayslipResult | null> {
  // 1. Get system settings
  const { data: settings } = await supabase
    .from('system_settings')
    .select('salary_type, shift_type, paid_leaves_per_year, emergency_leave_is_paid, unapproved_absence_penalty_days')
    .single()

  if (!settings) return null

  // 2. Get employee base salary
  const { data: employee } = await supabase
    .from('users')
    .select('base_salary')
    .eq('id', employeeId)
    .single()

  if (!employee) return null

  const baseSalary = Number(employee.base_salary) || 0
  const totalWorkingDays = getDaysInMonth(new Date(year, month - 1))

  // 3. Get attendance for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(totalWorkingDays).padStart(2, '0')}`

  const { data: attendance } = await supabase
    .from('attendance')
    .select('status, total_hours, overtime_hours')
    .eq('employee_id', employeeId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)

  const records = attendance || []

  let daysPresent   = records.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length
  const daysHalfDay = records.filter(r => r.status === 'HALF_DAY').length
  const daysOnLeave = records.filter(r => r.status === 'ON_LEAVE').length
  const daysPenalized = records.filter(r => r.status === 'PENALTY').length
  const totalHours  = records.reduce((s, r) => s + (Number(r.total_hours) || 0), 0)
  const overtimeHrs = records.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0)

  // Half days count as 0.5
  daysPresent += daysHalfDay * 0.5

  // Absent days = calendar days - present - leaves - penalized
  const daysAbsent = Math.max(0, totalWorkingDays - daysPresent - daysHalfDay * 0.5 - daysOnLeave - daysPenalized)

  // 4. Get approved leave details (paid vs unpaid)
  const { data: leaves } = await supabase
    .from('leaves')
    .select('is_paid_leave, total_days')
    .eq('employee_id', employeeId)
    .eq('status', 'APPROVED')
    .gte('from_date', startDate)
    .lte('to_date', endDate)

  const paidLeaveDays   = (leaves || []).filter(l => l.is_paid_leave).reduce((s, l) => s + (l.total_days || 0), 0)
  const unpaidLeaveDays = (leaves || []).filter(l => !l.is_paid_leave).reduce((s, l) => s + (l.total_days || 0), 0)

  // 5. Calculate deductions
  const dailySalary = settings.salary_type === 'DAILY_WAGES'
    ? baseSalary  // base_salary IS the daily rate for daily wages
    : baseSalary / totalWorkingDays  // monthly ÷ days for monthly fixed

  const penaltyMultiplier = Number(settings.unapproved_absence_penalty_days) || 2
  const deductions =
    (daysAbsent * dailySalary) +                        // absent days
    (unpaidLeaveDays * dailySalary) +                   // unpaid approved leaves
    (daysPenalized * dailySalary * penaltyMultiplier)   // 2× penalty for unapproved

  // 6. Get incentives for this month
  const { data: incentives } = await supabase
    .from('incentives')
    .select('amount')
    .eq('employee_id', employeeId)
    .eq('for_month', month)
    .eq('for_year', year)

  const incentivesTotal = (incentives || []).reduce((s, i) => s + (Number(i.amount) || 0), 0)

  // 7. Get lorry duty allowances for this month
  const { data: lorryDuties } = await supabase
    .from('lorry_duties')
    .select('allowance_amount')
    .eq('assigned_employee_id', employeeId)
    .eq('status', 'COMPLETED')
    .gte('assigned_date', startDate)
    .lte('assigned_date', endDate)

  const lorryAllowances = (lorryDuties || []).reduce((s, d) => s + (Number(d.allowance_amount) || 0), 0)

  // 8. Gross salary
  const effectiveBaseSalary = settings.salary_type === 'DAILY_WAGES'
    ? dailySalary * daysPresent   // daily: only pay for days worked
    : baseSalary                  // monthly: full salary minus deductions

  const grossSalary = Math.max(0, effectiveBaseSalary - deductions + incentivesTotal + lorryAllowances)

  return {
    employee_id: employeeId,
    month,
    year,
    total_working_days: totalWorkingDays,
    days_present: daysPresent,
    days_absent: daysAbsent,
    days_on_leave: paidLeaveDays,
    days_unpaid_leave: unpaidLeaveDays,
    days_penalized: daysPenalized,
    total_hours_worked: Math.round(totalHours * 10) / 10,
    overtime_hours: Math.round(overtimeHrs * 10) / 10,
    base_salary: baseSalary,
    deductions: Math.round(deductions * 100) / 100,
    incentives_total: Math.round(incentivesTotal * 100) / 100,
    lorry_allowances: Math.round(lorryAllowances * 100) / 100,
    gross_salary: Math.round(grossSalary * 100) / 100,
    salary_type: settings.salary_type,
    shift_type: settings.shift_type,
  }
}

/** Save computed payslip to DB */
export async function savePayslip(result: PayslipResult) {
  const { data, error } = await supabase
    .from('monthly_payslips')
    .upsert(result, { onConflict: 'employee_id,month,year' })
    .select()
    .single()

  if (error) throw error
  return data
}

/** Generate payslips for ALL active employees for a given month */
export async function generateAllPayslips(month: number, year: number) {
  const { data: employees } = await supabase
    .from('users')
    .select('id, first_name, last_name')
    .eq('is_active', true)
    .in('role', ['EMPLOYEE', 'ACCOUNTANT', 'ADMIN'])

  const results = []
  for (const emp of employees || []) {
    const payslip = await calculatePayslip(emp.id, month, year)
    if (payslip) {
      const saved = await savePayslip(payslip)
      results.push({ employee: emp, payslip: saved })
    }
  }

  return results
}
