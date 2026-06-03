alter table public.app_settings
add column if not exists asset_number_format text not null default 'REC/ASSET/{0000}';

create table if not exists public.numbering_sequences (
  key text primary key,
  current_value integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  asset_name text not null,
  category text not null,
  department_id uuid references public.departments(id) on delete set null,
  location text,
  brand text,
  model text,
  serial_number text,
  plate_number text,
  chassis_number text,
  engine_number text,
  purchase_date date,
  warranty_expiry_date date,
  registration_expiry_date date,
  insurance_expiry_date date,
  current_kilometer_reading numeric(12,2),
  current_running_hours numeric(12,2),
  assigned_operator_driver text,
  status text not null default 'Active',
  next_service_date date,
  next_service_kilometer numeric(12,2),
  next_service_running_hours numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint assets_category_check check (category in ('Vehicle','Bus','Car','Truck','Crane','Forklift','Generator','Factory Machine','Electrical Equipment','Building/Facility','Other')),
  constraint assets_status_check check (status in ('Active','In Use','Under Maintenance','Breakdown','Waiting for Parts','Out of Service','Retired'))
);

create table if not exists public.asset_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  file_path text not null,
  content_type text,
  file_size integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  part_code text not null unique,
  part_name text not null,
  description text,
  category text,
  part_number text,
  ss_rec_code text,
  unit_of_measure text not null default 'PCS',
  current_stock numeric(12,2) not null default 0,
  minimum_stock numeric(12,2) not null default 0,
  unit_price numeric(12,3) not null default 0,
  supplier text,
  store_location_bin text,
  compatible_asset_categories text[] not null default '{}',
  status text not null default 'Active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint parts_status_check check (status in ('Active','Inactive','Low Stock','Unavailable','Discontinued'))
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text unique,
  company_reference_format text,
  ordered_by text not null,
  requested_by_department_id uuid references public.departments(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  asset_category text,
  serial_number text,
  plate_number text,
  date_of_order date not null default current_date,
  job_location text,
  starting_datetime timestamptz,
  ending_datetime timestamptz,
  maintenance_type text not null,
  worker_type text not null,
  running_hours numeric(12,2),
  kilometers numeric(12,2),
  operator_complaint text,
  description_of_work text,
  priority text not null default 'Normal',
  status text not null default 'Draft',
  assigned_supervisor_id uuid references public.profiles(id) on delete set null,
  operator_requester_confirmation text,
  supervisor_verification text,
  maintenance_manager_closure text,
  next_service_date date,
  next_service_kilometer numeric(12,2),
  next_service_running_hours numeric(12,2),
  total_labor_cost numeric(12,3) not null default 0,
  total_material_cost numeric(12,3) not null default 0,
  total_work_order_cost numeric(12,3) generated always as (coalesce(total_labor_cost,0) + coalesce(total_material_cost,0)) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint work_orders_maintenance_type_check check (maintenance_type in ('Routine','Service','Breakdown','Preventive','Inspection','Emergency','Other')),
  constraint work_orders_worker_type_check check (worker_type in ('Auto','Mechanical','Electrical','Civil','AC','Plumbing','Welding/Fabrication','Other')),
  constraint work_orders_priority_check check (priority in ('Low','Normal','High','Urgent')),
  constraint work_orders_status_check check (status in ('Draft','Submitted','Pending Approval','Approved','Rejected','Assigned','In Progress','Waiting for Parts','Waiting for Purchase','Parts Issued','Completed by Technician','Verified by Supervisor','Confirmed by Requester','Closed','Cancelled','Reopened'))
);

create table if not exists public.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  notes text
);

