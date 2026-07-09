insert into public.notification_events(event_key, category, priority, description, is_critical)
values
  ('technician.assigned','Technician Jobs','high','Technician assigned to job',true),
  ('technician.job_started','Technician Jobs','normal','Technician started job',false),
  ('technician.job_completed','Technician Jobs','high','Technician completed job',true),
  ('technician.note_added','Technician Jobs','low','Technician note added',false),
  ('technician.labor_added','Technician Jobs','low','Technician labor added',false),
  ('technician.photo_uploaded','Technician Jobs','low','Technician photo uploaded',false)
on conflict (event_key) do update
set category = excluded.category,
    priority = excluded.priority,
    description = excluded.description,
    is_critical = excluded.is_critical,
    updated_at = now();

insert into public.notification_templates(event_key, channel, title_template, message_template, action_label_template, action_url_template)
values
  ('technician.job_started','in_app','Technician started job','Work order {work_order_number} has been started by the assigned technician.','Open work order','/maintenance/work-orders/{entity_id}'),
  ('technician.job_completed','in_app','Technician completed job','Work order {work_order_number} is completed by technician and waiting for verification.','Verify work order','/maintenance/work-orders/{entity_id}'),
  ('technician.note_added','in_app','Technician note added','A technician note was added to the work order.','Open work order','/maintenance/work-orders/{entity_id}'),
  ('technician.labor_added','in_app','Technician labor added','Technician labor was recorded for the work order.','Open work order','/maintenance/work-orders/{entity_id}'),
  ('technician.photo_uploaded','in_app','Technician photo uploaded','A technician photo was uploaded for the work order.','Open work order','/maintenance/work-orders/{entity_id}')
on conflict (event_key, channel) do update
set title_template = excluded.title_template,
    message_template = excluded.message_template,
    action_label_template = excluded.action_label_template,
    action_url_template = excluded.action_url_template,
    updated_at = now();
