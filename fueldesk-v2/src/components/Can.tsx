// src/components/Can.tsx
//
// Declarative permission gate.
//
//   <Can perm="users.create">
//     <button>Add Employee</button>
//   </Can>
//
//   <Can perm={['users.update','users.block']} mode="any">
//     <ActionMenu />
//   </Can>
//
//   <Can perm="settings.update" fallback={<ReadOnlyView />}>
//     <SettingsForm />
//   </Can>
//
// Notes:
//   • Mirrors the SQL has_permission() check; UI gating only — RLS still
//     enforces server side.
//   • mode='any' (default) returns true if at least one perm matches;
//     mode='all' requires every perm.

import React from 'react'
import { useRoleAccess } from '../hooks/useRoleAccess'
import type { Permission } from '../types'

type PermInput = Permission | string | Array<Permission | string>

interface CanProps {
  perm: PermInput
  mode?: 'any' | 'all'
  fallback?: React.ReactNode
  children: React.ReactNode
}

export const Can: React.FC<CanProps> = ({ perm, mode = 'any', fallback = null, children }) => {
  const { can } = useRoleAccess()
  const list = Array.isArray(perm) ? perm : [perm]
  const allowed = mode === 'all' ? list.every(can) : list.some(can)
  return <>{allowed ? children : fallback}</>
}
