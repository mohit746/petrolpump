-- ============================================================
-- Step 1 — Schema additions for RBAC + business modules
-- ============================================================
-- Adds, but does not drop:
--   • permission overrides on users + has_permission() helper
--   • fuel_types, fuel_prices, fuel_purchases
--   • machines, nozzles
--   • sales (no stored amounts — runtime priced)
--   • salary_structures, salary_advances (incentives + payslips already exist)
--   • audit_log
--   • RPCs: has_permission, get_fuel_price_at, compute_sale_amount, day_profit
--   • view: v_sales_with_amounts (sale joined with effective price + profit)
--   • RLS for everything new (same-pump pattern)
--
-- Safe to run on top of fresh_setup.sql. Idempotent where reasonable.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────
-- 1. Permission overrides on users
-- ────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.users.permissions IS
  'Per-user permission overrides. Values prefixed +perm grant, -perm revoke.
   Empty array = pure role default. See public.has_permission().';

-- ────────────────────────────────────────────
-- 2. Role → default permissions (data, not code, so it can be tuned via UI)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role        TEXT NOT NULL CHECK (role IN ('PLATFORM_OWNER','SUPER_ADMIN','ADMIN','ACCOUNTANT','EMPLOYEE')),
  permission  TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_read ON public.role_permissions;
