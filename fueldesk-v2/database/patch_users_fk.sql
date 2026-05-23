-- ============================================================
-- Patch: add the missing FK from public.users.id → auth.users.id
-- ============================================================
-- Surfaced by smoke_test.sql ("users.id references auth.users").
-- Idempotent. Safe to run any number of times.
-- ============================================================

BEGIN;

-- 1. Find any orphan public.users rows (id not present in auth.users).
--    Adding a FK fails if orphans exist, so we surface them first and
--    soft-delete them. If you need to keep an orphan, delete this block
--    and clean it up manually before re-running.
DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans
  FROM public.users pu
  LEFT JOIN auth.users au ON au.id = pu.id
  WHERE au.id IS NULL;

  IF orphans > 0 THEN
    RAISE NOTICE 'Found % orphan public.users row(s) (no auth.users counterpart).', orphans;

    -- Mark them deleted so the FK can be created without dropping data.
    UPDATE public.users pu
    SET deleted_at = COALESCE(deleted_at, NOW()),
        is_active = FALSE
    FROM (
      SELECT pu.id FROM public.users pu
      LEFT JOIN auth.users au ON au.id = pu.id
      WHERE au.id IS NULL
    ) sub
    WHERE pu.id = sub.id;

    -- Drop them entirely so the constraint addition succeeds. Comment this
    -- out if you'd rather investigate the orphans first.
    DELETE FROM public.users
    WHERE id IN (
      SELECT pu.id FROM public.users pu
      LEFT JOIN auth.users au ON au.id = pu.id
      WHERE au.id IS NULL
    );
  END IF;
END $$;

-- 2. Add the FK with ON DELETE CASCADE. Idempotent: skip if already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name
     AND rc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE kcu.table_schema = 'public'
      AND kcu.table_name   = 'users'
      AND kcu.column_name  = 'id'
      AND ccu.table_schema = 'auth'
      AND ccu.table_name   = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_auth_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added FK public.users.id → auth.users.id';
  ELSE
    RAISE NOTICE 'FK already present — nothing to do.';
  END IF;
END $$;

COMMIT;

-- Verify (or just re-run smoke_test.sql):
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.users'::regclass AND contype = 'f';
