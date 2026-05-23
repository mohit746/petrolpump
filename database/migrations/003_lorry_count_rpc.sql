-- Migration: Add helper RPC for lorry duty counter increment
-- Run this in Supabase SQL editor or as migration 003

-- Increment lorry duty count atomically
CREATE OR REPLACE FUNCTION increment_lorry_count(emp_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE users
  SET 
    lorry_duty_count = lorry_duty_count + 1,
    last_lorry_duty_date = CURRENT_DATE
  WHERE id = emp_id;
$$;

-- Grant execute to authenticated users (admins will call this via RLS)
GRANT EXECUTE ON FUNCTION increment_lorry_count(UUID) TO authenticated;