CREATE POLICY role_permissions_read ON public.role_permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Seed defaults (idempotent)
INSERT INTO public.role_permissions (role, permission) VALUES
  -- Platform owner
  ('PLATFORM_OWNER','pump.create'),
  ('PLATFORM_OWNER','pump.list_all'),
  ('PLATFORM_OWNER','pump.update'),
  ('PLATFORM_OWNER','pump.suspend'),
  ('PLATFORM_OWNER','pump.delete'),
  ('PLATFORM_OWNER','pump.impersonate'),
  ('PLATFORM_OWNER','pump.global_analytics'),
  ('PLATFORM_OWNER','users.create_super_admin'),
  ('PLATFORM_OWNER','users.create'),
  ('PLATFORM_OWNER','users.list'),
  ('PLATFORM_OWNER','users.update'),
  ('PLATFORM_OWNER','users.delete'),
  ('PLATFORM_OWNER','users.block'),
  ('PLATFORM_OWNER','users.assign_permissions'),

  -- Super admin
  ('SUPER_ADMIN','pump.update'),
  ('SUPER_ADMIN','users.create'),
  ('SUPER_ADMIN','users.list'),
  ('SUPER_ADMIN','users.update'),
  ('SUPER_ADMIN','users.delete'),
  ('SUPER_ADMIN','users.block'),
  ('SUPER_ADMIN','users.assign_permissions'),
  ('SUPER_ADMIN','leaves.apply'),
  ('SUPER_ADMIN','leaves.list_own'),
  ('SUPER_ADMIN','leaves.list_all'),
  ('SUPER_ADMIN','leaves.approve'),
  ('SUPER_ADMIN','leaves.reject'),
  ('SUPER_ADMIN','credit.account_create'),
  ('SUPER_ADMIN','credit.account_update'),
  ('SUPER_ADMIN','credit.account_delete'),
  ('SUPER_ADMIN','credit.txn_create'),
  ('SUPER_ADMIN','credit.txn_approve'),
  ('SUPER_ADMIN','credit.list'),
  ('SUPER_ADMIN','machines.crud'),
  ('SUPER_ADMIN','nozzles.crud'),
  ('SUPER_ADMIN','nozzles.read_list'),
  ('SUPER_ADMIN','fuel_type.crud'),
  ('SUPER_ADMIN','fuel_price.update'),
  ('SUPER_ADMIN','fuel_price.history.read'),
  ('SUPER_ADMIN','fuel_purchase.create'),
  ('SUPER_ADMIN','fuel_purchase.list'),
  ('SUPER_ADMIN','readings.create'),
  ('SUPER_ADMIN','readings.list_own'),
  ('SUPER_ADMIN','readings.list_all'),
  ('SUPER_ADMIN','readings.lock_day'),
  ('SUPER_ADMIN','salary.structure.set'),
  ('SUPER_ADMIN','salary.advance.grant'),
  ('SUPER_ADMIN','salary.incentive.grant'),
  ('SUPER_ADMIN','salary.payout.generate'),
  ('SUPER_ADMIN','salary.payslip.read_own'),
  ('SUPER_ADMIN','salary.payslip.read_all'),
  ('SUPER_ADMIN','analytics.tenant_dashboard'),
  ('SUPER_ADMIN','analytics.profit'),
  ('SUPER_ADMIN','settings.read'),
  ('SUPER_ADMIN','settings.update'),
  ('SUPER_ADMIN','settings.whatsapp'),

  -- Admin (no user-management — SUPER_ADMIN is the only role that adds/edits/blocks users)
  ('ADMIN','users.list'),
  ('ADMIN','leaves.apply'),
  ('ADMIN','leaves.list_own'),
  ('ADMIN','leaves.list_all'),
  ('ADMIN','leaves.approve'),
  ('ADMIN','leaves.reject'),
  ('ADMIN','credit.account_create'),
  ('ADMIN','credit.account_update'),
  ('ADMIN','credit.account_delete'),
  ('ADMIN','credit.txn_create'),
  ('ADMIN','credit.txn_approve'),
  ('ADMIN','credit.list'),
  ('ADMIN','machines.crud'),
  ('ADMIN','nozzles.crud'),
  ('ADMIN','nozzles.read_list'),
  ('ADMIN','fuel_price.update'),
  ('ADMIN','fuel_price.history.read'),
  ('ADMIN','fuel_purchase.create'),
  ('ADMIN','fuel_purchase.list'),
  ('ADMIN','readings.create'),
  ('ADMIN','readings.list_own'),
  ('ADMIN','readings.list_all'),
  ('ADMIN','readings.lock_day'),
  ('ADMIN','salary.structure.set'),
  ('ADMIN','salary.advance.grant'),
  ('ADMIN','salary.incentive.grant'),
  ('ADMIN','salary.payout.generate'),
  ('ADMIN','salary.payslip.read_own'),
  ('ADMIN','salary.payslip.read_all'),
  ('ADMIN','analytics.tenant_dashboard'),
  ('ADMIN','analytics.profit'),
  ('ADMIN','settings.read'),
  ('ADMIN','settings.update'),

  -- Accountant
  ('ACCOUNTANT','users.list'),
  ('ACCOUNTANT','leaves.apply'),
  ('ACCOUNTANT','leaves.list_own'),
  ('ACCOUNTANT','leaves.list_all'),
  ('ACCOUNTANT','credit.account_create'),
  ('ACCOUNTANT','credit.account_update'),
  ('ACCOUNTANT','credit.txn_create'),
  ('ACCOUNTANT','credit.txn_approve'),
  ('ACCOUNTANT','credit.list'),
  ('ACCOUNTANT','nozzles.read_list'),
  ('ACCOUNTANT','fuel_price.history.read'),
  ('ACCOUNTANT','fuel_purchase.create'),
  ('ACCOUNTANT','fuel_purchase.list'),
  ('ACCOUNTANT','readings.create'),
  ('ACCOUNTANT','readings.list_own'),
  ('ACCOUNTANT','readings.list_all'),
  ('ACCOUNTANT','readings.lock_day'),
  ('ACCOUNTANT','salary.advance.grant'),
  ('ACCOUNTANT','salary.payout.generate'),
  ('ACCOUNTANT','salary.payslip.read_own'),
  ('ACCOUNTANT','salary.payslip.read_all'),
  ('ACCOUNTANT','analytics.tenant_dashboard'),
  ('ACCOUNTANT','settings.read'),

  -- Employee
  ('EMPLOYEE','leaves.apply'),
  ('EMPLOYEE','leaves.list_own'),
  ('EMPLOYEE','credit.txn_create'),
  ('EMPLOYEE','nozzles.read_list'),
  ('EMPLOYEE','readings.create'),
  ('EMPLOYEE','readings.list_own'),
  ('EMPLOYEE','salary.payslip.read_own'),
  ('EMPLOYEE','settings.read')
