alter table public.app_settings
  add column if not exists notification_retention_days integer not null default 180,
  add column if not exists notification_poll_interval_seconds integer not null default 45,
  add column if not exists force_critical_notifications boolean not null default true;

create table if not exists public.notification_events (
  event_key text primary key,
  category text not null,
  priority text not null default 'normal',
  description text not null default '',
  is_critical boolean not null default false,
  is_enabled boolean not null default true,
  supports_in_app boolean not null default true,
  supports_email boolean not null default false,
  supports_whatsapp boolean not null default false,
  supports_sms boolean not null default false,
  supports_push boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_events_priority_check check (priority in ('low','normal','high','urgent')),
  constraint notification_events_category_check check (category in ('Work Orders','Approvals','Technician Jobs','Parts Requests','Store / Inventory','Purchase','Finance','CEO / Management','Assets','Reports','System'))
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references public.notification_events(event_key) on delete cascade,
  channel text not null default 'in_app',
  title_template text not null,
  message_template text not null,
  action_label_template text,
  action_url_template text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_key, channel),
  constraint notification_templates_channel_check check (channel in ('in_app','email','whatsapp','sms','push'))
);

alter table public.notifications
  add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists recipient_role text,
  add column if not exists recipient_department_id uuid references public.departments(id) on delete set null,
  add column if not exists event_key text,
  add column if not exists category text not null default 'System',
  add column if not exists priority text not null default 'normal',
  add column if not exists action_url text,
  add column if not exists action_label text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.notifications
set recipient_user_id = coalesce(recipient_user_id, recipient_id),
    read_at = case when read_at is null and is_read = true then created_at else read_at end,
    event_key = coalesce(event_key, notification_type),
    category = coalesce(nullif(category, ''), 'System'),
    priority = coalesce(nullif(priority, ''), 'normal'),
    metadata = coalesce(metadata, '{}'::jsonb)
where recipient_user_id is null
   or read_at is null
   or event_key is null
   or metadata is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_priority_check'
  ) then
    alter table public.notifications
      add constraint notifications_priority_check check (priority in ('low','normal','high','urgent'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'notifications_category_check'
  ) then
    alter table public.notifications
      add constraint notifications_category_check check (category in ('Work Orders','Approvals','Technician Jobs','Parts Requests','Store / Inventory','Purchase','Finance','CEO / Management','Assets','Reports','System'));
  end if;
end $$;

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null references public.notification_events(event_key) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, event_key)
);

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  event_key text,
  recipient_user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'in_app',
  status text not null default 'queued',
  provider text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint notification_delivery_logs_channel_check check (channel in ('in_app','email','whatsapp','sms','push')),
  constraint notification_delivery_logs_status_check check (status in ('queued','sent','failed','skipped','disabled'))
);

create index if not exists idx_notifications_recipient_user_id on public.notifications(recipient_user_id);
create index if not exists idx_notifications_read_at on public.notifications(read_at);
create index if not exists idx_notifications_created_at on public.notifications(created_at desc);
create index if not exists idx_notifications_event_key on public.notifications(event_key);
create index if not exists idx_notifications_category on public.notifications(category);
create index if not exists idx_notifications_priority on public.notifications(priority);
create index if not exists idx_notifications_entity on public.notifications(entity_type, entity_id);
create index if not exists idx_notifications_unarchived_recipient on public.notifications(recipient_user_id, archived_at, created_at desc);
create index if not exists idx_notification_preferences_user on public.notification_preferences(user_id);
create index if not exists idx_notification_delivery_logs_event on public.notification_delivery_logs(event_key, attempted_at desc);
create index if not exists idx_notification_delivery_logs_recipient on public.notification_delivery_logs(recipient_user_id, attempted_at desc);

drop trigger if exists notification_events_set_updated_at on public.notification_events;
create trigger notification_events_set_updated_at before update on public.notification_events for each row execute function public.set_updated_at();

drop trigger if exists notification_templates_set_updated_at on public.notification_templates;
create trigger notification_templates_set_updated_at before update on public.notification_templates for each row execute function public.set_updated_at();

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at before update on public.notification_preferences for each row execute function public.set_updated_at();

insert into public.permissions (key, description)
values
  ('admin.notification_settings.manage', 'Manage notification events, templates, and delivery logs')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('admin.notification_settings.manage','notifications.view')
where r.slug in ('super_admin','it_admin')
on conflict do nothing;

