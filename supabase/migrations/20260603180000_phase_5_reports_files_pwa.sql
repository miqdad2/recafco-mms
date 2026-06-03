insert into public.permissions (key, description)
values
  ('reports.view', 'View operational maintenance reports'),
  ('reports.export', 'Export operational maintenance reports'),
  ('files.upload', 'Upload private maintenance, asset, and purchase files'),
  ('files.view', 'View private signed maintenance, asset, and purchase files')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug = 'super_admin'
  and p.key in ('reports.view','reports.export','files.upload','files.view')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('reports.view','reports.export','files.view')
where r.slug in ('it_admin','ceo_management','maintenance_manager','maintenance_supervisor','viewer_auditor')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('reports.view','files.upload','files.view')
where r.slug in ('maintenance_data_entry','technician')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('reports.view','reports.export','files.upload','files.view')
where r.slug in ('store_keeper','purchase_officer','finance_manager')
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('work-order-files', 'work-order-files', false, 10485760, array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  ('asset-files', 'asset-files', false, 10485760, array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  ('purchase-files', 'purchase-files', false, 10485760, array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users read private recafco files" on storage.objects;
create policy "authenticated users read private recafco files"
on storage.objects for select to authenticated
using (
  bucket_id in ('work-order-files','asset-files','purchase-files')
  and public.has_permission('files.view')
);

drop policy if exists "authorized users upload private recafco files" on storage.objects;
create policy "authorized users upload private recafco files"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('work-order-files','asset-files','purchase-files')
  and public.has_permission('files.upload')
);

drop policy if exists "authorized users update private recafco files" on storage.objects;
create policy "authorized users update private recafco files"
on storage.objects for update to authenticated
using (
  bucket_id in ('work-order-files','asset-files','purchase-files')
  and public.has_permission('files.upload')
)
with check (
  bucket_id in ('work-order-files','asset-files','purchase-files')
  and public.has_permission('files.upload')
);

create index if not exists idx_work_orders_report_filters on public.work_orders(date_of_order, status, maintenance_type, worker_type, priority);
create index if not exists idx_assets_service_due on public.assets(next_service_date, status);
create index if not exists idx_assets_expiry_dates on public.assets(registration_expiry_date, insurance_expiry_date, warranty_expiry_date);
create index if not exists idx_parts_low_stock on public.parts(current_stock, minimum_stock);
create index if not exists idx_parts_requests_report_filters on public.parts_requests(request_date, status, department_id);
create index if not exists idx_purchase_requests_report_filters on public.purchase_requests(created_at, status);
create index if not exists idx_inventory_movements_report_filters on public.inventory_movements(created_at, movement_type);
