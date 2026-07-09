insert into public.permissions (key, description)
values ('architecture.view', 'View technical architecture presentation page')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'architecture.view'
where r.slug in ('super_admin', 'it_admin')
on conflict do nothing;
