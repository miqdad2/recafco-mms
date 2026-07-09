insert into public.permissions (key, description)
values ('system_map.view', 'View the RECAFCO system workflow map')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'system_map.view'
where r.slug in ('super_admin', 'it_admin', 'ceo_management')
on conflict do nothing;
