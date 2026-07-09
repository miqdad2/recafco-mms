-- Add password audit fields to auth_users.
-- password_changed_at: updated when the user successfully changes their own password.
-- temporary_password_set_at: set by admin at user creation or after an admin-initiated reset.
alter table public.auth_users
  add column if not exists password_changed_at     timestamptz,
  add column if not exists temporary_password_set_at timestamptz;
