create extension if not exists pgcrypto;

do $$
declare
  constraint_record record;
begin
  if to_regclass('auth.users') is not null then
    for constraint_record in
      select conname
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and confrelid = 'auth.users'::regclass
        and contype = 'f'
    loop
      execute format('alter table public.profiles drop constraint %I', constraint_record.conname);
    end loop;
  end if;
end;
$$;

create or replace procedure public.replace_auth_user_fk(
  target_table text,
  target_column text,
  delete_action text default 'set null'
)
language plpgsql
as $$
declare
  constraint_record record;
  constraint_name text;
begin
  if to_regclass('auth.users') is not null then
    for constraint_record in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join unnest(c.conkey) with ordinality ck(attnum, ord) on true
      join pg_attribute a on a.attrelid = t.oid and a.attnum = ck.attnum
      where n.nspname = 'public'
        and t.relname = target_table
        and a.attname = target_column
        and c.confrelid = 'auth.users'::regclass
        and c.contype = 'f'
    loop
      execute format('alter table public.%I drop constraint %I', target_table, constraint_record.conname);
    end loop;
  end if;

  constraint_name := left(target_table || '_' || target_column || '_profiles_fkey', 63);

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(c.conkey) with ordinality ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = ck.attnum
    where n.nspname = 'public'
      and t.relname = target_table
      and a.attname = target_column
      and c.confrelid = 'public.profiles'::regclass
      and c.contype = 'f'
  ) then
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete %s not valid',
      target_table,
      constraint_name,
      target_column,
      delete_action
    );
    execute format('alter table public.%I validate constraint %I', target_table, constraint_name);
  end if;
end;
$$;

call public.replace_auth_user_fk('app_settings', 'updated_by');
call public.replace_auth_user_fk('audit_logs', 'actor_id');
call public.replace_auth_user_fk('assets', 'created_by');
call public.replace_auth_user_fk('assets', 'updated_by');
call public.replace_auth_user_fk('asset_documents', 'uploaded_by');
call public.replace_auth_user_fk('parts', 'created_by');
call public.replace_auth_user_fk('parts', 'updated_by');
call public.replace_auth_user_fk('work_orders', 'created_by');
call public.replace_auth_user_fk('work_orders', 'updated_by');
call public.replace_auth_user_fk('work_order_assignments', 'assigned_by');
call public.replace_auth_user_fk('work_order_status_history', 'changed_by');
call public.replace_auth_user_fk('work_order_attachments', 'uploaded_by');
call public.replace_auth_user_fk('approvals', 'decided_by');
call public.replace_auth_user_fk('notifications', 'recipient_id', 'cascade');
call public.replace_auth_user_fk('notifications', 'recipient_user_id', 'cascade');
call public.replace_auth_user_fk('notifications', 'created_by');
call public.replace_auth_user_fk('notification_delivery_logs', 'recipient_user_id');
call public.replace_auth_user_fk('inventory_movements', 'created_by');
call public.replace_auth_user_fk('parts_requests', 'created_by');
call public.replace_auth_user_fk('parts_requests', 'updated_by');
call public.replace_auth_user_fk('purchase_requests', 'created_by');
call public.replace_auth_user_fk('purchase_requests', 'updated_by');

drop procedure public.replace_auth_user_fk(text, text, text);

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return value::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function public.current_app_profile_id()
returns uuid
language plpgsql
stable
as $$
begin
  return public.uuid_or_null(current_setting('app.current_profile_id', true));
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  old_data jsonb;
  entity_id_text text;
  actor_id_value uuid;
  entity_label text;
  entity_type_value text := tg_argv[0];
  action_value text;
  changed_keys text[];
  metadata_value jsonb;