ON CONFLICT (role, permission) DO NOTHING;

-- ────────────────────────────────────────────
-- 3. has_permission() — RLS-safe permission check
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission(uid UUID, perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
  user_perms TEXT[];
BEGIN
  SELECT role, permissions INTO user_role, user_perms
  FROM public.users
  WHERE id = uid;

  IF user_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- explicit revoke wins
  IF user_perms @> ARRAY['-' || perm] THEN
    RETURN FALSE;
  END IF;

  -- explicit grant
  IF user_perms @> ARRAY['+' || perm] THEN
    RETURN TRUE;
  END IF;

  -- fall back to role default
  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role = user_role AND permission = perm
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;

-- ────────────────────────────────────────────
-- 4. Fuel types + price history + purchases
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id     UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                  -- "Petrol", "Diesel", "CNG"
  code        TEXT NOT NULL,                  -- "MS", "HSD", "CNG", "XP"
  unit        TEXT NOT NULL DEFAULT 'LITRE'
              CHECK (unit IN ('LITRE','KG','PIECE')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pump_id, code)
);

CREATE INDEX IF NOT EXISTS idx_fuel_types_pump ON public.fuel_types(pump_id);

-- Price history. Closed intervals via effective_to (NULL = current).
CREATE TABLE IF NOT EXISTS public.fuel_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  fuel_type_id    UUID NOT NULL REFERENCES public.fuel_types(id) ON DELETE CASCADE,
  purchase_price  NUMERIC(10,4) NOT NULL CHECK (purchase_price >= 0),
  selling_price   NUMERIC(10,4) NOT NULL CHECK (selling_price >= 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fuel_prices_lookup
  ON public.fuel_prices(fuel_type_id, effective_from DESC);

-- Trigger: when a new price row is inserted with NULL effective_to, close the
-- previous open row for that fuel_type at NEW.effective_from.
CREATE OR REPLACE FUNCTION public.close_previous_fuel_price()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effective_to IS NOT NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.fuel_prices
  SET effective_to = NEW.effective_from
  WHERE fuel_type_id = NEW.fuel_type_id
    AND id <> NEW.id
    AND effective_to IS NULL
    AND effective_from < NEW.effective_from;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_previous_fuel_price ON public.fuel_prices;
CREATE TRIGGER trg_close_previous_fuel_price
  AFTER INSERT ON public.fuel_prices
  FOR EACH ROW EXECUTE FUNCTION public.close_previous_fuel_price();

-- Stock purchase events (used for COGS)
CREATE TABLE IF NOT EXISTS public.fuel_purchases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id        UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  fuel_type_id   UUID NOT NULL REFERENCES public.fuel_types(id) ON DELETE RESTRICT,
  quantity       NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  rate_per_unit  NUMERIC(10,4) NOT NULL CHECK (rate_per_unit >= 0),
  total_cost     NUMERIC(14,2) GENERATED ALWAYS AS (quantity * rate_per_unit) STORED,
  supplier       TEXT,
  invoice_no     TEXT,
  purchase_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_purchases_pump_date
  ON public.fuel_purchases(pump_id, purchase_date DESC);

-- ────────────────────────────────────────────
-- 5. Machines + Nozzles (replaces hardcoded 8 nozzles)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.machines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id     UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- "Dispenser 1"
  code        TEXT NOT NULL,                   -- "M1"
  display_order INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pump_id, code)
);