insert into public.notification_events(event_key, category, priority, description, is_critical)
values
  ('work_order.created','Work Orders','normal','Work order created',false),
  ('work_order.submitted','Approvals','high','Work order submitted for approval',true),
  ('work_order.approved','Approvals','normal','Work order approved',true),
  ('work_order.rejected','Approvals','high','Work order rejected',true),
  ('work_order.assigned','Technician Jobs','high','Work order assigned',true),
  ('work_order.started','Technician Jobs','normal','Work order started',false),
  ('work_order.completed','Technician Jobs','high','Work order completed by technician',true),
  ('work_order.verified','Approvals','normal','Work order verified by supervisor',true),
  ('work_order.closed','Work Orders','normal','Work order closed',true),
  ('work_order.reopened','Work Orders','high','Work order reopened',true),
  ('work_order.cancelled','Work Orders','high','Work order cancelled',true),
  ('work_order.overdue','Work Orders','urgent','Work order overdue',true),
  ('technician.assigned','Technician Jobs','high','Technician assigned to job',true),
  ('technician.job_started','Technician Jobs','normal','Technician started job',false),
  ('technician.job_completed','Technician Jobs','high','Technician completed job',true),
  ('technician.note_added','Technician Jobs','low','Technician note added',false),
  ('technician.labor_added','Technician Jobs','low','Technician labor added',false),
  ('technician.photo_uploaded','Technician Jobs','low','Technician photo uploaded',false),
  ('parts_request.created','Parts Requests','normal','Parts request created',false),
  ('parts_request.submitted','Parts Requests','high','Parts request submitted',true),
  ('parts_request.approved','Parts Requests','high','Parts request approved',true),
  ('parts_request.rejected','Parts Requests','high','Parts request rejected',true),
  ('parts_request.partially_issued','Store / Inventory','normal','Parts partially issued',true),
  ('parts_request.issued','Store / Inventory','normal','Parts issued',true),
  ('parts_request.unavailable','Store / Inventory','high','Requested part unavailable',true),
  ('parts_request.waiting_purchase','Purchase','high','Parts request waiting for purchase',true),
  ('parts_request.closed','Parts Requests','normal','Parts request closed',false),
  ('inventory.low_stock','Store / Inventory','high','Inventory low stock',true),
  ('inventory.stock_issued','Store / Inventory','normal','Stock issued',false),
  ('inventory.stock_received','Store / Inventory','normal','Stock received',false),
  ('inventory.adjusted','Store / Inventory','normal','Inventory adjusted',false),
  ('inventory.returned','Store / Inventory','normal','Inventory returned',false),
  ('purchase_request.created','Purchase','normal','Purchase request created',false),
  ('purchase_request.submitted','Purchase','high','Purchase request submitted',true),
  ('purchase_request.pending_finance','Finance','high','Purchase request pending finance approval',true),
  ('purchase_request.pending_ceo','CEO / Management','urgent','Purchase request pending CEO approval',true),
  ('purchase_request.approved','Purchase','normal','Purchase request approved',true),
  ('purchase_request.rejected','Purchase','high','Purchase request rejected',true),
  ('purchase_request.ordered','Purchase','normal','Purchase request ordered',false),
  ('purchase_request.received','Purchase','normal','Purchase request received',true),
  ('purchase_request.cancelled','Purchase','high','Purchase request cancelled',true),
  ('finance.approval_required','Finance','high','Finance approval required',true),
  ('finance.approved','Finance','normal','Finance approved',true),
  ('finance.rejected','Finance','high','Finance rejected',true),
  ('ceo.approval_required','CEO / Management','urgent','CEO approval required',true),
  ('ceo.approved','CEO / Management','normal','CEO approved',true),
  ('ceo.rejected','CEO / Management','high','CEO rejected',true),
  ('high_cost_request.created','CEO / Management','urgent','High cost request created',true),
  ('asset.service_due','Assets','normal','Asset service due',false),
  ('asset.service_overdue','Assets','high','Asset service overdue',true),
  ('asset.registration_expiring','Assets','normal','Asset registration expiring',false),
  ('asset.insurance_expiring','Assets','normal','Asset insurance expiring',false),
  ('asset.warranty_expiring','Assets','normal','Asset warranty expiring',false),
  ('asset.breakdown_reported','Assets','high','Asset breakdown reported',true),
  ('asset.status_changed','Assets','normal','Asset status changed',false),
  ('report.exported','Reports','low','Report exported',false),
  ('file.uploaded','System','low','File uploaded',false),
  ('system_map.viewed','System','low','System map viewed',false),
  ('user.created','System','normal','User profile created or updated',false),
  ('role.changed','System','high','Role changed',true),
  ('settings.changed','System','high','Settings changed',true)
on conflict (event_key) do update
set category = excluded.category,
    priority = excluded.priority,
    description = excluded.description,
    is_critical = excluded.is_critical,
    updated_at = now();

