// src/components/guards/RequirePerm.tsx
//
// Route guard that gates a route on one or more permissions.
// Drop-in replacement for the legacy <RequireRole roles={[...]}> pattern.
//
//   <RequirePerm perm="users.create"> <Employees /> </RequirePerm>
//   <RequirePerm perm={['fuel_type.crud','fuel_price.update']} mode="any"> ... </RequirePerm>
//
// On deny, redirects PLATFORM_OWNER → /platform, everyone else → /.
// This keeps platform owners out of tenant pages they can't see (no pump_id)
// rather than dumping them into a broken Dashboard fetch.

import React from 'react'
import { Navigate } from 'react-router-dom'
import useAuthStore from '../../stores/useAuthStore'
import { useRoleAccess } from '../../hooks/useRoleAccess'
import type { Permission } from '../../types'

type PermInput = Permission | string | Array<Permission | string>

interface RequirePermProps {
  perm: PermInput
  mode?: 'any' | 'all'
  children: React.ReactNode
}

export const RequirePerm: React.FC<RequirePermProps> = ({ perm, mode = 'any', children }) => {
  const { can, isPlatformOwner } = useRoleAccess()
  const user = useAuthStore(s => s.user)

  if (!user) return <Navigate to="/login" replace />

  const list = Array.isArray(perm) ? perm : [perm]
  const allowed = mode === 'all' ? list.every(can) : list.some(can)

  if (!allowed) {
    return <Navigate to={isPlatformOwner ? '/platform' : '/'} replace />
  }
  return <>{children}</>
}
