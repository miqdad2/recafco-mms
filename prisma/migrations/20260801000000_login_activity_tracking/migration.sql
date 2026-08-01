-- User Login Monitoring Improvement Task 2/14.
--
-- Additive login-activity tracking columns on auth_users so the Users page
-- and Manage User view can show admins who has actually logged in and when,
-- without touching any existing column, data, or auth behavior.
--
-- last_login_at and failed_login_count already existed and are unchanged.
ALTER TABLE public.auth_users
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz(6) NULL,
  ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz(6) NULL;
