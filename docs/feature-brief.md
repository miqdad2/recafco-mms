# Feature Brief

Use this file before building major RECAFCO features. Keep each brief practical and tied to the maintenance business workflow.

## Current Product Goal

Build the RECAFCO Enterprise Maintenance Management System as a secure internal application for work orders, assets, spare parts, approvals, purchase coordination, finance approval, reporting, dashboards, notifications, audit logs, private files, and mobile technician workflows.

## Feature Brief Template

### Feature / Area

Name the feature, route, workflow, or module.

### Business Problem

Describe the paper-based or manual process being replaced. Identify which users are affected: maintenance, supervisor, technician, store, purchase, finance, management, IT, or requester.

### Users and Permissions

List roles that can create, view, approve, update, export, or audit the feature. Call out cost visibility and technician assignment restrictions.

### Workflow

Describe the expected status flow and handoffs. Include approval, rejection, reassignment, notification, and closure behavior where relevant.

### Success Criteria

- The workflow matches RECAFCO's maintenance process.
- Permissions are enforced server-side.
- Forms validate data with clear errors.
- Status badges and timelines make progress clear.
- Mobile users can complete core actions with large tap targets.
- Audit logs are written for important actions.
- Relevant docs and tests are updated.

### Review Notes

Record product, UX, engineering, security, and documentation review decisions before implementation begins.

---

## Phase 1 Foundation

### Feature / Area

Project setup, Supabase Auth, RBAC, protected routes, Super Admin, departments, users/profiles, settings, basic dashboard, README, and RECAFCO-inspired UI.

### Business Problem

RECAFCO needs a secure first working system foundation before maintenance workflows can move from paper to digital records. Phase 1 must establish authenticated access, department ownership, user profiles, permissions, and configurable company settings so later work orders, store, purchase, finance, and reporting workflows can be built on real data instead of mock screens.

### Users and Permissions

Super Admin can access all Phase 1 modules. IT Admin can manage users, departments, settings, and audit visibility when granted. Other roles can access the dashboard and profile context, with future workflow pages protected by module permissions. Server-side permission checks must protect admin routes and actions.

### Workflow

1. User signs in through Supabase Auth.
2. Middleware protects application routes.
3. Server code loads the user's active profile, role, department, and permissions.
4. Dashboard shows live counts from Supabase tables.
5. Super Admin manages departments, users/profiles, role overview, settings, and audit logs.
6. Admin mutations validate input, write Supabase data, and record audit logs.

### Success Criteria

- Next.js App Router project compiles in TypeScript strict mode.
- Supabase browser/server clients are configured without exposing service role secrets.
- Protected routes redirect anonymous users to `/login`.
- Admin pages enforce server-side permissions.
- Departments, profiles, roles, settings, dashboard, and audit logs use Supabase queries.
- Forms use server actions with Zod validation.
- UI follows RECAFCO red, charcoal, white, and light gray enterprise style.
- README and docs explain setup, migrations, first Super Admin, and checks.

### Review Notes

Product: Phase 1 supports the required administrative backbone for all later maintenance workflows.

UX: Screens should be direct operational tools with clear tables, status badges, and compact management dashboard cards.

Engineering: Keep data access in server modules and actions; keep client components focused on interaction.

Security: Do not use service role in browser code; use RLS policies and server-side permission guards.

Documentation: Update README, architecture, security, testing checklist, and experiment log after implementation.

---

## Phase 2 Maintenance Data Foundation

### Feature / Area

Asset master, spare parts inventory, work order CRUD, configurable work order numbering, work order detail page, asset maintenance history, status history foundation, attachment metadata foundation, and print/PDF-ready work order page.

### Business Problem

RECAFCO maintenance needs real digital records for equipment, vehicles, spare parts, and paper work orders. Phase 2 replaces the core paper-form capture with structured records that later approval, technician, store, purchase, finance, and reporting workflows can use.

### Users and Permissions

Super Admin can manage all Phase 2 records. Maintenance Manager, Supervisor, and Data Entry can create and update work orders and assets according to permissions. Store Keeper can manage parts inventory. Viewer/Auditor and management roles can read records where permitted. Cost fields remain permission-aware.

### Workflow

1. Admin/maintenance users maintain the asset master.
2. Store users maintain spare parts inventory.
3. Maintenance users create work orders linked to assets and departments.
4. Work order numbers are generated automatically using settings-driven formats.
5. Work order status history records the initial status and later transitions.
6. Work order details show asset, labor, material, attachment metadata, costs, status history, and next service data.
7. Print page provides a PDF-ready paper-form layout.

### Success Criteria

- Phase 2 tables, indexes, triggers, RLS policies, permissions, and demo seed data exist.
- Asset forms include all AGENTS.md asset fields.
- Part forms include all AGENTS.md spare part fields.
- Work order forms include all AGENTS.md work order fields.
- Work order numbering supports `REC/MD/{TYPE}/JOB/{0000}` and configurable alternatives like `AUTO-MAINTENANCE-{SEQ}`.
- Asset detail page shows maintenance history.
- Work order detail page shows status history and attachment metadata foundation.
- Server actions validate input with Zod and enforce permissions server-side.
- README and docs are updated.

