// src/types/index.ts
export type Role = 'PLATFORM_OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'ACCOUNTANT' | 'EMPLOYEE'

// Permission strings — must match values seeded in role_permissions and the
// step1_rbac_and_business.sql migration. Adding a new permission here without
// adding it to the database (and vice versa) is a coordination bug.
export type Permission =
  // Tenant / SaaS
  | 'pump.create' | 'pump.list_all' | 'pump.update' | 'pump.suspend'
  | 'pump.delete' | 'pump.impersonate' | 'pump.global_analytics'
  // Users / Staff
  | 'users.create_super_admin' | 'users.create' | 'users.list' | 'users.update'
  | 'users.delete' | 'users.block' | 'users.assign_permissions'
  // Leaves
  | 'leaves.apply' | 'leaves.list_own' | 'leaves.list_all'
  | 'leaves.approve' | 'leaves.reject'
  // Credit
  | 'credit.account_create' | 'credit.account_update' | 'credit.account_delete'
  | 'credit.txn_create' | 'credit.txn_approve' | 'credit.list'
  // Machines / Nozzles
  | 'machines.crud' | 'nozzles.crud' | 'nozzles.read_list'
  // Fuel & Pricing
  | 'fuel_type.crud' | 'fuel_price.update' | 'fuel_price.history.read'
  | 'fuel_purchase.create' | 'fuel_purchase.list'
  // Sales / Readings
  | 'readings.create' | 'readings.list_own' | 'readings.list_all' | 'readings.lock_day'
  // Salary
  | 'salary.structure.set' | 'salary.advance.grant' | 'salary.incentive.grant'
  | 'salary.payout.generate' | 'salary.payslip.read_own' | 'salary.payslip.read_all'
  // Analytics
  | 'analytics.tenant_dashboard' | 'analytics.profit'
  // Settings
  | 'settings.read' | 'settings.update' | 'settings.whatsapp'

export interface User {
  id: string
  auth_id: string
  email: string
  first_name: string
  last_name: string
  phone: string
  role: Role
  pump_id: string | null
  employee_code: string
  base_salary: number
  preferred_language: 'en' | 'hi'
  is_active: boolean
  is_blocked: boolean
  lorry_duty_count: number
  // Per-user overrides; values prefixed +perm grant, -perm revoke. Empty []
  // means use only the role default. See public.has_permission() in SQL.
  permissions: string[]
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Mirrors public.pumps in fresh_setup.sql + step3_platform_owner.sql.
// EXPIRED was added in step1; deleted_at was added in step3.
export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED' | 'CANCELLED'
export type SubscriptionPlan   = 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE'

export interface Pump {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  subscription_status: SubscriptionStatus
  subscription_plan: SubscriptionPlan | null
  monthly_fee: number
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Return shape of public.platform_global_stats() RPC.
export interface PlatformGlobalStats {
  total_pumps: number
  active_pumps: number
  trial_pumps: number
  suspended_pumps: number
  cancelled_pumps: number
  expired_pumps: number
  mrr: number
  total_users: number
}

// Row shape of public.v_pump_health view.
export interface PumpHealth {
  pump_id: string
  name: string
  subscription_status: SubscriptionStatus
  is_active: boolean
  deleted_at: string | null
  active_users: number
  blocked_users: number
  revenue_7d: number
  profit_7d: number
  last_payment_at: string | null
  outstanding_credit: number
}

export interface Attendance {
  id: string
  user_id: string
  pump_id: string
  check_in_time: string
  check_out_time: string | null
  check_in_lat: number
  check_in_lng: number
  check_in_accuracy: number
  check_out_lat?: number
  check_out_lng?: number
  check_out_accuracy?: number
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE' | 'PENALTY'
  shift_date: string
  total_hours: number
  overtime_hours: number
  notes: string | null
}

export interface Leave {
  id: string
  user_id: string
  pump_id: string
  leave_type: 'PLANNED' | 'EMERGENCY'
  start_date: string
  end_date: string
  reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approved_by: string | null
  approved_at: string | null
  created_at: string
  users?: { first_name: string; last_name: string }
}

export interface NozzleReading {
  id: string
  pump_id: string
  nozzle_number: number
  fuel_type: 'MS' | 'HSD'
  reading_date: string
  opening_reading: number
  closing_reading: number
  litres_sold: number
  entered_by: string
}

export interface DailySales {
  id: string
  pump_id: string
  sale_date: string
  total_ms_litres: number
  total_hsd_litres: number
  total_expected_cash: number
  cash_collected: number
  online_collected: number
  credit_given: number
  shortfall: number
  is_locked: boolean
}

export interface CreditAccount {
  id: string
  pump_id: string
  customer_name: string
  phone: string
  outstanding_balance: number
  is_active: boolean
}

export interface CreditTransaction {
  id: string
  account_id: string
  pump_id: string
  amount: number
  type: 'CREDIT' | 'PAYMENT'
  entered_by: string
  approved_by: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AWAITING_APPROVAL'
  transaction_date: string
}

export interface LorryDuty {
  id: string
  user_id: string
  pump_id: string
  duty_date: string
  status: 'SCHEDULED' | 'ACCEPTED' | 'REFUSED' | 'DEPARTED' | 'ARRIVED' | 'COMPLETED'
  assigned_by: string
  notes: string | null
  users?: { first_name: string; last_name: string }
}

export interface Incentive {
  id: string
  user_id: string
  pump_id: string
  type: 'OIL_SALES' | 'LUBRICANT_SALES' | 'LORRY_DUTY' | 'FESTIVAL_BONUS' | 'PERFORMANCE' | 'CUSTOM'
  amount: number
  description: string
  awarded_by: string
  awarded_at: string
  is_paid: boolean
  users?: { first_name: string; last_name: string }
}

export interface Payslip {
  id: string
  user_id: string
  pump_id: string
  month: number
  year: number

  // Attendance details
  total_working_days: number
  days_present: number
  days_absent: number
  days_on_leave: number
  days_paid_leave: number
  days_unpaid_leave: number
  days_half_day: number
  days_penalty: number
  total_hours_worked: number
  overtime_hours: number

  // Financial details
  basic_salary: number
  salary_type: 'MONTHLY' | 'DAILY'
  overtime_amount: number
  incentive_total: number
  lorry_bonus: number
  deductions: number
  gross_salary: number
  net_salary: number

  status: 'GENERATED' | 'DRAFT' | 'FINALIZED' | 'PAID'
  generated_by: string
  generated_at: string
  paid_at?: string
  users?: { first_name: string; last_name: string; phone: string; employee_code: string }
}

export interface ShiftHandover {
  id: string
  pump_id: string
  attendance_id: string
  outgoing_employee_id: string
  incoming_employee_id: string
  handover_date: string
  planned_handover_time: string
  handover_note: string | null
  status: 'REQUESTED' | 'CONFIRMED' | 'CANCELLED'
  created_at: string
  outgoing_employee?: { first_name: string; last_name: string }
  incoming_employee?: { first_name: string; last_name: string }
}

export interface NotificationLog {
  id: string
  pump_id: string
  recipient_phone: string
  recipient_name: string
  message_type: string
  message_body: string
  whatsapp_msg_id: string | null
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED'
  error_message: string | null
  created_at: string
}
