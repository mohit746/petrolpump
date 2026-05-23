// src/components/guards/RequirePump.tsx
//
// Guard for tenant-scoped routes. Two failure modes:
//
//   1. PLATFORM_OWNER lands on a tenant route — they have no pump_id, so the
//      page would fetch with pump_id = null and explode. Bounce to /platform.
//
//   2. A non-platform user has no pump_id assigned yet — show a plain
//      "waiting for pump assignment" placeholder rather than a crashing page.

import React from 'react'
import { Navigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import useAuthStore from '../../stores/useAuthStore'

interface RequirePumpProps {
  children: React.ReactNode
}

export const RequirePump: React.FC<RequirePumpProps> = ({ children }) => {
  const user = useAuthStore(s => s.user)

  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'PLATFORM_OWNER') return <Navigate to="/platform" replace />

  if (!user.pump_id) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="card max-w-sm w-full text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30
                          flex items-center justify-center">
            <Building2 className="w-6 h-6 text-amber-600" />
          </div>
          <p className="text-base font-semibold text-slate-800 dark:text-white">
            No pump assigned
          </p>
          <p className="text-sm text-slate-500">
            Your account is not yet linked to a petrol pump. Please contact
            your platform administrator to be assigned.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
