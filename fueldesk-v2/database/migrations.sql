-- ============================================
-- FuelDesk v2 - Database Migration Scripts
-- Generated: 2026-05-20
-- ============================================

-- This file contains all required database schema updates
-- for the new features implemented in the system.

-- ============================================
-- PART 1: New Tables
-- ============================================

-- Notification Log Table
-- Stores audit trail of all WhatsApp notifications sent
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id UUID REFERENCES pumps(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  message_type TEXT NOT NULL,
  message_body TEXT,
  whatsapp_msg_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'NOT_CONFIGURED')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_log_pump_id ON notification_log(pump_id);
CREATE INDEX idx_notification_log_created_at ON notification_log(created_at DESC);
CREATE INDEX idx_notification_log_status ON notification_log(status);

-- Shift Handovers Table
-- Tracks shift handovers between employees
CREATE TABLE IF NOT EXISTS shift_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id UUID REFERENCES pumps(id) ON DELETE CASCADE,
  attendance_id UUID REFERENCES attendance(id) ON DELETE CASCADE,
  outgoing_employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  incoming_employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  handover_date DATE NOT NULL,
  planned_handover_time TIMESTAMPTZ,
  handover_note TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shift_handovers_pump_id ON shift_handovers(pump_id);
CREATE INDEX idx_shift_handovers_date ON shift_handovers(handover_date DESC);
CREATE INDEX idx_shift_handovers_outgoing ON shift_handovers(outgoing_employee_id);
CREATE INDEX idx_shift_handovers_incoming ON shift_handovers(incoming_employee_id);

-- ============================================
-- PART 2: Alter Existing Tables
-- ============================================

-- Add missing columns to attendance table (if not exists)
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS total_hours DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS check_out_lat DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS check_out_lng DECIMAL(11,8),
  ADD COLUMN IF NOT EXISTS check_out_accuracy DECIMAL(10,2);

