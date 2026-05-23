-- ============================================================
-- FuelDesk v2 — Schema smoke test
-- ============================================================
-- Read-only. Safe to run any number of times. Returns one row per check
-- with `ok = true|false` and the source step, so you can `WHERE NOT ok` to
-- spot what hasn't been deployed.
--
--   Usage in Supabase Dashboard → SQL Editor:
--     paste this whole file → run → scan the result.
--     Sort by `ok` ascending to surface failures.
-- ============================================================

WITH checks(step, what, ok, detail) AS (
  -- ───────────────────── fresh_setup.sql ─────────────────────
  SELECT 'fresh_setup', 'public.pumps exists',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pumps'),
    NULL::text
  UNION ALL SELECT 'fresh_setup', 'public.users exists',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'users.id references auth.users',
    -- pg_constraint is the catalog source of truth; information_schema views
    -- can hide cross-schema FKs depending on role/grants. Match any FK on
    -- public.users where the referenced table is auth.users.
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.users'::regclass
        AND c.contype  = 'f'
        AND c.confrelid = 'auth.users'::regclass
    ),
    'If failing, run database/patch_users_fk.sql.'
  UNION ALL SELECT 'fresh_setup', 'users.permissions column (text[])',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
        AND column_name='permissions' AND data_type='ARRAY'
    ),
    NULL
  UNION ALL SELECT 'fresh_setup', 'public.system_settings (key/value) shape',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='system_settings' AND column_name='key'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='system_settings' AND column_name='value'
    ),
    NULL
  UNION ALL SELECT 'fresh_setup', 'attendance UNIQUE(user_id, shift_date)',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND tablename='attendance'
        AND indexdef ILIKE '%UNIQUE%user_id%shift_date%'
    ),
    NULL
  UNION ALL SELECT 'fresh_setup', 'get_email_by_phone() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_email_by_phone'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'increment_lorry_count() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='increment_lorry_count'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'current_user_pump_id() RLS helper',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_pump_id'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'current_user_role() RLS helper',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_role'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'RLS enabled on public.users',
    (SELECT relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname='users'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'RLS enabled on public.pumps',
    (SELECT relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname='pumps'),
    NULL
  UNION ALL SELECT 'fresh_setup', 'at least one pump exists',
    -- Don't filter on pumps.deleted_at here — that column is added by step3,
    -- not fresh_setup. Soft-deleted pumps get caught by the dedicated step3
    -- check below instead.
    EXISTS (SELECT 1 FROM public.pumps),
    'Run fresh_setup.sql or create your first pump from /platform.'
  UNION ALL SELECT 'fresh_setup', 'at least one PLATFORM_OWNER user exists',
    -- Defensive: don't reference users.deleted_at unless the column exists,
    -- so a partially-applied schema still produces a useful smoke report
    -- instead of aborting at parse time.
    EXISTS (SELECT 1 FROM public.users WHERE role='PLATFORM_OWNER'),
    'Bootstrap: insert a public.users row for your auth user with role=PLATFORM_OWNER.'

  -- ───────────────── step1_rbac_and_business ─────────────────
  UNION ALL SELECT 'step1', 'role_permissions table',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='role_permissions'),
    NULL
  UNION ALL SELECT 'step1', 'role_permissions seeded',
    (SELECT COUNT(*) FROM public.role_permissions) >= 50,
    (SELECT 'count=' || COUNT(*)::text FROM public.role_permissions)
  UNION ALL SELECT 'step1', 'has_permission() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='has_permission'),
    NULL
  UNION ALL SELECT 'step1', 'fuel_types / fuel_prices / fuel_purchases',
    (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN ('fuel_types','fuel_prices','fuel_purchases')) = 3,
    NULL
  UNION ALL SELECT 'step1', 'machines + nozzles tables',
    (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN ('machines','nozzles')) = 2,
    NULL
  UNION ALL SELECT 'step1', 'nozzle_readings.nozzle_id column',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='nozzle_readings' AND column_name='nozzle_id'
    ),
    NULL
  UNION ALL SELECT 'step1', 'fuel_prices auto-close trigger',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_close_previous_fuel_price' AND NOT tgisinternal),
    NULL
  UNION ALL SELECT 'step1', 'get_fuel_price_at() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_fuel_price_at'),
    NULL
  UNION ALL SELECT 'step1', 'v_readings_priced view',
    EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_readings_priced'),
    NULL
  UNION ALL SELECT 'step1', 'day_profit() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='day_profit'),
    NULL
  UNION ALL SELECT 'step1', 'salary_structures + salary_advances tables',
    (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN ('salary_structures','salary_advances')) = 2,
    NULL
  UNION ALL SELECT 'step1', 'v_salary_month_summary view',
    EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_salary_month_summary'),
    NULL
  UNION ALL SELECT 'step1', 'audit_log table',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log'),
    NULL
  UNION ALL SELECT 'step1', 'ADMIN role has NO users.create',
    NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role='ADMIN' AND permission IN ('users.create','users.update','users.delete','users.block')
    ),
    'Step 1 deliberately strips user-management perms from ADMIN. Re-seed if mismatched.'

  -- ───────────────── step3_platform_owner ─────────────────
  UNION ALL SELECT 'step3', 'pumps.deleted_at column',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pumps' AND column_name='deleted_at'
    ),
    NULL
  UNION ALL SELECT 'step3', 'seed_pump_defaults() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='seed_pump_defaults'),
    NULL
  UNION ALL SELECT 'step3', 'create_pump_with_super_admin() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='create_pump_with_super_admin'),
    NULL
  UNION ALL SELECT 'step3', 'platform_global_stats() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='platform_global_stats'),
    NULL
  UNION ALL SELECT 'step3', 'v_pump_health view',
    EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_pump_health'),
    NULL
  UNION ALL SELECT 'step3', 'platform_suspend_pump / restore / delete RPCs',
    (SELECT COUNT(*) FROM pg_proc
       WHERE proname IN ('platform_suspend_pump','platform_restore_pump','platform_delete_pump')) = 3,
    NULL

  -- ───────────────── step5 advance flow ─────────────────
  UNION ALL SELECT 'step5', 'idx_nozzle_readings_pump_nozzle_date partial unique',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname='public'
        AND indexname='idx_nozzle_readings_pump_nozzle_date'
    ),
    NULL
  UNION ALL SELECT 'step5', 'mark_advances_deducted() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='mark_advances_deducted'),
    NULL
  UNION ALL SELECT 'step5', 'cancel_advance() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='cancel_advance'),
    NULL
  UNION ALL SELECT 'step5', 'day_close_locked() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='day_close_locked'),
    NULL

  -- ───────────────── step6 analytics ─────────────────
  UNION ALL SELECT 'step6', 'tenant_analytics_daily() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='tenant_analytics_daily'),
    NULL
  UNION ALL SELECT 'step6', 'tenant_top_employees() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='tenant_top_employees'),
    NULL
  UNION ALL SELECT 'step6', 'tenant_fuel_mix() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='tenant_fuel_mix'),
    NULL
  UNION ALL SELECT 'step6', 'tenant_credit_aging() RPC',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='tenant_credit_aging'),
    NULL
  UNION ALL SELECT 'step6', '_assert_same_pump() helper',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='_assert_same_pump'),
    NULL

  -- ───────────────── permission grants ─────────────────
  -- Confirm anon can call the mobile-login RPC (otherwise login from /login
  -- is broken). Other RPCs are checked for `authenticated`.
  UNION ALL SELECT 'grants', 'anon EXECUTE on get_email_by_phone',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname = 'get_email_by_phone'
        AND n.nspname = 'public'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    'Login by mobile number depends on this. Re-grant via fresh_setup.sql section 13 if missing.'
  UNION ALL SELECT 'grants', 'authenticated EXECUTE on tenant_analytics_daily',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname = 'tenant_analytics_daily'
        AND n.nspname = 'public'
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    NULL
)

SELECT
  step,
  what,
  CASE WHEN ok THEN '✅ pass' ELSE '❌ fail' END AS status,
  detail
FROM checks
ORDER BY ok ASC, step, what;
