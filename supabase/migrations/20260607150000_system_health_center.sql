create table if not exists public.system_error_logs (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'error',
  source text not null,
  message text not null,
  stack text,
  metadata jsonb not null default '{}'::jsonb,
  user_id uuid references public.profiles(id) on delete set null,
  route text,
  entity_type text,
  entity_id uuid,
  status text not null default 'open',
  resolution_notes text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_error_logs_severity_check check (severity in ('info', 'warning', 'error', 'critical')),
  constraint system_error_logs_status_check check (status in ('open', 'investigating', 'resolved', 'ignored'))
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

alter table public.system_error_logs add column if not exists route text;
alter table public.system_error_logs add column if not exists entity_type text;
alter table public.system_error_logs add column if not exists entity_id uuid;
alter table public.system_error_logs add column if not exists status text not null default 'open';
alter table public.system_error_logs add column if not exists resolution_notes text;
alter table public.system_error_logs add column if not exists resolved_by uuid references public.profiles(id) on delete set null;
alter table public.system_error_logs add column if not exists resolved_at timestamptz;
alter table public.system_error_logs add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_system_error_logs_created_at on public.system_error_logs(created_at desc);
create index if not exists idx_system_error_logs_status_created on public.system_error_logs(status, created_at desc);
create index if not exists idx_system_error_logs_severity_created on public.system_error_logs(severity, created_at desc);
create index if not exists idx_system_error_logs_source_created on public.system_error_logs(source, created_at desc);
create index if not exists idx_system_error_logs_user_created on public.system_error_logs(user_id, created_at desc);
create index if not exists idx_system_error_logs_entity on public.system_error_logs(entity_type, entity_id);

drop trigger if exists system_error_logs_set_updated_at on public.system_error_logs;
create trigger system_error_logs_set_updated_at
before update on public.system_error_logs
for each row execute function public.set_updated_at();

alter table public.system_error_logs enable row level security;

drop policy if exists "system health admins can read errors" on public.system_error_logs;
create policy "system health admins can read errors"
on public.system_error_logs for select
to authenticated
using (public.has_permission('admin.system_health.view') or public.has_permission('admin.audit_logs.view'));

drop policy if exists "system health admins can update errors" on public.system_error_logs;
create policy "system health admins can update errors"
on public.system_error_logs for update
to authenticated
using (public.has_permission('admin.system_health.manage') or public.has_permission('admin.audit_logs.view'))
with check (public.has_permission('admin.system_health.manage') or public.has_permission('admin.audit_logs.view'));

drop policy if exists "system health admins can insert manual errors" on public.system_error_logs;
create policy "system health admins can insert manual errors"
on public.system_error_logs for insert
to authenticated
with check (public.has_permission('admin.system_health.manage') or public.has_permission('admin.audit_logs.view'));

insert into public.permissions (key, description)
values
  ('admin.system_health.view', 'View system health, runtime issues, and reliability dashboard'),
  ('admin.system_health.manage', 'Manage system health issue status and manual issue notes')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('admin.system_health.view', 'admin.system_health.manage')
where r.slug in ('super_admin', 'it_admin')
on conflict do nothing;
