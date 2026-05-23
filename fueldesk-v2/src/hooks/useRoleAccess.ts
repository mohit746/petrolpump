// src/hooks/useRoleAccess.ts
//
// Single hook that exposes both:
//   • role booleans (isPlatformOwner, isSuperAdmin, …, isManagement) —
//     unchanged API; existing pages keep working without edits.
//   • can(perm) — permission lookup powered by lib/permissions.ts cache,
//     mirroring public.has_permission() in SQL.
//
// hasPermission() is pure (depends only on user.permissions + module-level
// cache) so React doesn't need a re-render to pick up the result. We do still
// need re-renders when the user changes; relying on useAuthStore subscription
// gives us that for free.

import useAuthStore from '../stores/useAuthStore'
import { hasPermission } from '../lib/permissions'
import type { Permission, Role } from '../types'

export function useRoleAccess() {
  const user = useAuthStore(s => s.user)
  const role = user?.role as Role | undefined

  // Permission check. Accepts the typed Permission union for autocomplete and
  // raw strings for forwards-compatibility (e.g. when admins add new perms
  // through future UI before the type union is regenerated).
  const can = (permission: Permission | string): boolean =>
    hasPermission(user, permission)

  return {
    can,
    role,
    isPlatformOwner: role === 'PLATFORM_OWNER',
    isSuperAdmin:    role === 'SUPER_ADMIN',
    isAdmin:         role === 'ADMIN',
    isAccountant:    role === 'ACCOUNTANT',
    isEmployee:      role === 'EMPLOYEE',
    isManagement:    role === 'SUPER_ADMIN' || role === 'ADMIN',
  }
}
