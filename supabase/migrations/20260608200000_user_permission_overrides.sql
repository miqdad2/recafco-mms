-- User-specific permission overrides
-- Allows Super Admin to grant or deny individual permissions to specific users,
-- independently of their role's default permission set.
--
-- Resolution order (in lib/auth/context.ts):
--   1. Role permissions are loaded as the base set.
--   2. 'allow' overrides add permissions not granted by the role.
--   3. 'deny' overrides remove permissions even if the role grants them.
--   4. Super Admin role bypasses all overrides and always has full access.
--
-- Note on impersonation:
--   Login-as-user (impersonation) is intentionally NOT implemented.
--   When implemented, it MUST create a dedicated audit log entry and
--   the impersonated session MUST be marked separately from real sessions.

create table if not exists public.user_permission_overrides (
  id             uuid        primary key default gen_random_uuid(),
  profile_id     uuid        not null references public.profiles(id) on delete cascade,
  permission_key text        not null,
  override_type  text        not null,
  reason         text,
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint upo_override_type_check check (override_type in ('allow', 'deny')),
  constraint upo_unique unique (profile_id, permission_key, override_type)
);

create index if not exists idx_upo_profile
  on public.user_permission_overrides(profile_id);

create index if not exists idx_upo_profile_type
  on public.user_permission_overrides(profile_id, override_type);
