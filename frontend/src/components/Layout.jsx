import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  HomeIcon, 
  ClockIcon, 
  CpuChipIcon, 
  DocumentTextIcon,
  ArrowRightOnRectangleIcon,
  UserIcon,
  UsersIcon,
  CalendarDaysIcon,
  GiftIcon,
  TruckIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import useAuthStore from '../stores/useAuthStore'
import { useRoleAccess } from '../hooks/useRoleAccess'

const LanguageSwitcher = () => {
  const { i18n } = useTranslation()
  const current = i18n.language?.startsWith('hi') ? 'hi' : 'en'

  const toggle = () => {
    const next = current === 'en' ? 'hi' : 'en'
    i18n.changeLanguage(next)
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center space-x-1 px-3 py-1.5 rounded-full border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors"
      title="Switch Language / भाषा बदलें"
    >
      <span className="text-base">{current === 'en' ? '🇮🇳' : '🇬🇧'}</span>
      <span className="text-gray-600">{current === 'en' ? 'हिंदी' : 'English'}</span>
    </button>
  )
}

const Layout = ({ children }) => {
  const { t } = useTranslation()
  const { user, logout } = useAuthStore()
  const { can } = useRoleAccess()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const allNavItems = [
    { key: 'dashboard',   name: t('nav.dashboard'),  href: '/dashboard',  icon: HomeIcon },
    { key: 'shifts',      name: t('nav.shifts'),     href: '/shifts',     icon: ClockIcon },
    { key: 'dispensers',  name: t('nav.dispensers'), href: '/dispensers', icon: CpuChipIcon },
    { key: 'readings',    name: t('nav.readings'),   href: '/readings',   icon: DocumentTextIcon },
    { key: 'employees',   name: t('nav.employees'),  href: '/employees',  icon: UsersIcon },
    { key: 'attendance',  name: t('nav.attendance'), href: '/attendance', icon: CalendarDaysIcon },
    { key: 'leaves',      name: t('nav.leaves'),     href: '/leaves',     icon: CalendarDaysIcon },
    { key: 'incentives',  name: t('nav.incentives'), href: '/incentives', icon: GiftIcon },
    { key: 'fuelLoads',   name: t('nav.fuelLoads'),  href: '/fuel-loads', icon: TruckIcon },
  ]

  const navigation = allNavItems.filter(item => can(item.key))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo + Desktop Nav */}
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <div className="h-8 w-8 bg-primary-600 rounded-lg flex items-center justify-center">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span className="ml-2 text-lg font-semibold text-gray-900">{t('app.name')}</span>
              </div>
              <div className="hidden lg:ml-6 lg:flex lg:space-x-4">
                {navigation.map((item) => (
                  <NavLink
                    key={item.key}
                    to={item.href}
                    className={({ isActive }) =>
                      `inline-flex items-center px-3 pt-1 border-b-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-primary-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4 mr-1.5" />
                    {item.name}
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-3">
              <LanguageSwitcher />
              <div className="hidden sm:flex items-center space-x-2">
                <UserIcon className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-gray-700">{user?.firstName} {user?.lastName}</span>
                <span className="text-xs bg-primary-100 text-primary-800 px-2 py-0.5 rounded-full font-medium">
                  {user?.role?.replace('_', ' ')}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center space-x-1 text-gray-500 hover:text-red-600 transition-colors"
                title={t('nav.logout')}
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" />
                <span className="text-sm">{t('nav.logout')}</span>
              </button>
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
              >
                {mobileOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile navigation */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-gray-200 bg-white">
            <div className="pt-2 pb-3 space-y-1 px-3">
              {navigation.map((item) => (
                <NavLink
                  key={item.key}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 rounded-md text-sm font-medium ${
                      isActive
                        ? 'text-primary-700 bg-primary-50'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.name}
                </NavLink>
              ))}
              <hr className="my-2" />
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center space-x-2">
                  <UserIcon className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700">{user?.firstName}</span>
                  <span className="text-xs bg-primary-100 text-primary-800 px-2 py-0.5 rounded-full">
                    {user?.role?.replace('_', ' ')}
                  </span>
                </div>
                <button onClick={handleLogout} className="text-red-500 text-sm flex items-center space-x-1">
                  <ArrowRightOnRectangleIcon className="h-4 w-4" />
                  <span>{t('nav.logout')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-2 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  )
}

export default Layout