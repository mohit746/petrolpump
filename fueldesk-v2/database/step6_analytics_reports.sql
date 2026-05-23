-- ============================================================
-- Step 6 — Analytics + Reports
-- ============================================================
--   • tenant_analytics_daily — per-day revenue/cogs/profit/litres + cash/online/credit
--     for a (pump, from_date, to_date) range. Driven by v_readings_priced and
--     daily_sales — runtime priced, never stores final amounts.
--   • tenant_top_employees — top N employees by completed lorry duties + incentive
--     totals for the same range.
--   • tenant_fuel_mix — total litres + revenue per fuel type for the range.
--   • tenant_credit_aging — outstanding credit bucketed by age for credit_accounts
--     that have a positive outstanding_balance.
--
-- All four are SECURITY DEFINER with a same-pump gate.
-- Safe to run on top of step1+step3+step5. Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────
-- Helper: enforce same-pump (or platform owner) caller scope.
-- We INLINE this rather than wrap it because PL/pgSQL functions can't
-- raise `42501` from the SQL function definitions below; the wrappers
-- declared in plpgsql do.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_same_pump(p_pump_id UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_pump UUID;
BEGIN
  SELECT role, pump_id INTO v_role, v_pump
  FROM public.users WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'PLATFORM_OWNER' AND v_pump <> p_pump_id THEN
    RAISE EXCEPTION 'Cross-pump report blocked' USING ERRCODE = '42501';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public._assert_same_pump(UUID) TO authenticated;

-- ────────────────────────────────────────────
-- 1. Daily trend — every day in [from, to], one row even if no activity.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_analytics_daily(
  p_pump_id    UUID,
  p_from_date  DATE,
  p_to_date    DATE
)
RETURNS TABLE (
  on_date         DATE,
  total_litres    NUMERIC,
  total_revenue   NUMERIC,
  total_cogs      NUMERIC,
  total_profit    NUMERIC,
  cash_total      NUMERIC,
  online_total    NUMERIC,
  credit_total    NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_same_pump(p_pump_id);
  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'to_date must be >= from_date';
  END IF;
  IF p_to_date - p_from_date > 366 THEN
    RAISE EXCEPTION 'Range cannot exceed 366 days';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_from_date, p_to_date, INTERVAL '1 day')::DATE AS d
  ),
  rev AS (
    SELECT reading_date AS d,
           COALESCE(SUM(litres_sold), 0) AS l,
           COALESCE(SUM(revenue),     0) AS r,
           COALESCE(SUM(cogs),        0) AS c,
           COALESCE(SUM(profit),      0) AS p
    FROM public.v_readings_priced
    WHERE pump_id = p_pump_id
      AND reading_date BETWEEN p_from_date AND p_to_date
    GROUP BY reading_date
  ),
  ds AS (
    SELECT sale_date AS d,
           COALESCE(cash_collected,   0) AS cash,
           COALESCE(online_collected, 0) AS online,
           COALESCE(credit_given,     0) AS credit
    FROM public.daily_sales
    WHERE pump_id = p_pump_id
      AND sale_date BETWEEN p_from_date AND p_to_date
  )
  SELECT days.d                            AS on_date,
         COALESCE(rev.l, 0)                AS total_litres,
         COALESCE(rev.r, 0)                AS total_revenue,
         COALESCE(rev.c, 0)                AS total_cogs,
         COALESCE(rev.p, 0)                AS total_profit,
         COALESCE(ds.cash, 0)              AS cash_total,
         COALESCE(ds.online, 0)            AS online_total,
         COALESCE(ds.credit, 0)            AS credit_total
  FROM days
  LEFT JOIN rev ON rev.d = days.d
  LEFT JOIN ds  ON ds.d  = days.d
  ORDER BY days.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_analytics_daily(UUID, DATE, DATE) TO authenticated;