create table if not exists public.work_order_labor (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete set null,
  labor_name text not null,
  employee_number text,
  hours numeric(10,2) not null default 0,
  rate numeric(12,3) not null default 0,
  amount numeric(12,3) generated always as (coalesce(hours,0) * coalesce(rate,0)) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_materials (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  material_name text not null,
  part_number text,
  ss_rec_code text,
  quantity numeric(12,2) not null default 0,
  unit_price numeric(12,3) not null default 0,
  amount numeric(12,3) generated always as (coalesce(quantity,0) * coalesce(unit_price,0)) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_status_history (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  notes text
);

create table if not exists public.work_order_attachments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  attachment_type text not null,
  file_name text not null,
  file_path text not null,
  content_type text,
  file_size integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_assets_department_id on public.assets(department_id);
create index if not exists idx_assets_category on public.assets(category);
create index if not exists idx_assets_status on public.assets(status);
create index if not exists idx_assets_deleted_at on public.assets(deleted_at);
create index if not exists idx_parts_status on public.parts(status);
create index if not exists idx_parts_current_stock on public.parts(current_stock);
create index if not exists idx_parts_deleted_at on public.parts(deleted_at);
create index if not exists idx_work_orders_number on public.work_orders(work_order_number);
create index if not exists idx_work_orders_status on public.work_orders(status);
create index if not exists idx_work_orders_asset_id on public.work_orders(asset_id);
create index if not exists idx_work_orders_department_id on public.work_orders(requested_by_department_id);
create index if not exists idx_work_orders_created_at on public.work_orders(created_at);
create index if not exists idx_work_orders_deleted_at on public.work_orders(deleted_at);
create index if not exists idx_work_order_assignments_technician on public.work_order_assignments(technician_id);
create index if not exists idx_work_order_status_history_work_order on public.work_order_status_history(work_order_id, changed_at desc);

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at before update on public.assets for each row execute function public.set_updated_at();

drop trigger if exists parts_set_updated_at on public.parts;
create trigger parts_set_updated_at before update on public.parts for each row execute function public.set_updated_at();

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at before update on public.work_orders for each row execute function public.set_updated_at();

create or replace function public.worker_type_code(worker_type text)
returns text
language sql
immutable
as $$
  select case worker_type
    when 'Electrical' then 'ELEC'
    when 'Mechanical' then 'MECH'
    when 'Auto' then 'AUTO'
    when 'Civil' then 'CIVIL'
    when 'AC' then 'AC'
    when 'Plumbing' then 'PLUMB'
    when 'Welding/Fabrication' then 'WELD'
    else 'GEN'
  end;
$$;

create or replace function public.next_number_for(sequence_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into public.numbering_sequences(key, current_value)
  values (sequence_key, 1)
  on conflict (key)
  do update set current_value = public.numbering_sequences.current_value + 1, updated_at = now()
  returning current_value into next_value;

  return next_value;
end;
$$;

create or replace function public.format_work_order_number(pattern text, worker_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  type_code text := public.worker_type_code(worker_type);
  sequence_key text := 'work_order:' || pattern || ':' || type_code;
  next_value integer;
  formatted text;
begin
  next_value := public.next_number_for(sequence_key);
  formatted := replace(pattern, '{TYPE}', type_code);
  formatted := replace(formatted, '{0000}', lpad(next_value::text, 4, '0'));
  formatted := replace(formatted, '{SEQ}', next_value::text);
  formatted := replace(formatted, '{YYYY}', extract(year from now())::text);
  return formatted;
end;
$$;

create or replace function public.set_work_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pattern text;
begin
  if new.work_order_number is null or length(trim(new.work_order_number)) = 0 then
    select work_order_number_format into pattern
    from public.app_settings
    where id = '00000000-0000-0000-0000-000000000001';

    new.company_reference_format := coalesce(pattern, 'REC/MD/{TYPE}/JOB/{0000}');
    new.work_order_number := public.format_work_order_number(new.company_reference_format, new.worker_type);
  end if;

  return new;
end;
$$;

drop trigger if exists work_orders_set_number on public.work_orders;
create trigger work_orders_set_number before insert on public.work_orders for each row execute function public.set_work_order_number();

create or replace function public.log_initial_work_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.work_order_status_history(work_order_id, from_status, to_status, changed_by, notes)
  values (new.id, null, new.status, new.created_by, 'Initial status');
  return new;
end;
$$;

drop trigger if exists work_orders_initial_status on public.work_orders;
create trigger work_orders_initial_status after insert on public.work_orders for each row execute function public.log_initial_work_order_status();

create or replace function public.log_work_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.work_order_status_history(work_order_id, from_status, to_status, changed_by, notes)
    values (new.id, old.status, new.status, new.updated_by, 'Status updated');
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_status_change on public.work_orders;
create trigger work_orders_status_change after update on public.work_orders for each row execute function public.log_work_order_status_change();

insert into public.permissions (key, description)
values
  ('assets.view', 'View asset master and maintenance history'),
  ('assets.manage', 'Create and update asset master records'),
  ('parts.view', 'View spare parts inventory'),
  ('parts.manage', 'Create and update spare parts inventory'),
  ('work_orders.view', 'View maintenance work orders'),
  ('work_orders.manage', 'Create and update maintenance work orders'),
  ('work_orders.print', 'Open work order print and PDF-ready layouts')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug = 'super_admin'
  and p.key in ('assets.view','assets.manage','parts.view','parts.manage','work_orders.view','work_orders.manage','work_orders.print')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('assets.view','parts.view','work_orders.view','work_orders.print')
where r.slug in ('it_admin','ceo_management','maintenance_manager','maintenance_supervisor','viewer_auditor')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('assets.view','assets.manage','work_orders.view','work_orders.manage','work_orders.print')
where r.slug in ('maintenance_manager','maintenance_supervisor','maintenance_data_entry')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('parts.view','parts.manage')
where r.slug = 'store_keeper'
on conflict do nothing;

alter table public.assets enable row level security;
alter table public.asset_documents enable row level security;
alter table public.parts enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.work_order_labor enable row level security;
alter table public.work_order_materials enable row level security;
alter table public.work_order_status_history enable row level security;
alter table public.work_order_attachments enable row level security;
alter table public.numbering_sequences enable row level security;

create policy "asset viewers read assets" on public.assets for select to authenticated using (public.has_permission('assets.view'));
create policy "asset managers write assets" on public.assets for all to authenticated using (public.has_permission('assets.manage')) with check (public.has_permission('assets.manage'));
create policy "asset viewers read documents" on public.asset_documents for select to authenticated using (public.has_permission('assets.view'));
create policy "asset managers write documents" on public.asset_documents for all to authenticated using (public.has_permission('assets.manage')) with check (public.has_permission('assets.manage'));
create policy "part viewers read parts" on public.parts for select to authenticated using (public.has_permission('parts.view'));
create policy "part managers write parts" on public.parts for all to authenticated using (public.has_permission('parts.manage')) with check (public.has_permission('parts.manage'));
create policy "work order viewers read work orders" on public.work_orders for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write work orders" on public.work_orders for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "work order viewers read assignments" on public.work_order_assignments for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write assignments" on public.work_order_assignments for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "work order viewers read labor" on public.work_order_labor for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write labor" on public.work_order_labor for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "work order viewers read materials" on public.work_order_materials for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write materials" on public.work_order_materials for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "work order viewers read history" on public.work_order_status_history for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write history" on public.work_order_status_history for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "work order viewers read attachments" on public.work_order_attachments for select to authenticated using (public.has_permission('work_orders.view'));
create policy "work order managers write attachments" on public.work_order_attachments for all to authenticated using (public.has_permission('work_orders.manage')) with check (public.has_permission('work_orders.manage'));
create policy "only authenticated can use numbering by trigger" on public.numbering_sequences for all to authenticated using (public.current_user_is_active()) with check (public.current_user_is_active());

insert into public.assets(asset_code, asset_name, category, department_id, location, brand, model, serial_number, plate_number, current_kilometer_reading, current_running_hours, assigned_operator_driver, status, next_service_date, next_service_kilometer, next_service_running_hours, notes)
select
  v.asset_code,
  v.asset_name,
  v.category,
  d.id,
  v.location,
  v.brand,
  v.model,
  v.serial_number,
  v.plate_number,
  v.km,
  v.hrs,
  v.operator_name,
  v.status,
  v.nsd,
  v.nsk,
  v.nsh,
  v.notes
from (
  values
  ('AST-CRN-001','Crane Sany STC3423','Crane','Operations Department','Main Yard','Sany','STC3423','SNY3423-001','CR-104',65400,3200,'Ali Hassan','In Use',current_date + 30,66000,3300,'Hydraulic inspection due.'),
  ('AST-BUS-001','Toyota Coaster Bus','Bus','Operations Department','Transport Yard','Toyota','Coaster','COA-7781','BUS-22',188500,0,'Jamal Nasser','Active',current_date + 20,190000,null,'Staff transport bus.'),
  ('AST-TRK-001','Mitsubishi Truck','Truck','Operations Department','Block Factory','Mitsubishi','Fuso','FUSO-3391','TRK-18',211900,0,'Khaled Omar','Under Maintenance',current_date + 45,215000,null,'Tire and brake follow-up.'),
  ('AST-FRK-001','Forklift Toyota 8FD30','Forklift','Store Department','Store Warehouse','Toyota','8FD30','8FD30-9102','FL-07',0,5400,'Store Team','In Use',current_date + 15,null,5500,'Daily store operation forklift.'),
  ('AST-GEN-001','Generator Caterpillar 500KVA','Generator','Operations Department','Factory Power Room','Caterpillar','500KVA','CAT500-2244',null,0,8700,'Power Team','Active',current_date + 25,null,8800,'Oil and coolant monitoring.'),
  ('AST-BPM-001','Batching Plant Mixer Line 1','Factory Machine','Operations Department','Batching Plant','Sicoma','MAO','MIX-L1-900',null,0,12300,'Plant Operator','Active',current_date + 10,null,12400,'Mixer blade inspection.'),
  ('AST-HCL-002','Factory Machine Hollowcore Line 2','Factory Machine','Operations Department','Hollowcore Factory','Elematic','Line 2','HCL2-778',null,0,15100,'Production Team','In Use',current_date + 35,null,15250,'Preventive maintenance planned.'),
  ('AST-ELP-004','Electrical Panel EP-04','Electrical Equipment','Maintenance Department','Electrical Room 2','Schneider','EP-04','EP04-112',null,0,0,'Electrical Team','Active',current_date + 60,null,null,'Breaker inspection schedule.'),
  ('AST-CMP-001','Air Compressor Atlas Copco','Factory Machine','Maintenance Department','Compressor Room','Atlas Copco','GA75','AC-GA75-33',null,0,9200,'Maintenance Team','Active',current_date + 18,null,9300,'Filter replacement due soon.'),
  ('AST-CAR-001','Company Car Toyota Camry','Car','CEO Office','Head Office','Toyota','Camry','CAM-2201','CAR-12',94300,0,'Admin Driver','Active',current_date + 40,96000,null,'Registration renewal check.'),
  ('AST-WLD-001','Workshop Welding Machine','Other','Maintenance Department','Workshop','Lincoln','Power MIG','WLD-665',null,0,0,'Workshop Team','Active',current_date + 90,null,null,'Cable inspection.'),
  ('AST-GRC-001','GRC Spray Machine','Factory Machine','Operations Department','GRC Area','GRC','Spray Pro','GRC-SP-14',null,0,4100,'GRC Team','Breakdown',current_date + 12,null,4200,'Nozzle pressure issue.'),
  ('AST-PMP-001','Concrete Pump Putzmeister','Factory Machine','Operations Department','Site Yard','Putzmeister','BSA','PUTZ-800',null,0,6600,'Site Team','Waiting for Parts',current_date + 22,null,6700,'Seal kit required.'),
  ('AST-TLG-001','Tower Light Generator','Generator','Operations Department','Site Store','Perkins','Tower Light','TLG-502',null,0,2900,'Site Team','Active',current_date + 55,null,3000,'Lamp replacement stock check.'),
  ('AST-PUP-001','Site Pickup Nissan','Vehicle','Operations Department','Project Site','Nissan','Pickup','NIS-PU-812','PU-31',132700,0,'Site Supervisor','In Use',current_date + 28,134000,null,'Service due next month.')
) as v(asset_code, asset_name, category, dept_name, location, brand, model, serial_number, plate_number, km, hrs, operator_name, status, nsd, nsk, nsh, notes)
left join public.departments d on d.name = v.dept_name
on conflict (asset_code) do nothing;

insert into public.parts(part_code, part_name, description, category, part_number, ss_rec_code, unit_of_measure, current_stock, minimum_stock, unit_price, supplier, store_location_bin, compatible_asset_categories, status, notes)
values
('PRT-001','Engine Oil Filter','Standard engine oil filter','Filters','EOF-100','SS-EOF-100','PCS',18,5,3.500,'Gulf Auto Parts','A1-01',array['Vehicle','Bus','Truck','Generator'],'Active','Fast moving item.'),
('PRT-002','Hydraulic Hose','High pressure hydraulic hose','Hydraulic','HH-220','SS-HH-220','MTR',12,4,8.250,'Kuwait Hydraulics','B2-04',array['Crane','Forklift','Factory Machine'],'Active','Common crane hose.'),
('PRT-003','Brake Pad Set','Vehicle brake pad set','Brake','BPS-44','SS-BPS-44','SET',7,3,14.000,'Auto Supply Co','A2-02',array['Vehicle','Bus','Truck','Car'],'Active',''),
('PRT-004','Alternator Belt','Alternator drive belt','Belts','ALT-B-77','SS-ALT-77','PCS',14,5,4.750,'Auto Supply Co','A2-07',array['Vehicle','Generator'],'Active',''),
('PRT-005','Air Filter','Engine air filter','Filters','AF-500','SS-AF-500','PCS',25,8,5.200,'Gulf Auto Parts','A1-03',array['Vehicle','Bus','Truck','Generator'],'Active',''),
('PRT-006','Diesel Filter','Diesel fuel filter','Filters','DF-90','SS-DF-90','PCS',16,6,4.900,'Gulf Auto Parts','A1-04',array['Vehicle','Bus','Truck','Generator'],'Active',''),
('PRT-007','Bearing','Industrial bearing','Mechanical','BRG-6205','SS-BRG-6205','PCS',30,10,2.250,'Industrial Bearings KW','C1-02',array['Factory Machine','Generator','Forklift'],'Active',''),
('PRT-008','Electrical Contactor','Panel electrical contactor','Electrical','LC1D','SS-CON-11','PCS',6,3,22.000,'Electrical House','E1-01',array['Electrical Equipment','Factory Machine'],'Active',''),
('PRT-009','Relay','Control relay','Electrical','RLY-24','SS-RLY-24','PCS',21,8,3.100,'Electrical House','E1-02',array['Electrical Equipment','Factory Machine'],'Active',''),
('PRT-010','Fuse','Industrial fuse','Electrical','FUSE-32A','SS-FUS-32','PCS',40,15,0.850,'Electrical House','E1-04',array['Electrical Equipment'],'Active',''),
('PRT-011','Hydraulic Oil','Hydraulic oil drum','Oil','HYD-68','SS-HYD-68','LTR',120,40,1.250,'Oil Trading Co','O1-01',array['Crane','Forklift','Factory Machine'],'Active',''),
('PRT-012','Gear Oil','Gear oil','Oil','GEAR-90','SS-GEAR-90','LTR',80,30,1.450,'Oil Trading Co','O1-02',array['Vehicle','Factory Machine'],'Active',''),
('PRT-013','Tire','Heavy vehicle tire','Tires','TIRE-1100','SS-TIR-1100','PCS',4,4,65.000,'Tire World','T1-01',array['Truck','Bus'],'Low Stock','At minimum stock.'),
('PRT-014','Battery','Vehicle battery','Electrical','BAT-100AH','SS-BAT-100','PCS',9,3,28.000,'Battery Center','E2-01',array['Vehicle','Bus','Truck','Generator'],'Active',''),
('PRT-015','Spark Plug','Spark plug','Engine','SP-77','SS-SP-77','PCS',32,10,1.200,'Auto Supply Co','A3-05',array['Vehicle','Car'],'Active',''),
('PRT-016','Compressor Belt','Compressor drive belt','Belts','CB-75','SS-CB-75','PCS',5,2,7.750,'Compressor Services','C2-01',array['Factory Machine'],'Active',''),
('PRT-017','Welding Rod','Welding electrode','Workshop','WR-6013','SS-WR-6013','BOX',22,6,6.500,'Welding Supply','W1-01',array['Other'],'Active',''),
('PRT-018','Sensor','Industrial proximity sensor','Electrical','SNS-PROX','SS-SNS-01','PCS',8,3,18.000,'Electrical House','E3-02',array['Factory Machine','Electrical Equipment'],'Active',''),
('PRT-019','Switch','Control switch','Electrical','SW-22','SS-SW-22','PCS',19,7,2.400,'Electrical House','E3-04',array['Electrical Equipment'],'Active',''),
('PRT-020','Light Bulb','Tower light bulb','Electrical','LB-LED','SS-LB-LED','PCS',3,5,4.100,'Electrical House','E4-01',array['Generator','Electrical Equipment'],'Low Stock','Below minimum stock.'),
('PRT-021','Grease','Industrial grease','Lubricants','GRS-EP2','SS-GRS-EP2','KG',55,15,1.050,'Oil Trading Co','O2-01',array['Factory Machine','Crane','Forklift'],'Active',''),
('PRT-022','Coolant','Engine coolant','Fluids','CLT-5L','SS-CLT-5','LTR',45,15,0.950,'Oil Trading Co','O2-03',array['Vehicle','Generator'],'Active',''),
('PRT-023','Pump Seal','Concrete pump seal','Mechanical','PMP-SEAL','SS-PMP-SEAL','PCS',0,2,19.000,'Pump Services','C3-01',array['Factory Machine'],'Unavailable','Purchase required.'),
('PRT-024','Valve','Industrial valve','Mechanical','VLV-2IN','SS-VLV-2','PCS',11,4,13.000,'Industrial Supply','C4-02',array['Factory Machine','Building/Facility'],'Active',''),
('PRT-025','Cable','Electrical power cable','Electrical','CBL-4C','SS-CBL-4C','MTR',140,50,0.650,'Electrical House','E5-01',array['Electrical Equipment','Factory Machine'],'Active','')
on conflict (part_code) do nothing;

insert into public.work_orders(ordered_by, requested_by_department_id, asset_id, asset_category, serial_number, plate_number, date_of_order, job_location, starting_datetime, ending_datetime, maintenance_type, worker_type, running_hours, kilometers, operator_complaint, description_of_work, priority, status, notes, total_labor_cost, total_material_cost, next_service_date, next_service_kilometer, next_service_running_hours)
select
  v.ordered_by, d.id, a.id, a.category, a.serial_number, a.plate_number, current_date - v.days_ago, v.location,
  now() - (v.days_ago || ' days')::interval, null, v.maintenance_type, v.worker_type,
  a.current_running_hours, a.current_kilometer_reading, v.complaint, v.work_desc, v.priority, v.status, v.notes,
  v.labor_cost, v.material_cost, current_date + v.next_days, a.next_service_kilometer, a.next_service_running_hours
from (
  values
  ('Operations Foreman','Operations Department','AST-CRN-001',2,'Main Yard','Breakdown','Mechanical','Crane hydraulic leak','Inspect hydraulic line and replace damaged hose.','Urgent','Pending Approval','Leak reported during lifting operation.',35,18,30),
  ('Transport Coordinator','Operations Department','AST-BUS-001',4,'Transport Yard','Service','Auto','Bus service due','Routine oil, filters, and safety inspection.','Normal','Approved','Scheduled service.',45,28,45),
  ('Store Supervisor','Store Department','AST-FRK-001',5,'Store Warehouse','Breakdown','Mechanical','Forklift brake issue','Check brake pads and hydraulic brake line.','High','Assigned','Requires supervisor assignment.',30,14,20),
  ('Power Team Lead','Operations Department','AST-GEN-001',8,'Power Room','Breakdown','Mechanical','Generator overheating','Check coolant system, radiator, and thermostat.','Urgent','In Progress','Technician started inspection.',50,22,25),
  ('Plant Operator','Operations Department','AST-BPM-001',10,'Batching Plant','Inspection','Mechanical','Batching plant mixer noise','Inspect mixer bearing and blade clearance.','High','Waiting for Parts','Bearing request expected.',28,12,15),
  ('Electrical Foreman','Maintenance Department','AST-ELP-004',12,'Electrical Room 2','Breakdown','Electrical','Electrical panel breaker trip','Trace load fault and inspect breaker terminals.','Urgent','Waiting for Purchase','Replacement contactor unavailable.',42,35,40),
  ('Transport Coordinator','Operations Department','AST-TRK-001',15,'Block Factory','Routine','Auto','Truck tire replacement','Replace worn front tires and check alignment.','High','Completed by Technician','Awaiting supervisor verification.',32,130,50),
  ('Production Supervisor','Operations Department','AST-HCL-002',18,'Hollowcore Factory','Preventive','Mechanical','Factory machine preventive maintenance','Routine lubrication, sensor check, and belt inspection.','Normal','Verified by Supervisor','Ready for closure.',60,24,35),
  ('Maintenance Planner','Maintenance Department','AST-CMP-001',20,'Compressor Room','Service','Mechanical','Compressor filter replacement','Replace air filter and inspect belts.','Normal','Closed','Completed successfully.',25,10,60),
  ('Admin Officer','CEO Office','AST-CAR-001',22,'Head Office','Service','Auto','Company car service','Oil and brake inspection.','Low','Rejected','Rejected as duplicate request.',0,0,90),
  ('Workshop Lead','Maintenance Department','AST-WLD-001',3,'Workshop','Inspection','Electrical','Welding machine cable inspection','Inspect earth cable and holder.','Normal','Draft','Draft from paper form.',0,0,80),
  ('GRC Supervisor','Operations Department','AST-GRC-001',6,'GRC Area','Breakdown','Mechanical','GRC spray machine pressure low','Inspect nozzle and pump pressure.','High','Submitted','Submitted for manager approval.',20,5,20),
  ('Site Engineer','Operations Department','AST-PMP-001',7,'Site Yard','Breakdown','Mechanical','Concrete pump seal leaking','Replace pump seal kit.','Urgent','Waiting for Parts','Seal out of stock.',40,19,25),
  ('Site Supervisor','Operations Department','AST-TLG-001',9,'Site Store','Service','Electrical','Tower light bulb replacement','Replace faulty light bulbs and inspect generator.','Normal','Parts Issued','Parts issued by store.',18,8,50),
  ('Project Manager','Operations Department','AST-PUP-001',11,'Project Site','Service','Auto','Pickup service due','Routine pickup service and tire pressure check.','Normal','Closed','Closed after road test.',36,20,45),
  ('Maintenance Planner','Maintenance Department','AST-GEN-001',14,'Power Room','Preventive','Mechanical','Generator preventive service','Oil, coolant, belt and load test.','Normal','Pending Approval','Scheduled PM.',0,0,35),
  ('Electrical Foreman','Maintenance Department','AST-ELP-004',16,'Electrical Room 2','Inspection','Electrical','Panel thermal scan','Thermal scan and terminal torque check.','Normal','Approved','Approved for supervisor scheduling.',10,0,75),
  ('Plant Operator','Operations Department','AST-BPM-001',19,'Batching Plant','Breakdown','Mechanical','Mixer abnormal vibration','Inspect mixer coupling and bearing.','High','In Progress','Vibration under load.',55,18,12),
  ('Store Supervisor','Store Department','AST-FRK-001',21,'Store Warehouse','Service','Auto','Forklift service due','Service engine, hydraulic oil and safety alarm.','Normal','Assigned','Assigned for this week.',22,16,30),
  ('Transport Coordinator','Operations Department','AST-BUS-001',25,'Transport Yard','Inspection','Auto','Bus AC not cooling','Inspect AC compressor belt and refrigerant.','High','Waiting for Purchase','AC parts purchase needed.',25,30,20)
) as v(ordered_by, dept_name, asset_code, days_ago, location, maintenance_type, worker_type, complaint, work_desc, priority, status, notes, labor_cost, material_cost, next_days)
join public.assets a on a.asset_code = v.asset_code
left join public.departments d on d.name = v.dept_name
where not exists (select 1 from public.work_orders wo where wo.operator_complaint = v.complaint and wo.asset_id = a.id);
