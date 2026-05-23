// src/lib/audit.ts
//
// Thin wrapper around `public.audit_log` for role-sensitive mutations.
// Best-effort: never throws — a failed audit must not break the user-facing
// action it's auditing. The DB has its own RLS-backed insert policy.
//
// Usage:
//   import { logAudit } from '../lib/audit'
//
//   await supabase.from('users').update({ is_blocked: true }).eq('id', empId)
//   await logAudit({
//     action: 'users.block',
//     entity_type: 'users',
//     entity_id: empId,
//     before: { is_blocked: false },
//     after:  { is_blocked: true },
//   })

import { supabase } from './supabase'

export type AuditAction =
  | 'pump.create' | 'pump.suspend' | 'pump.delete' | 'pump.update'
  | 'users.create' | 'users.update' | 'users.block' | 'users.delete' | 'users.unblock'
  | 'fuel_type.create' | 'fuel_type.update' | 'fuel_type.delete'
  | 'fuel_price.update'
  | 'fuel_purchase.create'
  | 'salary.structure.set' | 'salary.advance.grant' | 'salary.incentive.grant'
  | 'salary.payout.generate'
  | 'leaves.approve' | 'leaves.reject'
  | 'credit.txn_approve'
  | 'settings.update'

interface AuditPayload {
  action: AuditAction | string
  entity_type?: string
  entity_id?: string | null
  before?: unknown
  after?: unknown
  // Optional pump_id override; defaults to the caller's pump_id from the
  // current user. Set explicitly for platform-level actions where the
  // caller has no pump_id (e.g. PLATFORM_OWNER suspending a pump).
  pump_id?: string | null
}

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const actorId = authUser?.id ?? null

    // Resolve pump_id: explicit override → caller's profile → null.
    let pumpId = payload.pump_id ?? null
    if (pumpId === null && actorId) {
      const { data: profile } = await supabase
        .from('users')
        .select('pump_id')
        .eq('id', actorId)
        .maybeSingle()
      pumpId = profile?.pump_id ?? null
    }

    const userAgent =
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null

    const { error } = await supabase.from('audit_log').insert({
      pump_id: pumpId,
      actor_id: actorId,
      action: payload.action,
      entity_type: payload.entity_type ?? null,
      entity_id: payload.entity_id ?? null,
      before_state: payload.before ?? null,
      after_state: payload.after ?? null,
      user_agent: userAgent,
    })

    if (error) {
      // Best-effort: surface in the console but do NOT throw. The user-facing
      // mutation already succeeded; an audit-log failure is observability,
      // not correctness.
      console.warn('[audit] insert failed:', error.message, payload.action)
    }
  } catch (err) {
    console.warn('[audit] threw (suppressed):', err)
  }
}
