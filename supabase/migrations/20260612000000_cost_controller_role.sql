-- ─────────────────────────────────────────────────────────────────────────────
-- Cost Controller and Accounting Reviewer roles
--
-- Business context:
--   Cost validation happens BEFORE Finance approval in the cost-control chain:
--   Purchase Officer → Cost Controller (review) → Finance Manager (payment) → CEO (if over threshold)
--
--   Cost Controller: reviews estimated cost, checks budget/cost center, flags
--   duplicate or unusual costs, and forwards to Finance or CEO depending on limits.
--
--   Accounting Reviewer: supports the accounting department in reviewing cost
--   records, validating entries, and producing cost reports.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add roles
insert into public.roles (name, slug, description)
values
  ('Cost Controller', 'cost_controller', 'Review estimated costs, verify budget/cost center, flag unusual costs, and validate cost reasonableness before finance approval.'),
  ('Accounting Reviewer', 'accounting_reviewer', 'Accounting department review for cost validation, budget checking, and cost reporting.')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

-- Add permissions
insert into public.permissions (key, description)
values
  ('cost.review',        'Review and validate cost items before finance approval'),
  ('cost.approve',       'Approve or flag cost items after review'),
  ('cost.reports.view',  'View cost controller reports and cost summaries'),
  ('budget.check',       'Check budget availability and cost center allocation'),
  ('cost_center.manage', 'Manage cost centers and budget allocations')
on conflict (key) do update set description = excluded.description;

-- Grant permissions to Cost Controller
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'dashboard.view',
  'costs.view',
  'cost.review',
  'cost.approve',
  'cost.reports.view',
  'budget.check',
  'purchase_requests.view',
  'finance.reports.view',
  'reports.view',
  'reports.export',
  'work_orders.view',
  'assets.view',
  'parts.view'
)
where r.slug = 'cost_controller'
on conflict do nothing;

-- Grant permissions to Accounting Reviewer
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'dashboard.view',
  'costs.view',
  'cost.review',
  'cost.reports.view',
  'budget.check',
  'purchase_requests.view',
  'finance.reports.view',
  'reports.view',
  'reports.export',
  'work_orders.view',
  'assets.view'
)
where r.slug = 'accounting_reviewer'
on conflict do nothing;

-- RLS: cost controllers and accounting reviewers can view purchase requests
-- (they need read access to perform cost review — write/approval handled by application layer)
drop policy if exists "cost reviewers can view purchase requests" on public.purchase_requests;
create policy "cost reviewers can view purchase requests"
on public.purchase_requests for select
to authenticated
using (
  public.has_permission('cost.review')
  or public.has_permission('purchase_requests.view')
);