CREATE TABLE IF NOT EXISTS public.nozzles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id       UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  machine_id    UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  fuel_type_id  UUID NOT NULL REFERENCES public.fuel_types(id) ON DELETE RESTRICT,
  code          TEXT NOT NULL,                 -- "N1", "N2"
  display_order INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (machine_id, code)
);

CREATE INDEX IF NOT EXISTS idx_nozzles_pump ON public.nozzles(pump_id);
CREATE INDEX IF NOT EXISTS idx_nozzles_machine ON public.nozzles(machine_id);

-- Link nozzle_readings to nozzle_id (nullable for now to keep old rows valid)
ALTER TABLE public.nozzle_readings
  ADD COLUMN IF NOT EXISTS nozzle_id UUID REFERENCES public.nozzles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nozzle_readings_nozzle
  ON public.nozzle_readings(nozzle_id);

-- ────────────────────────────────────────────
-- 6. Pricing helpers — runtime price lookup
-- ────────────────────────────────────────────
-- Returns selling_price, purchase_price for a fuel at a given timestamp.
CREATE OR REPLACE FUNCTION public.get_fuel_price_at(
  p_fuel_type_id UUID,
  p_at           TIMESTAMPTZ
)
RETURNS TABLE (selling_price NUMERIC, purchase_price NUMERIC)
LANGUAGE SQL STABLE
AS $$
  SELECT fp.selling_price, fp.purchase_price
  FROM public.fuel_prices fp
  WHERE fp.fuel_type_id = p_fuel_type_id
    AND fp.effective_from <= p_at
    AND (fp.effective_to IS NULL OR fp.effective_to > p_at)
  ORDER BY fp.effective_from DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_fuel_price_at(UUID, TIMESTAMPTZ) TO authenticated;

-- ────────────────────────────────────────────
-- 7. Reading-derived sales view (no separate sales table — readings are SoT).
--    For each nozzle_readings row we compute litres_sold and price-it at the
--    selling_price/purchase_price effective at end-of-shift (created_at).
--    The CASH/ONLINE/CREDIT split for a given pump+day comes from
--    daily_sales (cash_collected / online_collected / credit_given).
-- ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_readings_priced AS
SELECT
  r.id                AS reading_id,
  r.pump_id,
  r.nozzle_id,
  r.nozzle_number,
  r.fuel_type,
  r.reading_date,
  r.opening_reading,
  r.closing_reading,
  r.litres_sold,
  r.entered_by,
  r.created_at,
  -- Resolve fuel_type_id (preferred via nozzles.fuel_type_id, fallback to code)
  COALESCE(n.fuel_type_id, ft.id)                              AS fuel_type_id,
  p.selling_price                                              AS unit_selling_price,
  p.purchase_price                                             AS unit_purchase_price,
  (r.litres_sold * p.selling_price)::NUMERIC(14,2)             AS revenue,
  (r.litres_sold * p.purchase_price)::NUMERIC(14,2)            AS cogs,
  (r.litres_sold * (p.selling_price - p.purchase_price))::NUMERIC(14,2) AS profit
FROM public.nozzle_readings r
LEFT JOIN public.nozzles    n  ON n.id = r.nozzle_id
LEFT JOIN public.fuel_types ft ON ft.pump_id = r.pump_id AND ft.code = r.fuel_type
LEFT JOIN LATERAL public.get_fuel_price_at(
  COALESCE(n.fuel_type_id, ft.id),
  r.created_at
) p ON TRUE;

COMMENT ON VIEW public.v_readings_priced IS
  'Runtime-priced view over nozzle_readings. NEVER store revenue/cogs/profit
   on the readings row — they must be derived from fuel_prices history.';

