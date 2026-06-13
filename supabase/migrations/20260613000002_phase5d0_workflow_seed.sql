-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-D0: Workflow Engine Template Seed
--
-- Seeds workflow_definitions and workflow_steps tables with template data.
-- This is TEMPLATE DATA ONLY.
--
--   * No workflow_instances are created.
--   * No workflow_step_instances are created.
--   * No work_orders status behavior is changed.
--   * No application code is modified.
--   * No purchase_requests routing is changed.
--
-- Idempotent: uses ON CONFLICT DO UPDATE, safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Workflow Definitions ──────────────────────────────────────────────────

insert into public.workflow_definitions (
  name,
  code,
  entity_type,
  version,
  is_active,
  description
)
values
  (
    'Maintenance Work Order',
    'maintenance_work_order',
    'work_order',
    1,
    true,
    'Standard maintenance work order workflow: draft submission, manager approval, inventory check, technician execution, parts request with available and unavailable branches, purchase order chain, and final closure.'
  ),
  (
    'Construction Project Request',
    'construction_project_request',
    'construction_request',
    1,
    true,
    'Construction and project maintenance request workflow: data entry, project manager approval, construction manager confirmation, purchase manager, finance authorization, CEO approval (if threshold met), PO creation, team execution, and closure.'
  )
on conflict (code) do update set
  name        = excluded.name,
  description = excluded.description,
  is_active   = excluded.is_active,
  updated_at  = now();


-- ─── 2. Maintenance Work Order Steps (20 steps) ───────────────────────────────
--
-- Main path:          steps  1 – 9  (submission → manager approval → inventory
--                                    check → assignment → execution → closure)
-- Unavailable branch: steps 10 – 20 (shortage confirmed → production/factory/
--                                    purchase manager → finance → CEO → PO
--                                    creation → receive → return to assignment)
--
-- Branch routing will be wired by the workflow engine service in Phase 5-D1.
-- The metadata column carries status-transition hints and branching intent.

insert into public.workflow_steps (
  workflow_def_id,
  step_order,
  code,
  name,
  description,
  required_role,
  required_permission,
  is_approval_step,
  is_final_step,
  metadata
)
select
  wd.id,
  s.step_order,
  s.code,
  s.name,
  s.description,
  s.required_role,
  s.required_permission,
  s.is_approval_step,
  s.is_final_step,
  s.metadata::jsonb
