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

  entity_id_text := coalesce(
    row_data->>'id',
    old_data->>'id',
    row_data->>'event_key',
    old_data->>'event_key',
    row_data->>'key',
    old_data->>'key',
    nullif(concat_ws(':', row_data->>'role_id', row_data->>'permission_id'), ''),
    nullif(concat_ws(':', old_data->>'role_id', old_data->>'permission_id'), '')
  );

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
    public.uuid_or_null(row_data->>'recipient_user_id'),
    public.uuid_or_null(row_data->>'user_id'),
    public.uuid_or_null(row_data->>'profile_id'),
    public.uuid_or_null(old_data->>'updated_by'),
    public.uuid_or_null(old_data->>'created_by'),
    public.uuid_or_null(old_data->>'decided_by'),
    public.uuid_or_null(old_data->>'assigned_by'),
    public.uuid_or_null(old_data->>'uploaded_by'),
    public.uuid_or_null(old_data->>'changed_by'),
    public.uuid_or_null(old_data->>'recipient_user_id'),
    public.uuid_or_null(old_data->>'user_id'),
    public.uuid_or_null(old_data->>'profile_id')
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
    row_data->>'event_key',
    old_data->>'event_key',
    row_data->>'key',
    old_data->>'key',
    entity_id_text,
    'record'
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
    when coalesce(old_data->>'is_active', '') <> coalesce(row_data->>'is_active', '') then entity_type_value || '.active_state_change'
    when coalesce(old_data->>'is_enabled', '') <> coalesce(row_data->>'is_enabled', '') then entity_type_value || '.enabled_state_change'
    when coalesce(old_data->>'is_read', '') <> coalesce(row_data->>'is_read', '') then entity_type_value || '.read_state_change'
    else entity_type_value || '.record_update'
  end;

  metadata_value := jsonb_build_object(
    'table', tg_table_name,
    'operation', lower(tg_op),
    'changed_fields', coalesce(to_jsonb(changed_keys), '[]'::jsonb),
    'entity_key', entity_id_text
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

create or replace procedure public.attach_audit_trigger_if_exists(target_table text, entity_type text)
language plpgsql
as $$
begin
  if to_regclass('public.' || quote_ident(target_table)) is null then
    return;
  end if;

  execute format('drop trigger if exists %I on public.%I', target_table || '_audit_row_change', target_table);
  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)',
    target_table || '_audit_row_change',
    target_table,
    entity_type
  );
end;
$$;

call public.attach_audit_trigger_if_exists('app_settings', 'app_setting');
call public.attach_audit_trigger_if_exists('approvals', 'approval');
call public.attach_audit_trigger_if_exists('asset_documents', 'asset_document');
call public.attach_audit_trigger_if_exists('assets', 'asset');
call public.attach_audit_trigger_if_exists('auth_sessions', 'auth_session');
call public.attach_audit_trigger_if_exists('auth_users', 'auth_user');
call public.attach_audit_trigger_if_exists('departments', 'department');
call public.attach_audit_trigger_if_exists('inventory_movements', 'inventory_movement');
call public.attach_audit_trigger_if_exists('notification_delivery_logs', 'notification_delivery_log');
call public.attach_audit_trigger_if_exists('notification_events', 'notification_event');
call public.attach_audit_trigger_if_exists('notification_preferences', 'notification_preference');
call public.attach_audit_trigger_if_exists('notification_templates', 'notification_template');
call public.attach_audit_trigger_if_exists('notifications', 'notification');
call public.attach_audit_trigger_if_exists('numbering_sequences', 'numbering_sequence');
call public.attach_audit_trigger_if_exists('parts', 'part');
call public.attach_audit_trigger_if_exists('parts_request_items', 'parts_request_item');
call public.attach_audit_trigger_if_exists('parts_requests', 'parts_request');
call public.attach_audit_trigger_if_exists('permissions', 'permission');
call public.attach_audit_trigger_if_exists('profiles', 'profile');
call public.attach_audit_trigger_if_exists('purchase_request_items', 'purchase_request_item');
call public.attach_audit_trigger_if_exists('purchase_requests', 'purchase_request');
call public.attach_audit_trigger_if_exists('role_permissions', 'role_permission');
call public.attach_audit_trigger_if_exists('roles', 'role');
call public.attach_audit_trigger_if_exists('work_order_assignments', 'work_order_assignment');
call public.attach_audit_trigger_if_exists('work_order_attachments', 'work_order_attachment');
call public.attach_audit_trigger_if_exists('work_order_labor', 'work_order_labor');
call public.attach_audit_trigger_if_exists('work_order_materials', 'work_order_material');
call public.attach_audit_trigger_if_exists('work_order_status_history', 'work_order_status_history');
call public.attach_audit_trigger_if_exists('work_order_technician_notes', 'work_order_technician_note');
call public.attach_audit_trigger_if_exists('work_orders', 'work_order');
call public.attach_audit_trigger_if_exists('workflow_map_versions', 'workflow_map_version');

drop procedure public.attach_audit_trigger_if_exists(text, text);

create index if not exists idx_audit_logs_entity_type_created_at on public.audit_logs(entity_type, created_at desc);
create index if not exists idx_audit_logs_entity_id_created_at on public.audit_logs(entity_id, created_at desc);
create index if not exists idx_audit_logs_actor_created_at on public.audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_logs_action_created_at on public.audit_logs(action, created_at desc);
