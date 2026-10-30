create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Every minute: refresh the wheel status and resolve finished nights.
-- The function is public and idempotent, so no secret is needed here.
-- Replace the project ref if you deploy your own copy.
select cron.unschedule(jobid) from cron.job where jobname = 'polyhamster-tick';
select cron.schedule(
  'polyhamster-tick',
  '* * * * *',
  $$ select net.http_get(url := 'https://smwgeqxdxisrbhabkwdb.supabase.co/functions/v1/polyhamster?action=tick', timeout_milliseconds := 20000) $$
);
