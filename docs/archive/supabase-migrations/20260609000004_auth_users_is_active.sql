-- Add is_active column to auth_users.
-- The original local_auth_replacement DDL (20260606100000) omitted this column.
-- Prisma schema expects it; login flow uses profiles.is_active to gate access,
-- but auth_users.is_active is the auth-layer flag for direct account suspension.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to run multiple times.

alter table public.auth_users
  add column if not exists is_active boolean not null default true;