insert into public.notification_templates(event_key, channel, title_template, message_template, action_label_template, action_url_template)
values
  ('work_order.submitted','in_app','New work order pending approval','Work order {work_order_number} for {asset_name} is waiting for your approval.','Review work order','/maintenance/work-orders/{entity_id}'),
  ('work_order.approved','in_app','Work order approved','Work order {work_order_number} is approved and ready for assignment.','Open work order','/maintenance/work-orders/{entity_id}'),
  ('work_order.rejected','in_app','Work order rejected','Work order {work_order_number} was rejected. Review comments and correct if needed.','Open work order','/maintenance/work-orders/{entity_id}'),
  ('work_order.assigned','in_app','New job assigned','Work order {work_order_number} has been assigned to you.','Open job','/technician/jobs/{entity_id}'),
  ('work_order.completed','in_app','Job completed','Work order {work_order_number} is completed by technician and waiting for verification.','Verify work order','/maintenance/work-orders/{entity_id}'),
  ('work_order.verified','in_app','Work order verified','Work order {work_order_number} is verified and ready for closure.','Close work order','/maintenance/work-orders/{entity_id}'),
  ('work_order.closed','in_app','Work order closed','Work order {work_order_number} has been closed.','View work order','/maintenance/work-orders/{entity_id}'),
  ('parts_request.submitted','in_app','Parts request pending approval','Parts request {parts_request_number} is waiting for maintenance approval.','Review parts request','/store/parts-requests/{entity_id}'),
  ('parts_request.approved','in_app','Parts request approved','Parts request {parts_request_number} is waiting for store issue.','Open parts request','/store/parts-requests/{entity_id}'),
  ('parts_request.rejected','in_app','Parts request rejected','Parts request {parts_request_number} was rejected.','Open parts request','/store/parts-requests/{entity_id}'),
  ('parts_request.issued','in_app','Parts issued','Parts request {parts_request_number} has been issued by store.','Open parts request','/store/parts-requests/{entity_id}'),
  ('parts_request.partially_issued','in_app','Parts partially issued','Parts request {parts_request_number} was partially issued by store.','Open parts request','/store/parts-requests/{entity_id}'),
  ('parts_request.unavailable','in_app','Part unavailable','Parts request {parts_request_number} has unavailable items requiring purchase action.','Open parts request','/store/parts-requests/{entity_id}'),
  ('purchase_request.created','in_app','Purchase request created','Purchase request {purchase_request_number} requires action.','Open purchase request','/purchase/requests/{entity_id}'),
  ('purchase_request.pending_finance','in_app','Finance approval required','Purchase request {purchase_request_number} requires finance approval.','Review finance approval','/finance/approvals'),
  ('purchase_request.pending_ceo','in_app','CEO approval required','Purchase request {purchase_request_number} requires CEO approval.','Review purchase request','/purchase/requests/{entity_id}'),
  ('purchase_request.ordered','in_app','Purchase ordered','Purchase request {purchase_request_number} has been ordered.','Open purchase request','/purchase/requests/{entity_id}'),
  ('purchase_request.received','in_app','Purchase received','Purchase request {purchase_request_number} was received and inventory was updated.','Open purchase request','/purchase/requests/{entity_id}'),
  ('finance.approved','in_app','Finance approved','Purchase request {purchase_request_number} finance decision: approved.','Open purchase request','/purchase/requests/{entity_id}'),
  ('finance.rejected','in_app','Finance rejected','Purchase request {purchase_request_number} finance decision: rejected.','Open purchase request','/purchase/requests/{entity_id}'),
  ('ceo.approved','in_app','CEO approved','Purchase request {purchase_request_number} CEO decision: approved.','Open purchase request','/purchase/requests/{entity_id}'),
  ('ceo.rejected','in_app','CEO rejected','Purchase request {purchase_request_number} CEO decision: rejected.','Open purchase request','/purchase/requests/{entity_id}'),
  ('inventory.low_stock','in_app','Low stock alert','Part {part_name} is at or below minimum stock.','View low stock','/store/low-stock'),
  ('file.uploaded','in_app','File uploaded','A file was uploaded for {entity_type}.','Open record','{action_url}'),
  ('report.exported','in_app','Report exported','A {report_name} report was exported.','Open reports','/reports/work-orders'),
  ('settings.changed','in_app','Settings changed','System settings were updated.','Open settings','/admin/settings'),
  ('user.created','in_app','User profile saved','User profile {user_name} was created or updated.','Open users','/admin/users')
on conflict (event_key, channel) do update
set title_template = excluded.title_template,
    message_template = excluded.message_template,
    action_label_template = excluded.action_label_template,
    action_url_template = excluded.action_url_template,
    updated_at = now();

alter table public.notification_events enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_delivery_logs enable row level security;

