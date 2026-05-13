-- Schedules the score-session-health edge function to run every minute.
-- Run this ONCE against the linked Supabase project after the
-- score-session-health function is deployed and GROQ_API_KEY is set.
--
-- Prereqs (run these once if not already enabled):
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   CREATE EXTENSION IF NOT EXISTS pg_net;     -- gives us net.http_post
--
-- Replace <SUPABASE_PROJECT_REF> and <SERVICE_ROLE_KEY> before running.
-- The service role key authorises the cron-initiated POST.

-- Make sure we don't end up with two of the same schedule.
SELECT cron.unschedule('score-session-health')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'score-session-health');

SELECT cron.schedule(
  'score-session-health',
  '* * * * *',                            -- every minute
  $$
    SELECT net.http_post(
      url := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/score-session-health',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

-- Verify the schedule landed:
SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname = 'score-session-health';
