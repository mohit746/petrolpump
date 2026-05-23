// src/hooks/useRoleAccess.js
import useAuthStore from '../stores/useAuthStore'

const ROLE_HIERARCHY = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  ACCOUNTANT: 2,
  EMPLOYEE: 1,
}

// What each role can access
const ROLE_PERMISSIONS = {
  SUPER_ADMIN: [
    'dashboard', 'shifts', 'dispensers', 'readings',
    'employees', 'attendance', 'leaves', 'incentives', 'fuelLoads',
    'manage_users', 'manage_settings',
  ],
  ADMIN: [
    'dashboard', 'shifts', 'dispensers', 'readings',
    'employees', 'attendance', 'leaves', 'incentives', 'fuelLoads',
  ],
  ACCOUNTANT: [
    'dashboard', 'shifts', 'readings', 'incentives',
  ],
  EMPLOYEE: [
    'dashboard', 'attendance', 'leaves',
  ],
}

export const useRoleAccess = () => {
  const { user } = useAuthStore()
  const role = user?.role || 'EMPLOYEE'

  const can = (permission) => {
    const permissions = ROLE_PERMISSIONS[role] || []
    return permissions.includes(permission)
  }

  const isAtLeast = (minRole) => {
    return (ROLE_HIERARCHY[role] || 0) >= (ROLE_HIERARCHY[minRole] || 0)
  }

  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const isAccountant = role === 'ACCOUNTANT'
  const isEmployee = role === 'EMPLOYEE'

  return { can, isAtLeast, isSuperAdmin, isAdmin, isAccountant, isEmployee, role }
}

export default useRoleAccess
