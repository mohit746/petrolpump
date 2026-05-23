// supabase/functions/monthly-report/index.ts
// Triggered on 1st of each month via Supabase cron schedule
// Schedule: "0 6 1 * *"  (6 AM IST on 1st of every month)
// Deploy: supabase functions deploy monthly-report

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Default: generate for previous month
    let reportMonth: number, reportYear: number
    try {
      const body = await req.json()
      reportMonth = body.month
      reportYear = body.year
    } catch {
      const now = new Date()
      reportMonth = now.getMonth() === 0 ? 12 : now.getMonth()
      reportYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    }

    // Get system settings
    const { data: settings } = await supabase.from('system_settings').select('*').single()
    const salaryType = settings?.salary_type || 'MONTHLY_FIXED'
    const penaltyMultiplier = Number(settings?.unapproved_absence_penalty_days) || 2

    // Get all active employees
    const { data: employees, error: empErr } = await supabase
      .from('users').select('id, first_name, last_name, base_salary, role')
      .eq('is_active', true).neq('role', 'SUPER_ADMIN')
    if (empErr) throw empErr

    const totalDays = new Date(reportYear, reportMonth, 0).getDate()
    const monthStart = `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`
    const monthEnd   = `${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`

    let totalPayout = 0
    const payslipSummary: string[] = []

    for (const emp of employees || []) {
      const baseSalary = Number(emp.base_salary) || 0
      const dailyRate = salaryType === 'DAILY_WAGES' ? baseSalary : baseSalary / totalDays

      // Attendance
      const { data: attendance } = await supabase.from('attendance')
        .select('status, total_hours, overtime_hours')
        .eq('employee_id', emp.id)
        .gte('attendance_date', monthStart)
        .lte('attendance_date', monthEnd)

      const records = attendance || []
      const daysPresent   = records.filter(r => ['PRESENT', 'LATE'].includes(r.status)).length
      const daysHalfDay   = records.filter(r => r.status === 'HALF_DAY').length
      const daysAbsent    = records.filter(r => r.status === 'ABSENT').length
      const daysPenalized = records.filter(r => r.status === 'PENALTY').length
      const daysOnLeave   = records.filter(r => r.status === 'ON_LEAVE').length
      const totalHours    = records.reduce((s, r) => s + (Number(r.total_hours) || 0), 0)
      const overtimeHours = records.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0)

      const effectiveDays = daysPresent + daysHalfDay * 0.5

      // Deductions
      const unpaidAbsent = Math.max(0, totalDays - effectiveDays - daysOnLeave - daysPenalized)
      const deductions = (unpaidAbsent * dailyRate) + (daysPenalized * dailyRate * penaltyMultiplier)

      // Effective base
      const baseEarned = salaryType === 'DAILY_WAGES'
        ? effectiveDays * dailyRate
        : baseSalary

      // Incentives
      const { data: incentives } = await supabase.from('incentives')
        .select('amount').eq('employee_id', emp.id)
        .eq('for_month', reportMonth).eq('for_year', reportYear)
      const incentivesTotal = (incentives || []).reduce((s, i) => s + (Number(i.amount) || 0), 0)

      // Lorry allowances
      const { data: lorries } = await supabase.from('lorry_duties')
        .select('allowance_amount').eq('assigned_employee_id', emp.id)
        .eq('status', 'COMPLETED')
        .gte('assigned_date', monthStart).lte('assigned_date', monthEnd)
      const lorryAllowances = (lorries || []).reduce((s, l) => s + (Number(l.allowance_amount) || 0), 0)

      const grossSalary = Math.max(0, baseEarned - deductions + incentivesTotal + lorryAllowances)
      totalPayout += grossSalary

      // Upsert payslip with correct column names
      await supabase.from('monthly_payslips').upsert({
        employee_id: emp.id,
        month: reportMonth,
        year: reportYear,
        total_working_days: totalDays,
        days_present: Math.round(effectiveDays),
        days_absent: daysAbsent,
        days_on_leave: daysOnLeave,
        days_penalized: daysPenalized,
        total_hours_worked: Math.round(totalHours * 10) / 10,
        overtime_hours: Math.round(overtimeHours * 10) / 10,
        base_salary: baseSalary,
        deductions: Math.round(deductions * 100) / 100,
        incentives_total: Math.round(incentivesTotal * 100) / 100,
        lorry_allowances: Math.round(lorryAllowances * 100) / 100,
        gross_salary: Math.round(grossSalary * 100) / 100,
        salary_type: salaryType,
        shift_type: settings?.shift_type || '12HR',
        generated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,month,year' })

      payslipSummary.push(`${emp.first_name} ${emp.last_name}: ₹${Math.round(grossSalary).toLocaleString()}`)
    }

    // ── WhatsApp monthly summary to super admin ──────────────────────────────
    const waPhoneId = settings?.whatsapp_phone_number_id
    const waToken   = settings?.whatsapp_access_token
    const adminWA   = settings?.report_whatsapp_number

    if (waPhoneId && waToken && adminWA) {
      const monthName = new Date(reportYear, reportMonth - 1, 1)
        .toLocaleString('en-IN', { month: 'long' })
      const message = [
        `📊 *Monthly Payroll Report*`,
        `*${monthName} ${reportYear}*`,
        ``,
        `👥 Employees: ${employees?.length || 0}`,
        `💰 Total Payout: ₹${Math.round(totalPayout).toLocaleString()}`,
        ``,
        `*Breakdown:*`,
        ...payslipSummary.slice(0, 15),
        payslipSummary.length > 15 ? `...and ${payslipSummary.length - 15} more` : '',
        ``,
        `✅ All payslips generated. View in PumpManager app.`,
      ].filter(Boolean).join('\n')

      await fetch(`https://graph.facebook.com/v19.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: adminWA.replace(/\D/g, ''),
          type: 'text',
          text: { body: message },
        }),
      })

      await supabase.from('notification_log').insert({
        recipient_phone: adminWA,
        recipient_name: 'Super Admin',
        message_type: 'MONTHLY_REPORT',
        message_body: `${monthName} ${reportYear} — ₹${Math.round(totalPayout).toLocaleString()} total`,
        status: 'SENT',
        sent_at: new Date().toISOString(),
      })
    }

    return new Response(JSON.stringify({
      success: true,
      month: reportMonth,
      year: reportYear,
      employeesProcessed: employees?.length,
      totalPayout: Math.round(totalPayout),
      payslips: payslipSummary,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })

  } catch (err) {
    console.error('Monthly report error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    })
  }
})
