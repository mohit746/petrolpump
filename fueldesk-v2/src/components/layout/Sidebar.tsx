// src/components/layout/Sidebar.tsx
import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Users, Clock, CalendarDays, Gauge, CreditCard,
  Truck, Gift, FileText, Settings, Building2, LogOut, Fuel, ChevronLeft, ChevronRight,
  Wrench, Wallet, BarChart3,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/useAuthStore'
import { useRoleAccess } from '../../hooks/useRoleAccess'
import { getInitials } from '../../lib/utils'
import { PLATFORM_NAV, TENANT_NAV, type NavSpec } from './navLinks'

const ICONS: Record<NavSpec['icon'], React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, Clock, CalendarDays, Gauge, CreditCard,
  Truck, Gift, FileText, Settings, Building2,
  Fuel, Wrench, Wallet, BarChart3,
}

const useSidebarLinks = (): NavSpec[] => {
  const { can, isPlatformOwner } = useRoleAccess()
  const source = isPlatformOwner ? PLATFORM_NAV : TENANT_NAV
  return source.filter(item => item.perm.length === 0 || item.perm.some(can))
}

export const Sidebar: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const links = useSidebarLinks()
  const { t } = useTranslation()

  const handleLogout = async () => { await logout(); navigate('/login') }

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="hidden md:flex flex-col h-screen bg-white dark:bg-slate-800
                 border-r border-slate-100 dark:border-slate-700 flex-shrink-0 overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 gap-3 border-b border-slate-100 dark:border-slate-700">
        <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Fuel className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="font-bold text-slate-900 dark:text-white text-base">FuelDesk</motion.span>
        )}
        <button onClick={onToggle} className="ml-auto text-slate-400 hover:text-slate-600 transition-colors">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {links.map(link => {
          const Icon = ICONS[link.icon]
          return (
            <NavLink key={link.to} to={link.to} end={link.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm font-medium transition-colors
                 ${isActive
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`
              }
            >
              <span className="w-5 h-5 flex-shrink-0"><Icon className="w-5 h-5" /></span>
              {!collapsed && <span className="truncate">{t(link.labelKey, link.fallback)}</span>}
            </NavLink>
          )
        })}
      </nav>

      {/* User + logout */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-700 space-y-1">
        {!collapsed && user && (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="avatar w-7 h-7 text-xs">
              {getInitials(user.first_name, user.last_name)}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-slate-800 dark:text-white truncate">
                {user.first_name} {user.last_name}
              </p>
              <p className="text-[10px] text-slate-400 truncate">{user.role}</p>
            </div>
          </div>
        )}
        <button onClick={handleLogout}
          className="flex items-center gap-3 w-full px-2 py-2.5 rounded-lg text-sm font-medium
                     text-slate-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600
                     dark:hover:text-rose-400 transition-colors">
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </motion.aside>
  )
}
