create table if not exists public.parts_requests (
  id uuid primary key default gen_random_uuid(),
  parts_request_number text unique,
  department_id uuid references public.departments(id) on delete set null,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  remarks text,
  request_date date not null default current_date,
  request_time time not null default current_time,
  serial_number text,
  requested_by uuid references public.profiles(id) on delete set null,
  prepared_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  status text not null default 'Submitted',
  approval_comments text,
  store_issue_comments text,
  total_price numeric(12,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint parts_requests_status_check check (status in ('Draft','Submitted','Pending Approval','Approved','Rejected','Waiting for Store','Partially Issued','Issued','Waiting for Purchase','Closed','Cancelled'))
);

alter table public.approvals alter column work_order_id drop not null;

create table if not exists public.parts_request_items (
  id uuid primary key default gen_random_uuid(),
  parts_request_id uuid not null references public.parts_requests(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  description text not null,
  part_number text,
  ss_rec_code text,
  quantity_requested numeric(12,2) not null default 0,
  unit_price numeric(12,3) not null default 0,
  total_price numeric(12,3) generated always as (coalesce(quantity_requested,0) * coalesce(unit_price,0)) stored,
  remarks text,
  stock_availability text not null default 'Unchecked',
  issued_quantity numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint parts_request_items_availability_check check (stock_availability in ('Unchecked','Available','Partial','Unavailable'))
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  movement_type text not null,
  quantity numeric(12,2) not null,
  unit_price numeric(12,3) not null default 0,
  work_order_id uuid references public.work_orders(id) on delete set null,
  parts_request_id uuid references public.parts_requests(id) on delete set null,
  purchase_request_id uuid,
  reference text,
  comments text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_type_check check (movement_type in ('Stock In','Stock Out','Issue to Work Order','Return from Work Order','Adjustment','Purchase Receive'))
);

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  purchase_request_number text unique,
  work_order_id uuid references public.work_orders(id) on delete set null,
  parts_request_id uuid references public.parts_requests(id) on delete set null,
  supplier text,
  status text not null default 'Draft',
  purchase_officer_notes text,
  finance_comments text,
  ceo_comments text,
  estimated_total numeric(12,3) not null default 0,
  finance_approved_by uuid references public.profiles(id) on delete set null,
  finance_approved_at timestamptz,
  ceo_approved_by uuid references public.profiles(id) on delete set null,
  ceo_approved_at timestamptz,
  quotation_file_name text,
  quotation_file_path text,
  invoice_file_name text,
  invoice_file_path text,
  delivery_note_file_name text,
  delivery_note_file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint purchase_requests_status_check check (status in ('Draft','Submitted','Pending Purchase','Pending Finance Approval','Pending CEO Approval','Approved','Ordered','Received','Rejected','Cancelled'))
);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  parts_request_item_id uuid references public.parts_request_items(id) on delete set null,
  part_id uuid references public.parts(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 0,
  estimated_unit_price numeric(12,3) not null default 0,
  estimated_total numeric(12,3) generated always as (coalesce(quantity,0) * coalesce(estimated_unit_price,0)) stored,
  supplier text,
  created_at timestamptz not null default now()
);

alter table public.inventory_movements
drop constraint if exists inventory_movements_purchase_request_fk;
alter table public.inventory_movements
add constraint inventory_movements_purchase_request_fk foreign key (purchase_request_id) references public.purchase_requests(id) on delete set null;

create index if not exists idx_parts_requests_status on public.parts_requests(status);
create index if not exists idx_parts_requests_work_order on public.parts_requests(work_order_id);
create index if not exists idx_parts_request_items_request on public.parts_request_items(parts_request_id);
create index if not exists idx_inventory_movements_part on public.inventory_movements(part_id, created_at desc);
create index if not exists idx_purchase_requests_status on public.purchase_requests(status);
create index if not exists idx_purchase_requests_parts_request on public.purchase_requests(parts_request_id);
create index if not exists idx_purchase_request_items_request on public.purchase_request_items(purchase_request_id);

drop trigger if exists parts_requests_set_updated_at on public.parts_requests;
create trigger parts_requests_set_updated_at before update on public.parts_requests for each row execute function public.set_updated_at();
drop trigger if exists purchase_requests_set_updated_at on public.purchase_requests;
create trigger purchase_requests_set_updated_at before update on public.purchase_requests for each row execute function public.set_updated_at();

create or replace function public.set_parts_request_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pattern text;
  next_value integer;
begin
  if new.parts_request_number is null or length(trim(new.parts_request_number)) = 0 then
    select parts_request_number_format into pattern from public.app_settings where id = '00000000-0000-0000-0000-000000000001';
    pattern := coalesce(pattern, 'REC/STORE/PR/{0000}');
    next_value := public.next_number_for('parts_request:' || pattern);
    new.parts_request_number := replace(replace(pattern, '{0000}', lpad(next_value::text, 4, '0')), '{SEQ}', next_value::text);
  end if;
  return new;
end;
$$;

drop trigger if exists parts_requests_set_number on public.parts_requests;
create trigger parts_requests_set_number before insert on public.parts_requests for each row execute function public.set_parts_request_number();

create or replace function public.set_purchase_request_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pattern text;
  next_value integer;
begin
  if new.purchase_request_number is null or length(trim(new.purchase_request_number)) = 0 then
    select purchase_request_number_format into pattern from public.app_settings where id = '00000000-0000-0000-0000-000000000001';
    pattern := coalesce(pattern, 'REC/PUR/{0000}');
    next_value := public.next_number_for('purchase_request:' || pattern);
    new.purchase_request_number := replace(replace(pattern, '{0000}', lpad(next_value::text, 4, '0')), '{SEQ}', next_value::text);
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_requests_set_number on public.purchase_requests;
create trigger purchase_requests_set_number before insert on public.purchase_requests for each row execute function public.set_purchase_request_number();

insert into public.permissions (key, description)
values
  ('parts_requests.view', 'View parts requests'),
  ('parts_requests.create', 'Create parts requests from work orders'),
  ('parts_requests.approve', 'Approve or reject parts requests'),
  ('store.issue', 'Issue parts and manage store workflow'),
  ('inventory.movements.view', 'View inventory movements'),
  ('purchase_requests.view', 'View purchase requests'),
  ('purchase_requests.manage', 'Create and manage purchase requests'),
  ('finance.approve', 'Approve or reject finance approvals'),
  ('ceo.approve', 'Approve or reject CEO threshold approvals'),
  ('finance.reports.view', 'View finance reports')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.slug = 'super_admin'
  and p.key in ('parts_requests.view','parts_requests.create','parts_requests.approve','store.issue','inventory.movements.view','purchase_requests.view','purchase_requests.manage','finance.approve','ceo.approve','finance.reports.view')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('parts_requests.view','parts_requests.create','parts_requests.approve')
where r.slug = 'maintenance_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('parts_requests.view','parts_requests.create')
where r.slug in ('maintenance_supervisor','technician')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('parts_requests.view','store.issue','inventory.movements.view','parts.view','parts.manage')
where r.slug = 'store_keeper'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('purchase_requests.view','purchase_requests.manage','parts_requests.view')
where r.slug = 'purchase_officer'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('purchase_requests.view','finance.approve','finance.reports.view','costs.view')
where r.slug = 'finance_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('purchase_requests.view','ceo.approve','finance.reports.view','costs.view')
where r.slug = 'ceo_management'
on conflict do nothing;

alter table public.parts_requests enable row level security;
alter table public.parts_request_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;

create policy "parts request viewers read requests" on public.parts_requests for select to authenticated
using (public.has_permission('parts_requests.view') or created_by = auth.uid() or requested_by = auth.uid());
create policy "parts request creators insert requests" on public.parts_requests for insert to authenticated
with check (public.has_permission('parts_requests.create'));
create policy "parts request approvers update requests" on public.parts_requests for update to authenticated
using (public.has_permission('parts_requests.approve') or public.has_permission('store.issue') or public.has_permission('purchase_requests.manage'))
with check (public.has_permission('parts_requests.approve') or public.has_permission('store.issue') or public.has_permission('purchase_requests.manage'));

create policy "parts request viewers read items" on public.parts_request_items for select to authenticated
using (exists (select 1 from public.parts_requests pr where pr.id = parts_request_id and (public.has_permission('parts_requests.view') or pr.created_by = auth.uid() or pr.requested_by = auth.uid())));
create policy "parts request creators write items" on public.parts_request_items for all to authenticated
using (public.has_permission('parts_requests.create') or public.has_permission('store.issue') or public.has_permission('purchase_requests.manage'))
with check (public.has_permission('parts_requests.create') or public.has_permission('store.issue') or public.has_permission('purchase_requests.manage'));

create policy "inventory movement viewers read movements" on public.inventory_movements for select to authenticated
using (public.has_permission('inventory.movements.view') or public.has_permission('finance.reports.view'));
create policy "store and purchase create movements" on public.inventory_movements for insert to authenticated
with check (public.has_permission('store.issue') or public.has_permission('purchase_requests.manage'));

create policy "purchase viewers read requests" on public.purchase_requests for select to authenticated
using (public.has_permission('purchase_requests.view') or public.has_permission('finance.approve') or public.has_permission('ceo.approve'));
create policy "purchase managers write requests" on public.purchase_requests for all to authenticated
using (public.has_permission('purchase_requests.manage') or public.has_permission('finance.approve') or public.has_permission('ceo.approve'))
with check (public.has_permission('purchase_requests.manage') or public.has_permission('finance.approve') or public.has_permission('ceo.approve'));

create policy "purchase viewers read items" on public.purchase_request_items for select to authenticated
using (public.has_permission('purchase_requests.view') or public.has_permission('finance.approve') or public.has_permission('ceo.approve'));
create policy "purchase managers write items" on public.purchase_request_items for all to authenticated
using (public.has_permission('purchase_requests.manage'))
with check (public.has_permission('purchase_requests.manage'));
