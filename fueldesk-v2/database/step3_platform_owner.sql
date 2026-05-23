-- ============================================================
-- Step 3 — Platform Owner module
-- ============================================================
--   • RPC create_pump_with_super_admin: atomic pump + super_admin auth + profile
--   • RPC seed_pump_defaults: idempotent default fuel types, machines, settings
--   • RPC platform_global_stats: cross-pump rollup for the platform dashboard
--   • View v_pump_health: per-pump health metrics for PumpDetail
--   • RPC platform_suspend_pump / platform_restore_pump / platform_delete_pump
--   • Enforce: a pump cannot be soft-deleted while it still has active users
--
-- Safe to run on top of fresh_setup.sql + step1_rbac_and_business.sql.
-- Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────
-- 1. Make `pumps` soft-deletable
-- ────────────────────────────────────────────
ALTER TABLE public.pumps
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pumps_active
  ON public.pumps(is_active)
  WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────
-- 2. seed_pump_defaults(p_pump_id) — idempotent
--    Called automatically inside create_pump_with_super_admin and also
--    safely re-runnable from PumpDetail.tsx if the platform owner wants a
--    fresh defaults set.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_pump_defaults(p_pump_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_petrol_id UUID;
  v_diesel_id UUID;
  v_machine1_id UUID;
  v_machine2_id UUID;
BEGIN
  -- Default fuel types: MS (Petrol), HSD (Diesel)
  INSERT INTO public.fuel_types (pump_id, name, code, unit)
  VALUES (p_pump_id, 'Petrol', 'MS', 'LITRE')
  ON CONFLICT (pump_id, code) DO NOTHING
  RETURNING id INTO v_petrol_id;

  IF v_petrol_id IS NULL THEN
    SELECT id INTO v_petrol_id FROM public.fuel_types WHERE pump_id = p_pump_id AND code = 'MS';
  END IF;

  INSERT INTO public.fuel_types (pump_id, name, code, unit)
  VALUES (p_pump_id, 'Diesel', 'HSD', 'LITRE')
  ON CONFLICT (pump_id, code) DO NOTHING
  RETURNING id INTO v_diesel_id;

  IF v_diesel_id IS NULL THEN
    SELECT id INTO v_diesel_id FROM public.fuel_types WHERE pump_id = p_pump_id AND code = 'HSD';
  END IF;

  -- Default machines + 2 nozzles each (matches the legacy hard-coded 8 layout
  -- enough for a typical small pump; super admin can edit later).
  INSERT INTO public.machines (pump_id, name, code, display_order)
  VALUES (p_pump_id, 'Dispenser 1', 'M1', 1)
  ON CONFLICT (pump_id, code) DO NOTHING
  RETURNING id INTO v_machine1_id;

  IF v_machine1_id IS NULL THEN
    SELECT id INTO v_machine1_id FROM public.machines WHERE pump_id = p_pump_id AND code = 'M1';
  END IF;

  INSERT INTO public.machines (pump_id, name, code, display_order)
  VALUES (p_pump_id, 'Dispenser 2', 'M2', 2)
  ON CONFLICT (pump_id, code) DO NOTHING
  RETURNING id INTO v_machine2_id;

  IF v_machine2_id IS NULL THEN
    SELECT id INTO v_machine2_id FROM public.machines WHERE pump_id = p_pump_id AND code = 'M2';
  END IF;

  -- Default nozzles
  INSERT INTO public.nozzles (pump_id, machine_id, fuel_type_id, code, display_order)
  VALUES
    (p_pump_id, v_machine1_id, v_petrol_id, 'N1', 1),
    (p_pump_id, v_machine1_id, v_diesel_id, 'N2', 2),
    (p_pump_id, v_machine2_id, v_petrol_id, 'N1', 1),
    (p_pump_id, v_machine2_id, v_diesel_id, 'N2', 2)
  ON CONFLICT (machine_id, code) DO NOTHING;

  -- Baseline pump settings (key/value)
  INSERT INTO public.system_settings (pump_id, key, value)
  VALUES
    (p_pump_id, 'casual_leaves_annual', '12'),
    (p_pump_id, 'sick_leaves_annual',   '10'),
    (p_pump_id, 'earned_leaves_annual', '15'),
    (p_pump_id, 'late_grace_minutes',   '15'),
    (p_pump_id, 'overtime_rate',        '1.5'),
    (p_pump_id, 'morning_shift_start',  '06:00'),
    (p_pump_id, 'morning_shift_end',    '14:00'),
    (p_pump_id, 'evening_shift_start',  '14:00'),
    (p_pump_id, 'evening_shift_end',    '22:00'),
    (p_pump_id, 'night_shift_start',    '22:00'),
    (p_pump_id, 'night_shift_end',      '06:00')
  ON CONFLICT (pump_id, key) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_pump_defaults(UUID) TO authenticated;

-- ────────────────────────────────────────────
-- 3. create_pump_with_super_admin — single atomic transaction
--
--    Inputs:
--      • Pump details
--      • Super admin email (must already exist in auth.users — caller is
--        responsible for creating the auth user via the client SDK first,
--        because we cannot insert into auth.users via SQL without admin keys)
--
--    What it does:
--      1) Insert pumps row
--      2) Insert public.users row for the super admin, linked to the pump
--      3) Seed default fuel_types, machines, nozzles, settings
--    All in one transaction. If anything fails, nothing persists.
--
--    Returns the new pump_id.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pump_with_super_admin(
  -- pump
  p_name              TEXT,
  p_address           TEXT,
  p_city              TEXT,
  p_state             TEXT,
  p_subscription_plan TEXT,
  p_monthly_fee       NUMERIC,
  -- super admin (auth.users row already created by client)
  p_owner_auth_id     UUID,
  p_owner_email       TEXT,
  p_owner_first_name  TEXT,
  p_owner_last_name   TEXT,
  p_owner_phone       TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pump_id UUID;
  v_caller_role TEXT;
BEGIN
  -- Only PLATFORM_OWNER may invoke this.
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role <> 'PLATFORM_OWNER' THEN
    RAISE EXCEPTION 'Only platform owner may create pumps' USING ERRCODE = '42501';
  END IF;

  -- Validate inputs
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Pump name is required';
  END IF;
  IF p_owner_auth_id IS NULL THEN
    RAISE EXCEPTION 'Owner auth_id is required (create the auth user first)';
  END IF;
  IF p_owner_email IS NULL OR length(trim(p_owner_email)) = 0 THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;

  -- Confirm the auth user actually exists.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_auth_id) THEN
    RAISE EXCEPTION 'auth.users row % not found', p_owner_auth_id;
  END IF;

  -- 1. Insert pump
  INSERT INTO public.pumps (
    name, address, city, state,
    subscription_plan, monthly_fee, subscription_status, is_active
  )
  VALUES (
    trim(p_name), p_address, p_city, p_state,
    COALESCE(p_subscription_plan, 'BASIC'),
    COALESCE(p_monthly_fee, 0),
    'ACTIVE',
    TRUE
  )
  RETURNING id INTO v_pump_id;

  -- 2. Upsert super admin profile linked to this pump.
  --    Uses ON CONFLICT (id) so re-creation after a partial failure is safe.
  INSERT INTO public.users (
    id, pump_id, email, first_name, last_name, phone,
    role, is_active, is_blocked
  )
  VALUES (
    p_owner_auth_id,
    v_pump_id,
    lower(trim(p_owner_email)),
    COALESCE(NULLIF(trim(p_owner_first_name), ''), split_part(p_owner_email, '@', 1)),
    COALESCE(p_owner_last_name, ''),
    p_owner_phone,
    'SUPER_ADMIN',
    TRUE,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE
    SET pump_id    = EXCLUDED.pump_id,
        role       = 'SUPER_ADMIN',
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        phone      = EXCLUDED.phone,
        is_active  = TRUE,
        is_blocked = FALSE,
        deleted_at = NULL;

  -- 3. Seed defaults
  PERFORM public.seed_pump_defaults(v_pump_id);

  RETURN v_pump_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pump_with_super_admin(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ────────────────────────────────────────────
-- 4. platform_global_stats — single round-trip dashboard rollup
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_global_stats()
RETURNS TABLE (
  total_pumps      INT,
  active_pumps     INT,
  trial_pumps      INT,
  suspended_pumps  INT,
  cancelled_pumps  INT,
  expired_pumps    INT,
  mrr              NUMERIC,
  total_users      INT
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::INT                                                                 AS total_pumps,
    COUNT(*) FILTER (WHERE subscription_status = 'ACTIVE')::INT                   AS active_pumps,
    COUNT(*) FILTER (WHERE subscription_status = 'TRIAL')::INT                    AS trial_pumps,
    COUNT(*) FILTER (WHERE subscription_status = 'SUSPENDED')::INT                AS suspended_pumps,
    COUNT(*) FILTER (WHERE subscription_status = 'CANCELLED')::INT                AS cancelled_pumps,
    COUNT(*) FILTER (WHERE subscription_status = 'EXPIRED')::INT                  AS expired_pumps,
    COALESCE(SUM(monthly_fee) FILTER (WHERE subscription_status = 'ACTIVE'), 0)   AS mrr,
    (SELECT COUNT(*)::INT FROM public.users
       WHERE deleted_at IS NULL AND is_active AND role <> 'PLATFORM_OWNER')       AS total_users
  FROM public.pumps
  WHERE deleted_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.platform_global_stats() TO authenticated;

-- ────────────────────────────────────────────
-- 5. v_pump_health — per-pump dashboard for PumpDetail
-- ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_pump_health AS
SELECT
  p.id                                                                AS pump_id,
  p.name,
  p.subscription_status,
  p.is_active,
  p.deleted_at,
  -- Active users (non-deleted, non-blocked)
  (SELECT COUNT(*) FROM public.users u
     WHERE u.pump_id = p.id
       AND u.deleted_at IS NULL
       AND u.is_active
       AND COALESCE(u.is_blocked, FALSE) = FALSE)                     AS active_users,
  (SELECT COUNT(*) FROM public.users u
     WHERE u.pump_id = p.id
       AND u.deleted_at IS NULL
       AND COALESCE(u.is_blocked, FALSE) = TRUE)                      AS blocked_users,
  -- Last 7 days revenue/profit derived from v_readings_priced
  (SELECT COALESCE(SUM(revenue), 0) FROM public.v_readings_priced
     WHERE pump_id = p.id
       AND reading_date >= CURRENT_DATE - INTERVAL '7 days')          AS revenue_7d,
  (SELECT COALESCE(SUM(profit), 0) FROM public.v_readings_priced
     WHERE pump_id = p.id
       AND reading_date >= CURRENT_DATE - INTERVAL '7 days')          AS profit_7d,
  -- Last subscription payment
  (SELECT MAX(paid_at) FROM public.subscription_payments
     WHERE pump_id = p.id AND status = 'RECEIVED')                    AS last_payment_at,
  -- Outstanding credit across all customers
  (SELECT COALESCE(SUM(outstanding_balance), 0)
     FROM public.credit_accounts WHERE pump_id = p.id AND is_active)  AS outstanding_credit
FROM public.pumps p;

COMMENT ON VIEW public.v_pump_health IS
  'Per-pump health rollup for the platform owner UI. Read-only.';

-- ────────────────────────────────────────────
-- 6. Pump lifecycle RPCs — uniform interface, audit-friendly,
--    enforced platform-owner gate.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_suspend_pump(p_pump_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role <> 'PLATFORM_OWNER' THEN
    RAISE EXCEPTION 'Only platform owner may suspend pumps' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pumps
  SET subscription_status = 'SUSPENDED',
      is_active = FALSE,
      updated_at = NOW()
  WHERE id = p_pump_id AND deleted_at IS NULL;

  -- Audit row (best-effort; matches lib/audit.ts schema)
  INSERT INTO public.audit_log (pump_id, actor_id, action, entity_type, entity_id, after_state)
  VALUES (p_pump_id, auth.uid(), 'pump.suspend', 'pumps', p_pump_id,
          jsonb_build_object('subscription_status','SUSPENDED','is_active', false,'reason', p_reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_suspend_pump(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_restore_pump(p_pump_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role <> 'PLATFORM_OWNER' THEN
    RAISE EXCEPTION 'Only platform owner may restore pumps' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pumps
  SET subscription_status = 'ACTIVE',
      is_active = TRUE,
      deleted_at = NULL,
      updated_at = NOW()
  WHERE id = p_pump_id;

  INSERT INTO public.audit_log (pump_id, actor_id, action, entity_type, entity_id, after_state)
  VALUES (p_pump_id, auth.uid(), 'pump.update', 'pumps', p_pump_id,
          jsonb_build_object('subscription_status','ACTIVE','is_active', true,'restored', true));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_restore_pump(UUID) TO authenticated;

-- Soft-delete the pump. Does NOT delete child rows (preserves audit + history).
-- Refuses if any non-platform user is still active under this pump — the
-- platform owner is expected to off-board users first.
CREATE OR REPLACE FUNCTION public.platform_delete_pump(p_pump_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_active_users INT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role <> 'PLATFORM_OWNER' THEN
    RAISE EXCEPTION 'Only platform owner may delete pumps' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_active_users
  FROM public.users
  WHERE pump_id = p_pump_id
    AND deleted_at IS NULL
    AND is_active;

  IF v_active_users > 0 AND NOT p_force THEN
    RAISE EXCEPTION
      'Pump still has % active user(s). Block/remove them first, or call with p_force = TRUE.',
      v_active_users
      USING ERRCODE = 'P0001';
  END IF;

  -- Soft-delete: keeps history queryable. Child tables continue to exist
  -- but the same-pump RLS policy will still admit access for the platform
  -- owner (current_user_role() = 'PLATFORM_OWNER'), so reporting still works.
  UPDATE public.pumps
  SET deleted_at = NOW(),
      is_active = FALSE,
      subscription_status = 'CANCELLED',
      updated_at = NOW()
  WHERE id = p_pump_id;

  -- Cascade: soft-delete every user attached to the pump.
  IF p_force THEN
    UPDATE public.users
    SET deleted_at = NOW(), is_active = FALSE
    WHERE pump_id = p_pump_id AND deleted_at IS NULL;
  END IF;

  INSERT INTO public.audit_log (pump_id, actor_id, action, entity_type, entity_id, after_state)
  VALUES (p_pump_id, auth.uid(), 'pump.delete', 'pumps', p_pump_id,
          jsonb_build_object('deleted_at', NOW(), 'force', p_force));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_delete_pump(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- ────────────────────────────────────────────
-- Smoke test:
--   SELECT * FROM public.platform_global_stats();
--   SELECT * FROM public.v_pump_health LIMIT 5;
-- ────────────────────────────────────────────