from public.workflow_definitions wd,
(values

  -- ── Main path ─────────────────────────────────────────────────────────────

  (
    1, 'draft_submission', 'Draft Submission',
    'Maintenance data entry creates and submits the work order with asset and complaint details.',
    'maintenance_data_entry', 'work_orders.create',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_submit_status":"Submitted","template_note":"Entry point — data entry submits the work order for manager review"}'
  ),
  (
    2, 'maintenance_manager_review', 'Maintenance Manager Review',
    'Maintenance manager reviews, then approves or rejects the submitted work order.',
    'maintenance_manager', 'work_orders.approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Approved","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Primary gate — manager decides if the job proceeds"}'
  ),
  (
    3, 'inventory_check', 'Inventory Check',
    'Store keeper checks stock availability for all required parts before the technician starts.',
    'store_keeper', 'work_orders.inventory_check',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_available_status":"Parts Available","on_shortage_status":"Waiting for Parts","template_note":"Branch point: available path continues to step 4–6; shortage path branches to step 10"}'
  ),
  (
    4, 'store_keeper_confirmation', 'Store Keeper Confirmation',
    'Store keeper confirms full issue, partial issue, or marks items unavailable to determine the branch path.',
    'store_keeper', 'store.issue',
    true, false,
    '{"is_optional":false,"allow_clarification":false,"on_issue_status":"Parts Issued","on_unavailable_status":"Waiting for Purchase","template_note":"Confirms inventory check result and resolves available vs unavailable branch"}'
  ),
  (
    5, 'available_parts_issue', 'Available Parts Issue',
    'Store keeper issues all available parts directly from stock to the work order.',
    'store_keeper', 'store.issue',
    false, false,
    '{"is_optional":true,"allow_clarification":false,"on_complete_status":"Parts Issued","template_note":"Available-path step — parts issued, flow continues to maintenance assignment"}'
  ),
  (
    6, 'maintenance_assignment', 'Maintenance Assignment',
    'Maintenance manager assigns the approved work order to a maintenance team and technician.',
    'maintenance_manager', 'work_orders.assign',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_assign_status":"Assigned","template_note":"Links the work order to the responsible team and individual technician"}'
  ),
  (
    7, 'team_execution', 'Team Execution',
    'Assigned technician starts work, records labor hours, adds notes and photos, and marks the job complete.',
    'technician', 'work_orders.update',
    false, false,
    '{"is_optional":false,"allow_clarification":true,"on_start_status":"In Progress","on_complete_status":"Completed by Technician","template_note":"Execution stage — technician performs the job and records all work details"}'
  ),
  (
    8, 'supervisor_verification', 'Supervisor Verification',
    'Maintenance supervisor verifies that the completed job meets quality and safety standards.',
    'maintenance_supervisor', 'work_orders.assign',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Verified by Supervisor","on_reject_status":"Needs Rework","on_clarify_status":"Pending Clarification","template_note":"Quality gate before the manager closes the work order"}'
  ),
  (
    9, 'closure', 'Closure',
    'Maintenance manager closes the verified work order and updates the asset maintenance history record.',
    'maintenance_manager', 'work_orders.close',
    false, true,
    '{"is_optional":false,"allow_clarification":false,"on_close_status":"Closed","template_note":"Final step — work order closed; asset history and next service date updated"}'
  ),

  -- ── Unavailable-parts branch ──────────────────────────────────────────────

  (
    10, 'store_shortage_confirmed', 'Store Shortage Confirmed',
    'Store keeper confirms that one or more required parts are not available in stock, triggering the purchase path.',
    'store_keeper', 'store.issue',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_confirm_status":"Waiting for Purchase","template_note":"Shortage gate — activates the purchase request and approval chain"}'
  ),
  (
    11, 'production_manager_approval', 'Production Manager Approval',
    'Production manager reviews the parts request for feasibility and alignment with production schedules.',
    'production_manager', 'purchase.production_approve',
    true, false,
    '{"is_optional":true,"allow_clarification":true,"on_approve_status":"Pending Factory Review","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Construction and production context check — optional for standard maintenance requests"}'
  ),
  (
    12, 'factory_manager_approval', 'Factory Manager Approval',
    'Factory manager confirms factory equipment requirements, scheduling impact, and team readiness.',
    'factory_manager', 'purchase.factory_approve',
    true, false,
    '{"is_optional":true,"allow_clarification":true,"on_approve_status":"Pending Purchase Manager Review","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Factory operations check — optional for routine maintenance; required for construction requests"}'
  ),
  (
    13, 'purchase_manager_approval', 'Purchase Manager Approval',
    'Purchase manager approves procurement strategy, vendor selection, and total purchase value.',
    'purchase_manager', 'purchase.manager_approve',
    true, false,
    '{"is_optional":true,"allow_clarification":true,"on_approve_status":"Pending Finance Approval","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Procurement oversight gate — approves vendor and strategy before Finance authorization"}'
  ),
  (
    14, 'finance_manager_approval', 'Finance Manager Approval',
    'Finance manager authorizes payment for the purchase request after cost validation is confirmed.',
    'finance_manager', 'finance.approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Approved","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Payment authorization — final approval unless the CEO threshold applies"}'
  ),
  (
    15, 'ceo_final_approval', 'CEO Final Approval',
    'CEO approves high-value purchase requests that meet or exceed the configured threshold (default 1,000 KWD).',
    'ceo_management', 'ceo.approve',
    true, false,
    '{"is_optional":true,"allow_clarification":false,"on_approve_status":"Pending CEO Approval","on_reject_status":"Rejected","threshold_kwd":1000,"template_note":"Triggered only when purchase amount >= configured CEO approval threshold"}'
  ),
  (
    16, 'purchase_order_creation', 'Purchase Order Creation',
    'Purchase officer creates a formal Purchase Order (PO) against the approved purchase request and issues it to the supplier.',
    'purchase_officer', 'purchase_orders.manage',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_create_status":"Ordered","template_note":"Formal PO raised and sent to supplier — procurement officially initiated"}'
  ),
  (
    17, 'po_issued', 'PO Issued to Supplier',
    'Purchase officer records that the PO has been sent and the supplier has confirmed acknowledgement.',
    'purchase_officer', 'purchase_orders.manage',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_issue_status":"Ordered","template_note":"Supplier acknowledgement recorded — waiting for delivery"}'
  ),
  (
    18, 'parts_received', 'Parts Received',
    'Store keeper records delivery receipt, checks quantity and quality against the PO, and raises discrepancies.',
    'store_keeper', 'store.receive',
    false, false,
    '{"is_optional":false,"allow_clarification":true,"on_receive_status":"Received","template_note":"Physical receipt of parts from supplier — quality and quantity verified"}'
  ),
  (
    19, 'store_stock_update', 'Store Stock Update',
    'Store keeper updates inventory stock levels and issues the received parts to the work order.',
    'store_keeper', 'store.issue',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_update_status":"Parts Issued","template_note":"Stock updated in inventory; parts formally issued to the job"}'
  ),
  (
    20, 'return_to_assignment', 'Return to Assignment',
    'Maintenance manager reassigns the work order now that all required parts have been received and issued.',
    'maintenance_manager', 'work_orders.assign',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_assign_status":"Assigned","template_note":"Job resumes the normal execution path from assignment — rejoins the main path at step 6"}'
  )

) as s(step_order, code, name, description, required_role, required_permission, is_approval_step, is_final_step, metadata)
where wd.code = 'maintenance_work_order'
on conflict (workflow_def_id, code) do update set
  step_order          = excluded.step_order,
  name                = excluded.name,
  description         = excluded.description,
  required_role       = excluded.required_role,
  required_permission = excluded.required_permission,
  is_approval_step    = excluded.is_approval_step,
  is_final_step       = excluded.is_final_step,
  metadata            = excluded.metadata,
  updated_at          = now();


