import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      // Actions
      login: async (email, password) => {
        set({ isLoading: true })
        
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Login failed')
          }

          set({
            user: data.data.user,
            token: data.data.token,
            isAuthenticated: true,
            isLoading: false,
          })

          return { success: true }
        } catch (error) {
          set({ isLoading: false })
          return { success: false, error: error.message }
        }
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        })
      },

      verifyAuth: async () => {
        const { token } = get()
        
        if (!token) {
          return false
        }

        try {
          const response = await fetch('/api/auth/me', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })

          if (!response.ok) {
            get().logout()
            return false
          }

          const data = await response.json()
          set({ user: data.data.user, isAuthenticated: true })
          return true
        } catch (error) {
          get().logout()
          return false
        }
      },

      // Helper methods
      hasRole: (role) => {
        const { user } = get()
        return user?.role === role
      },

      hasAnyRole: (roles) => {
        const { user } = get()
        return roles.includes(user?.role)
      },

      getAuthHeaders: () => {
        const { token } = get()
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

export default useAuthStore