-- Comprehensive local PostgreSQL compatibility migration.
-- All statements are idempotent (IF EXISTS / IF NOT EXISTS).
--
-- Fixes applied in this migration:
-- 1. Drop any remaining FK from public.profiles.id to auth.users.
--    On Supabase this was handled conditionally in 20260606113000; on plain
--    local PostgreSQL auth.users never existed so the FK was never created —
--    both cases are safe no-ops here.
--
-- 2. Add password_changed_at, temporary_password_set_at, and is_active to auth_users.
--    These columns were omitted from the original DDL in 20260606100000 and
--    introduced in later migrations; this section back-fills them idempotently.
--
-- 3. Add max_upload_size_mb and signed_url_expiry_seconds to app_settings.
--    The settings action schema references these columns but they were missing
--    from the original app_settings DDL.

-- ── 1. Drop profiles.id FK ──────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from   pg_constraint   c
    join   pg_class        t  on t.oid  = c.conrelid
    join   pg_namespace    n  on n.oid  = t.relnamespace
    join   pg_attribute    a  on a.attrelid = t.oid
                             and a.attnum   = c.conkey[1]
    where  n.nspname = 'public'
      and  t.relname = 'profiles'
      and  a.attname = 'id'
      and  c.contype = 'f'
  loop
    execute 'alter table public.profiles drop constraint ' || quote_ident(r.conname);
  end loop;
end;
$$;

-- ── 2. auth_users: add columns missing from the original DDL ────────────────

alter table public.auth_users
  add column if not exists password_changed_at       timestamptz,
  add column if not exists temporary_password_set_at timestamptz,
  add column if not exists is_active                 boolean not null default true;

-- ── 3. app_settings: add columns used by updateSettingsAction ───────────────

alter table public.app_settings
  add column if not exists max_upload_size_mb        integer not null default 10,
  add column if not exists signed_url_expiry_seconds integer not null default 300;
