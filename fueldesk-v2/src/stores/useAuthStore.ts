// src/stores/useAuthStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'
import { loadRolePermissions, resetPermissionCache } from '../lib/permissions'
import type { User } from '../types'

/**
 * If the user belongs to a pump, refuse the login when the pump is
 * suspended/cancelled/expired or soft-deleted. Throws an Error with a
 * user-friendly message; the caller is responsible for signing the auth
 * session out.
 *
 * Platform owners (pump_id = null) are exempt — they manage tenants from
 * outside the tenant scope and should always be able to log in to fix
 * problems.
 */
async function assertPumpAccessible(profile: User): Promise<void> {
  if (!profile.pump_id) return // PLATFORM_OWNER or unassigned — handled elsewhere
  const { data, error } = await supabase
    .from('pumps')
    .select('subscription_status,is_active,deleted_at,name')
    .eq('id', profile.pump_id)
    .maybeSingle()

  if (error) {
    // Don't block login on a transient lookup error; just log it.
    console.warn('[Auth] pump lookup failed:', error.message)
    return
  }
  if (!data) {
    throw new Error('Your pump account no longer exists. Contact platform support.')
  }
  if (data.deleted_at) {
    throw new Error('Your pump has been removed. Contact platform support.')
  }
  if (data.subscription_status === 'SUSPENDED') {
    throw new Error('Your pump is currently suspended. Contact platform support.')
  }
  if (data.subscription_status === 'CANCELLED') {
    throw new Error('Your pump subscription has been cancelled.')
  }
  if (data.subscription_status === 'EXPIRED') {
    throw new Error('Your pump subscription has expired. Renew to continue.')
  }
  if (data.is_active === false) {
    throw new Error('Your pump is inactive. Contact platform support.')
  }
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  initialize: () => Promise<void>
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  setUser: (user: User | null) => void
}

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      // Validate the persisted session against Supabase on app load.
      // If the JWT has expired or the user has been blocked/soft-deleted, sign out.
      initialize: async () => {
        set({ isLoading: true })
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session?.user) {
            set({ user: null, isAuthenticated: false, isLoading: false })
            return
          }
          const { data: profile, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .is('deleted_at', null)
            .maybeSingle()

          if (error) {
            // Surface profile-lookup errors (column missing, RLS recursion, …)
            // so they show up in the console instead of silently signing the user out.
            console.error('[Auth] Profile lookup failed during initialize:', error)
            await supabase.auth.signOut()
            set({ user: null, isAuthenticated: false, isLoading: false })
            return
          }

          if (!profile || !profile.is_active || profile.is_blocked) {
            await supabase.auth.signOut()
            resetPermissionCache()
            set({ user: null, isAuthenticated: false, isLoading: false })
            return
          }

          // Pump-level lockout (suspended / cancelled / expired / deleted).
          // Quietly sign out on initialize() so a stale persisted session
          // can't bring a user into a tenant that is no longer accessible.
          try {
            await assertPumpAccessible(profile as User)
          } catch (lockoutErr) {
            console.warn('[Auth] pump lockout on resume:', (lockoutErr as Error).message)
            await supabase.auth.signOut()
            resetPermissionCache()
            set({ user: null, isAuthenticated: false, isLoading: false })
            return
          }

          // Load role defaults so can()/<Can/> work immediately. Failure here
          // shouldn't strand the user — log it and proceed; UI permission
          // checks will fail closed (deny) until the cache populates.
          try {
            await loadRolePermissions()
          } catch (e) {
            console.error('[Auth] loadRolePermissions failed during initialize:', e)
          }

          set({ user: profile, isAuthenticated: true, isLoading: false })
        } catch (err) {
          console.error('[Auth] initialize() threw:', err)
          resetPermissionCache()
          set({ user: null, isAuthenticated: false, isLoading: false })
        }
      },

      login: async (identifier, password) => {
        set({ isLoading: true })
        try {
          const trimmedId = identifier.trim()
          const looksLikeEmail = trimmedId.includes('@')
          const isPhone = !looksLikeEmail && /^[+\d][\d\s\-()]{6,}$/.test(trimmedId)
          let email = trimmedId

          if (isPhone) {
            // Use the SECURITY DEFINER RPC `get_email_by_phone` so the lookup
            // bypasses RLS (anonymous users cannot SELECT from `users` directly).
            // The RPC normalises the input and matches all common stored formats.
            const { data: foundEmail, error: rpcError } = await supabase
              .rpc('get_email_by_phone', { input_phone: trimmedId })

            if (rpcError) {
              // Most common cause: the RPC has not been deployed yet.
              // Surface a clear, actionable error rather than the raw PostgREST message.
              const msg = (rpcError.message || '').toLowerCase()
              if (msg.includes('does not exist') || msg.includes('not found') || msg.includes('function')) {
                throw new Error('Mobile login is not configured. Please run database/migrations.sql in Supabase.')
              }
              throw new Error(rpcError.message || 'Could not look up mobile number')
            }

            if (!foundEmail) {
              throw new Error('No active account found with this mobile number')
            }

            email = foundEmail as string
          }

          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
          if (authError) {
            const msg = authError.message.toLowerCase()
            if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
              throw new Error('Wrong password. Please try again.')
            }
            if (msg.includes('email not confirmed')) {
              throw new Error('Account not confirmed. Ask your admin to confirm the account in Supabase.')
            }
            throw new Error(authError.message)
          }

          let { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', authData.user.id)
            .is('deleted_at', null)
            .maybeSingle()

          // Surface the real PostgREST error (column missing, RLS recursion, …)
          // instead of falling through to the silent auto-create branch.
          if (profileError) {
            throw new Error(`Profile lookup failed: ${profileError.message}`)
          }

          // No matching app profile → auto-create a minimal row so the user
          // is not stranded after a successful auth. Admin can fill in the
          // role / pump_id / salary later from the Employees screen.
          if (!profile) {
            const meta = (authData.user.user_metadata || {}) as Record<string, string>
            const inserted = await supabase
              .from('users')
              .insert({
                id: authData.user.id,
                email: authData.user.email,
                first_name: meta.first_name || (authData.user.email?.split('@')[0] ?? ''),
                last_name: meta.last_name || '',
                role: 'EMPLOYEE',
                is_active: true,
                is_blocked: false,
              })
              .select('*')
              .maybeSingle()
            profile = inserted.data
            profileError = inserted.error
          }

          if (profileError) throw new Error(profileError.message || 'Could not load profile')
          if (!profile) throw new Error('User profile not found')
          if (!profile.is_active) throw new Error('Account is inactive')
          if (profile.is_blocked) throw new Error('Account is blocked. Contact your administrator.')

          // Pump-level lockout. Throws with a user-friendly message that we
          // catch below; on lockout we sign out the auth session so the
          // failed-login screen doesn't leave a half-authenticated state.
          try {
            await assertPumpAccessible(profile as User)
          } catch (lockoutErr) {
            await supabase.auth.signOut()
            throw lockoutErr
          }

          // Refresh role-permission cache for the new identity. We reset first
          // so a previous user's defaults can't bleed into this session if the
          // schema changed between logins.
          resetPermissionCache()
          try {
            await loadRolePermissions()
          } catch (e) {
            console.error('[Auth] loadRolePermissions failed during login:', e)
          }

          set({ user: profile, isAuthenticated: true, isLoading: false })
          return { success: true }
        } catch (err: unknown) {
          set({ isLoading: false })
          return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
        }
      },

      logout: async () => {
        await supabase.auth.signOut()
        resetPermissionCache()
        set({ user: null, isAuthenticated: false })
      },
    }),
    { name: 'fueldesk-auth', partialize: (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated }) }
  )
)

export default useAuthStore
