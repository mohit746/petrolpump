-- Seed data for Petrol Pump Management System
-- Run this after running migration: 002_pwa_complete_schema.sql

-- ========== AVAILABLE ROLES (System Recognized) ==========
-- Role Value: 'SUPER_ADMIN'
--   - Full system access, manage all settings, approve leaves, manage admins, view reports
--
-- Role Value: 'ADMIN'
--   - Manage employees, view reports, approve shifts, manage attendance
--
-- Role Value: 'ACCOUNTANT'
--   - Manage salaries, incentives, process payments, view financial records
--
-- Role Value: 'EMPLOYEE'
--   - Mark attendance, view own data, request leaves, apply for duties

-- ========== USERS - SUPER ADMIN ==========
INSERT INTO public.users (auth_id, email, first_name, last_name, phone, role, employee_code, date_of_joining, base_salary, is_active) 
VALUES 
('5a89c7c3-7a10-4b8a-9d5c-445314fc5747', 'mohitdwivedi746@gmail.com', 'Mohit', 'Dwivedi', '+919999999999', 'SUPER_ADMIN', 'SA001', CURRENT_DATE, 50000.00, TRUE)
ON CONFLICT (auth_id) DO NOTHING;

-- ========== USERS - ADMIN ==========
INSERT INTO public.users (auth_id, email, first_name, last_name, phone, role, employee_code, date_of_joining, base_salary, is_active) 
VALUES 
(NULL, 'admin@petrolpump.com', 'System', 'Admin', '+919999999998', 'ADMIN', 'AD001', CURRENT_DATE, 40000.00, TRUE)
ON CONFLICT (auth_id) DO NOTHING;

-- ========== USERS - ACCOUNTANT ==========
INSERT INTO public.users (auth_id, email, first_name, last_name, phone, role, employee_code, date_of_joining, base_salary, is_active) 
VALUES 
(NULL, 'accountant@petrolpump.com', 'Finance', 'Manager', '+919999999997', 'ACCOUNTANT', 'ACC001', CURRENT_DATE, 35000.00, TRUE)
ON CONFLICT (auth_id) DO NOTHING;

-- ========== USERS - EMPLOYEES (4 Employees) ==========
INSERT INTO public.users (auth_id, email, first_name, last_name, phone, role, employee_code, date_of_joining, base_salary, aadhar_number, bank_account_number, bank_ifsc, is_active) 
VALUES 
(NULL, 'kishan.singh@petrolpump.com', 'Kishan', 'Singh', '+918765432101', 'EMPLOYEE', 'EMP001', '2025-01-15'::DATE, 18000.00, '123456789012', '1234567890123456', 'HDFC0001234', TRUE),
(NULL, 'prahlad.m@petrolpump.com', 'Prahlad', 'M', '+918765432102', 'EMPLOYEE', 'EMP002', '2025-02-10'::DATE, 18000.00, '234567890123', '2345678901234567', 'ICIC0005678', TRUE),
(NULL, 'shankar.v@petrolpump.com', 'Shankar', 'V', '+918765432103', 'EMPLOYEE', 'EMP003', '2025-03-05'::DATE, 18000.00, '345678901234', '3456789012345678', 'AXIS0009012', TRUE),
(NULL, 'bablu.bhatt@petrolpump.com', 'Bablu', 'Bhatt', '+918765432104', 'EMPLOYEE', 'EMP004', '2025-04-01'::DATE, 18000.00, '456789012345', '4567890123456789', 'SBIN0003456', TRUE)
ON CONFLICT (auth_id) DO NOTHING;

-- ========== SYSTEM SETTINGS ==========
UPDATE public.system_settings 
SET 
  salary_type = 'MONTHLY_FIXED',
  shift_type = '12HR',
  paid_leaves_per_year = 12,
  emergency_leave_is_paid = TRUE,
  unapproved_absence_penalty_days = 2.0,
  shift_a_start = '06:00:00',
  shift_a_end = '18:00:00',
  shift_b_start = '18:00:00',
  shift_b_end = '06:00:00',
  pump_name = 'Petrol Pump Management System',
  pump_latitude = 24.788297,
  pump_longitude = 74.104187,
  pump_radius_meters = 150,
  report_whatsapp_number = '+919640620555',
  report_email = 'mohitdwivedi746@gmail.com',
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ========== ATTENDANCE RECORDS ==========
INSERT INTO public.attendance (employee_id, attendance_date, status, check_in_time, check_in_lat, check_in_lng, check_in_verified, check_out_time, check_out_lat, check_out_lng, check_out_verified, total_hours, notes)
SELECT u.id, CURRENT_DATE - INTERVAL '1 day', 'PRESENT', NOW() - INTERVAL '1 day' + INTERVAL '6 hours', 28.7041, 77.1025, TRUE, NOW() - INTERVAL '1 day' + INTERVAL '18 hours', 28.7041, 77.1025, TRUE, 12.0, 'Regular shift'
FROM public.users u WHERE u.employee_code IN ('EMP001', 'EMP002', 'EMP003', 'EMP004')
ON CONFLICT (employee_id, attendance_date) DO NOTHING;

