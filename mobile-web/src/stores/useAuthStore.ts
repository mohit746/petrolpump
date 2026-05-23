// src/stores/useAuthStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'

export type UserRole = 'PLATFORM_OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'ACCOUNTANT' | 'EMPLOYEE'

export interface AppUser {
  id: string
  auth_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  role: UserRole
  pump_id: string | null          // null only for PLATFORM_OWNER
  employee_code: string | null
  base_salary: number
  preferred_language: string
  is_active: boolean
  is_blocked: boolean
  lorry_duty_count: number
}

export const PLATFORM_OWNER_EMAIL = 'mohitdwivedi746@gmail.com'

interface AuthState {
  user: AppUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  initialize: () => Promise<void>
  updateLanguage: (lang: string) => void
}

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,

      initialize: async () => {
        set({ isLoading: true })
        const { data: { session } } = await supabase.auth.getSession()

        if (session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', session.user.id)
            .is('deleted_at', null)
            .single()

          if (profile?.is_active && !profile?.is_blocked) {
            set({ user: profile, isAuthenticated: true })
          } else {
            await supabase.auth.signOut()
            set({ user: null, isAuthenticated: false })
          }
        }
        set({ isLoading: false })
      },

      login: async (email, password) => {
        set({ isLoading: true })
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password })

        if (authErr || !authData.session) {
          set({ isLoading: false })
          return { success: false, error: authErr?.message || 'Login failed' }
        }

        const { data: profile, error: profileErr } = await supabase
          .from('users')
          .select('*')
          .eq('auth_id', authData.session.user.id)
          .is('deleted_at', null)
          .single()

        if (profileErr || !profile) {
          await supabase.auth.signOut()
          set({ isLoading: false })
          return { success: false, error: 'User profile not found. Contact support.' }
        }

        if (profile.is_blocked) {
          await supabase.auth.signOut()
          set({ isLoading: false })
          return { success: false, error: 'Your account has been blocked. Contact your Super Admin.' }
        }

        if (!profile.is_active) {
          await supabase.auth.signOut()
          set({ isLoading: false })
          return { success: false, error: 'Account is deactivated. Contact your admin.' }
        }

        set({ user: profile, isAuthenticated: true, isLoading: false })
        return { success: true }
      },

      logout: async () => {
        await supabase.auth.signOut()
        set({ user: null, isAuthenticated: false })
      },

      updateLanguage: (lang) => {
        const user = get().user
        if (!user) return
        set({ user: { ...user, preferred_language: lang } })
        supabase.from('users').update({ preferred_language: lang }).eq('id', user.id)
      },
    }),
    {
      name: 'pump-auth',
      partialize: (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated }),
    },
  ),
)

export default useAuthStore
