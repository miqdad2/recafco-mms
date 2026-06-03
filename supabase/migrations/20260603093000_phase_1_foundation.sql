create extension if not exists "pgcrypto";

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  description text,
  manager_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  employee_number text,
  phone text,
  job_title text,
  department_id uuid references public.departments(id) on delete set null,
  role_id uuid references public.roles(id) on delete set null,
  is_active boolean not null default true,
  can_view_costs boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  company_name text not null default 'RECAFCO',
  default_currency text not null default 'KWD',
  work_order_number_format text not null default 'REC/MD/{TYPE}/JOB/{0000}',
  parts_request_number_format text not null default 'REC/STORE/PR/{0000}',
  purchase_request_number_format text not null default 'REC/PUR/{0000}',
  ceo_approval_threshold numeric(12,3) not null default 1000,
  requester_confirmation_enabled boolean not null default true,
  finance_approval_enabled boolean not null default true,
  ceo_approval_enabled boolean not null default true,
  logo_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint app_settings_singleton check (id = '00000000-0000-0000-0000-000000000001')
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_department_id on public.profiles(department_id);
create index if not exists idx_profiles_role_id on public.profiles(role_id);
create index if not exists idx_profiles_is_active on public.profiles(is_active);
create index if not exists idx_departments_is_active on public.departments(is_active);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_actor_id on public.audit_logs(actor_id);
create index if not exists idx_audit_logs_action on public.audit_logs(action);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
before update on public.departments
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  );
$$;

create or replace function public.current_user_role_slug()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.slug
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.is_active = true
  limit 1;
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions pe on pe.id = rp.permission_id
    where p.id = auth.uid()
      and p.is_active = true
      and (r.slug = 'super_admin' or pe.key = permission_key)
  );
$$;

alter table public.departments enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "active users can read departments" on public.departments;
create policy "active users can read departments"
on public.departments for select
to authenticated
using (public.current_user_is_active());

drop policy if exists "department managers can write departments" on public.departments;
create policy "department managers can write departments"
on public.departments for all
to authenticated
using (public.has_permission('admin.departments.manage'))
with check (public.has_permission('admin.departments.manage'));

drop policy if exists "active users can read roles" on public.roles;
create policy "active users can read roles"
on public.roles for select
to authenticated
using (public.current_user_is_active());

drop policy if exists "active users can read permissions" on public.permissions;
create policy "active users can read permissions"
on public.permissions for select
to authenticated
using (public.current_user_is_active());

drop policy if exists "active users can read role permissions" on public.role_permissions;
create policy "active users can read role permissions"
on public.role_permissions for select
to authenticated
using (public.current_user_is_active());

drop policy if exists "users read own profile or admins read all" on public.profiles;
create policy "users read own profile or admins read all"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.has_permission('admin.users.manage'));

drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles"
on public.profiles for all
to authenticated
using (public.has_permission('admin.users.manage'))
with check (public.has_permission('admin.users.manage'));

drop policy if exists "active users read settings" on public.app_settings;
create policy "active users read settings"
on public.app_settings for select
to authenticated
using (public.current_user_is_active());

drop policy if exists "settings managers update settings" on public.app_settings;
create policy "settings managers update settings"
on public.app_settings for all
to authenticated
using (public.has_permission('admin.settings.manage'))
with check (public.has_permission('admin.settings.manage'));

drop policy if exists "active users can insert audit logs" on public.audit_logs;
create policy "active users can insert audit logs"
on public.audit_logs for insert
to authenticated
with check (public.current_user_is_active());

drop policy if exists "audit viewers can read audit logs" on public.audit_logs;
create policy "audit viewers can read audit logs"
on public.audit_logs for select
to authenticated
using (public.has_permission('admin.audit_logs.view'));

insert into public.permissions (key, description)
values
  ('dashboard.view', 'View the authenticated dashboard'),
  ('admin.users.manage', 'Manage users and profiles'),
  ('admin.roles.view', 'View roles and permissions'),
  ('admin.departments.manage', 'Manage departments'),
  ('admin.settings.manage', 'Manage application settings'),
  ('admin.audit_logs.view', 'View audit logs'),
  ('costs.view', 'View sensitive maintenance and finance costs')
on conflict (key) do update set description = excluded.description;

insert into public.roles (name, slug, description)
values
  ('Super Admin', 'super_admin', 'Full system control across all modules.'),
  ('IT Admin', 'it_admin', 'Manage users, departments, settings, and audit support.'),
  ('CEO / Management', 'ceo_management', 'Management dashboards and high-level approvals.'),
  ('Maintenance Manager', 'maintenance_manager', 'Maintenance approvals, costs if permitted, and closure.'),
  ('Maintenance Supervisor', 'maintenance_supervisor', 'Assignments, technician workload, and verification.'),
  ('Maintenance Data Entry', 'maintenance_data_entry', 'Create and submit maintenance records.'),
  ('Technician / Mechanic', 'technician', 'Assigned mobile jobs and technician updates.'),
  ('Store Keeper', 'store_keeper', 'Parts requests, stock issue, and inventory movements.'),
  ('Purchase Officer', 'purchase_officer', 'Purchase request coordination and supplier documents.'),
  ('Finance Manager', 'finance_manager', 'Finance approvals and cost reporting.'),
  ('Department Requester', 'department_requester', 'Department request tracking and confirmation.'),
  ('Viewer / Auditor', 'viewer_auditor', 'Read-only reporting and audit visibility when permitted.')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug = 'super_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'dashboard.view',
  'admin.users.manage',
  'admin.roles.view',
  'admin.departments.manage',
  'admin.settings.manage',
  'admin.audit_logs.view'
)
where r.slug = 'it_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('dashboard.view', 'costs.view')
where r.slug in ('ceo_management', 'finance_manager')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'dashboard.view'
where r.slug in (
  'maintenance_manager',
  'maintenance_supervisor',
  'maintenance_data_entry',
  'technician',
  'store_keeper',
  'purchase_officer',
  'department_requester',
  'viewer_auditor'
)
on conflict do nothing;

insert into public.departments (name, code, description)
values
  ('Maintenance Department', 'MNT', 'Maintenance operations and work order control.'),
  ('Store Department', 'STR', 'Spare parts store and inventory issue.'),
  ('Purchase Department', 'PUR', 'Purchase request and supplier coordination.'),
  ('Finance Department', 'FIN', 'Finance approvals and cost reporting.'),
  ('IT Department', 'IT', 'System administration and technical support.'),
  ('Operations Department', 'OPS', 'Operations and equipment request coordination.'),
  ('CEO Office', 'CEO', 'Executive monitoring and approvals.')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.app_settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
