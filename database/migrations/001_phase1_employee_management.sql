-- ============================================================
-- Phase 1 Migration: Employee Management System
-- Multi-language support, Role-based access, Employee features
-- ============================================================

-- 1. Update user_role enum (drop old, recreate)
-- NOTE: Run this on a fresh DB or handle existing data migration
ALTER TYPE user_role RENAME TO user_role_old;

CREATE TYPE user_role AS ENUM (
  'SUPER_ADMIN',  -- Full system access
  'ADMIN',        -- Pump manager/owner daily ops
  'ACCOUNTANT',   -- Cash & accounts only
  'EMPLOYEE'      -- Field staff / operators
);

-- Migrate existing data (map old roles to new)
ALTER TABLE public.users ALTER COLUMN role TYPE user_role
  USING CASE role::text
    WHEN 'OWNER'      THEN 'SUPER_ADMIN'
    WHEN 'MANAGER'    THEN 'ADMIN'
    WHEN 'SUPERVISOR' THEN 'ADMIN'
    WHEN 'CASHIER'    THEN 'ACCOUNTANT'
    WHEN 'ACCOUNTANT' THEN 'ACCOUNTANT'
    WHEN 'STAFF'      THEN 'EMPLOYEE'
    ELSE 'EMPLOYEE'
  END::user_role;

DROP TYPE user_role_old;

-- 2. Add language preference to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS employee_code VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS date_of_joining DATE,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS aadhar_number VARCHAR(12),
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(11),
  ADD COLUMN IF NOT EXISTS base_salary DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS shift_type VARCHAR(10) DEFAULT '12HR'; -- '12HR' | '24HR'

-- 3. Shift type enum
CREATE TYPE shift_type_enum AS ENUM ('12HR', '24HR');
CREATE TYPE leave_type AS ENUM ('PLANNED', 'EMERGENCY', 'SICK', 'CASUAL');
CREATE TYPE leave_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE');
CREATE TYPE fuel_load_status AS ENUM ('SCHEDULED', 'DEPARTED', 'ARRIVED', 'COMPLETED', 'CANCELLED');

-- 4. Employee Shift Assignments
-- Tracks which shift type an employee is assigned to
CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    shift_type shift_type_enum NOT NULL DEFAULT '12HR',
    shift_start_time TIME NOT NULL DEFAULT '06:00:00', -- e.g., 06:00 or 18:00
    shift_end_time TIME NOT NULL DEFAULT '18:00:00',
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,  -- NULL = still active
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Attendance Table with Geo-tagging
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status attendance_status DEFAULT 'PRESENT',
    -- Check-in
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_in_latitude DECIMAL(10, 8),
    check_in_longitude DECIMAL(11, 8),
    check_in_accuracy DECIMAL(8, 2), -- meters
    check_in_address TEXT,           -- reverse geocoded address
    check_in_verified BOOLEAN DEFAULT false, -- within allowed radius?
    -- Check-out
    check_out_time TIMESTAMP WITH TIME ZONE,
    check_out_latitude DECIMAL(10, 8),
    check_out_longitude DECIMAL(11, 8),
    check_out_accuracy DECIMAL(8, 2),
    check_out_address TEXT,
    check_out_verified BOOLEAN DEFAULT false,
    -- Working hours
    total_hours DECIMAL(5, 2) GENERATED ALWAYS AS (
        CASE
            WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600
            ELSE NULL
        END
    ) STORED,
    overtime_hours DECIMAL(5, 2) DEFAULT 0.00,
    notes TEXT,
    marked_by UUID REFERENCES public.users(id) ON DELETE SET NULL, -- if admin marked manually
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, attendance_date)
);

-- 6. Pump Location (for geo-fence validation)
CREATE TABLE IF NOT EXISTS public.pump_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    allowed_radius_meters INTEGER DEFAULT 200, -- employees must be within this radius
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Leaves Table
CREATE TABLE IF NOT EXISTS public.leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    leave_type leave_type NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    total_days INTEGER GENERATED ALWAYS AS (to_date - from_date + 1) STORED,
    reason TEXT NOT NULL,
    status leave_status DEFAULT 'PENDING',
    -- Backup arrangement
    backup_employee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    backup_notes TEXT,
    -- Approval
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Leave Balance Table (per year)
CREATE TABLE IF NOT EXISTS public.leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    planned_total INTEGER DEFAULT 12,
    planned_used INTEGER DEFAULT 0,
    sick_total INTEGER DEFAULT 7,
    sick_used INTEGER DEFAULT 0,
    casual_total INTEGER DEFAULT 5,
    casual_used INTEGER DEFAULT 0,
    emergency_total INTEGER DEFAULT 3,
    emergency_used INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, year)
);

