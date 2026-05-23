// src/lib/permissions.ts
//
// Permission resolution mirroring public.has_permission() in SQL.
// Loaded once at login / app initialise and cached in module scope, so each
// can()/<Can/> call is a Set lookup, not a DB round-trip.
//
// Source of truth:
//   • role_permissions(role, permission)   — seeded role defaults
//   • users.permissions text[]             — per-user overrides:
//       "+permission" => grant
//       "-permission" => revoke (wins over both default and grant)
//
// IMPORTANT: this never bypasses RLS. Even if the cache is wrong/stale, the
// database still enforces row-level security via the same has_permission()
// helper. UI gating is convenience, not the security boundary.

import { supabase } from './supabase'
import type { Permission, Role, User } from '../types'

interface CacheState {
  roleDefaults: Map<Role, Set<string>>
  loaded: boolean
}

const cache: CacheState = {
  roleDefaults: new Map(),
  loaded: false,
}

let inFlight: Promise<void> | null = null

/**
 * Load role defaults from `role_permissions`. Idempotent and de-duplicated:
 * concurrent callers share the same in-flight request, and a successful load
 * marks the cache so subsequent calls are no-ops.
 */
export async function loadRolePermissions(): Promise<void> {
  if (cache.loaded) return
  if (inFlight) return inFlight

  inFlight = (async () => {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role, permission')

    if (error) {
      // Don't poison the cache; let the next call retry.
      inFlight = null
      throw new Error(`Could not load role_permissions: ${error.message}`)
    }

    const grouped = new Map<Role, Set<string>>()
    for (const row of (data ?? []) as Array<{ role: Role; permission: string }>) {
      let set = grouped.get(row.role)
      if (!set) {
        set = new Set<string>()
        grouped.set(row.role, set)
      }
      set.add(row.permission)
    }

    cache.roleDefaults = grouped
    cache.loaded = true
    inFlight = null
  })()

  return inFlight
}

/**
 * Reset the cache. Call after login (so a fresh user picks up fresh role
 * defaults) and on logout. Cheap because the next loadRolePermissions()
 * pulls only ~50 rows.
 */
export function resetPermissionCache(): void {
  cache.roleDefaults = new Map()
  cache.loaded = false
  inFlight = null
}

/**
 * Resolve whether a user has a permission, applying overrides.
 * Mirrors the SQL has_permission() function exactly.
 */
export function hasPermission(user: User | null, perm: Permission | string): boolean {
  if (!user) return false

  // Explicit revoke wins over everything — including role default and grant.
  if (user.permissions?.includes(`-${perm}`)) return false
  // Explicit grant.
  if (user.permissions?.includes(`+${perm}`)) return true
  // Fall back to role default. If the cache hasn't loaded yet, deny — better
  // to flicker a hidden tab for a frame than to flash a forbidden one.
  return cache.roleDefaults.get(user.role)?.has(perm) ?? false
}

/**
 * Returns the set of permissions for a given role. Used by Employees UI when
 * displaying what a role can do.
 */
export function getRoleDefaults(role: Role): ReadonlySet<string> {
  return cache.roleDefaults.get(role) ?? new Set()
}

/**
 * Lightweight readiness flag — useful for UI that wants to avoid rendering
 * gated nav items until permissions are loaded. Most callers can ignore it
 * and rely on hasPermission() returning false until ready.
 */
export function isPermissionCacheReady(): boolean {
  return cache.loaded
}