begin
  if current_setting('app.audit_disabled', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    row_data := '{}'::jsonb;
    old_data := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    row_data := to_jsonb(new);
    old_data := to_jsonb(old);

    if (row_data - 'updated_at') = (old_data - 'updated_at') then
      return new;
    end if;
  else
    row_data := to_jsonb(new);
    old_data := '{}'::jsonb;
  end if;

  entity_id_text := coalesce(row_data->>'id', old_data->>'id');

  if entity_id_text is null then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  actor_id_value := coalesce(
    public.current_app_profile_id(),
    public.uuid_or_null(row_data->>'updated_by'),
    public.uuid_or_null(row_data->>'created_by'),
    public.uuid_or_null(row_data->>'decided_by'),
    public.uuid_or_null(row_data->>'assigned_by'),
    public.uuid_or_null(row_data->>'uploaded_by'),
    public.uuid_or_null(row_data->>'changed_by'),
    public.uuid_or_null(row_data->>'finance_approved_by'),
    public.uuid_or_null(row_data->>'ceo_approved_by'),
    public.uuid_or_null(row_data->>'technician_id'),
    public.uuid_or_null(old_data->>'updated_by'),
    public.uuid_or_null(old_data->>'created_by'),
    public.uuid_or_null(old_data->>'decided_by'),
    public.uuid_or_null(old_data->>'assigned_by'),
    public.uuid_or_null(old_data->>'uploaded_by'),
    public.uuid_or_null(old_data->>'changed_by')
  );

  entity_label := coalesce(
    row_data->>'work_order_number',
    old_data->>'work_order_number',
    row_data->>'parts_request_number',
    old_data->>'parts_request_number',
    row_data->>'purchase_request_number',
    old_data->>'purchase_request_number',
    row_data->>'asset_code',
    old_data->>'asset_code',
    row_data->>'part_code',
    old_data->>'part_code',
    row_data->>'full_name',
    old_data->>'full_name',
    row_data->>'name',
    old_data->>'name',
    row_data->>'email',
    old_data->>'email',
    left(entity_id_text, 8)
  );

  if tg_op = 'UPDATE' then
    select array_agg(key order by key)
    into changed_keys
    from (
      select coalesce(n.key, o.key) as key
      from jsonb_each(row_data) n
      full join jsonb_each(old_data) o using (key)
      where n.value is distinct from o.value
        and coalesce(n.key, o.key) <> 'updated_at'
    ) changed;
  else
    changed_keys := array[]::text[];
  end if;

  action_value := case
    when tg_op = 'INSERT' then entity_type_value || '.record_create'
    when tg_op = 'DELETE' then entity_type_value || '.record_delete'
    when coalesce(old_data->>'status', '') <> coalesce(row_data->>'status', '') then entity_type_value || '.status_change'
    else entity_type_value || '.record_update'
  end;

  metadata_value := jsonb_build_object(
    'table', tg_table_name,
    'operation', lower(tg_op),
    'changed_fields', coalesce(to_jsonb(changed_keys), '[]'::jsonb)
  );

  if coalesce(old_data->>'status', '') <> coalesce(row_data->>'status', '') then
    metadata_value := metadata_value || jsonb_build_object('from_status', old_data->>'status', 'to_status', row_data->>'status');
  end if;

  perform set_config('app.audit_disabled', 'on', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
  values (
    actor_id_value,
    action_value,
    entity_type_value,
    public.uuid_or_null(entity_id_text),
    case
      when tg_op = 'INSERT' then 'Created ' || replace(entity_type_value, '_', ' ') || ' ' || entity_label
      when tg_op = 'DELETE' then 'Deleted ' || replace(entity_type_value, '_', ' ') || ' ' || entity_label
      when coalesce(old_data->>'status', '') <> coalesce(row_data->>'status', '') then 'Changed ' || replace(entity_type_value, '_', ' ') || ' ' || entity_label || ' status from ' || coalesce(old_data->>'status', 'blank') || ' to ' || coalesce(row_data->>'status', 'blank')
      else 'Updated ' || replace(entity_type_value, '_', ' ') || ' ' || entity_label
    end,
    metadata_value
  );

  perform set_config('app.audit_disabled', 'off', true);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
exception
  when others then
    perform set_config('app.audit_disabled', 'off', true);
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
end;
$$;

create or replace procedure public.attach_audit_trigger(target_table text, entity_type text)
language plpgsql
as $$
begin
  execute format('drop trigger if exists %I on public.%I', target_table || '_audit_row_change', target_table);
  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)',
    target_table || '_audit_row_change',
    target_table,
    entity_type
  );
end;
$$;