-- ────────────────────────────────────────────
-- 2. Top employees by lorry duties completed + incentives earned.
--    "Top" sorts by (completed_duties + incentive_total/100) so a duty is
--    weighted at ~₹100 of incentive — adjust to taste.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_top_employees(
  p_pump_id    UUID,
  p_from_date  DATE,
  p_to_date    DATE,
  p_limit      INT DEFAULT 10
)
RETURNS TABLE (
  user_id            UUID,
  first_name         TEXT,
  last_name          TEXT,
  role               TEXT,
  completed_duties   INT,
  incentive_total    NUMERIC,
  rank_score         NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_same_pump(p_pump_id);

  RETURN QUERY
  WITH duties AS (
    SELECT user_id, COUNT(*)::INT AS n
    FROM public.lorry_duties
    WHERE pump_id = p_pump_id
      AND status = 'COMPLETED'
      AND duty_date BETWEEN p_from_date AND p_to_date
    GROUP BY user_id
  ),
  inc AS (
    SELECT user_id, COALESCE(SUM(amount), 0)::NUMERIC AS s
    FROM public.incentives
    WHERE pump_id = p_pump_id
      AND awarded_at >= p_from_date
      AND awarded_at <  p_to_date + INTERVAL '1 day'
    GROUP BY user_id
  )
  SELECT u.id,
         u.first_name,
         u.last_name,
         u.role,
         COALESCE(duties.n, 0)                                            AS completed_duties,
         COALESCE(inc.s, 0)                                               AS incentive_total,
         (COALESCE(duties.n, 0) + COALESCE(inc.s, 0) / 100)::NUMERIC      AS rank_score
  FROM public.users u
  LEFT JOIN duties ON duties.user_id = u.id
  LEFT JOIN inc    ON inc.user_id    = u.id
  WHERE u.pump_id = p_pump_id
    AND u.deleted_at IS NULL
    AND u.role <> 'PLATFORM_OWNER'
    -- Drop completely-inactive employees from "top" lists.
    AND (COALESCE(duties.n, 0) > 0 OR COALESCE(inc.s, 0) > 0)
  ORDER BY rank_score DESC, u.first_name
  LIMIT GREATEST(1, p_limit);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_top_employees(UUID, DATE, DATE, INT) TO authenticated;

-- ────────────────────────────────────────────
-- 3. Fuel mix — litres + revenue per fuel code for the range.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_fuel_mix(
  p_pump_id    UUID,
  p_from_date  DATE,
  p_to_date    DATE
)
RETURNS TABLE (
  fuel_code      TEXT,
  total_litres   NUMERIC,
  total_revenue  NUMERIC,
  total_profit   NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_same_pump(p_pump_id);

  RETURN QUERY
  SELECT
    fuel_type                                          AS fuel_code,
    COALESCE(SUM(litres_sold), 0)::NUMERIC             AS total_litres,
    COALESCE(SUM(revenue),     0)::NUMERIC             AS total_revenue,
    COALESCE(SUM(profit),      0)::NUMERIC             AS total_profit
  FROM public.v_readings_priced
  WHERE pump_id = p_pump_id
    AND reading_date BETWEEN p_from_date AND p_to_date
  GROUP BY fuel_type
  HAVING COALESCE(SUM(litres_sold), 0) > 0
  ORDER BY total_revenue DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_fuel_mix(UUID, DATE, DATE) TO authenticated;

-- ────────────────────────────────────────────
-- 4. Credit aging — outstanding balance bucketed by age.
--    Age is determined by the most recent CREDIT (debit-type) transaction
--    that hasn't been fully offset; we approximate with the account's
--    most recent CREDIT timestamp because we don't track per-line age.
--    Buckets: 0-30, 31-60, 61-90, 90+ days.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_credit_aging(p_pump_id UUID)
RETURNS TABLE (
  bucket          TEXT,
  account_count   INT,
  outstanding     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_same_pump(p_pump_id);

  RETURN QUERY
  WITH last_credit AS (
    SELECT
      ca.id,
      ca.outstanding_balance,
      COALESCE(
        (SELECT MAX(ct.transaction_date) FROM public.credit_transactions ct
           WHERE ct.account_id = ca.id AND ct.type = 'CREDIT'),
        ca.created_at
      ) AS last_event
    FROM public.credit_accounts ca
    WHERE ca.pump_id = p_pump_id
      AND ca.is_active
      AND ca.outstanding_balance > 0
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN NOW() - last_event <= INTERVAL '30 days'  THEN '0–30 days'
        WHEN NOW() - last_event <= INTERVAL '60 days'  THEN '31–60 days'
        WHEN NOW() - last_event <= INTERVAL '90 days'  THEN '61–90 days'
        ELSE '90+ days'
      END AS bucket,
      outstanding_balance
    FROM last_credit
  )
  SELECT bucket,
         COUNT(*)::INT                                              AS account_count,
         COALESCE(SUM(outstanding_balance), 0)::NUMERIC             AS outstanding
  FROM bucketed
  GROUP BY bucket
  ORDER BY
    CASE bucket
      WHEN '0–30 days'  THEN 1
      WHEN '31–60 days' THEN 2
      WHEN '61–90 days' THEN 3
      ELSE 4
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_credit_aging(UUID) TO authenticated;

COMMIT;

-- Smoke test:
--   SELECT * FROM public.tenant_analytics_daily('<pump>', current_date - 6, current_date);
--   SELECT * FROM public.tenant_top_employees   ('<pump>', current_date - 30, current_date, 5);
--   SELECT * FROM public.tenant_fuel_mix        ('<pump>', current_date - 30, current_date);
--   SELECT * FROM public.tenant_credit_aging    ('<pump>');
