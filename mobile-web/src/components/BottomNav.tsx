// src/components/BottomNav.tsx
import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  HomeIcon, CalendarDaysIcon, TruckIcon,
  BanknotesIcon, UsersIcon, Cog6ToothIcon,
  ChartBarIcon, BeakerIcon, CurrencyRupeeIcon,
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeSolid, CalendarDaysIcon as CalSolid,
  TruckIcon as TruckSolid, BanknotesIcon as BankSolid,
  UsersIcon as UsersSolid, Cog6ToothIcon as CogSolid,
  ChartBarIcon as ChartSolid, BeakerIcon as BeakerSolid,
  CurrencyRupeeIcon as CurrSolid,
} from '@heroicons/react/24/solid'
import { useRoleAccess } from '../hooks/useRoleAccess'
import type { UserRole } from '../stores/useAuthStore'

interface Tab {
  to: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  ActiveIcon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const ALL_TABS: Tab[] = [
  // Dashboard — everyone
  { to: '/', label: 'Home', Icon: HomeIcon, ActiveIcon: HomeSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE'] },

  // Attendance — SUPER_ADMIN, ADMIN, EMPLOYEE
  { to: '/attendance', label: 'Attendance', Icon: CalendarDaysIcon, ActiveIcon: CalSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'] },

  // Lorry — SUPER_ADMIN, ADMIN, EMPLOYEE
  { to: '/lorry', label: 'Lorry', Icon: TruckIcon, ActiveIcon: TruckSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'] },

  // Payslip — everyone except ... well, everyone
  { to: '/payslip', label: 'Payslip', Icon: BanknotesIcon, ActiveIcon: BankSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE'] },

  // Incentives / Transactions — SUPER_ADMIN, ADMIN, ACCOUNTANT
  { to: '/incentives', label: 'Finance', Icon: ChartBarIcon, ActiveIcon: ChartSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'] },

  // Meter Readings — SUPER_ADMIN, ADMIN, EMPLOYEE
  { to: '/readings', label: 'Readings', Icon: BeakerIcon, ActiveIcon: BeakerSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'] },

  // Credit / Khata — SUPER_ADMIN, ADMIN, ACCOUNTANT, EMPLOYEE
  { to: '/credits', label: 'Credit', Icon: CurrencyRupeeIcon, ActiveIcon: CurrSolid,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE'] },

  // Employees — SUPER_ADMIN, ADMIN
  { to: '/employees', label: 'Staff', Icon: UsersIcon, ActiveIcon: UsersSolid,
    roles: ['SUPER_ADMIN', 'ADMIN'] },

  // Settings — SUPER_ADMIN only
  { to: '/settings', label: 'Settings', Icon: Cog6ToothIcon, ActiveIcon: CogSolid,
    roles: ['SUPER_ADMIN'] },
]

const BottomNav: React.FC = () => {
  const { role } = useRoleAccess()

  const tabs = ALL_TABS.filter(tab => tab.roles.includes(role as UserRole))

  return (
    <nav className="tab-bar">
      {tabs.map(({ to, label, Icon, ActiveIcon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}
        >
          {({ isActive }) => (
            <>
              {isActive ? <ActiveIcon className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
              <span className="text-[10px] font-medium leading-tight">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export default BottomNav
