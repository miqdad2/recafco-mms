create extension if not exists pgcrypto;

create table if not exists public.auth_users (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  email varchar(320) not null unique,
  password_hash text not null,
  password_set_at timestamptz,
  must_reset_password boolean not null default false,
  last_login_at timestamptz,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_token_hash text not null unique,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_sessions_profile_expiry_idx on public.auth_sessions(profile_id, expires_at);
create index if not exists auth_sessions_user_expiry_idx on public.auth_sessions(user_id, expires_at);
create index if not exists auth_sessions_active_idx on public.auth_sessions(expires_at) where revoked_at is null;

drop trigger if exists set_auth_users_updated_at on public.auth_users;
create trigger set_auth_users_updated_at
before update on public.auth_users
for each row execute function public.set_updated_at();

drop trigger if exists set_auth_sessions_updated_at on public.auth_sessions;
create trigger set_auth_sessions_updated_at
before update on public.auth_sessions
for each row execute function public.set_updated_at();
