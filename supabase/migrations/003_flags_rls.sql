-- 003_flags_rls.sql — close the RLS gap on the flags table.
--
-- 001 enabled RLS on the 14 data tables but skipped `flags`, leaving it
-- exposed through PostgREST to anon/authenticated under Supabase's default
-- grants. Anyone with the publishable anon key could flip payments_enabled
-- (and any future kill-switch flags) and thereby bypass the bundle gate,
-- which skips its access check when the flag reads false.
--
-- Keep deny-by-default complete: every table in this schema carries RLS
-- with zero permissive policies; only service_role reaches these rows.

alter table flags enable row level security;
