-- ============================================================
-- Migration 006: Platform Owner + Multi-Tenancy
-- Adds PLATFORM_OWNER role, pumps table, and pump_id to all
-- relevant tables for full multi-tenant data isolation.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── 1. Add PLATFORM_OWNER to user_role enum ──────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';

-- ── 2. Create pumps table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pumps (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) UNIQUE, -- URL-friendly identifier

  -- Location
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  country               VARCHAR(100) DEFAULT 'India',
  pincode               VARCHAR(10),
  phone                 VARCHAR(20),
  email                 VARCHAR(255),

  -- Geo-fence
  pump_lat              DECIMAL(10,8),
  pump_lng              DECIMAL(11,8),
  geo_radius_meters     INTEGER DEFAULT 200,

  -- Subscription
  subscription_status   VARCHAR(20) DEFAULT 'TRIAL'
                        CHECK (subscription_status IN ('ACTIVE','TRIAL','SUSPENDED','CANCELLED')),
  subscription_plan     VARCHAR(50) DEFAULT 'BASIC',
  subscription_start    DATE,
  subscription_end      DATE,
  monthly_premium       DECIMAL(10,2) DEFAULT 999.00,
  last_payment_date     DATE,
  last_payment_amount   DECIMAL(10,2),

  -- Feature flags (controlled by PLATFORM_OWNER only)
  whatsapp_enabled      BOOLEAN DEFAULT false,
  reports_enabled       BOOLEAN DEFAULT true,
  max_employees         INTEGER DEFAULT 20,

  -- WhatsApp config (can also be pump-level)
  whatsapp_phone_number_id TEXT,
  whatsapp_access_token    TEXT,

  -- Lifecycle
  is_active             BOOLEAN DEFAULT true,
  deactivated_at        TIMESTAMPTZ,
  deactivation_reason   TEXT,
  created_by_platform   BOOLEAN DEFAULT true,
  notes                 TEXT, -- platform owner internal notes

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Add pump_id FK to users ────────────────────────────────
-- PLATFORM_OWNER will have pump_id = NULL
-- All other roles must have a pump_id
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE SET NULL;

-- ── 4. Add pump_id to attendance ──────────────────────────────
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 5. Add pump_id to leaves ──────────────────────────────────
ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 6. Add pump_id to lorry_duties ───────────────────────────
ALTER TABLE public.lorry_duties
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 7. Add pump_id to incentives ─────────────────────────────
ALTER TABLE public.incentives
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 8. Add pump_id to monthly_payslips ───────────────────────
ALTER TABLE public.monthly_payslips
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 9. Add pump_id to fuel_loads ─────────────────────────────
ALTER TABLE public.fuel_loads
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 10. Add pump_id to shift_handovers ───────────────────────
ALTER TABLE public.shift_handovers
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 11. Migrate system_settings → per-pump settings ──────────
-- system_settings was a single-row global table.
-- We now use the pumps table for geo/shift/salary settings.
-- Add pump_id to system_settings for backward compat:
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- ── 12. Add pump_payments table ──────────────────────────────
-- Track monthly subscription payments per pump
CREATE TABLE IF NOT EXISTS public.pump_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  amount          DECIMAL(10,2) NOT NULL,
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method  VARCHAR(50), -- UPI, NEFT, Cash, etc.
  reference_no    VARCHAR(100),
  notes           TEXT,
  recorded_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 13. Indexes for performance ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_pump_id         ON public.users(pump_id);
CREATE INDEX IF NOT EXISTS idx_attendance_pump_id    ON public.attendance(pump_id);
CREATE INDEX IF NOT EXISTS idx_leaves_pump_id        ON public.leaves(pump_id);
CREATE INDEX IF NOT EXISTS idx_lorry_duties_pump_id  ON public.lorry_duties(pump_id);
CREATE INDEX IF NOT EXISTS idx_incentives_pump_id    ON public.incentives(pump_id);
CREATE INDEX IF NOT EXISTS idx_payslips_pump_id      ON public.monthly_payslips(pump_id);
CREATE INDEX IF NOT EXISTS idx_fuel_loads_pump_id    ON public.fuel_loads(pump_id);
CREATE INDEX IF NOT EXISTS idx_pump_payments_pump_id ON public.pump_payments(pump_id);

-- ── 14. PLATFORM_OWNER bootstrap ─────────────────────────────
-- After running this migration, go to Supabase Auth → Users,
-- find mohitdwivedi746@gmail.com's auth UUID, then run:
--
--   INSERT INTO public.users (auth_id, email, first_name, last_name, role, is_active, pump_id)
--   VALUES ('<auth_uuid>', 'mohitdwivedi746@gmail.com', 'Mohit', 'Dwivedi', 'PLATFORM_OWNER', true, NULL)
--   ON CONFLICT (email) DO UPDATE SET role = 'PLATFORM_OWNER', pump_id = NULL;
--
-- OR update existing row:
--   UPDATE public.users SET role = 'PLATFORM_OWNER', pump_id = NULL
--   WHERE email = 'mohitdwivedi746@gmail.com';
