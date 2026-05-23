// src/components/layout/BottomNav.tsx
//
// Mobile bottom navigation. Shows up to 4 primary tabs and an always-present
// "More" tab that opens a sheet listing every remaining permitted item, so
// nothing in the sidebar is unreachable on mobile.
//
// Desktop (≥ md) hides this entirely — Sidebar.tsx is the desktop nav.

import React, { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Clock, CalendarDays, Gauge, Users,
  CreditCard, Truck, Gift, FileText, Settings, Building2,
  Fuel, Wrench, Wallet, BarChart3,
  MoreHorizontal, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRoleAccess } from '../../hooks/useRoleAccess'
import { PLATFORM_NAV, TENANT_NAV, type NavSpec } from './navLinks'

const ICONS: Record<NavSpec['icon'], React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Clock, CalendarDays, Gauge, Users,
  CreditCard, Truck, Gift, FileText, Settings, Building2,
  Fuel, Wrench, Wallet, BarChart3,
}

// 4 primary tabs + 1 "More" slot = 5 total, which is the typical bottom-nav
// budget on a phone. Everything past the cap is reachable via More so no
// sidebar item gets quietly hidden on mobile.
const PRIMARY_SLOTS = 4

export const BottomNav: React.FC = () => {
  const { t } = useTranslation()
  const { can, isPlatformOwner } = useRoleAccess()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const source = isPlatformOwner ? PLATFORM_NAV : TENANT_NAV
  const visible = source.filter(item => item.perm.length === 0 || item.perm.some(can))

  if (visible.length === 0) return null

  // If everything fits in the primary row, skip the More tab entirely.
  const needsMore = visible.length > PRIMARY_SLOTS
  const primary  = needsMore ? visible.slice(0, PRIMARY_SLOTS) : visible
  const overflow = needsMore ? visible.slice(PRIMARY_SLOTS) : []

  // The More tab paints "active" whenever the current route is in the
  // overflow set, so the user has visual continuity after picking from it.
  const overflowActive = needsMore && overflow.some(o =>
    o.to === '/' ? location.pathname === '/' : location.pathname.startsWith(o.to)
  )

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40
                      bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700
                      flex items-center safe-area-pb">
        {primary.map(link => {
          const Icon = ICONS[link.icon]
          return (
            <NavLink key={link.to} to={link.to} end={link.to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-w-0
                 transition-colors ${isActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`w-5 h-5 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-[10px] font-medium truncate max-w-full px-1">
                    {t(link.labelKey, link.fallback)}
                  </span>
                </>
              )}
            </NavLink>
          )
        })}

        {needsMore && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More navigation"
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-w-0
                        transition-colors ${overflowActive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </nav>

      {/* Overflow sheet — covers the screen behind a translucent backdrop and
          slides in a tray with the remaining items. Also includes the primary
          tabs so the user can switch from anywhere without a back-out. */}
      {needsMore && moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="flex-1 bg-slate-900/40 backdrop-blur-sm"
          />
          <div className="bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700
                          rounded-t-2xl shadow-xl pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {t('nav.more', 'More')}
              </p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 px-2 pb-3">
              {visible.map(link => {
                const Icon = ICONS[link.icon]
                const active = link.to === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(link.to)
                return (
                  <button
                    key={link.to}
                    onClick={() => { setMoreOpen(false); navigate(link.to) }}
                    className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl
                                transition-colors ${active
                                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium text-center px-1 leading-tight">
                      {t(link.labelKey, link.fallback)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
