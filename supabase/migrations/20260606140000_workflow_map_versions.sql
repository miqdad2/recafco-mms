create table if not exists public.workflow_map_versions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'RECAFCO Maintenance Workflow Workshop Map',
  version_number integer not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  diagram jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workflow_map_versions_status_created
on public.workflow_map_versions(status, created_at desc);

create index if not exists idx_workflow_map_versions_version
on public.workflow_map_versions(version_number desc);

drop trigger if exists trg_workflow_map_versions_updated_at on public.workflow_map_versions;
create trigger trg_workflow_map_versions_updated_at
before update on public.workflow_map_versions
for each row execute function public.set_updated_at();

insert into public.notification_events (
  event_key,
  category,
  priority,
  description,
  is_critical,
  is_enabled,
  supports_in_app
)
values (
  'system_map.updated',
  'System',
  'normal',
  'Editable workflow map version saved or published',
  false,
  true,
  true
)
on conflict (event_key) do update set
  category = excluded.category,
  priority = excluded.priority,
  description = excluded.description,
  is_enabled = excluded.is_enabled,
  supports_in_app = excluded.supports_in_app,
  updated_at = now();

insert into public.notification_templates (
  event_key,
  channel,
  title_template,
  message_template,
  action_label_template,
  action_url_template,
  is_active
)
values (
  'system_map.updated',
  'in_app',
  'Workflow map updated',
  '{{user_name}} saved workflow map version {{version_number}}.',
  'Open editable map',
  '/admin/system-map/edit',
  true
)
on conflict (event_key, channel) do update set
  title_template = excluded.title_template,
  message_template = excluded.message_template,
  action_label_template = excluded.action_label_template,
  action_url_template = excluded.action_url_template,
  is_active = excluded.is_active,
  updated_at = now();