INSERT INTO public.attendance (employee_id, attendance_date, status, check_in_time, check_in_lat, check_in_lng, check_in_verified, check_out_time, check_out_lat, check_out_lng, check_out_verified, total_hours, notes)
SELECT u.id, CURRENT_DATE, 'PRESENT', NOW() + INTERVAL '6 hours', 28.7041, 77.1025, TRUE, NULL, NULL, NULL, FALSE, NULL, 'Today''s shift - in progress'
FROM public.users u WHERE u.employee_code IN ('EMP001', 'EMP002')
ON CONFLICT (employee_id, attendance_date) DO NOTHING;

-- ========== LEAVE REQUESTS ==========
INSERT INTO public.leaves (employee_id, leave_type, from_date, to_date, status, reason, created_at)
SELECT u.id, 'PLANNED', CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '8 days', 'APPROVED', 'Personal work', NOW()
FROM public.users u WHERE u.employee_code = 'EMP001'
ON CONFLICT DO NOTHING;

INSERT INTO public.leaves (employee_id, leave_type, from_date, to_date, status, reason, created_at)
SELECT u.id, 'EMERGENCY', CURRENT_DATE + INTERVAL '2 days', CURRENT_DATE + INTERVAL '2 days', 'PENDING_SUPER_ADMIN', 'Medical emergency', NOW()
FROM public.users u WHERE u.employee_code = 'EMP003'
ON CONFLICT DO NOTHING;

-- ========== INCENTIVES ==========
INSERT INTO public.incentives (employee_id, incentive_type, amount, description, added_by, for_month, for_year, created_at)
SELECT u.id, 'OIL_SALES', 500.00, 'Oil sales target achieved', 
  (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1), EXTRACT(MONTH FROM CURRENT_DATE), EXTRACT(YEAR FROM CURRENT_DATE), NOW()
FROM public.users u WHERE u.employee_code IN ('EMP001', 'EMP002')
ON CONFLICT DO NOTHING;

INSERT INTO public.incentives (employee_id, incentive_type, amount, description, added_by, for_month, for_year, created_at)
SELECT u.id, 'LUBRICANT_SALES', 750.00, 'Lubricant sales achievement', 
  (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1), EXTRACT(MONTH FROM CURRENT_DATE), EXTRACT(YEAR FROM CURRENT_DATE), NOW()
FROM public.users u WHERE u.employee_code IN ('EMP003', 'EMP004')
ON CONFLICT DO NOTHING;

-- ========== SALARY RECORDS (monthly_payslips) ==========
-- Note: Payslips are typically auto-generated on the 1st of each month
-- For now, we skip seeding - they'll be created by system
-- INSERT INTO public.monthly_payslips...

-- ========== LORRY DUTIES ASSIGNMENTS ==========
INSERT INTO public.lorry_duties (trip_number, assigned_employee_id, assigned_date, terminal_name, vehicle_number, fuel_type, quantity_liters, allowance_amount, status, assigned_by, created_at)
SELECT 'TRIP-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001', u.id, CURRENT_DATE, 'Distribution Center - North', 'DL-01-AB-1234', 'HSD', 5000.00, 500.00, 'SCHEDULED', 
  (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1), NOW()
FROM public.users u WHERE u.employee_code = 'EMP001'
ON CONFLICT (trip_number) DO NOTHING;

INSERT INTO public.lorry_duties (trip_number, assigned_employee_id, assigned_date, terminal_name, vehicle_number, fuel_type, quantity_liters, allowance_amount, status, assigned_by, created_at)
SELECT 'TRIP-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-002', u.id, CURRENT_DATE, 'Main Pump Storage', 'DL-01-AB-5678', 'MS', 3000.00, 400.00, 'COMPLETED', 
  (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1), NOW()
FROM public.users u WHERE u.employee_code = 'EMP002'
ON CONFLICT (trip_number) DO NOTHING;