---

## Phase 3 Workflow Execution

### Feature / Area

Work order approvals, rejection, technician assignment, technician mobile dashboard, technician job execution, supervisor verification, maintenance manager closure, status history updates, audit logs, and in-app notifications.

### Business Problem

Phase 2 captures real maintenance records, but RECAFCO management also needs controlled handoffs between Data Entry, Maintenance Manager, Supervisor, and Technician. Phase 3 makes the work order lifecycle operational while keeping purchase/store/finance workflows for later phases.

### Users and Permissions

Maintenance Manager can approve, reject, and close verified work orders. Maintenance Supervisor can assign technicians and verify completed jobs. Technicians can view assigned jobs only and update their execution notes, labor, photo metadata, and completion status. Super Admin can perform and monitor all workflow actions.

### Workflow

1. Work order is submitted or pending approval.
2. Maintenance Manager approves or rejects.
3. Approved work order can be assigned to one or more technicians.
4. Technician sees only assigned jobs in `/technician/jobs`.
5. Technician starts, adds notes/labor/photo metadata, and completes the job.
6. Supervisor verifies completed work.
7. Maintenance Manager closes the verified work order.
8. Notifications, audit logs, approvals, assignments, and status history record the workflow.

### Success Criteria

- Phase 3 permissions, RLS, approvals, notifications, and technician note foundation exist.
- Role-based action buttons appear only when allowed.
- All workflow mutations use Zod validation and server-side permission checks.
- Technician pages are mobile-friendly and show assigned jobs only.
- Status transitions write history, notifications, and audit logs.

---

## Phase 4 Store, Purchase, Finance, and CEO Workflow

### Feature / Area

Parts requests, store issue, inventory movements, purchase requests for unavailable parts, finance approvals, CEO threshold approvals, queue dashboards, cost visibility controls, notifications, and audit logs.

### Business Problem

After technicians start work, RECAFCO needs a controlled path for requesting spare parts, issuing stock, handling unavailable parts, purchasing items, approving costs, and receiving purchased stock. Phase 4 connects maintenance execution to store, purchase, finance, and management review.

### Users and Permissions

Technicians and supervisors can create parts requests from work orders. Maintenance Manager approves or rejects parts requests. Store Keeper issues stock, partially issues stock, and marks items unavailable. Purchase Officer manages purchase requests. Finance Manager approves or rejects finance costs. CEO / Management approves or rejects requests over the configured threshold. Cost fields are hidden unless the role has `costs.view`.

### Workflow

1. Technician or supervisor creates a parts request linked to work order, asset, department, and requester.
2. Maintenance Manager approves or rejects the parts request.
3. Store Keeper issues available items, partially issues, or marks unavailable.
4. Issued parts reduce stock, create inventory movements, and update work order materials.
5. Unavailable parts create purchase requests and move the work order to `Waiting for Purchase`.
6. Purchase Officer updates supplier, estimates, quotation metadata, ordered, and received status.
7. Finance and CEO approvals are required according to app settings and threshold.
8. Receiving purchase items increases stock and creates inventory movements.

### Success Criteria

- Phase 4 tables, permissions, RLS policies, indexes, and demo workflow data exist.
- Parts request forms support multiple items and status workflow.
- Store issue panel updates stock, issue quantity, inventory movements, work order materials, and work order status.
- Purchase workflow supports supplier/quotation metadata, estimates, ordered, and received.
- Finance and CEO actions are permission-protected and settings-aware.
- Cost fields are guarded in UI and server-side reads.
- Notifications and audit logs are created for all major Phase 4 actions.

---

## System Map Presentation Page

### Feature / Area

Premium visual Enterprise Operations Control Center at `/admin/system-map`.

### Business Problem

RECAFCO IT and management need one professional screen that explains what the system does, how work flows from request to closure, which roles are involved, what management can monitor, which modules are completed, and what is coming next.

### Users and Permissions

Super Admin can always access the page. IT Admin and CEO / Management can access it through `system_map.view`. Other roles are blocked server-side.

### Workflow

1. Authorized user opens `/admin/system-map`.
2. Page writes a non-blocking `system_map.viewed` audit log.
3. Server fetches live Supabase statistics.
4. Config-driven sections render the executive workflow strip, phases, modules, workflow nodes, edges, role swimlanes, management monitoring cards, and roadmap items.
5. Presentation mode opens a full-screen executive workflow and detailed workflow map.

### Success Criteria

- Page feels like an Enterprise Operations Control Center, not a generic dashboard.
- Workflow content is driven by `lib/system-map/config.ts`.
- Live stats are fetched server-side through `lib/system-map/stats.ts`.
- Sidebar link is visible only to permitted users.
- README explains access and future config updates.