-- Day-level rollup with profit + payment-mode split sourced from daily_sales.
CREATE OR REPLACE FUNCTION public.day_profit(p_pump_id UUID, p_date DATE)
RETURNS TABLE (
  pump_id        UUID,
  on_date        DATE,
  total_litres   NUMERIC,
  total_revenue  NUMERIC,
  total_cogs     NUMERIC,
  total_profit   NUMERIC,
  cash_total     NUMERIC,
  online_total   NUMERIC,
  credit_total   NUMERIC
)
LANGUAGE SQL STABLE
AS $$
  WITH r AS (
    SELECT
      COALESCE(SUM(litres_sold), 0)                AS total_litres,
      COALESCE(SUM(revenue),     0)                AS total_revenue,
      COALESCE(SUM(cogs),        0)                AS total_cogs,
      COALESCE(SUM(profit),      0)                AS total_profit
    FROM public.v_readings_priced
    WHERE pump_id = p_pump_id AND reading_date = p_date
  ),
  d AS (
    SELECT
      COALESCE(cash_collected,   0) AS cash_total,
      COALESCE(online_collected, 0) AS online_total,
      COALESCE(credit_given,     0) AS credit_total
    FROM public.daily_sales
    WHERE pump_id = p_pump_id AND sale_date = p_date
    LIMIT 1
  )
  SELECT
    p_pump_id, p_date,
    r.total_litres, r.total_revenue, r.total_cogs, r.total_profit,
    COALESCE(d.cash_total, 0),
    COALESCE(d.online_total, 0),
    COALESCE(d.credit_total, 0)
  FROM r LEFT JOIN d ON TRUE
$$;

GRANT EXECUTE ON FUNCTION public.day_profit(UUID, DATE) TO authenticated;