-- Add missing columns to payslips table (if not exists)
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS total_working_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_present DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_absent DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_on_leave DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_paid_leave DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_unpaid_leave DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_half_day DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_penalty DECIMAL(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_hours_worked DECIMAL(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_type TEXT DEFAULT 'MONTHLY' CHECK (salary_type IN ('MONTHLY', 'DAILY')),
  ADD COLUMN IF NOT EXISTS overtime_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incentive_total DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lorry_bonus DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_salary DECIMAL(10,2) DEFAULT 0;

-- Rename net_salary column if basic_salary exists (adjust based on actual schema)
-- ALTER TABLE payslips RENAME COLUMN basic_salary TO base_salary;

-- Add missing columns to users table (if not exists)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS salary DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_lorry_duty_date TIMESTAMPTZ;

-- ============================================
-- PART 3: RPC Functions
-- ============================================

-- Get Email By Phone (used for mobile-number login)
-- This RPC bypasses RLS so anonymous users can resolve their phone → email
-- before calling supabase.auth.signInWithPassword().
-- It only returns the email (no other PII) and only for active, non-deleted users.
CREATE OR REPLACE FUNCTION get_email_by_phone(input_phone TEXT)
RETURNS TEXT AS $$
DECLARE
  result_email TEXT;
  normalized_phone TEXT;
  last_10_digits TEXT;
BEGIN
  -- Normalize input: strip everything except digits
  normalized_phone := REGEXP_REPLACE(COALESCE(input_phone, ''), '[^\d]', '', 'g');

  IF length(normalized_phone) < 10 THEN
    RETURN NULL;
  END IF;

  -- Last 10 digits is the canonical mobile number
  last_10_digits := RIGHT(normalized_phone, 10);

  -- Try matching against any common storage format:
  --   9876543210, 09876543210, 919876543210, +919876543210
  SELECT email INTO result_email
  FROM public.users
  WHERE deleted_at IS NULL
    AND is_active = TRUE
    AND COALESCE(is_blocked, FALSE) = FALSE
    AND (
      phone = last_10_digits
      OR phone = '0' || last_10_digits
      OR phone = '91' || last_10_digits
      OR phone = '+91' || last_10_digits
      OR REGEXP_REPLACE(phone, '[^\d]', '', 'g') = last_10_digits
      OR RIGHT(REGEXP_REPLACE(phone, '[^\d]', '', 'g'), 10) = last_10_digits
    )
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  RETURN result_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Allow anonymous (unauthenticated) calls — needed for the login screen
GRANT EXECUTE ON FUNCTION get_email_by_phone(TEXT) TO anon, authenticated;

-- Increment Lorry Duty Count
-- Called when a lorry duty is marked as COMPLETED
CREATE OR REPLACE FUNCTION increment_lorry_count(uid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET
    lorry_duty_count = COALESCE(lorry_duty_count, 0) + 1,
    last_lorry_duty_date = NOW()
  WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate Leave Balance
-- Returns leave balance for an employee
CREATE OR REPLACE FUNCTION calculate_leave_balance(
  emp_id UUID,
  p_id UUID,
  balance_year INTEGER
)
RETURNS TABLE(
  leave_type TEXT,
  total_quota INTEGER,
  used_days INTEGER,
  remaining_days INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH settings AS (
    SELECT
      COALESCE(MAX(CASE WHEN setting_key = 'casual_leaves_annual' THEN setting_value::INTEGER END), 12) AS casual_total,
      COALESCE(MAX(CASE WHEN setting_key = 'sick_leaves_annual' THEN setting_value::INTEGER END), 10) AS sick_total,
      COALESCE(MAX(CASE WHEN setting_key = 'earned_leaves_annual' THEN setting_value::INTEGER END), 15) AS earned_total
    FROM system_settings
    WHERE pump_id = p_id
  ),
  leave_usage AS (
    SELECT
      CASE
        WHEN l.leave_type = 'PLANNED' THEN 'CASUAL'
        WHEN l.leave_type = 'EMERGENCY' THEN 'SICK'
        ELSE 'EARNED'
      END AS ltype,
      SUM(
        EXTRACT(DAY FROM l.end_date - l.start_date) + 1
      )::INTEGER AS days_used
    FROM leaves l
    WHERE l.user_id = emp_id
      AND l.pump_id = p_id
      AND l.status = 'APPROVED'
      AND EXTRACT(YEAR FROM l.start_date) = balance_year
    GROUP BY ltype
  )
  SELECT
    'CASUAL'::TEXT,
    s.casual_total,
    COALESCE(lu.days_used, 0),
    s.casual_total - COALESCE(lu.days_used, 0)
  FROM settings s
  LEFT JOIN leave_usage lu ON lu.ltype = 'CASUAL'
  UNION ALL
  SELECT
    'SICK'::TEXT,
    s.sick_total,
    COALESCE(lu.days_used, 0),
    s.sick_total - COALESCE(lu.days_used, 0)
  FROM settings s
  LEFT JOIN leave_usage lu ON lu.ltype = 'SICK'
  UNION ALL
  SELECT
    'EARNED'::TEXT,
    s.earned_total,
    COALESCE(lu.days_used, 0),
    s.earned_total - COALESCE(lu.days_used, 0)
  FROM settings s
  LEFT JOIN leave_usage lu ON lu.ltype = 'EARNED';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 4: Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS on new tables
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;

-- Notification Log Policies
CREATE POLICY "Users can view their pump's notification logs"
  ON notification_log FOR SELECT
  USING (
    pump_id IN (
      SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
    )
  );

CREATE POLICY "Users can insert notification logs for their pump"
  ON notification_log FOR INSERT
  WITH CHECK (
    pump_id IN (
      SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
    )
  );

-- Shift Handover Policies
CREATE POLICY "Users can view their pump's shift handovers"
  ON shift_handovers FOR SELECT
  USING (
    pump_id IN (
      SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
    )
  );

CREATE POLICY "Users can create shift handovers for their pump"
  ON shift_handovers FOR INSERT
  WITH CHECK (
    pump_id IN (
      SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
    )
  );

-- ============================================
-- PART 5: Update Existing RLS Policies
-- ============================================

-- Ensure all multi-tenant tables have pump_id filtering
-- (Run these only if policies don't exist)

-- Example: Attendance table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance'
    AND policyname = 'Users can only access their pump attendance'
  ) THEN
    CREATE POLICY "Users can only access their pump attendance"
      ON attendance FOR ALL
      USING (
        pump_id IN (
          SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
        )
      )
      WITH CHECK (
        pump_id IN (
          SELECT pump_id FROM users WHERE auth.uid() = users.auth_id
        )
      );
  END IF;
END $$;

-- ============================================
-- PART 6: Indexes for Performance
-- ============================================

-- Attendance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_pump_date ON attendance(pump_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- Leaves indexes
CREATE INDEX IF NOT EXISTS idx_leaves_user_id ON leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_pump_id ON leaves(pump_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(status);
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves(start_date, end_date);

-- Payslips indexes
CREATE INDEX IF NOT EXISTS idx_payslips_user_month ON payslips(user_id, month, year);
CREATE INDEX IF NOT EXISTS idx_payslips_pump_month ON payslips(pump_id, month, year);
CREATE INDEX IF NOT EXISTS idx_payslips_status ON payslips(status);

-- Incentives indexes
CREATE INDEX IF NOT EXISTS idx_incentives_user_id ON incentives(user_id);
CREATE INDEX IF NOT EXISTS idx_incentives_pump_id ON incentives(pump_id);
CREATE INDEX IF NOT EXISTS idx_incentives_awarded_at ON incentives(awarded_at DESC);

-- Lorry Duties indexes
CREATE INDEX IF NOT EXISTS idx_lorry_duties_user_id ON lorry_duties(user_id);
CREATE INDEX IF NOT EXISTS idx_lorry_duties_pump_id ON lorry_duties(pump_id);
CREATE INDEX IF NOT EXISTS idx_lorry_duties_status ON lorry_duties(status);
CREATE INDEX IF NOT EXISTS idx_lorry_duties_date ON lorry_duties(duty_date DESC);

-- ============================================
-- PART 7: Data Validation Triggers
-- ============================================

-- Prevent leave application if balance exhausted
CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER AS $$
DECLARE
  balance_remaining INTEGER;
BEGIN
  -- Get remaining leave balance
  SELECT remaining_days INTO balance_remaining
  FROM calculate_leave_balance(NEW.user_id, NEW.pump_id, EXTRACT(YEAR FROM NEW.start_date)::INTEGER)
  WHERE leave_type = 'CASUAL' -- Adjust based on leave type logic
  LIMIT 1;

  -- Calculate requested days
  DECLARE
    requested_days INTEGER := EXTRACT(DAY FROM NEW.end_date - NEW.start_date) + 1;
  BEGIN
    IF requested_days > balance_remaining THEN
      RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %', balance_remaining, requested_days;
    END IF;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Uncomment to enable leave balance validation
-- CREATE TRIGGER validate_leave_balance
--   BEFORE INSERT ON leaves
--   FOR EACH ROW
--   EXECUTE FUNCTION check_leave_balance();

-- ============================================
-- PART 8: Views for Reporting
-- ============================================

-- Monthly Attendance Summary View
CREATE OR REPLACE VIEW monthly_attendance_summary AS
SELECT
  a.pump_id,
  a.user_id,
  u.first_name,
  u.last_name,
  EXTRACT(YEAR FROM a.shift_date) AS year,
  EXTRACT(MONTH FROM a.shift_date) AS month,
  COUNT(*) AS total_days,
  SUM(CASE WHEN a.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS days_present,
  SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END) AS days_absent,
  SUM(CASE WHEN a.status = 'ON_LEAVE' THEN 1 ELSE 0 END) AS days_on_leave,
  SUM(CASE WHEN a.status = 'LATE' THEN 1 ELSE 0 END) AS days_late,
  SUM(CASE WHEN a.status = 'HALF_DAY' THEN 0.5 ELSE 0 END) AS days_half_day,
  SUM(COALESCE(a.total_hours, 0)) AS total_hours_worked,
  SUM(COALESCE(a.overtime_hours, 0)) AS total_overtime
FROM attendance a
JOIN users u ON a.user_id = u.id
GROUP BY a.pump_id, a.user_id, u.first_name, u.last_name, year, month;

-- ============================================
-- PART 9: Sample Data (Optional - for testing)
-- ============================================

-- Insert sample system settings if they don't exist
INSERT INTO system_settings (pump_id, key, value)
SELECT
  p.id,
  unnest(ARRAY[
    'casual_leaves_annual', 'sick_leaves_annual', 'earned_leaves_annual',
    'max_consecutive_leaves', 'late_grace_minutes', 'overtime_rate',
    'deduction_method', 'payslip_day'
  ]),
  unnest(ARRAY['12', '10', '15', '7', '15', '1.5', 'per_day', '25'])
FROM pumps p
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE pump_id = p.id
  AND key = 'casual_leaves_annual'
)
ON CONFLICT (pump_id, key) DO NOTHING;

-- ============================================
-- PART 10: Cleanup Old Data (Optional)
-- ============================================

-- Archive old notification logs (older than 6 months)
-- CREATE TABLE IF NOT EXISTS notification_log_archive (LIKE notification_log INCLUDING ALL);
--
-- WITH archived AS (
--   DELETE FROM notification_log
--   WHERE created_at < NOW() - INTERVAL '6 months'
--   RETURNING *
-- )
-- INSERT INTO notification_log_archive SELECT * FROM archived;

-- ============================================
-- Migration Complete
-- ============================================

-- Verify migration
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'New tables created: notification_log, shift_handovers';
  RAISE NOTICE 'RPC functions created: increment_lorry_count, calculate_leave_balance';
  RAISE NOTICE 'Indexes and policies applied.';
END $$;