-- 9. Incentives Table
CREATE TABLE IF NOT EXISTS public.incentives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    incentive_type VARCHAR(50) NOT NULL, -- 'PERFORMANCE', 'ATTENDANCE', 'FESTIVAL', 'OVERTIME', 'CUSTOM'
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    for_month INTEGER, -- 1-12
    for_year INTEGER,
    is_paid BOOLEAN DEFAULT false,
    paid_on DATE,
    added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Fuel Load / Tanker Trip Table
-- For employees who go to pick up fuel from the terminal
CREATE TABLE IF NOT EXISTS public.fuel_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_number VARCHAR(30) UNIQUE NOT NULL,  -- Auto-generated e.g. FL-2024-001
    -- Assignment
    driver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    helper_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- optional helper
    -- Vehicle
    vehicle_number VARCHAR(20) NOT NULL,
    vehicle_type VARCHAR(50), -- 'TANKER_10KL', 'TANKER_20KL'
    -- Terminal details
    terminal_name VARCHAR(100) NOT NULL,
    terminal_address TEXT,
    -- Fuel details
    fuel_type fuel_type NOT NULL,
    ordered_quantity_liters DECIMAL(10, 2) NOT NULL,
    loaded_quantity_liters DECIMAL(10, 2),
    received_quantity_liters DECIMAL(10, 2),
    -- Trip timing
    scheduled_departure TIMESTAMP WITH TIME ZONE,
    actual_departure TIMESTAMP WITH TIME ZONE,
    actual_arrival TIMESTAMP WITH TIME ZONE,
    -- Geo tracking
    departure_latitude DECIMAL(10, 8),
    departure_longitude DECIMAL(11, 8),
    arrival_latitude DECIMAL(10, 8),
    arrival_longitude DECIMAL(11, 8),
    -- Documents
    delivery_challan_number VARCHAR(50),
    gate_pass_number VARCHAR(50),
    -- Status
    status fuel_load_status DEFAULT 'SCHEDULED',
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON public.attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_leaves_employee_id ON public.leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON public.leaves(status);
CREATE INDEX IF NOT EXISTS idx_incentives_employee_id ON public.incentives(employee_id);
CREATE INDEX IF NOT EXISTS idx_fuel_loads_driver ON public.fuel_loads(driver_id);
CREATE INDEX IF NOT EXISTS idx_fuel_loads_status ON public.fuel_loads(status);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON public.employee_shift_assignments(employee_id);

-- 12. Updated_at triggers
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leaves_updated_at BEFORE UPDATE ON public.leaves FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_incentives_updated_at BEFORE UPDATE ON public.incentives FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fuel_loads_updated_at BEFORE UPDATE ON public.fuel_loads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shift_assignments_updated_at BEFORE UPDATE ON public.employee_shift_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 13. RLS Policies for new tables
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pump_locations ENABLE ROW LEVEL SECURITY;

-- Employees can see own attendance; admins/super_admin see all
CREATE POLICY "Own attendance visible" ON public.attendance FOR SELECT
  USING (
    employee_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  );

CREATE POLICY "Admin can manage attendance" ON public.attendance FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Employees see own leaves; admin sees all
CREATE POLICY "Own leaves visible" ON public.leaves FOR SELECT
  USING (
    employee_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN')
  );

CREATE POLICY "Admin can manage leaves" ON public.leaves FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Incentives: employee sees own, admin manages all
CREATE POLICY "Own incentives visible" ON public.incentives FOR SELECT
  USING (
    employee_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  );

CREATE POLICY "Admin can manage incentives" ON public.incentives FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Fuel loads: driver sees own trips; admin sees all
CREATE POLICY "Own fuel loads visible" ON public.fuel_loads FOR SELECT
  USING (
    driver_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN')
  );

CREATE POLICY "Admin can manage fuel loads" ON public.fuel_loads FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Pump locations visible to all authenticated
CREATE POLICY "Pump locations visible to all" ON public.pump_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manages pump locations" ON public.pump_locations FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Shift assignments
CREATE POLICY "Own shift assignments visible" ON public.employee_shift_assignments FOR SELECT
  USING (
    employee_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN')
  );

CREATE POLICY "Admin manages shift assignments" ON public.employee_shift_assignments FOR ALL
  USING ((SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN'));

-- Leave balances
CREATE POLICY "Own leave balances visible" ON public.leave_balances FOR SELECT
  USING (
    employee_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = auth.uid()) IN ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  );

-- 14. Seed: Default pump location (update lat/lng as needed)
INSERT INTO public.pump_locations (name, latitude, longitude, allowed_radius_meters, is_primary)
VALUES ('Main Pump', 28.6139391, 77.2090212, 200, true)
ON CONFLICT DO NOTHING;
