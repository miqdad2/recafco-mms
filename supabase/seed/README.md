# Phase 1 Seed Instructions

Run the Phase 1 migration first. Then create a Supabase Auth user through the Supabase dashboard or CLI.

After the Auth user exists, copy that user's UUID and run this SQL in the Supabase SQL editor to create the first Super Admin profile:

```sql
insert into public.profiles (
  id,
  full_name,
  employee_number,
  job_title,
  department_id,
  role_id,
  is_active,
  can_view_costs
)
select
  'PASTE_AUTH_USER_UUID_HERE',
  'RECAFCO Super Admin',
  'ADMIN-001',
  'System Administrator',
  d.id,
  r.id,
  true,
  true
from public.roles r
left join public.departments d on d.code = 'IT'
where r.slug = 'super_admin'
on conflict (id) do update set
  role_id = excluded.role_id,
  department_id = excluded.department_id,
  is_active = true,
  can_view_costs = true;
```

Do not commit real passwords. Use Supabase Auth to invite users or create temporary passwords through approved internal setup procedures.
