// src/hooks/useRoleAccess.ts
import useAuthStore from '../stores/useAuthStore'
import type { UserRole } from '../stores/useAuthStore'

const PERMISSIONS: Record<UserRole, string[]> = {
  PLATFORM_OWNER: [
    'dashboard', 'pumps', 'pump_create', 'pump_edit', 'pump_delete',
    'pump_subscription', 'pump_features', 'settings',
  ],
  SUPER_ADMIN: [
    'dashboard', 'attendance', 'leaves', 'lorry_duty', 'incentives',
    'payslip', 'employees', 'settings', 'reports', 'approve_leaves',
    'manage_incentives', 'manage_lorry', 'readings', 'daily_sales',
    'credit_management', 'employee_salary',
  ],
  ADMIN: [
    'dashboard', 'attendance', 'leaves', 'lorry_duty', 'incentives',
    'payslip', 'employees', 'approve_leaves', 'manage_incentives',
    'manage_lorry', 'readings', 'daily_sales', 'credit_management',
  ],
  ACCOUNTANT: [
    'dashboard', 'payslip', 'incentives', 'credit_management',
    'reports', 'transactions', 'expenses',
  ],
  EMPLOYEE: [
    'dashboard', 'attendance', 'leaves', 'payslip', 'lorry_duty',
    'readings', 'credit_entry', 'daily_cash_entry',
  ],
}

export function useRoleAccess() {
  const { user } = useAuthStore()
  const role = (user?.role || 'EMPLOYEE') as UserRole

  const can = (permission: string) => PERMISSIONS[role]?.includes(permission) ?? false
  const isPlatformOwner = role === 'PLATFORM_OWNER'
  const isSuperAdmin    = role === 'SUPER_ADMIN'
  const isAdmin         = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const isAccountant    = role === 'ACCOUNTANT'
  const isEmployee      = role === 'EMPLOYEE'

  return { can, isPlatformOwner, isSuperAdmin, isAdmin, isAccountant, isEmployee, role }
}