call public.attach_audit_trigger('departments', 'department');
call public.attach_audit_trigger('profiles', 'profile');
call public.attach_audit_trigger('auth_users', 'auth_user');
call public.attach_audit_trigger('app_settings', 'app_setting');
call public.attach_audit_trigger('assets', 'asset');
call public.attach_audit_trigger('asset_documents', 'asset_document');
call public.attach_audit_trigger('parts', 'part');
call public.attach_audit_trigger('work_orders', 'work_order');
call public.attach_audit_trigger('work_order_labor', 'work_order_labor');
call public.attach_audit_trigger('work_order_materials', 'work_order_material');
call public.attach_audit_trigger('work_order_assignments', 'work_order_assignment');
call public.attach_audit_trigger('work_order_status_history', 'work_order_status_history');
call public.attach_audit_trigger('work_order_attachments', 'work_order_attachment');
call public.attach_audit_trigger('work_order_technician_notes', 'work_order_technician_note');
call public.attach_audit_trigger('parts_requests', 'parts_request');
call public.attach_audit_trigger('parts_request_items', 'parts_request_item');
call public.attach_audit_trigger('inventory_movements', 'inventory_movement');
call public.attach_audit_trigger('purchase_requests', 'purchase_request');
call public.attach_audit_trigger('purchase_request_items', 'purchase_request_item');
call public.attach_audit_trigger('approvals', 'approval');
call public.attach_audit_trigger('notification_events', 'notification_event');
call public.attach_audit_trigger('notification_templates', 'notification_template');
call public.attach_audit_trigger('notification_preferences', 'notification_preference');

drop procedure public.attach_audit_trigger(text, text);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'asset.existing_record', 'asset', id, 'Existing asset ' || asset_code, jsonb_build_object('status', status, 'category', category, 'backfilled', true, 'original_created_at', created_at)
from public.assets a
where not exists (select 1 from public.audit_logs al where al.entity_type = 'asset' and al.entity_id = a.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'part.existing_record', 'part', id, 'Existing part ' || part_code, jsonb_build_object('status', status, 'stock', current_stock, 'backfilled', true, 'original_created_at', created_at)
from public.parts p
where not exists (select 1 from public.audit_logs al where al.entity_type = 'part' and al.entity_id = p.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'work_order.existing_record', 'work_order', id, 'Existing work order ' || coalesce(work_order_number, left(id::text, 8)), jsonb_build_object('status', status, 'priority', priority, 'backfilled', true, 'original_created_at', created_at)
from public.work_orders wo
where not exists (select 1 from public.audit_logs al where al.entity_type = 'work_order' and al.entity_id = wo.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'parts_request.existing_record', 'parts_request', id, 'Existing parts request ' || coalesce(parts_request_number, left(id::text, 8)), jsonb_build_object('status', status, 'backfilled', true, 'original_created_at', created_at)
from public.parts_requests pr
where not exists (select 1 from public.audit_logs al where al.entity_type = 'parts_request' and al.entity_id = pr.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'purchase_request.existing_record', 'purchase_request', id, 'Existing purchase request ' || coalesce(purchase_request_number, left(id::text, 8)), jsonb_build_object('status', status, 'backfilled', true, 'original_created_at', created_at)
from public.purchase_requests pr
where not exists (select 1 from public.audit_logs al where al.entity_type = 'purchase_request' and al.entity_id = pr.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select created_by, 'inventory_movement.existing_record', 'inventory_movement', id, 'Existing inventory movement ' || coalesce(reference, left(id::text, 8)), jsonb_build_object('movement_type', movement_type, 'backfilled', true, 'original_created_at', created_at)
from public.inventory_movements im
where not exists (select 1 from public.audit_logs al where al.entity_type = 'inventory_movement' and al.entity_id = im.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select decided_by, 'approval.existing_record', 'approval', id, 'Existing approval ' || approval_type || ' ' || status, jsonb_build_object('status', status, 'approval_type', approval_type, 'backfilled', true, 'original_created_at', created_at)
from public.approvals ap
where not exists (select 1 from public.audit_logs al where al.entity_type = 'approval' and al.entity_id = ap.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select null, 'department.existing_record', 'department', id, 'Existing department ' || name, jsonb_build_object('code', code, 'is_active', is_active, 'backfilled', true, 'original_created_at', created_at)
from public.departments d
where not exists (select 1 from public.audit_logs al where al.entity_type = 'department' and al.entity_id = d.id);

insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata)
select id, 'profile.existing_record', 'profile', id, 'Existing user profile ' || full_name, jsonb_build_object('is_active', is_active, 'employee_number', employee_number, 'backfilled', true, 'original_created_at', created_at)
from public.profiles p
where not exists (select 1 from public.audit_logs al where al.entity_type = 'profile' and al.entity_id = p.id);
