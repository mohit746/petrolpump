-- ============================================================
-- Migration 005: Monthly Payslip Automation via pg_cron
-- Run this in Supabase SQL Editor AFTER deploying the edge function:
--   supabase functions deploy monthly-report
-- ============================================================

-- Enable pg_cron (already enabled on Supabase)
-- Schedule: Run on 1st of every month at 6:00 AM UTC
SELECT cron.schedule(
  'monthly-payslip-generation',          -- job name (unique)
  '0 6 1 * *',                           -- cron: 6 AM on 1st of every month
  $$
    SELECT net.http_post(
      url     := current_setting('app.settings.supabase_url') || '/functions/v1/monthly-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ─── Alternative: if net.http_post is not available, use pg_net ──────────────
-- SELECT cron.schedule(
--   'monthly-payslip-generation',
--   '0 6 1 * *',
--   $$
--     SELECT pg_net.http_post(
--       url     => (SELECT 'https://' || id || '.supabase.co/functions/v1/monthly-report' FROM supabase_admin.projects LIMIT 1),
--       headers => '{"Content-Type":"application/json"}'::jsonb,
--       body    => '{}'::bytea
--     );
--   $$
-- );

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To unschedule:
-- SELECT cron.unschedule('monthly-payslip-generation');

-- ─── Set app config (run once, replace values) ────────────────────────────────
-- ALTER DATABASE postgres SET app.settings.supabase_url = 'https://aqtpuxjcotjukutezmbp.supabase.co';
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
