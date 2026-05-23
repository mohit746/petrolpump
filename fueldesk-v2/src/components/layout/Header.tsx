// src/components/layout/Header.tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, Bell, LogOut } from 'lucide-react'
import useAuthStore from '../../stores/useAuthStore'
import { getInitials } from '../../lib/utils'

interface HeaderProps { title: string }

export const Header: React.FC<HeaderProps> = ({ title }) => {
  const { i18n } = useTranslation()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const isHindi = i18n.language?.startsWith('hi')

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark')
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b
                       bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 flex-shrink-0">
      <h1 className="text-base font-semibold text-slate-800 dark:text-white">{title}</h1>
      <div className="flex items-center gap-2">
        {/* Lang toggle */}
        <button
          onClick={() => i18n.changeLanguage(isHindi ? 'en' : 'hi')}
          className="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-700
                     text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200
                     dark:hover:bg-slate-600 transition-colors"
        >
          {isHindi ? 'EN' : 'हिं'}
        </button>

        {/* Dark mode */}
        <button onClick={toggleDark}
          className="w-8 h-8 flex items-center justify-center rounded-full
                     hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                     text-slate-500 dark:text-slate-400">
          <Sun className="w-4 h-4 block dark:hidden" />
          <Moon className="w-4 h-4 hidden dark:block" />
        </button>

        {/* Notifications placeholder */}
        <button className="w-8 h-8 flex items-center justify-center rounded-full
                           hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                           text-slate-500 dark:text-slate-400 relative">
          <Bell className="w-4 h-4" />
        </button>

        {/* Avatar */}
        {user && (
          <div className="avatar w-8 h-8 text-xs">
            {getInitials(user.first_name, user.last_name)}
          </div>
        )}

        {/* Logout — mobile only (desktop has it in the sidebar) */}
        <button
          onClick={handleLogout}
          aria-label="Log out"
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-full
                     hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors
                     text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
