-- ============================================================
-- Step 5 — Sale entry, payslip↔advance wiring, day-close hardening
-- ============================================================
--   • Partial unique index on nozzle_readings(pump_id, nozzle_id, reading_date)
--     so the catalog flow ((pump,nozzle_id,date)) can be upserted safely
--     while the legacy flow keeps its own (pump,nozzle_number,date) index.
--   • mark_advances_deducted(pump,user,month,year) — flips matching PENDING
--     advance rows to DEDUCTED. Idempotent. Returns the count flipped.
--   • cancel_advance(advance_id, reason) — flips a PENDING row to CANCELLED.
--     Refuses if already DEDUCTED so you can't retroactively undo a paid-out
--     advance from the UI. Audit-logged.
--   • day_close_locked(pump, date) helper for client-side guard parity.
--
-- Safe to run on top of step1 + step3. Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────
-- 1. Catalog-friendly unique index for nozzle_readings.
--    Existing fresh_setup.sql defines UNIQUE(pump_id, nozzle_number, reading_date)
--    which keeps the legacy 8-nozzle path working. The catalog path needs its
--    own (pump_id, nozzle_id, reading_date) uniqueness so upserts via
--    onConflict='pump_id,nozzle_id,reading_date' are deterministic.
--    Partial = only enforce when nozzle_id is set, so legacy rows (nozzle_id=null)
--    don't conflict.
-- ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_nozzle_readings_pump_nozzle_date
  ON public.nozzle_readings (pump_id, nozzle_id, reading_date)
  WHERE nozzle_id IS NOT NULL;

-- ────────────────────────────────────────────
-- 2. mark_advances_deducted — called by payslip generation.
--
--    Why a function and not a plain UPDATE from the client?
--      a) RLS-safe — runs as definer so the engine can flip rows even if the
--         caller (an accountant generating payslips) has narrower row-level
--         visibility on salary_advances later.
--      b) Atomic — one round-trip, returns the count.
--      c) Defence in depth — the caller is verified to be a member of the
--         pump (or platform owner). Anyone else gets 42501.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_advances_deducted(
  p_pump_id UUID,
  p_user_id UUID,
  p_month   INT,
  p_year    INT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_pump UUID;
  v_count INT;
BEGIN
  SELECT role, pump_id INTO v_caller_role, v_caller_pump
  FROM public.users WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_caller_role <> 'PLATFORM_OWNER' AND v_caller_pump <> p_pump_id THEN
    RAISE EXCEPTION 'Cross-pump advance flip blocked' USING ERRCODE = '42501';
  END IF;

  UPDATE public.salary_advances
  SET status = 'DEDUCTED'
  WHERE pump_id = p_pump_id
    AND user_id = p_user_id
    AND for_month = p_month
    AND for_year  = p_year
    AND status = 'PENDING';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_advances_deducted(UUID, UUID, INT, INT) TO authenticated;

-- ────────────────────────────────────────────
-- 3. cancel_advance — explicit cancel UI path.
--    Refuses to cancel a DEDUCTED advance because that would make the
--    historical payslip drift from the live summary.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_advance(
  p_advance_id UUID,
  p_reason     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_pump UUID;
  v_advance     RECORD;
BEGIN
  SELECT role, pump_id INTO v_caller_role, v_caller_pump
  FROM public.users WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_advance FROM public.salary_advances WHERE id = p_advance_id;
  IF v_advance IS NULL THEN
    RAISE EXCEPTION 'Advance not found';
  END IF;

  IF v_caller_role <> 'PLATFORM_OWNER' AND v_caller_pump <> v_advance.pump_id THEN
    RAISE EXCEPTION 'Cross-pump cancel blocked' USING ERRCODE = '42501';
  END IF;

  IF v_advance.status = 'CANCELLED' THEN
    RETURN; -- idempotent
  END IF;
  IF v_advance.status = 'DEDUCTED' THEN
    RAISE EXCEPTION
      'Advance already deducted on a payslip; cancel by recording a reverse incentive instead'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.salary_advances
  SET status = 'CANCELLED',
      notes = COALESCE(notes || E'\n', '') || 'Cancelled: ' || COALESCE(p_reason, '(no reason)')
  WHERE id = p_advance_id;

  -- Audit (best-effort).
  INSERT INTO public.audit_log (pump_id, actor_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (
    v_advance.pump_id, auth.uid(), 'salary.advance.cancel', 'salary_advances', p_advance_id,
    jsonb_build_object('status', v_advance.status, 'amount', v_advance.amount),
    jsonb_build_object('status', 'CANCELLED', 'reason', p_reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_advance(UUID, TEXT) TO authenticated;

-- ────────────────────────────────────────────
-- 4. day_close_locked — small helper used by the client to gate
--    "save readings" attempts in lockstep with the database. It's only a
--    convenience: RLS still owns the source-of-truth check.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.day_close_locked(p_pump_id UUID, p_date DATE)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_locked FROM public.daily_sales
       WHERE pump_id = p_pump_id AND sale_date = p_date),
    FALSE
  )
$$;

GRANT EXECUTE ON FUNCTION public.day_close_locked(UUID, DATE) TO authenticated;

COMMIT;

-- Smoke test:
--   SELECT public.mark_advances_deducted(<pump>, <user>, 5, 2026);
--   SELECT public.day_close_locked(<pump>, current_date);