-- ────────────────────────────────────────────
-- 8. Salary structures + advances
--    (salary_incentives = existing `incentives` table; payslips already exist)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salary_structures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  base_salary     NUMERIC(10,2) NOT NULL DEFAULT 0,
  salary_type     TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (salary_type IN ('MONTHLY','DAILY')),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_user
  ON public.salary_structures(user_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.salary_advances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id       UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  granted_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  for_month     INT  NOT NULL CHECK (for_month BETWEEN 1 AND 12),
  for_year      INT  NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','DEDUCTED','CANCELLED')),
  granted_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_user_period
  ON public.salary_advances(user_id, for_year, for_month);

-- Per-employee, per-month live summary.
-- Reads aggregate cleanly: one row per (user, year, month) with current
-- base salary, MTD advances (sum of PENDING+DEDUCTED), MTD incentives,
-- and the projected month-end payable.
--
-- Super admin uses this to see what each employee is owed; employee uses
-- it on their own dashboard to see how much advance they've taken so far.
CREATE OR REPLACE VIEW public.v_salary_month_summary AS
WITH months AS (
  -- Anchor on the (user, year, month) keys present anywhere this period.
  SELECT user_id, pump_id, for_year AS year, for_month AS month
    FROM public.salary_advances
  UNION
  SELECT user_id, pump_id,
         EXTRACT(YEAR  FROM awarded_at)::INT AS year,
         EXTRACT(MONTH FROM awarded_at)::INT AS month
    FROM public.incentives
  UNION
  SELECT u.id AS user_id, u.pump_id,
         EXTRACT(YEAR  FROM CURRENT_DATE)::INT AS year,
         EXTRACT(MONTH FROM CURRENT_DATE)::INT AS month
    FROM public.users u
   WHERE u.deleted_at IS NULL AND u.is_active
),
base AS (
  SELECT DISTINCT ON (m.user_id, m.year, m.month)
    m.user_id, m.pump_id, m.year, m.month,
    ss.base_salary, ss.salary_type
  FROM months m
  LEFT JOIN public.salary_structures ss
    ON ss.user_id = m.user_id
   AND ss.effective_from <= make_date(m.year, m.month, 1) + INTERVAL '1 month' - INTERVAL '1 day'
   AND (ss.effective_to IS NULL OR ss.effective_to >= make_date(m.year, m.month, 1))
  ORDER BY m.user_id, m.year, m.month, ss.effective_from DESC
),
adv AS (
  SELECT user_id, for_year AS year, for_month AS month,
         COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING','DEDUCTED')), 0) AS advance_total
  FROM public.salary_advances
  GROUP BY user_id, for_year, for_month
),
inc AS (
  SELECT user_id,
         EXTRACT(YEAR  FROM awarded_at)::INT AS year,
         EXTRACT(MONTH FROM awarded_at)::INT AS month,
         COALESCE(SUM(amount), 0) AS incentive_total
  FROM public.incentives
  GROUP BY user_id, EXTRACT(YEAR FROM awarded_at), EXTRACT(MONTH FROM awarded_at)
)
SELECT
  b.user_id,
  b.pump_id,
  b.year,
  b.month,
  COALESCE(b.base_salary, 0)                                         AS base_salary,
  COALESCE(b.salary_type, 'MONTHLY')                                 AS salary_type,
  COALESCE(adv.advance_total, 0)                                     AS advance_total,
  COALESCE(inc.incentive_total, 0)                                   AS incentive_total,
  -- Projected month-end payable (leave deductions are layered in by
  -- payslip.ts when the payslip is actually generated; this is a live
  -- estimate for dashboards).
  GREATEST(
    COALESCE(b.base_salary, 0)
      + COALESCE(inc.incentive_total, 0)
      - COALESCE(adv.advance_total, 0),
    0
  )::NUMERIC(12,2) AS projected_payable
FROM base b
LEFT JOIN adv ON adv.user_id = b.user_id AND adv.year = b.year AND adv.month = b.month
LEFT JOIN inc ON inc.user_id = b.user_id AND inc.year = b.year AND inc.month = b.month;

COMMENT ON VIEW public.v_salary_month_summary IS
  'Live per-employee, per-month salary picture. Super admin: list view of all
   employees. Employee: own dashboard. Updated implicitly whenever an advance
   or incentive row is inserted — no app-side recomputation needed.';

-- ────────────────────────────────────────────
-- 9. Audit log — role-sensitive actions
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id      UUID REFERENCES public.pumps(id) ON DELETE SET NULL,
  actor_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,            -- "fuel_price.update", "users.block", ...
  entity_type  TEXT,
  entity_id    UUID,
  before_state JSONB,
  after_state  JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_pump_time ON public.audit_log(pump_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_log(action);

-- ────────────────────────────────────────────
-- 10. RLS for everything new — same-pump pattern, platform owner override.
--     Re-uses public.current_user_pump_id() and public.current_user_role()
--     installed by fresh_setup.sql.
-- ────────────────────────────────────────────
ALTER TABLE public.fuel_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_prices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_purchases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machines            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nozzles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'fuel_types','fuel_prices','fuel_purchases','machines','nozzles',
    'salary_structures','salary_advances'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I_same_pump_all ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_same_pump_all ON public.%I
         FOR ALL
         USING (pump_id = public.current_user_pump_id()
                OR public.current_user_role() = ''PLATFORM_OWNER'')
         WITH CHECK (pump_id = public.current_user_pump_id()
                OR public.current_user_role() = ''PLATFORM_OWNER'')',
      t, t);
  END LOOP;
END $$;

-- Audit log: every authenticated user in the same pump can read; only system
-- code (server-side) inserts. Restrict insert to authenticated for now and
-- tighten later if you add a service role.
DROP POLICY IF EXISTS audit_log_read ON public.audit_log;
CREATE POLICY audit_log_read ON public.audit_log
  FOR SELECT USING (
    pump_id = public.current_user_pump_id()
    OR public.current_user_role() = 'PLATFORM_OWNER'
  );

DROP POLICY IF EXISTS audit_log_write ON public.audit_log;
CREATE POLICY audit_log_write ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

COMMIT;

-- ────────────────────────────────────────────
-- Smoke test (run separately):
--   SELECT public.has_permission(auth.uid(), 'fuel_price.update');
--   SELECT * FROM public.role_permissions WHERE role = 'EMPLOYEE';
-- ────────────────────────────────────────────
