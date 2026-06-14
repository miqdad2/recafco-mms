-- User archive / soft-delete support.
--
-- Adds deleted_at to profiles and auth_users so Super Admins can archive
-- (hide) a user without destroying any linked business history.
--
-- Lifecycle rules enforced by application code:
--   Active   : is_active = true  AND deleted_at IS NULL
--   Deactivated: is_active = false AND deleted_at IS NULL
--   Archived : deleted_at IS NOT NULL   (is_active forced false on archive)
--
-- All statements are idempotent.

-- ── profiles ──────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists deleted_at timestamptz;

-- Partial index: only index rows that are actually archived (keeps it tiny).
create index if not exists idx_profiles_archived
  on public.profiles(deleted_at)
  where deleted_at is not null;

-- ── auth_users ────────────────────────────────────────────────────────────────

alter table public.auth_users
  add column if not exists deleted_at timestamptz;

create index if not exists idx_auth_users_archived
  on public.auth_users(deleted_at)
  where deleted_at is not null;
