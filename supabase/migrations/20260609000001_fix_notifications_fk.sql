-- Fix: drop auth.users FK constraints from notifications and approvals.
--
-- These columns were defined with "references auth.users(id)" in earlier migrations
-- (phase 3, notification upgrade). After the custom auth replacement
-- (20260606100000_local_auth_replacement.sql), profile IDs are generated independently
-- of Supabase auth.users. Any INSERT with a profile UUID that does not exist in
-- auth.users violates the constraint and is silently caught by sendNotification(),
-- logged as "failed", and discarded — so no notification row is ever written.
--
-- Using IF EXISTS makes each statement a no-op when the constraint is absent
-- (plain local PostgreSQL has no auth schema, so the FK was never created there).

alter table public.notifications
  drop constraint if exists notifications_recipient_id_fkey,
  drop constraint if exists notifications_recipient_user_id_fkey,
  drop constraint if exists notifications_created_by_fkey;

-- notification_delivery_logs has the same pattern.
alter table public.notification_delivery_logs
  drop constraint if exists notification_delivery_logs_recipient_user_id_fkey;

-- approvals.decided_by also referenced auth.users(id).
alter table public.approvals
  drop constraint if exists approvals_decided_by_fkey;
