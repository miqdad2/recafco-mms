create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  approval_type text not null default 'Work Order',
  status text not null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  comments text,
  created_at timestamptz not null default now(),
  constraint approvals_status_check check (status in ('Approved','Rejected','Closed','Verified'))
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  entity_type text not null,
  entity_id uuid,
  notification_type text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_technician_notes (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  labor_hours numeric(10,2) not null default 0,
  photo_file_name text,
  photo_file_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_approvals_work_order_id on public.approvals(work_order_id);
create index if not exists idx_notifications_recipient_created on public.notifications(recipient_id, created_at desc);
create index if not exists idx_notifications_is_read on public.notifications(is_read);
create index if not exists idx_work_order_technician_notes_work_order on public.work_order_technician_notes(work_order_id, created_at desc);
create index if not exists idx_work_order_technician_notes_technician on public.work_order_technician_notes(technician_id);

create or replace function public.is_assigned_technician(work_order_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.work_order_assignments a
    join public.profiles p on p.id = a.technician_id
    where a.work_order_id = work_order_uuid
      and p.id = auth.uid()
      and p.is_active = true
  );
$$;

insert into public.permissions (key, description)
values
  ('work_orders.approve', 'Approve, reject, and close maintenance work orders'),
  ('work_orders.assign', 'Assign technicians and verify completed maintenance work'),
  ('technician.jobs.view', 'View assigned technician jobs'),
  ('technician.jobs.update', 'Start, update, and complete assigned technician jobs'),
  ('notifications.view', 'View in-app notifications')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug = 'super_admin'
  and p.key in ('work_orders.approve','work_orders.assign','technician.jobs.view','technician.jobs.update','notifications.view')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('work_orders.approve','notifications.view')
where r.slug = 'maintenance_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('work_orders.assign','notifications.view')
where r.slug = 'maintenance_supervisor'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('technician.jobs.view','technician.jobs.update','notifications.view')
where r.slug = 'technician'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'notifications.view'
where r.slug in ('it_admin','ceo_management','maintenance_data_entry','store_keeper','purchase_officer','finance_manager','department_requester','viewer_auditor')
on conflict do nothing;

alter table public.approvals enable row level security;
alter table public.notifications enable row level security;
alter table public.work_order_technician_notes enable row level security;

drop policy if exists "approval viewers read approvals" on public.approvals;
create policy "approval viewers read approvals" on public.approvals
for select to authenticated
using (public.has_permission('work_orders.view') or public.is_assigned_technician(work_order_id));

drop policy if exists "approval managers write approvals" on public.approvals;
create policy "approval managers write approvals" on public.approvals
for all to authenticated
using (public.has_permission('work_orders.approve') or public.has_permission('work_orders.assign'))
with check (public.has_permission('work_orders.approve') or public.has_permission('work_orders.assign'));

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
for select to authenticated
using (recipient_id = auth.uid() or public.has_permission('admin.audit_logs.view'));

drop policy if exists "active users insert notifications" on public.notifications;
create policy "active users insert notifications" on public.notifications
for insert to authenticated
with check (public.current_user_is_active());

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists "technicians read own notes" on public.work_order_technician_notes;
create policy "technicians read own notes" on public.work_order_technician_notes
for select to authenticated
using (public.has_permission('work_orders.view') or technician_id = auth.uid());

drop policy if exists "technicians write own notes" on public.work_order_technician_notes;
create policy "technicians write own notes" on public.work_order_technician_notes
for insert to authenticated
with check (public.has_permission('technician.jobs.update') and technician_id = auth.uid() and public.is_assigned_technician(work_order_id));

drop policy if exists "work order viewers read work orders" on public.work_orders;
create policy "work order viewers read work orders" on public.work_orders
for select to authenticated
using (public.has_permission('work_orders.view') or public.is_assigned_technician(id));

drop policy if exists "work order viewers read assignments" on public.work_order_assignments;
create policy "work order viewers read assignments" on public.work_order_assignments
for select to authenticated
using (public.has_permission('work_orders.view') or technician_id = auth.uid());

drop policy if exists "assignment managers write assignments" on public.work_order_assignments;
create policy "assignment managers write assignments" on public.work_order_assignments
for all to authenticated
using (public.has_permission('work_orders.assign') or public.has_permission('work_orders.manage'))
with check (public.has_permission('work_orders.assign') or public.has_permission('work_orders.manage'));

drop policy if exists "work order viewers read labor" on public.work_order_labor;
create policy "work order viewers read labor" on public.work_order_labor
for select to authenticated
using (public.has_permission('work_orders.view') or public.is_assigned_technician(work_order_id));

drop policy if exists "work order viewers read attachments" on public.work_order_attachments;
create policy "work order viewers read attachments" on public.work_order_attachments
for select to authenticated
using (public.has_permission('work_orders.view') or public.is_assigned_technician(work_order_id));

drop policy if exists "assigned technicians update assigned work orders" on public.work_orders;
create policy "assigned technicians update assigned work orders" on public.work_orders
for update to authenticated
using (public.has_permission('technician.jobs.update') and public.is_assigned_technician(id))
with check (public.has_permission('technician.jobs.update') and public.is_assigned_technician(id));

drop policy if exists "assigned technicians insert labor" on public.work_order_labor;
create policy "assigned technicians insert labor" on public.work_order_labor
for insert to authenticated
with check (public.has_permission('technician.jobs.update') and public.is_assigned_technician(work_order_id));

drop policy if exists "assigned technicians insert attachments" on public.work_order_attachments;
create policy "assigned technicians insert attachments" on public.work_order_attachments
for insert to authenticated
with check (public.has_permission('technician.jobs.update') and public.is_assigned_technician(work_order_id));

insert into public.notifications(recipient_id, title, message, entity_type, entity_id, notification_type)
select p.id, 'Work order pending approval', 'A submitted work order is waiting for maintenance manager review.', 'work_order', wo.id, 'pending_approval'
from public.work_orders wo
cross join public.profiles p
join public.roles r on r.id = p.role_id
where wo.status in ('Submitted','Pending Approval')
  and r.slug in ('super_admin','maintenance_manager')
  and not exists (
    select 1 from public.notifications n
    where n.recipient_id = p.id and n.entity_id = wo.id and n.notification_type = 'pending_approval'
  );
