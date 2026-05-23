-- ================================================================
-- Migration 007: Meter Readings, Daily Sales & Credit Management
-- Run in Supabase SQL Editor
-- ================================================================

-- ── 1. Dispensing Units (nozzles, configurable per pump) ──────
CREATE TABLE IF NOT EXISTS public.dispensing_units (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,          -- e.g. "Nozzle 1", "Dispenser A Left"
  fuel_type       VARCHAR(100) NOT NULL,          -- MS, HSD, 2T OIL, etc. (free text)
  machine_number  INTEGER DEFAULT 1,              -- which physical machine
  nozzle_number   INTEGER NOT NULL,               -- nozzle # on that machine
  display_order   INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Fuel Types with current rates (configurable per pump) ──
CREATE TABLE IF NOT EXISTS public.fuel_types (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,          -- MS, HSD, Engine Oil 2T, etc.
  category        VARCHAR(20) DEFAULT 'FUEL'
                  CHECK (category IN ('FUEL', 'INVENTORY')),
  unit            VARCHAR(20) DEFAULT 'LITRE',    -- LITRE, PIECE, KG, etc.
  current_rate    DECIMAL(10,2) DEFAULT 0,
  rate_updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pump_id, name)
);

-- ── 3. Daily Readings (one row per nozzle per day) ────────────
CREATE TABLE IF NOT EXISTS public.daily_readings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id             UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  dispenser_id        UUID NOT NULL REFERENCES public.dispensing_units(id) ON DELETE CASCADE,
  reading_date        DATE NOT NULL,
  start_reading       DECIMAL(12,2),
  end_reading         DECIMAL(12,2),
  testing_litres      DECIMAL(8,2) DEFAULT 0,
  fuel_rate           DECIMAL(10,2),              -- rate snapshot at time of entry
  entered_by          UUID REFERENCES public.users(id),
  is_locked           BOOLEAN DEFAULT false,
  locked_at           TIMESTAMPTZ,
  unlock_requested_by UUID REFERENCES public.users(id),
  unlock_approved_by  UUID REFERENCES public.users(id),
  unlock_reason       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dispenser_id, reading_date)
);

-- ── 4. Daily Sales Summary (one row per pump per day) ─────────
CREATE TABLE IF NOT EXISTS public.daily_sales (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id             UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  sale_date           DATE NOT NULL,
  total_ms_litres     DECIMAL(12,2) DEFAULT 0,
  total_hsd_litres    DECIMAL(12,2) DEFAULT 0,
  total_other_litres  DECIMAL(12,2) DEFAULT 0,
  total_expected_cash DECIMAL(12,2) DEFAULT 0,
  cash_collected      DECIMAL(12,2) DEFAULT 0,
  online_collected    DECIMAL(12,2) DEFAULT 0,
  credit_given        DECIMAL(12,2) DEFAULT 0,
  credit_settled      DECIMAL(12,2) DEFAULT 0,
  shortfall           DECIMAL(12,2) DEFAULT 0,    -- positive = missing money
  notes               TEXT,
  submitted_by        UUID REFERENCES public.users(id),
  submitted_at        TIMESTAMPTZ,
  is_locked           BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pump_id, sale_date)
);

-- ── 5. Fuel Rate History ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_rate_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  fuel_type_name  VARCHAR(100) NOT NULL,
  old_rate        DECIMAL(10,2),
  new_rate        DECIMAL(10,2) NOT NULL,
  effective_date  DATE DEFAULT CURRENT_DATE,
  changed_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Credit Customers ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_customers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id           UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  phone             VARCHAR(20) NOT NULL,
  vehicle_number    VARCHAR(50) NOT NULL,
  address           TEXT,
  credit_limit      DECIMAL(10,2) DEFAULT 0,       -- 0 = unlimited
  total_outstanding DECIMAL(12,2) DEFAULT 0,        -- maintained by triggers / app
  is_active         BOOLEAN DEFAULT true,
  added_by          UUID REFERENCES public.users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Credit Entries (fuel given on credit) ──────────────────
CREATE TABLE IF NOT EXISTS public.credit_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id           UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES public.credit_customers(id) ON DELETE RESTRICT,
  fuel_type         VARCHAR(100),
  litres            DECIMAL(8,2),
  rate_per_litre    DECIMAL(10,2),
  amount            DECIMAL(12,2) NOT NULL,
  outstanding_amount DECIMAL(12,2) NOT NULL,       -- reduces with partial settlements
  credit_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  given_by          UUID REFERENCES public.users(id),    -- employee who dispensed fuel
  receiver_name     TEXT,                                -- who physically received (free text)
  vehicle_number    VARCHAR(50),
  notes             TEXT,
  is_fully_settled  BOOLEAN DEFAULT false,
  notification_sent BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. Credit Settlements (partial/full payments) ─────────────
CREATE TABLE IF NOT EXISTS public.credit_settlements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  credit_entry_id UUID NOT NULL REFERENCES public.credit_entries(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES public.credit_customers(id) ON DELETE RESTRICT,
  amount_settled  DECIMAL(12,2) NOT NULL,
  payment_mode    VARCHAR(20) DEFAULT 'CASH'
                  CHECK (payment_mode IN ('CASH','UPI','NEFT','CARD','OTHER')),
  received_by     UUID REFERENCES public.users(id),  -- employee who received payment
  payer_name      TEXT NOT NULL,                     -- who physically paid (free text)
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dispensing_units_pump     ON public.dispensing_units(pump_id);
CREATE INDEX IF NOT EXISTS idx_fuel_types_pump           ON public.fuel_types(pump_id);
CREATE INDEX IF NOT EXISTS idx_daily_readings_pump_date  ON public.daily_readings(pump_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_daily_readings_dispenser  ON public.daily_readings(dispenser_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_pump_date     ON public.daily_sales(pump_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_fuel_rate_history_pump    ON public.fuel_rate_history(pump_id);
CREATE INDEX IF NOT EXISTS idx_credit_customers_pump     ON public.credit_customers(pump_id);
CREATE INDEX IF NOT EXISTS idx_credit_entries_pump       ON public.credit_entries(pump_id, credit_date);
CREATE INDEX IF NOT EXISTS idx_credit_entries_customer   ON public.credit_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_settlements_entry  ON public.credit_settlements(credit_entry_id);
CREATE INDEX IF NOT EXISTS idx_credit_settlements_pump   ON public.credit_settlements(pump_id, settlement_date);
