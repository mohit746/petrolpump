-- ============================================================
-- Migration 007: Meter Readings + Credit Management
-- Run in Supabase SQL Editor after migration 006
-- ============================================================

-- ── Fuel types (primary = nozzle fuel, secondary = inventory items) ──────────
CREATE TABLE IF NOT EXISTS public.fuel_types (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id       UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,   -- 'MS (Petrol)', 'HSD (Diesel)', 'Engine Oil 2T'
  short_code    VARCHAR(20)  NOT NULL,   -- 'MS', 'HSD', '2T', 'GREASE'
  is_meter_fuel BOOLEAN DEFAULT true,    -- true = meter-tracked nozzle fuel; false = inventory item
  unit          VARCHAR(10)  DEFAULT 'L', -- L, Kg, Pcs
  is_active     BOOLEAN DEFAULT true,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Fuel rate history (rate changes by SUPER_ADMIN only) ─────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_rates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id        UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  fuel_type_id   UUID NOT NULL REFERENCES public.fuel_types(id) ON DELETE CASCADE,
  rate_per_unit  DECIMAL(10,2) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Dispensers (physical machines at the pump) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dispensers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id    UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL, -- 'Dispenser 1', 'DU-A'
  is_active  BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Nozzles (individual nozzles attached to dispensers) ───────────────────────
CREATE TABLE IF NOT EXISTS public.nozzles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id      UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  dispenser_id UUID REFERENCES public.dispensers(id) ON DELETE SET NULL,
  fuel_type_id UUID NOT NULL REFERENCES public.fuel_types(id) ON DELETE RESTRICT,
  label        VARCHAR(100) NOT NULL, -- 'N1 - Petrol', 'N2 - Diesel'
  is_active    BOOLEAN DEFAULT true,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Daily nozzle readings ─────────────────────────────────────────────────────
-- One row per nozzle per reading_date (unique constraint)
CREATE TABLE IF NOT EXISTS public.nozzle_readings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id              UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  nozzle_id            UUID NOT NULL REFERENCES public.nozzles(id) ON DELETE CASCADE,
  reading_date         DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Readings
  start_reading        DECIMAL(12,2),   -- auto-fetched from previous day end; manual if first day
  end_reading          DECIMAL(12,2),
  testing_litres       DECIMAL(8,2) DEFAULT 0,

  -- Snapshot of rate at time of submission (for historical accuracy)
  rate_per_litre       DECIMAL(10,2),

  -- Lock / unlock mechanism
  is_locked            BOOLEAN DEFAULT false,
  unlock_requested_at  TIMESTAMPTZ,
  unlock_requested_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  unlock_approved_at   TIMESTAMPTZ,
  unlock_approved_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Audit
  entered_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(nozzle_id, reading_date)
);

-- ── Daily sales summary (cash/online entry + closing) ────────────────────────
-- One row per pump per date. Created/updated when employee submits day-end summary.
CREATE TABLE IF NOT EXISTS public.daily_sales (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id          UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  sale_date        DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Cash summary (manual entry by employee)
  cash_collected   DECIMAL(12,2) DEFAULT 0,
  online_collected DECIMAL(12,2) DEFAULT 0,

  -- Auto-computed from credit_entries for this date (updated when credits are added)
  credit_issued    DECIMAL(12,2) DEFAULT 0,

  -- Auto-computed from credit_settlements marked include_in_daily_cash = true for this date
  credit_received  DECIMAL(12,2) DEFAULT 0,

  -- Closing
  is_closed        BOOLEAN DEFAULT false,
  closed_at        TIMESTAMPTZ,
  closed_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes            TEXT,
  entered_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(pump_id, sale_date)
);

-- ── Credit customers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_customers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id             UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  phone               VARCHAR(20)  NOT NULL,
  vehicle_number      VARCHAR(50)  NOT NULL,
  address             TEXT,
  email               VARCHAR(255),
  credit_limit        DECIMAL(10,2) DEFAULT 0, -- 0 = no limit enforced
  outstanding_balance DECIMAL(12,2) DEFAULT 0, -- maintained by app on each entry/settlement
  is_active           BOOLEAN DEFAULT true,
  added_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Credit entries (fuel given on credit / udhar) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id           UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES public.credit_customers(id) ON DELETE CASCADE,
  fuel_type_id      UUID REFERENCES public.fuel_types(id) ON DELETE SET NULL,
  litres            DECIMAL(8,2)  NOT NULL,
  rate_per_litre    DECIMAL(10,2) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  outstanding_amount DECIMAL(10,2) NOT NULL, -- reduces with partial settlements
  entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  given_by          UUID REFERENCES public.users(id) ON DELETE SET NULL, -- who dispensed
  vehicle_number    VARCHAR(50),  -- can be different from customer's main vehicle
  notes             TEXT,
  is_fully_settled  BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Credit settlements ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_settlements (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id              UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES public.credit_customers(id) ON DELETE CASCADE,
  amount               DECIMAL(10,2) NOT NULL,
  settlement_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by          UUID REFERENCES public.users(id) ON DELETE SET NULL, -- employee who received
  given_by_name        VARCHAR(255) NOT NULL,  -- person who handed the cash
  mode_of_payment      VARCHAR(30) DEFAULT 'CASH', -- CASH, UPI, BANK_TRANSFER, CHEQUE
  include_in_daily_cash BOOLEAN DEFAULT true,  -- add to today's cash_collected in daily_sales
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fuel_types_pump        ON public.fuel_types(pump_id);
CREATE INDEX IF NOT EXISTS idx_fuel_rates_pump        ON public.fuel_rates(pump_id, fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_dispensers_pump        ON public.dispensers(pump_id);
CREATE INDEX IF NOT EXISTS idx_nozzles_pump           ON public.nozzles(pump_id);
CREATE INDEX IF NOT EXISTS idx_nozzle_readings_date   ON public.nozzle_readings(pump_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_nozzle_readings_nozzle ON public.nozzle_readings(nozzle_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_date       ON public.daily_sales(pump_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_credit_customers_pump  ON public.credit_customers(pump_id, is_active);
CREATE INDEX IF NOT EXISTS idx_credit_entries_pump    ON public.credit_entries(pump_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_credit_entries_cust    ON public.credit_entries(customer_id, is_fully_settled);
CREATE INDEX IF NOT EXISTS idx_credit_settlements_cust ON public.credit_settlements(customer_id, settlement_date);