-- ─── 3. Construction Project Request Steps (10 steps) ────────────────────────
--
-- Covers construction and project maintenance requests that require approval
-- from Production Manager and Factory Manager before entering the standard
-- purchase and execution chain.

insert into public.workflow_steps (
  workflow_def_id,
  step_order,
  code,
  name,
  description,
  required_role,
  required_permission,
  is_approval_step,
  is_final_step,
  metadata
)
select
  wd.id,
  s.step_order,
  s.code,
  s.name,
  s.description,
  s.required_role,
  s.required_permission,
  s.is_approval_step,
  s.is_final_step,
  s.metadata::jsonb
from public.workflow_definitions wd,
(values

  (
    1, 'project_data_entry_submission', 'Project Data Entry Submission',
    'Maintenance data entry creates and submits the construction or project maintenance request.',
    'maintenance_data_entry', 'work_orders.create',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_submit_status":"Submitted","template_note":"Entry point for all construction and project-related maintenance requests"}'
  ),
  (
    2, 'project_manager_approval', 'Project Manager Approval',
    'Project manager reviews the construction request for scope, resources, and feasibility.',
    'production_manager', 'purchase.production_approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Pending Construction Review","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Scope and feasibility gate — project manager confirms the request is viable"}'
  ),
  (
    3, 'construction_manager_approval', 'Construction Manager Approval',
    'Construction manager confirms scheduling, equipment availability, and team readiness for the project.',
    'factory_manager', 'purchase.factory_approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Pending Purchase Review","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Operations scheduling and team readiness check before procurement begins"}'
  ),
  (
    4, 'purchase_manager_approval', 'Purchase Manager Approval',
    'Purchase manager approves the procurement plan, vendor shortlist, and total estimated cost.',
    'purchase_manager', 'purchase.manager_approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Pending Finance Approval","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Procurement plan and vendor selection approval"}'
  ),
  (
    5, 'finance_manager_approval', 'Finance Manager Approval',
    'Finance manager authorizes the total project cost and validates budget allocation.',
    'finance_manager', 'finance.approve',
    true, false,
    '{"is_optional":false,"allow_clarification":true,"on_approve_status":"Approved","on_reject_status":"Rejected","on_clarify_status":"Pending Clarification","template_note":"Budget authorization — final approval unless CEO threshold applies"}'
  ),
  (
    6, 'ceo_final_approval', 'CEO Final Approval',
    'CEO approves the construction project request when total cost meets or exceeds the configured threshold (default 1,000 KWD).',
    'ceo_management', 'ceo.approve',
    true, false,
    '{"is_optional":true,"allow_clarification":false,"on_approve_status":"CEO Approved","on_reject_status":"Rejected","threshold_kwd":1000,"template_note":"Triggered only when project cost >= configured CEO approval threshold"}'
  ),
  (
    7, 'purchase_order_creation', 'Purchase Order Creation',
    'Purchase officer creates a formal Purchase Order for the approved construction project materials and services.',
    'purchase_officer', 'purchase_orders.manage',
    false, false,
    '{"is_optional":false,"allow_clarification":false,"on_create_status":"Ordered","template_note":"Formal PO issued to supplier for construction materials and services"}'
  ),
  (
    8, 'waiting_ready_received_update', 'Waiting / Ready / Received',
    'Purchase officer updates PO status as construction materials and services are ordered and received.',
    'purchase_officer', 'purchase_orders.manage',
    false, false,
    '{"is_optional":false,"allow_clarification":true,"on_ready_status":"Parts Issued","on_received_status":"Received","template_note":"Tracks procurement delivery progress for construction materials"}'
  ),
  (
    9, 'project_team_execution', 'Project Team Execution',
    'Assigned project team executes the construction work with documented progress, labor records, and photos.',
    'technician', 'work_orders.update',
    false, false,
    '{"is_optional":false,"allow_clarification":true,"on_start_status":"In Progress","on_complete_status":"Completed by Technician","template_note":"Construction execution tracked through the same completion flow as maintenance work orders"}'
  ),
  (
    10, 'closure', 'Closure',
    'Maintenance manager closes the project work order and updates the asset and project records.',
    'maintenance_manager', 'work_orders.close',
    false, true,
    '{"is_optional":false,"allow_clarification":false,"on_close_status":"Closed","template_note":"Final closure — work order closed with project completion notes and updated asset record"}'
  )

) as s(step_order, code, name, description, required_role, required_permission, is_approval_step, is_final_step, metadata)
where wd.code = 'construction_project_request'
on conflict (workflow_def_id, code) do update set
  step_order          = excluded.step_order,
  name                = excluded.name,
  description         = excluded.description,
  required_role       = excluded.required_role,
  required_permission = excluded.required_permission,
  is_approval_step    = excluded.is_approval_step,
  is_final_step       = excluded.is_final_step,
  metadata            = excluded.metadata,
  updated_at          = now();


-- ─── Verification queries (run after applying to confirm seed) ────────────────
--
-- select code, name, is_active from public.workflow_definitions order by code;
--
-- select wd.code, ws.step_order, ws.code, ws.name, ws.required_role
-- from public.workflow_steps ws
-- join public.workflow_definitions wd on wd.id = ws.workflow_def_id
-- order by wd.code, ws.step_order;
--
-- select count(*) from public.workflow_instances;       -- must be 0
-- select count(*) from public.workflow_step_instances;  -- must be 0
-- ─────────────────────────────────────────────────────────────────────────────
