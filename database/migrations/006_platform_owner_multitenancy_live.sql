-- ============================================================
-- Migration 006 (Live-safe): Platform Owner + Multi-Tenancy
-- Matches the actual live database tables exactly.
-- ============================================================

-- 1. Add PLATFORM_OWNER to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';

-- 2. Create pumps table
CREATE TABLE IF NOT EXISTS public.pumps (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) UNIQUE,
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  country               VARCHAR(100) DEFAULT 'India',
  pincode               VARCHAR(10),
  phone                 VARCHAR(20),
  email                 VARCHAR(255),
  pump_lat              DECIMAL(10,8),
  pump_lng              DECIMAL(11,8),
  geo_radius_meters     INTEGER DEFAULT 200,
  subscription_status   VARCHAR(20) DEFAULT 'TRIAL'
                        CHECK (subscription_status IN ('ACTIVE','TRIAL','SUSPENDED','CANCELLED')),
  subscription_plan     VARCHAR(50) DEFAULT 'BASIC',
  subscription_start    DATE,
  subscription_end      DATE,
  monthly_premium       DECIMAL(10,2) DEFAULT 999.00,
  last_payment_date     DATE,
  last_payment_amount   DECIMAL(10,2),
  whatsapp_enabled      BOOLEAN DEFAULT false,
  reports_enabled       BOOLEAN DEFAULT true,
  max_employees         INTEGER DEFAULT 20,
  whatsapp_phone_number_id TEXT,
  whatsapp_access_token    TEXT,
  is_active             BOOLEAN DEFAULT true,
  deactivated_at        TIMESTAMPTZ,
  deactivation_reason   TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add pump_id to all existing tables
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE SET NULL;

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.lorry_duties
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.incentives
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.monthly_payslips
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.shift_handovers
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES public.pumps(id) ON DELETE CASCADE;

-- 4. pump_payments table
CREATE TABLE IF NOT EXISTS public.pump_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  amount          DECIMAL(10,2) NOT NULL,
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method  VARCHAR(50),
  reference_no    VARCHAR(100),
  notes           TEXT,
  recorded_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_users_pump_id         ON public.users(pump_id);
CREATE INDEX IF NOT EXISTS idx_attendance_pump_id    ON public.attendance(pump_id);
CREATE INDEX IF NOT EXISTS idx_leaves_pump_id        ON public.leaves(pump_id);
CREATE INDEX IF NOT EXISTS idx_lorry_duties_pump_id  ON public.lorry_duties(pump_id);
CREATE INDEX IF NOT EXISTS idx_incentives_pump_id    ON public.incentives(pump_id);
CREATE INDEX IF NOT EXISTS idx_payslips_pump_id      ON public.monthly_payslips(pump_id);
CREATE INDEX IF NOT EXISTS idx_pump_payments_pump_id ON public.pump_payments(pump_id);