drop policy if exists "notification events are visible to authenticated users" on public.notification_events;
create policy "notification events are visible to authenticated users" on public.notification_events
for select to authenticated
using (true);

drop policy if exists "notification events managed by admins" on public.notification_events;
create policy "notification events managed by admins" on public.notification_events
for all to authenticated
using (public.has_permission('admin.notification_settings.manage') or public.has_permission('admin.settings.manage'))
with check (public.has_permission('admin.notification_settings.manage') or public.has_permission('admin.settings.manage'));

drop policy if exists "notification templates visible to authenticated users" on public.notification_templates;
create policy "notification templates visible to authenticated users" on public.notification_templates
for select to authenticated
using (true);

drop policy if exists "notification templates managed by admins" on public.notification_templates;
create policy "notification templates managed by admins" on public.notification_templates
for all to authenticated
using (public.has_permission('admin.notification_settings.manage') or public.has_permission('admin.settings.manage'))
with check (public.has_permission('admin.notification_settings.manage') or public.has_permission('admin.settings.manage'));

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
for select to authenticated
using (
  recipient_user_id = auth.uid()
  or recipient_id = auth.uid()
  or public.has_permission('admin.notification_settings.manage')
  or public.has_permission('admin.audit_logs.view')
);

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications
for update to authenticated
using (
  recipient_user_id = auth.uid()
  or recipient_id = auth.uid()
  or public.has_permission('admin.notification_settings.manage')
)
with check (
  recipient_user_id = auth.uid()
  or recipient_id = auth.uid()
  or public.has_permission('admin.notification_settings.manage')
);

drop policy if exists "active users insert notifications" on public.notifications;
create policy "active users insert notifications" on public.notifications
for insert to authenticated
with check (public.current_user_is_active());

drop policy if exists "users manage own notification preferences" on public.notification_preferences;
create policy "users manage own notification preferences" on public.notification_preferences
for all to authenticated
using (user_id = auth.uid() or public.has_permission('admin.notification_settings.manage'))
with check (user_id = auth.uid() or public.has_permission('admin.notification_settings.manage'));

drop policy if exists "delivery logs visible to admins and owners" on public.notification_delivery_logs;
create policy "delivery logs visible to admins and owners" on public.notification_delivery_logs
for select to authenticated
using (recipient_user_id = auth.uid() or public.has_permission('admin.notification_settings.manage') or public.has_permission('admin.audit_logs.view'));

drop policy if exists "delivery logs insert by active users" on public.notification_delivery_logs;
create policy "delivery logs insert by active users" on public.notification_delivery_logs
for insert to authenticated
with check (public.current_user_is_active());

insert into public.notifications(recipient_id, recipient_user_id, title, message, entity_type, entity_id, notification_type, event_key, category, priority, action_url, action_label, metadata, created_at)
select p.id, p.id, v.title, v.message, v.entity_type, v.entity_id, v.notification_type, v.event_key, v.category, v.priority, v.action_url, v.action_label, v.metadata::jsonb, now() - (v.age_hours || ' hours')::interval
from (
  select 'Urgent approval pending' title, 'A high priority purchase request requires executive approval.' message, 'purchase_request' entity_type, null::uuid entity_id, 'ceo_required' notification_type, 'purchase_request.pending_ceo' event_key, 'CEO / Management' category, 'urgent' priority, '/purchase/requests' action_url, 'Review approvals' action_label, '{"demo":true}' metadata, 2 age_hours, 'ceo_management' role_slug
  union all select 'Low stock alert','Engine Oil Filter is at or below minimum stock.','part',null::uuid,'low_stock','inventory.low_stock','Store / Inventory','high','/store/low-stock','View low stock','{"demo":true}',6,'store_keeper'
  union all select 'New job assigned','Work order REC/MD/MECH/JOB/0007 has been assigned to you.','work_order',null::uuid,'assigned','technician.assigned','Technician Jobs','high','/technician/jobs','Open jobs','{"demo":true}',12,'technician'
  union all select 'Work order pending approval','A submitted work order is waiting for maintenance manager review.','work_order',null::uuid,'pending_approval','work_order.submitted','Approvals','high','/maintenance/approvals','Review approvals','{"demo":true}',18,'maintenance_manager'
  union all select 'Report exported','A work order report was exported successfully.','report',null::uuid,'report_exported','report.exported','Reports','low','/reports/work-orders','Open reports','{"demo":true}',30,'super_admin'
) v
join public.roles r on r.slug = v.role_slug
join public.profiles p on p.role_id = r.id and p.is_active = true
where not exists (
  select 1 from public.notifications n
  where (n.recipient_user_id = p.id or n.recipient_id = p.id)
    and n.event_key = v.event_key
    and n.title = v.title
    and n.metadata->>'demo' = 'true'
);
