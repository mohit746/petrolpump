// src/components/layout/navLinks.ts
//
// Single source of truth for navigation. Both Sidebar (desktop) and
// BottomNav (mobile) read from this list and filter by can(). When a new
// permission is added, only this file needs changing.
//
// `perm` is checked with mode="any" — visible if the user has any of the
// listed permissions. For role-only items (like the Platform Dashboard),
// gate on the role-specific permission (e.g. pump.list_all).

import type { Permission } from '../../types'

export interface NavSpec {
  to: string
  // i18n key used by the consumer to look up the visible label.
  labelKey: string
  // Plain-English fallback when no translation exists.
  fallback: string
  // lucide-react icon name. Renderers import the actual component lazily
  // to keep this file framework-light.
  icon: 'LayoutDashboard' | 'Clock' | 'CalendarDays' | 'Gauge' | 'Users'
      | 'CreditCard' | 'Truck' | 'Gift' | 'FileText' | 'Settings' | 'Building2'
      | 'Fuel' | 'Wrench' | 'Wallet' | 'BarChart3'
  // Caller is shown the link if can(any of these) is true.
  // Empty array = always visible (only used for the home dashboard).
  perm: Permission[]
}

export const PLATFORM_NAV: NavSpec[] = [
  { to: '/platform', labelKey: 'nav.platform', fallback: 'Platform', icon: 'Building2', perm: ['pump.list_all'] },
]

export const TENANT_NAV: NavSpec[] = [
  { to: '/',           labelKey: 'nav.dashboard',  fallback: 'Dashboard',   icon: 'LayoutDashboard', perm: [] },
  { to: '/attendance', labelKey: 'nav.attendance', fallback: 'Attendance',  icon: 'Clock',
    perm: ['readings.list_own', 'readings.list_all', 'leaves.list_own'] /* attendance is broad — anyone with the basic operational perms */ },
  { to: '/readings',   labelKey: 'nav.readings',   fallback: 'Readings',    icon: 'Gauge',
    perm: ['readings.create', 'readings.list_own', 'readings.list_all'] },
  { to: '/leaves',     labelKey: 'nav.leaves',     fallback: 'Leaves',      icon: 'CalendarDays',
    perm: ['leaves.apply', 'leaves.list_own', 'leaves.list_all'] },
  { to: '/employees',  labelKey: 'nav.employees',  fallback: 'Employees',   icon: 'Users',
    perm: ['users.list'] },
  { to: '/credit',     labelKey: 'nav.credit',     fallback: 'Credit',      icon: 'CreditCard',
    perm: ['credit.list', 'credit.txn_create'] },
  { to: '/lorry-duty', labelKey: 'nav.lorry',      fallback: 'Lorry Duty',  icon: 'Truck',
    perm: ['readings.create', 'readings.list_own', 'readings.list_all'] /* lorry tab is for everyone with ops access */ },
  { to: '/fuel',       labelKey: 'nav.fuel',       fallback: 'Fuel',        icon: 'Fuel',
    perm: ['fuel_type.crud', 'fuel_price.update', 'fuel_price.history.read', 'fuel_purchase.list'] },
  { to: '/machines',   labelKey: 'nav.machines',   fallback: 'Machines',    icon: 'Wrench',
    perm: ['machines.crud', 'nozzles.crud'] },
  { to: '/advances',   labelKey: 'nav.advances',   fallback: 'Advances',    icon: 'Wallet',
    perm: ['salary.advance.grant'] },
  { to: '/incentives', labelKey: 'nav.incentives', fallback: 'Incentives',  icon: 'Gift',
    perm: ['salary.incentive.grant'] },
  { to: '/payslip',    labelKey: 'nav.payslip',    fallback: 'Payslip',     icon: 'FileText',
    perm: ['salary.payslip.read_own', 'salary.payslip.read_all'] },
  { to: '/reports',    labelKey: 'nav.reports',    fallback: 'Reports',     icon: 'BarChart3',
    perm: ['analytics.tenant_dashboard'] },
  { to: '/settings',   labelKey: 'nav.settings',   fallback: 'Settings',    icon: 'Settings',
    perm: ['settings.update'] },
]
