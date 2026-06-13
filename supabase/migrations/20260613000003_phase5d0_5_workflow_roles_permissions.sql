-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-D0.5: Workflow Roles and Permissions Seed
--
-- Adds only the missing roles, permissions, and role-permission mappings
-- required by the workflow_steps template seeded in Phase 5-D0.
--
-- This is CONFIGURATION DATA ONLY.
--   * No workflow_instances are created.
--   * No workflow_step_instances are created.
--   * No work_order or purchase_request behavior is changed.
--   * No existing roles are downgraded.
--   * No existing permissions are removed.
--   * No application code is modified.
--
-- Idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Missing Permissions (12 new keys) ─────────────────────────────────────
--
-- 9 required by workflow_steps.required_permission:
--   work_orders.close, work_orders.create, work_orders.inventory_check,
--   work_orders.update, store.receive, purchase_orders.manage,
--   purchase.production_approve, purchase.factory_approve,
--   purchase.manager_approve
--
-- 3 utility permissions needed for new role assignments:
--   purchase_orders.view, workflow.view, workflow.clarify

insert into public.permissions (key, description)
values
  -- Work order lifecycle
  ('work_orders.create',          'Create new maintenance work orders'),
  ('work_orders.update',          'Update work order execution details — notes, labor hours, and photos'),
  ('work_orders.close',           'Close completed and verified work orders and update asset history'),
  ('work_orders.inventory_check', 'Check inventory availability for work order required parts'),

  -- Store receiving
  ('store.receive',               'Receive parts delivery from supplier and update inventory stock levels'),

  -- Purchase order management
  ('purchase_orders.manage',      'Create and manage formal purchase orders against approved purchase requests'),
  ('purchase_orders.view',        'View purchase orders and order line item details'),

  -- New approval chain permissions (production, factory, purchase manager gates)
  ('purchase.production_approve', 'Approve or reject production manager feasibility review for purchase requests'),
  ('purchase.factory_approve',    'Approve or reject factory manager operational review for purchase requests'),
  ('purchase.manager_approve',    'Approve or reject purchase manager procurement strategy for purchase requests'),

  -- Workflow engine visibility and clarification
  ('workflow.view',               'View workflow instances, step history, and the full approval chain'),
  ('workflow.clarify',            'Submit and respond to clarification requests in workflow steps')

on conflict (key) do nothing;


-- ─── 2. Missing Roles (3 new slugs) ───────────────────────────────────────────
--
-- required_role values in workflow_steps that have no matching role row:
--   factory_manager, production_manager, purchase_manager

insert into public.roles (name, slug, description, is_system)
values
  (
    'Production Manager',
    'production_manager',
    'Reviews construction and project maintenance requests for production feasibility and resource impact before entering the purchase chain.',
    true
  ),
  (
    'Factory Manager',
    'factory_manager',
    'Confirms factory equipment requirements, scheduling, and operational readiness for construction and maintenance requests.',
    true
  ),
  (
    'Purchase Manager',
    'purchase_manager',
    'Oversees procurement strategy, vendor selection, and purchase manager approval for high-value purchase requests and purchase orders.',
    true
  )
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description;


-- ─── 3. Role-Permission Mappings ──────────────────────────────────────────────
--
-- All inserts use ON CONFLICT DO NOTHING — existing mappings are preserved.
-- Organised in five groups:
--   A) New roles (production_manager, factory_manager, purchase_manager)
--   B) Maintenance roles — missing workflow permissions
--   C) Store / Purchase roles — missing workflow permissions
--   D) Finance / CEO / Cost roles — missing workflow permissions
--   E) Super Admin — all new permissions
--   F) Remaining roles — workflow.view where useful


