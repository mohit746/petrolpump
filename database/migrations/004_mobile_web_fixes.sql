-- ============================================================
-- Migration 004: Mobile Web PWA Fixes
-- Run this in Supabase SQL Editor if you get column errors
-- ============================================================

-- 1. Add incentive_date column to incentives (optional convenience column)
ALTER TABLE public.incentives ADD COLUMN IF NOT EXISTS incentive_date DATE;
-- Back-fill from for_month/for_year
UPDATE public.incentives SET incentive_date = make_date(for_year, for_month, 1) WHERE incentive_date IS NULL;

-- 2. Ensure lorry_duties has the trip_number auto-generation fallback
-- trip_number is UNIQUE NOT NULL — a default sequence helps
ALTER TABLE public.lorry_duties ALTER COLUMN trip_number SET DEFAULT 'TRIP-' || extract(epoch from now())::bigint::text;

-- 3. Ensure system_settings row exists
INSERT INTO public.system_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- 4. RPC: increment_lorry_count (called after assigning lorry duty)
CREATE OR REPLACE FUNCTION increment_lorry_count(emp_id UUID)
RETURNS void AS $$
  UPDATE public.users 
  SET lorry_duty_count = lorry_duty_count + 1,
      last_lorry_duty_date = CURRENT_DATE
  WHERE id = emp_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- 5. Grant execute on the RPC
GRANT EXECUTE ON FUNCTION increment_lorry_count(UUID) TO authenticated;

-- 6. Add RLS policy for users INSERT (needed when creating new employees via signUp)
-- The users row is created after auth signup, policy must allow it
DROP POLICY IF EXISTS "Users: self insert" ON public.users;
CREATE POLICY "Users: self insert" ON public.users FOR INSERT
  WITH CHECK (auth_id = auth.uid() OR current_user_role() IN ('SUPER_ADMIN', 'ADMIN'));
