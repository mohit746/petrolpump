-- Petrol Pump Management System - Database Schema
-- Supabase PostgreSQL Schema for Phase 1

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Custom Types/Enums
CREATE TYPE user_role AS ENUM ('OWNER', 'MANAGER', 'SUPERVISOR', 'CASHIER', 'ACCOUNTANT', 'STAFF');
CREATE TYPE fuel_type AS ENUM ('MS', 'HSD', 'LUBRICANT', 'ENGINE_OIL_2T');
CREATE TYPE shift_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE reading_type AS ENUM ('SHIFT_START', 'SHIFT_END', 'INTERMEDIATE', 'EMERGENCY');

-- Users table (extends Supabase auth.users)
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role user_role DEFAULT 'STAFF',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dispensing Units table
CREATE TABLE public.dispensing_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., "Nozzle-1", "Dispenser-A"
    fuel_type fuel_type NOT NULL,
    rate_per_liter DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    description TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shifts table
CREATE TABLE public.shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    status shift_status DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reading Entries table
CREATE TABLE public.reading_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispensing_unit_id UUID REFERENCES public.dispensing_units(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
    previous_reading DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    current_reading DECIMAL(10,2) NOT NULL,
    fuel_sold DECIMAL(10,2) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
    rate_per_liter DECIMAL(10,2) NOT NULL,
    expected_revenue DECIMAL(10,2) GENERATED ALWAYS AS ((current_reading - previous_reading) * rate_per_liter) STORED,
    entry_type reading_type DEFAULT 'SHIFT_END',
    entered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cash Collections table
CREATE TABLE public.cash_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
    total_cash_collected DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    expected_cash DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    variance DECIMAL(10,2) GENERATED ALWAYS AS (total_cash_collected - expected_cash) STORED,
    payment_breakdown JSONB, -- {cash: 1000, card: 500, upi: 300}
    collected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily Summaries table
CREATE TABLE public.daily_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE UNIQUE NOT NULL,
    total_fuel_sold DECIMAL(10,2) DEFAULT 0.00,
    total_revenue DECIMAL(10,2) DEFAULT 0.00,
    total_cash_collected DECIMAL(10,2) DEFAULT 0.00,
    total_variance DECIMAL(10,2) DEFAULT 0.00,
    number_of_shifts INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX idx_users_auth_id ON public.users(auth_id);
CREATE INDEX idx_users_role ON public.users(role);
CREATE INDEX idx_dispensing_units_fuel_type ON public.dispensing_units(fuel_type);
CREATE INDEX idx_shifts_user_id ON public.shifts(user_id);
CREATE INDEX idx_shifts_status ON public.shifts(status);
CREATE INDEX idx_shifts_start_time ON public.shifts(start_time);
CREATE INDEX idx_reading_entries_shift_id ON public.reading_entries(shift_id);
CREATE INDEX idx_reading_entries_dispensing_unit_id ON public.reading_entries(dispensing_unit_id);
CREATE INDEX idx_reading_entries_timestamp ON public.reading_entries(timestamp);
CREATE INDEX idx_cash_collections_shift_id ON public.cash_collections(shift_id);
CREATE INDEX idx_daily_summaries_date ON public.daily_summaries(date);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_dispensing_units_updated_at BEFORE UPDATE ON public.dispensing_units FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensing_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (can be refined later)
CREATE POLICY "Users can view their own data" ON public.users FOR SELECT USING (auth.uid() = auth_id);
CREATE POLICY "Authenticated users can view dispensing units" ON public.dispensing_units FOR SELECT TO authenticated;
CREATE POLICY "Authenticated users can view shifts" ON public.shifts FOR SELECT TO authenticated;
CREATE POLICY "Authenticated users can view reading entries" ON public.reading_entries FOR SELECT TO authenticated;
CREATE POLICY "Authenticated users can view cash collections" ON public.cash_collections FOR SELECT TO authenticated;
CREATE POLICY "Authenticated users can view daily summaries" ON public.daily_summaries FOR SELECT TO authenticated;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;