-- ── A) New role permissions ────────────────────────────────────────────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- production_manager
  ('production_manager', 'dashboard.view'),
  ('production_manager', 'notifications.view'),
  ('production_manager', 'files.view'),
  ('production_manager', 'work_orders.view'),
  ('production_manager', 'work_orders.print'),
  ('production_manager', 'assets.view'),
  ('production_manager', 'reports.view'),
  ('production_manager', 'purchase_requests.view'),
  ('production_manager', 'purchase_orders.view'),
  ('production_manager', 'purchase.production_approve'),
  ('production_manager', 'workflow.view'),
  ('production_manager', 'workflow.clarify'),

  -- factory_manager
  ('factory_manager', 'dashboard.view'),
  ('factory_manager', 'notifications.view'),
  ('factory_manager', 'files.view'),
  ('factory_manager', 'work_orders.view'),
  ('factory_manager', 'work_orders.print'),
  ('factory_manager', 'assets.view'),
  ('factory_manager', 'reports.view'),
  ('factory_manager', 'purchase_requests.view'),
  ('factory_manager', 'purchase_orders.view'),
  ('factory_manager', 'purchase.factory_approve'),
  ('factory_manager', 'workflow.view'),
  ('factory_manager', 'workflow.clarify'),

  -- purchase_manager
  ('purchase_manager', 'dashboard.view'),
  ('purchase_manager', 'notifications.view'),
  ('purchase_manager', 'files.view'),
  ('purchase_manager', 'files.upload'),
  ('purchase_manager', 'work_orders.view'),
  ('purchase_manager', 'work_orders.print'),
  ('purchase_manager', 'assets.view'),
  ('purchase_manager', 'parts.view'),
  ('purchase_manager', 'reports.view'),
  ('purchase_manager', 'reports.export'),
  ('purchase_manager', 'purchase_requests.view'),
  ('purchase_manager', 'purchase_requests.manage'),
  ('purchase_manager', 'purchase_orders.view'),
  ('purchase_manager', 'purchase_orders.manage'),
  ('purchase_manager', 'purchase.manager_approve'),
  ('purchase_manager', 'costs.view'),
  ('purchase_manager', 'workflow.view'),
  ('purchase_manager', 'workflow.clarify')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ── B) Maintenance roles — missing workflow permissions ────────────────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- maintenance_data_entry: explicit create permission + workflow visibility
  ('maintenance_data_entry', 'work_orders.create'),
  ('maintenance_data_entry', 'workflow.view'),

  -- maintenance_manager: assignment gate (step 6, 20), closure (step 9),
  --   inventory oversight (step 3), create, update, and workflow gates
  ('maintenance_manager', 'work_orders.assign'),
  ('maintenance_manager', 'work_orders.close'),
  ('maintenance_manager', 'work_orders.create'),
  ('maintenance_manager', 'work_orders.inventory_check'),
  ('maintenance_manager', 'work_orders.update'),
  ('maintenance_manager', 'workflow.view'),
  ('maintenance_manager', 'workflow.clarify'),

  -- maintenance_supervisor: update execution details (step 7 oversight),
  --   workflow visibility and clarification
  ('maintenance_supervisor', 'work_orders.update'),
  ('maintenance_supervisor', 'work_orders.create'),
  ('maintenance_supervisor', 'workflow.view'),
  ('maintenance_supervisor', 'workflow.clarify'),

  -- technician: work_orders.update required for step 7 team_execution
  ('technician', 'work_orders.update'),
  ('technician', 'work_orders.view'),
  ('technician', 'workflow.view'),
  ('technician', 'workflow.clarify')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ── C) Store / Purchase roles — missing workflow permissions ───────────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- store_keeper: receive delivery (step 18), inventory check (step 3),
  --   work order visibility, workflow gates
  ('store_keeper', 'store.receive'),
  ('store_keeper', 'work_orders.inventory_check'),
  ('store_keeper', 'work_orders.view'),
  ('store_keeper', 'work_orders.print'),
  ('store_keeper', 'workflow.view'),
  ('store_keeper', 'workflow.clarify'),

  -- purchase_officer: PO creation (steps 16, 17), PO view, workflow visibility
  ('purchase_officer', 'purchase_orders.manage'),
  ('purchase_officer', 'purchase_orders.view'),
  ('purchase_officer', 'workflow.view')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ── D) Finance / CEO / Cost roles — missing workflow permissions ───────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- finance_manager: see work order context for costs, PO view, workflow gates
  ('finance_manager', 'work_orders.view'),
  ('finance_manager', 'purchase_orders.view'),
  ('finance_manager', 'workflow.view'),
  ('finance_manager', 'workflow.clarify'),

  -- ceo_management: PO view for executive oversight, workflow visibility
  ('ceo_management', 'purchase_orders.view'),
  ('ceo_management', 'workflow.view'),

  -- cost_controller: PO view for cost validation, workflow visibility
  ('cost_controller', 'purchase_orders.view'),
  ('cost_controller', 'workflow.view'),

  -- accounting_reviewer: workflow visibility for audit trail
  ('accounting_reviewer', 'workflow.view')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ── E) Super Admin — all 12 new permissions ────────────────────────────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('super_admin', 'work_orders.create'),
  ('super_admin', 'work_orders.update'),
  ('super_admin', 'work_orders.close'),
  ('super_admin', 'work_orders.inventory_check'),
  ('super_admin', 'store.receive'),
  ('super_admin', 'purchase_orders.manage'),
  ('super_admin', 'purchase_orders.view'),
  ('super_admin', 'purchase.production_approve'),
  ('super_admin', 'purchase.factory_approve'),
  ('super_admin', 'purchase.manager_approve'),
  ('super_admin', 'workflow.view'),
  ('super_admin', 'workflow.clarify')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ── F) Remaining roles — workflow.view where useful ───────────────────────────

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- it_admin: workflow visibility for support and audit
  ('it_admin', 'workflow.view'),

  -- department_requester: track request workflow status
  ('department_requester', 'workflow.view'),

  -- viewer_auditor: read-only workflow audit trail
  ('viewer_auditor', 'workflow.view')

) as t(role_slug, perm_key)
join public.roles r on r.slug = t.role_slug
join public.permissions p on p.key = t.perm_key
on conflict (role_id, permission_id) do nothing;


-- ─── Verification queries ─────────────────────────────────────────────────────
--
-- Confirm all workflow_steps.required_role values exist in roles:
-- select ws.required_role from public.workflow_steps ws
-- left join public.roles r on r.slug = ws.required_role
-- where ws.required_role is not null and r.id is null;
-- → expect 0 rows
--
-- Confirm all workflow_steps.required_permission values exist in permissions:
-- select ws.required_permission from public.workflow_steps ws
-- left join public.permissions p on p.key = ws.required_permission
-- where ws.required_permission is not null and p.id is null;
-- → expect 0 rows
--
-- select count(*) from public.workflow_instances;       -- must be 0
-- select count(*) from public.workflow_step_instances;  -- must be 0
-- ─────────────────────────────────────────────────────────────────────────────
