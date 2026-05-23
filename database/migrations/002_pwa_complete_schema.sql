-- ============================================================
-- Phase 1 Complete Migration: PWA Employee Management System
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron; -- for monthly report trigger

-- ─── ENUMS ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE salary_type AS ENUM ('DAILY_WAGES', 'MONTHLY_FIXED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shift_type AS ENUM ('12HR', '24HR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE leave_status AS ENUM ('PENDING_ACCOUNTANT', 'PENDING_SUPER_ADMIN', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE leave_type AS ENUM ('PLANNED', 'EMERGENCY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE handover_status AS ENUM ('REQUESTED', 'CONFIRMED', 'REJECTED', 'ADMIN_ASSIGNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE duty_status AS ENUM ('SCHEDULED', 'ACCEPTED', 'REFUSED', 'DEPARTED', 'ARRIVED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'PENALTY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incentive_type AS ENUM ('OIL_SALES', 'LUBRICANT_SALES', 'LORRY_DUTY', 'FESTIVAL_BONUS', 'PERFORMANCE', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── SYSTEM SETTINGS (set by SUPER_ADMIN, one row) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Salary rules
  salary_type salary_type NOT NULL DEFAULT 'MONTHLY_FIXED',
  shift_type shift_type NOT NULL DEFAULT '12HR',
  -- Leave rules (for monthly fixed employees)
  paid_leaves_per_year INTEGER DEFAULT 12,
  emergency_leave_is_paid BOOLEAN DEFAULT TRUE,
  -- Penalty rule
  unapproved_absence_penalty_days DECIMAL(3,1) DEFAULT 2.0, -- deduct 2x daily salary
  -- Shift timing
  shift_a_start TIME DEFAULT '06:00:00',  -- morning shift start
  shift_a_end   TIME DEFAULT '18:00:00',
  shift_b_start TIME DEFAULT '18:00:00',  -- night shift start
  shift_b_end   TIME DEFAULT '06:00:00',
  -- Geo-fence
  pump_latitude  DECIMAL(10,8),
  pump_longitude DECIMAL(11,8),
  pump_radius_meters INTEGER DEFAULT 200,
  pump_name TEXT DEFAULT 'My Petrol Pump',
  -- Report
  report_whatsapp_number VARCHAR(20), -- super admin WhatsApp number with country code
  report_email TEXT,
  -- WhatsApp
  whatsapp_phone_number_id TEXT,
  whatsapp_access_token TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID
);

-- Ensure only one row
INSERT INTO public.system_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ─── USERS (employees) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Identity
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  phone      VARCHAR(20),            -- used for WhatsApp notifications
  -- Role & work
  role       user_role DEFAULT 'EMPLOYEE',
  employee_code VARCHAR(20) UNIQUE,
  date_of_joining DATE,
  date_of_birth   DATE,
  -- Salary
  base_salary DECIMAL(10,2) DEFAULT 0.00, -- monthly or daily depending on system_settings
  -- Documents
  aadhar_number VARCHAR(12),
  bank_account_number VARCHAR(20),
  bank_ifsc VARCHAR(11),
  -- Emergency
  emergency_contact_name  VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  address TEXT,
  -- Lorry duty rotation tracker
  lorry_duty_count INTEGER DEFAULT 0,      -- total times sent for lorry duty
  last_lorry_duty_date DATE,
  -- App preferences
  preferred_language VARCHAR(5) DEFAULT 'en',
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── ATTENDANCE ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status attendance_status DEFAULT 'PRESENT',
  -- Check-in
  check_in_time  TIMESTAMP WITH TIME ZONE,
  check_in_lat   DECIMAL(10,8),
  check_in_lng   DECIMAL(11,8),
  check_in_accuracy DECIMAL(8,2),
  check_in_verified BOOLEAN DEFAULT FALSE, -- within geo-fence?
  -- Check-out
  check_out_time TIMESTAMP WITH TIME ZONE,
  check_out_lat  DECIMAL(10,8),
  check_out_lng  DECIMAL(11,8),
  check_out_accuracy DECIMAL(8,2),
  check_out_verified BOOLEAN DEFAULT FALSE,
  -- Computed
  total_hours DECIMAL(5,2),
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  -- Admin override
  notes TEXT,
  marked_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(employee_id, attendance_date)
);

-- ─── SHIFT HANDOVERS ────────────────────────────────────────────────────────────
-- When employee wants to leave before shift ends, they must arrange replacement
CREATE TABLE IF NOT EXISTS public.shift_handovers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Who is leaving
  outgoing_employee_id UUID NOT NULL REFERENCES public.users(id),
  attendance_id UUID REFERENCES public.attendance(id),
  -- Who will replace
  incoming_employee_id UUID REFERENCES public.users(id),
  -- Timing
  handover_date DATE NOT NULL DEFAULT CURRENT_DATE,
  planned_handover_time TIME NOT NULL,
  -- Status
  status handover_status DEFAULT 'REQUESTED',
  -- Admin override (if incoming refuses or unavailable)
  admin_note TEXT,
  admin_assigned_by UUID REFERENCES public.users(id),
  -- Notification tracking
  notification_sent_at TIMESTAMP WITH TIME ZONE,
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── LEAVES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL DEFAULT 'PLANNED',
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  -- Computed: to_date - from_date + 1
  total_days INTEGER,
  reason TEXT NOT NULL,
  -- Backup arrangement
  backup_employee_id UUID REFERENCES public.users(id),
  backup_confirmed BOOLEAN DEFAULT FALSE,
  -- Approval chain
  status leave_status DEFAULT 'PENDING_ACCOUNTANT',
  accountant_action_by UUID REFERENCES public.users(id),
  accountant_action_at TIMESTAMP WITH TIME ZONE,
  super_admin_action_by UUID REFERENCES public.users(id),
  super_admin_action_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  -- If leave is paid (decided by super admin rule or override)
  is_paid_leave BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── LORRY DUTY (Fuel load trips) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lorry_duties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_number VARCHAR(30) UNIQUE NOT NULL,
  -- Assignment
  assigned_employee_id UUID NOT NULL REFERENCES public.users(id),
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Details
  terminal_name VARCHAR(100),
  vehicle_number VARCHAR(20),
  fuel_type VARCHAR(20) DEFAULT 'HSD',
  quantity_liters DECIMAL(10,2),
  -- Allowance paid for this duty (snacks + fare)
  allowance_amount DECIMAL(8,2) DEFAULT 0,
  -- Status
  status duty_status DEFAULT 'SCHEDULED',
  refused_at TIMESTAMP WITH TIME ZONE,
  refusal_reason TEXT,
  -- Geo
  departure_lat DECIMAL(10,8),
  departure_lng DECIMAL(11,8),
  arrival_lat   DECIMAL(10,8),
  arrival_lng   DECIMAL(11,8),
  departed_at   TIMESTAMP WITH TIME ZONE,
  arrived_at    TIMESTAMP WITH TIME ZONE,
  -- Documents
  challan_number VARCHAR(50),
  notes TEXT,
  assigned_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── INCENTIVES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incentives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  incentive_type incentive_type NOT NULL,
  -- For oil/lubricant: qty × rate
  quantity DECIMAL(10,2),        -- litres / packets / units
  rate_per_unit DECIMAL(8,2),    -- ₹ per unit
  -- Fixed or computed amount
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  for_month INTEGER NOT NULL,   -- 1-12
  for_year  INTEGER NOT NULL,
  -- Payment
  is_paid BOOLEAN DEFAULT FALSE,
  paid_on DATE,
  added_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── MONTHLY PAYSLIPS (computed on 1st of each month) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.monthly_payslips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  year  INTEGER NOT NULL,
  -- Working stats
  total_working_days INTEGER,     -- calendar days in month
  days_present       INTEGER DEFAULT 0,
  days_absent        INTEGER DEFAULT 0,
  days_on_leave      INTEGER DEFAULT 0,   -- approved paid leave
  days_unpaid_leave  INTEGER DEFAULT 0,
  days_penalized     INTEGER DEFAULT 0,   -- unapproved absences
  total_hours_worked DECIMAL(8,2) DEFAULT 0,
  overtime_hours     DECIMAL(8,2) DEFAULT 0,
  -- Salary components
  base_salary        DECIMAL(10,2) DEFAULT 0,  -- as configured
  deductions         DECIMAL(10,2) DEFAULT 0,  -- absences + penalties
  incentives_total   DECIMAL(10,2) DEFAULT 0,  -- from incentives table
  lorry_allowances   DECIMAL(10,2) DEFAULT 0,  -- from lorry_duties
  gross_salary       DECIMAL(10,2) DEFAULT 0,  -- base - deductions + incentives + lorry
  -- Meta
  salary_type        salary_type,
  shift_type         shift_type,
  report_sent        BOOLEAN DEFAULT FALSE,
  report_sent_at     TIMESTAMP WITH TIME ZONE,
  generated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

-- ─── NOTIFICATION LOG ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_phone VARCHAR(20),
  recipient_name  TEXT,
  message_type    TEXT,  -- 'HANDOVER_REQUEST', 'LORRY_DUTY', 'LEAVE_DECISION', 'MONTHLY_REPORT'
  message_body    TEXT,
  whatsapp_msg_id TEXT,
  status          TEXT DEFAULT 'SENT',  -- 'SENT', 'FAILED', 'DELIVERED'
  sent_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date   ON public.attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_leaves_employee       ON public.leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status         ON public.leaves(status);
CREATE INDEX IF NOT EXISTS idx_incentives_emp_month  ON public.incentives(employee_id, for_month, for_year);
CREATE INDEX IF NOT EXISTS idx_lorry_emp             ON public.lorry_duties(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_payslip_emp_month     ON public.monthly_payslips(employee_id, month, year);
CREATE INDEX IF NOT EXISTS idx_handover_date         ON public.shift_handovers(handover_date);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_leaves_updated_at
  BEFORE UPDATE ON public.leaves FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_lorry_updated_at
  BEFORE UPDATE ON public.lorry_duties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_handovers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lorry_duties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentives        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_payslips  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log  ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role::text FROM public.users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- Helper function: get current user's id
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- USERS policies
CREATE POLICY "Users: view all if admin"   ON public.users FOR SELECT
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT') OR auth_id = auth.uid());
CREATE POLICY "Users: manage if admin"     ON public.users FOR ALL
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- SYSTEM SETTINGS: only super admin writes, all read
CREATE POLICY "Settings: anyone reads"     ON public.system_settings FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Settings: super admin only" ON public.system_settings FOR UPDATE
  USING (current_user_role() = 'SUPER_ADMIN');

-- ATTENDANCE policies
CREATE POLICY "Attendance: own or admin"   ON public.attendance FOR SELECT
  USING (employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT'));
CREATE POLICY "Attendance: insert own"     ON public.attendance FOR INSERT
  WITH CHECK (employee_id = current_user_id());
CREATE POLICY "Attendance: update own or admin" ON public.attendance FOR UPDATE
  USING (employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- SHIFT HANDOVERS
CREATE POLICY "Handover: own or admin"     ON public.shift_handovers FOR SELECT
  USING (outgoing_employee_id = current_user_id() OR incoming_employee_id = current_user_id()
         OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));
CREATE POLICY "Handover: insert own"       ON public.shift_handovers FOR INSERT
  WITH CHECK (outgoing_employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));
CREATE POLICY "Handover: update relevant"  ON public.shift_handovers FOR UPDATE
  USING (outgoing_employee_id = current_user_id() OR incoming_employee_id = current_user_id()
         OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- LEAVES
CREATE POLICY "Leaves: own or admin"       ON public.leaves FOR SELECT
  USING (employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT'));
CREATE POLICY "Leaves: insert own"         ON public.leaves FOR INSERT
  WITH CHECK (employee_id = current_user_id());
CREATE POLICY "Leaves: update by approvers" ON public.leaves FOR UPDATE
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT') OR employee_id = current_user_id());

-- LORRY DUTIES
CREATE POLICY "Lorry: own or admin"        ON public.lorry_duties FOR SELECT
  USING (assigned_employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));
CREATE POLICY "Lorry: admin creates"       ON public.lorry_duties FOR INSERT
  WITH CHECK (current_user_role() IN ('SUPER_ADMIN','ADMIN'));
CREATE POLICY "Lorry: update relevant"     ON public.lorry_duties FOR UPDATE
  USING (assigned_employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- INCENTIVES
CREATE POLICY "Incentives: own or admin"   ON public.incentives FOR SELECT
  USING (employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT'));
CREATE POLICY "Incentives: admin manages"  ON public.incentives FOR ALL
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- PAYSLIPS
CREATE POLICY "Payslips: own or admin"     ON public.monthly_payslips FOR SELECT
  USING (employee_id = current_user_id() OR current_user_role() IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT'));
CREATE POLICY "Payslips: system insert"    ON public.monthly_payslips FOR ALL
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- NOTIFICATION LOG: admin only
CREATE POLICY "Notif log: admin only"      ON public.notification_log FOR ALL
  USING (current_user_role() IN ('SUPER_ADMIN','ADMIN'));

-- ─── PERMISSIONS ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
