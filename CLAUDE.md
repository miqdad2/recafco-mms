# CLAUDE.md

## Project Name

**RECAFCO Enterprise Maintenance Management System**

## Project Type

Enterprise internal web application for maintenance, assets, work orders, spare parts, approvals, purchase coordination, finance approval, reporting, dashboards, notifications, audit logs, and management monitoring.

This project is **not** a requirement collection portal. It is the actual **Maintenance Management System prototype / first working version** for RECAFCO management review.

The system must be secure, scalable, fast, mobile-friendly, PWA-ready, and suitable for a large construction/manufacturing company with multiple departments.

---

# 1. Business Context

RECAFCO is a large construction/manufacturing company with multiple departments such as:

- Maintenance
- Store
- Purchase
- Finance
- HR
- IT
- Operations
- CEO / Management

The maintenance department currently uses paper-based forms for:

1. **Work Orders**
2. **Parts Requests**
3. Other maintenance-related forms that may be added later

The goal is to digitize and control the full maintenance workflow so the company can track:

- who created the work order
- who approved or rejected it
- which asset/equipment/vehicle is involved
- assigned supervisor
- assigned technician
- spare parts requested
- parts issued
- unavailable parts
- purchase requests
- finance approval
- CEO approval if required
- work completion
- supervisor verification
- final closure
- maintenance history
- next service details
- asset expiry dates
- costs
- reports
- audit trail

---

# 2. Main Product Goal

Build a working enterprise-grade Maintenance Management System with:

1. Login for all users ✅
2. Role-based access control ✅
3. Super Admin full control ✅
4. Department management ✅
5. User/profile management ✅
6. Asset / vehicle / equipment master ✅
7. Work order creation ✅
8. Work order approval / rejection ✅
9. Technician assignment ✅
10. Technician mobile dashboard ✅
11. Parts request linked to work order ✅
12. Store issue workflow ✅
13. Basic spare parts inventory ✅
14. Purchase request workflow when parts are unavailable ✅
15. Finance approval workflow ✅
16. CEO approval threshold workflow ✅
17. Maintenance history per asset ✅
18. Next service / preventive maintenance tracking ✅
19. PDF / print forms ✅
20. Excel exports ✅
21. Role-based dashboards ✅
22. Dedicated in-app notification system ✅
23. Audit logs ✅
24. Private file uploads ✅
25. PWA-ready mobile experience ✅
26. Realistic RECAFCO-style demo data ✅

This must be a real working application, not fake UI screens.

---

# 3. Tech Stack

Use the following stack:

- Framework: **Next.js latest stable App Router** ✅
- Language: **TypeScript** ✅
- Package manager: **npm** ✅
- Styling: **Tailwind CSS** ✅
- UI Components: **shadcn/ui** or clean reusable enterprise components ✅
- Database: **Supabase PostgreSQL** ✅
- Auth: **Supabase Auth** ✅
- Storage: **Supabase Storage** ✅
- Validation: **Zod** ✅
- Forms: **React Hook Form** ✅
- Tables: **TanStack Table** if useful
- Charts: **Recharts** ✅
- PDF Export: **pdfmake**, **react-pdf**, or another stable server-side PDF library ✅ (browser print layout)
- Excel Export: **exceljs** or **xlsx** ✅
- PWA: **next-pwa** or equivalent ✅ (manifest + installable structure)
- Deployment Target for now: **Vercel** ✅
- Future Hosting: should be portable enough to move to a company server or approved cloud later

Use **TypeScript strict mode**. ✅

---

# 4. Branding and UI/UX Direction

## Brand Source

Use the uploaded RECAFCO logo as the visual inspiration.

The logo uses:

- strong red
- charcoal / black
- light gray background
- bold industrial typography
- structural / construction-inspired symbol

## Suggested Brand Colors

Use a professional enterprise color palette inspired by the logo:

```txt
Primary Red:        #ED1C24
Dark Charcoal:      #2B2B2B
Near Black:         #111827
Light Gray BG:      #F5F6F8
Border Gray:        #E5E7EB
Text Gray:          #4B5563
Success Green:      #16A34A
Warning Amber:      #F59E0B
Error Red:          #DC2626
Info Blue:          #2563EB
White:              #FFFFFF
```

## Color Psychology

Use colors intentionally:

- **Red**: urgency, action, critical alerts, pending approvals, high priority, maintenance urgency, brand identity
- **Charcoal / black**: authority, reliability, heavy industry, construction strength
- **Light gray / white**: clarity, cleanliness, enterprise simplicity, low visual fatigue for daily users
- **Green**: approved, completed, active, available stock
- **Amber**: waiting, pending, warning, low stock, due soon
- **Blue**: information, neutral workflow actions, links
- **Muted grays**: secondary information, borders, backgrounds

Do not overuse red. Use red as a strong accent for important actions and status, not as a full-page background.

## UI/UX Rules

1. The interface must look like a professional enterprise internal system.
2. Keep screens clean, modern, simple, and management-ready.
3. Make forms easy for non-technical staff.
4. Use clear labels and helper text.
5. Use status badges everywhere.
6. Use progress/timeline views for work order lifecycle.
7. Use dashboard cards for KPIs.
8. Use tables with filters, search, sorting, and pagination.
9. Use mobile-first layouts for technicians and managers.
10. Avoid unnecessary animations.
11. Use enough whitespace.
12. Use clear hierarchy: page title, status, key details, actions, history.
13. Do not make the UI look like a generic SaaS template.
14. Add a subtle industrial/corporate feel using strong typography, clean grids, and RECAFCO colors.
15. All important actions must have confirmation dialogs.
16. Destructive actions must be clearly separated and confirmed.
17. Forms must support draft saving where useful.
18. Error messages must be clear and human-readable.
19. The system should work well on desktop, tablet, and mobile.
20. Mobile technician pages must have large tap targets and quick actions.

## Layout Rules

Admin/Desktop layout:

- Left sidebar
- Top bar with user info and logout
- Breadcrumbs
- Page header
- Primary action button
- Dashboard cards
- Data tables
- Filters

Mobile layout:

- Bottom navigation or simplified menu
- Large tap targets
- Single-column forms
- Sticky primary action where useful
- Technician dashboard optimized for quick job actions

---

# 5. User Roles

The following roles are implemented in the system:

1. Super Admin ✅
2. IT Admin ✅
3. CEO / Management ✅
4. Maintenance Manager ✅
5. Maintenance Supervisor ✅
6. Maintenance Data Entry ✅
7. Technician / Mechanic ✅
8. Store Keeper ✅
9. Purchase Officer ✅
10. Finance Manager ✅
11. Department Requester ✅
12. Viewer / Auditor ✅
13. Cost Controller ✅ _(added — internal cost validation before Finance approval)_
14. Accounting Reviewer ✅ _(added — accounting department cost cross-check)_

All users must login.

No public secure respondent links are required for this project.

---

# 6. Role Permissions

## Super Admin

Has full access to the entire system.

Can:

- Manage all users
- Manage all roles and permissions
- Manage departments
- Manage assets
- Manage work orders
- Manage spare parts
- Manage inventory
- Manage parts requests
- Manage purchase requests
- Manage finance approvals
- View all dashboards
- View all reports
- View all costs
- View audit logs
- Change system settings
- Monitor the full system

Super Admin is the highest authority in the system.

## IT Admin

Can:

- Manage users
- Manage departments
- Manage roles if permitted
- Manage system settings
- View audit logs
- View system-wide dashboard
- Support password/account issues

Cannot approve maintenance or finance transactions unless explicitly granted.

## CEO / Management

Can:

- View executive dashboard (operations, approvals, financial summary, department performance)
- View executive work orders (high-risk, blocked, overdue, CEO approval queue)
- Approve/reject high-value purchase requests above configured threshold
- View cost reports at executive summary level
- View CEO Executive Reports (6 modes: executive summary, CEO approvals, cost exposure, blocked operations, department performance, asset risk)

**Cannot:**

- Create work orders, parts requests, vehicle requisitions, or inspection checklists
- See routine drafts, submitted forms, or technician operational tasks
- Perform daily cost validation (that is handled by Cost Controller / Accounting + Finance)
- See all work orders — only executive-relevant items (high-risk, blocked, overdue, pending CEO approval)

**CEO Executive Work Orders page shows only:**
- Items with purchase requests pending CEO approval
- High/Urgent priority open work orders
- Blocked operations (Waiting for Parts / Purchase)
- Overdue work orders (open 7+ days)
- High-cost work orders (if cost visibility granted)

## Maintenance Manager

Can:

- View all maintenance work orders (department scope)
- Approve/reject work orders
- Approve/reject parts requests
- View costs if permission allows
- Close work orders
- View maintenance reports
- View asset history

## Maintenance Supervisor

Can:

- View approved work orders
- Assign technicians
- Verify completed jobs
- Request parts
- Update work order status
- View technician workload

## Maintenance Data Entry

Can:

- Create work orders
- Enter paper-form data
- Attach documents/photos
- View work orders they personally created
- Save drafts
- Submit work orders

Cannot approve unless specific permission is granted.

## Technician / Mechanic

Can:

- View assigned jobs only
- Start assigned job
- Add job notes
- Add labor hours
- Upload before/after photos
- Request parts
- Mark job completed

Cannot view unrelated jobs or sensitive costs unless permitted.

## Store Keeper

Can:

- View approved parts requests
- Check stock
- Issue parts
- Partially issue parts
- Mark parts unavailable
- Update stock issue records
- View inventory movements

## Purchase Officer

Can:

- View purchase requests
- Update purchase workflow
- Add supplier details
- Attach quotations
- Attach invoices
- Attach delivery notes
- Update purchase status

## Finance Manager

Can:

- View purchase/cost approval requests
- Approve or reject cost approval
- Add finance comments
- View cost reports
- Export finance reports

Note: Finance Manager provides payment authorization. Detailed cost correctness validation is handled by Cost Controller / Accounting before Finance stage.

## Department Requester

Can:

- View own department work orders
- Submit maintenance request if enabled later
- Track request status
- Confirm job completion if required

## Viewer / Auditor

Can:

- Read-only access to permitted reports
- View audit trails if permitted

## Cost Controller ✅ _(new role)_

Can:

- Review estimated costs for reasonableness before Finance approval
- Check budget availability for relevant cost centers
- Identify duplicate or unusual cost items
- Flag requests for CEO escalation if above policy limits
- View purchase requests and work order cost data
- View cost reports and finance reports
- Export cost reports

Permissions: `cost.review`, `cost.approve`, `cost.reports.view`, `budget.check`, `costs.view`, `purchase_requests.view`, `finance.reports.view`, `reports.view`, `reports.export`, `work_orders.view`, `assets.view`, `parts.view`

## Accounting Reviewer ✅ _(new role)_

Can:

- Review cost entries against accounting standards
- Validate cost center and account codes
- Check compliance with company financial policies
- Prepare cost reports for management
- Support Cost Controller with historical cost data

Permissions: `cost.review`, `cost.reports.view`, `budget.check`, `costs.view`, `purchase_requests.view`, `finance.reports.view`, `reports.view`, `reports.export`, `work_orders.view`, `assets.view`

---

# 7. Security Rules

1. Enforce permissions server-side, not only through frontend UI hiding. ✅
2. Use Supabase Row Level Security where possible. ✅
3. Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser. ✅
4. Use private Supabase Storage buckets. ✅
5. Use signed URLs for private attachments. ✅
6. Validate all input using Zod. ✅
7. All admin and business routes must be protected. ✅
8. All users must have active/inactive status. ✅
9. Inactive users cannot login or access protected features. ✅
10. Sensitive cost fields must be permission-protected. ✅
11. Technicians should only see assigned jobs. ✅
12. Department requesters should only see their department data. ✅
13. Audit important actions. ✅
14. Prefer soft delete/deactivation over hard delete. ✅
15. Do not hardcode secrets or real credentials. ✅
16. Password reset should be supported if possible through Supabase Auth. ✅
17. The application must be safe for internal company use. ✅
18. Notification metadata must not expose sensitive cost data to users without cost visibility. ✅
19. Notification failures must not block the main business workflow. ✅
20. CEO must not be shown detailed accounting action buttons — executive summary only. ✅

---

# 8. Recommended Workflow

The implemented workflow:

1. Maintenance Data Entry creates a work order. ✅
2. Work order goes to Maintenance Manager for approval. ✅
3. Maintenance Manager approves or rejects. ✅
4. If approved, Maintenance Supervisor assigns technician. ✅
5. Technician sees assigned job in mobile dashboard. ✅
6. Technician starts the job. ✅
7. Technician can request parts if needed. ✅
8. Parts request goes to Maintenance Manager for approval. ✅
9. Store Keeper checks availability. ✅
10. If parts are available, Store Keeper issues parts and stock reduces. ✅
11. If parts are not available, system creates/allows purchase request. ✅
12. Purchase Officer updates purchase status and obtains quotation. ✅
13. **Cost Controller / Accounting reviews cost reasonableness and budget availability.** ✅ _(cost review step — "Pending Cost Review" status planned for future activation)_
14. Finance Manager approves purchase/cost if required. ✅
15. CEO approval is required only if amount exceeds configured threshold (default: 1,000 KWD). ✅
16. Technician completes work with notes, labor hours, material usage, and photos. ✅
17. Supervisor verifies completion. ✅
18. Requester/operator confirmation can be recorded if applicable. ✅
19. Maintenance Manager closes the work order. ✅
20. Asset maintenance history is updated. ✅
21. Next service date/km/running hours can be recorded. ✅

Emergency work type should exist, but for this prototype keep it inside the same approval workflow unless configured otherwise.

---

# 9. Work Order Requirements

The digital work order includes all important fields from the current paper form. ✅

Fields:

- Work order number ✅
- Company/reference format ✅
- Ordered by ✅
- Requested by department ✅
- Machine / asset ✅
- Asset category ✅
- Serial number ✅
- Plate number if vehicle ✅
- Date of order ✅
- Job location ✅
- Starting date/time ✅
- Ending date/time ✅
- Maintenance type ✅
- Worker type ✅
- Running hours ✅
- Kilometers ✅
- Operator complaint ✅
- Description of work ✅
- Priority ✅
- Status ✅
- Assigned supervisor ✅
- Assigned technician(s) ✅
- Labor entries ✅
- Material used entries ✅
- Total labor cost ✅
- Total material cost ✅
- Total work order cost ✅
- Operator/requester confirmation ✅
- Supervisor verification ✅
- Maintenance manager closure ✅
- Next service date ✅
- Next service kilometer ✅
- Next service running hours ✅
- Attachments/photos ✅
- Notes ✅

## Maintenance Types

- Routine, Service, Breakdown, Preventive, Inspection, Emergency, Other ✅

## Worker Types

- Auto, Mechanical, Electrical, Civil, AC, Plumbing, Welding/Fabrication, Other ✅

## Priority

- Low, Normal, High, Urgent ✅

## Auto Numbering

Work order numbers are generated automatically. ✅

Support configurable company-style numbering such as:

```txt
AUTO-MAINTENANCE-2495
REC/MD/ELEC/JOB/0001
REC/MD/MECH/JOB/0001
REC/MD/AUTO/JOB/0001
REC/MD/CIVIL/JOB/0001
```

---

# 10. Work Order Statuses

Implemented statuses: ✅

- Draft, Submitted, Pending Approval, Approved, Rejected
- Assigned, In Progress
- Waiting for Parts, Waiting for Purchase, Parts Issued
- Completed by Technician, Verified by Supervisor, Confirmed by Requester
- Closed, Cancelled, Reopened

Status changes are tracked in history. ✅

---

# 11. Parts Request Requirements

Parts request is linked to a work order. ✅

All fields implemented including item rows, partial issue, unavailable item marking, and purchase request creation from unavailable items. ✅

---

# 12. Parts Request Statuses

Implemented: Draft, Submitted, Pending Approval, Approved, Rejected, Waiting for Store, Partially Issued, Issued, Waiting for Purchase, Closed, Cancelled ✅

---

# 13. Asset Master Requirements

Full asset/equipment/vehicle master implemented. ✅

All fields, categories, statuses, and per-asset detail page (maintenance history, work orders, parts used, cost history, next service, expiry alerts) are implemented. ✅

---

# 14. Spare Parts Inventory

Basic inventory implemented. ✅

All part fields, stock features (add/edit, view, low stock alert, issue to parts request, partial issue, stock reduction, movement history) are implemented. ✅

---

# 15. Purchase Request Workflow

Fully implemented. ✅

Statuses: Draft, Submitted, Pending Purchase, Pending Finance Approval, Pending CEO Approval, Approved, Ordered, Received, Rejected, Cancelled ✅

Default CEO approval threshold: **1,000 KWD** — configurable in Admin → Settings. ✅

---

# 16. Finance Approval

Finance Manager approval workflow implemented. ✅

Cost visibility is permission-based (`costs.view`). ✅

Note: Finance Manager provides payment authorization. Cost correctness validation is handled by Cost Controller / Accounting before Finance stage.

---

# 17. Dashboards

Role-based dashboards implemented for all roles. ✅

## Super Admin / IT Admin ✅

Total users, departments, assets, work orders, open work orders, pending approvals, system activity, audit log summary.

## CEO / Management ✅

Executive dashboard with 4 sections:

1. **Operations Overview** — Active WOs, Pending CEO decisions, Overdue, Blocked
2. **Executive Financial Snapshot** — Recorded Cost Exposure (this month), Pending Purchase Value, Pending CEO Cost Decision
3. **CEO Approval Queue** — Purchase requests pending CEO decision, with approve/reject actions
4. **Department Performance** — Work orders by department with status breakdown

**CEO Dashboard wording rules:**
- "Recorded Cost Exposure" not "Maintenance Spend" — CEO sees summary, not accounting ledger
- "Executive cost summary" eyebrow — clarifies this is not a daily accounting view
- All cost links go to `/reports/work-orders?report=cost-exposure`
- Detailed cost validation note: "Recorded cost — validated by Accounting / Cost Controller"

## Maintenance Manager ✅

Pending work orders, approved, in progress, waiting for parts, completed awaiting closure, overdue, technician workload, cost summary.

## Maintenance Supervisor ✅

Jobs to assign, assigned, in progress, needing verification, technician workload.

## Maintenance Data Entry ✅

My requests, drafts, submitted, rejected — plus quick create actions.

## Technician ✅

Assigned jobs, in progress, waiting for parts, completed — mobile-optimized.

## Store Keeper ✅

Pending parts requests, low stock, issued today, unavailable parts.

## Purchase Officer ✅

Pending purchase requests, approved, ordered, received.

## Finance Manager ✅

Pending finance approvals, approved costs, rejected costs, cost report links.

## Department Requester ✅

Department requests, status tracking, jobs awaiting confirmation.

## Cost Controller ✅ _(new)_

Placeholder dashboard showing:
- Pending cost review items (amber)
- High-value items ≥ 500 KWD (red)
- Total active purchase value (blue)
- Quick links: Purchase Requests, Cost Report, Work Order Costs
- Amber info banner noting cost review workflow is a placeholder for future activation

## Accounting Reviewer ✅ _(new)_

Same placeholder dashboard structure as Cost Controller with accounting-focused labels.

Charts used: Work orders by status, by type, maintenance cost by department, monthly completed, top assets by breakdown count. ✅

---

# 18. Database Requirements

Supabase SQL migrations implemented. ✅

UUID primary keys used throughout. ✅

Core tables all implemented. Migration files:

- `20260603093000_phase_1_foundation.sql` — profiles, roles, permissions, departments, auth
- `20260603110000_phase_2_assets_parts_work_orders.sql` — assets, parts, work orders
- `20260603130000_phase_3_workflow_notifications.sql` — approvals, assignments, notifications
- `20260603150000_phase_4_store_purchase_finance.sql` — parts requests, inventory, purchase requests
- `20260603180000_phase_5_reports_files_pwa.sql` — reports, file storage, PWA config
- `20260604120000_notification_system_upgrade.sql` — extended notification schema
- `20260606100000_local_auth_replacement.sql` — local auth compatibility
- `20260607120000_comprehensive_audit_coverage.sql` — extended audit logging
- `20260607150000_system_health_center.sql` — system health tables
- `20260608000001_phase1_batch2_integrity.sql` — integrity constraints
- `20260608120000_performance_indexes.sql` — performance indexes
- `20260608200000_user_permission_overrides.sql` — per-user permission overrides
- `20260609000006_realtime_events.sql` — realtime event foundation
- `20260612000000_cost_controller_role.sql` — Cost Controller + Accounting Reviewer roles and permissions

---

# 19. File Uploads

Private Supabase Storage buckets implemented: `work-order-files`, `asset-files`, `purchase-files`. ✅

Signed URLs used for viewing. ✅

All upload types implemented (complaint photo, before/after repair, damaged part, meter/km, asset documents, registration, insurance, warranty, quotations, invoices, delivery notes). ✅

---

# 20. PDF and Print

Print layouts implemented for: ✅

1. Work Order — `/maintenance/work-orders/[id]/print`
2. Parts Request — `/store/parts-requests/[id]/print`
3. Purchase Request — `/purchase/requests/[id]/print`
4. Asset Maintenance History — `/assets/[id]/history/print`

Professional RECAFCO-branded layouts with structured tables, approval history, and signatures. ✅

---

# 21. Excel Export

Excel exports implemented for work orders, assets, parts inventory, parts requests, purchase requests, maintenance cost report, asset maintenance history, pending approvals. ✅

Export endpoint: `/api/exports/[kind]`

---

# 22. PWA and Mobile

PWA-ready with manifest and installable structure. ✅

Mobile-friendly navigation and technician dashboard implemented. ✅

All technician mobile features implemented (view assigned jobs, start, add notes, request parts, upload photos, complete). ✅

Manager mobile features (approve/reject, view dashboard) implemented. ✅

---

# 23. Notification System

Full in-app notification system implemented. ✅

Centralized notification service in `lib/notifications/` with all required functions. ✅

Header notification bell, unread count, Notification Center at `/notifications`, mark read/archive all implemented. ✅

All notification events implemented (work order lifecycle, parts, purchase, finance, CEO approval). ✅

External delivery channels (email, WhatsApp, SMS, push) are schema-ready but disabled pending provider/consent approval.

---

# 24. Audit Logs

Comprehensive audit logging implemented for all required actions. ✅

Audit logs visible at `/admin/audit-logs` for Super Admin and IT Admin. ✅

---

# 25. Settings

All settings implemented at `/admin/settings`. ✅

Including: work order number format, CEO approval threshold, currency (KWD), company name/logo, requester confirmation toggle, finance approval toggle, CEO approval toggle, notification settings.

---

# 26. App Routes

All routes implemented. ✅

## Auth

- `/login` ✅
- `/forgot-password` ✅
- `/reset-password` ✅
- `/change-password` ✅

## Dashboard

- `/dashboard` ✅ _(role-based: 14 role branches)_

## Admin

- `/admin/users` ✅
- `/admin/users/[id]` ✅
- `/admin/roles` ✅
- `/admin/departments` ✅
- `/admin/settings` ✅
- `/admin/audit-logs` ✅
- `/admin/notification-settings` ✅
- `/admin/architecture` ✅
- `/admin/system-health` ✅
- `/admin/system-map` ✅
- `/admin/system-map/edit` ✅
- `/admin/demo-guide` ✅

## CEO

- `/ceo/approvals` ✅ _(CEO approval queue for high-value purchase requests)_

## Maintenance

- `/maintenance/work-orders` ✅ _(role-branched: CEO sees executive view, others see operational view)_
- `/maintenance/work-orders/new` ✅
- `/maintenance/work-orders/[id]` ✅
- `/maintenance/work-orders/[id]/edit` ✅
- `/maintenance/work-orders/[id]/print` ✅
- `/maintenance/approvals` ✅
- `/maintenance/assignments` ✅

## Assets

- `/assets` ✅
- `/assets/new` ✅
- `/assets/[id]` ✅
- `/assets/[id]/edit` ✅
- `/assets/[id]/history` ✅
- `/assets/[id]/history/print` ✅

## Store

- `/store/parts` ✅
- `/store/parts/new` ✅
- `/store/parts-requests` ✅
- `/store/parts-requests/new` ✅
- `/store/parts-requests/[id]` ✅
- `/store/parts-requests/[id]/print` ✅
- `/store/inventory-movements` ✅
- `/store/low-stock` ✅

## Purchase

- `/purchase/requests` ✅
- `/purchase/requests/[id]` ✅
- `/purchase/requests/[id]/print` ✅

## Finance

- `/finance/approvals` ✅
- `/finance/reports` ✅

## Technician

- `/technician/jobs` ✅
- `/technician/jobs/[id]` ✅

## Reports

- `/reports/work-orders` ✅ _(role-branched: CEO gets 6-mode Executive Reports Center)_
- `/reports/assets` ✅
- `/reports/costs` ✅
- `/reports/preventive-maintenance` ✅

## Profile

- `/profile` ✅
- `/profile/notifications` ✅

## Notifications

- `/notifications` ✅

## API

- `/api/exports/[kind]` ✅ _(Excel exports)_
- `/api/files/[bucket]/[...path]` ✅ _(signed file access)_
- `/api/notifications/stream` ✅ _(notification polling foundation)_

---

# 27. Demo Data

Realistic RECAFCO-style demo data seeded. ✅

All departments, users (one per role), 15+ assets, 25+ spare parts, 20+ work orders with varied statuses, parts requests, purchase requests, approvals, and inventory movements are seeded. ✅

---

# 28. Environment Variables

`.env.example` implemented. ✅

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
```

Rules remain the same — `SUPABASE_SERVICE_ROLE_KEY` is server-side only.

---

# 29. Folder Structure

Implemented structure: ✅

```txt
app/
  (auth)/           — login, forgot-password, reset-password, change-password
  (dashboard)/      — all protected routes
    admin/          — users, roles, departments, settings, audit-logs, system-health, system-map, architecture, notification-settings, demo-guide
    assets/         — asset master + history + print
    ceo/            — ceo/approvals
    dashboard/      — role-based main dashboard
    finance/        — approvals, reports
    maintenance/    — work-orders (CRUD + print), approvals, assignments
    notifications/  — notification center
    profile/        — profile + notification preferences
    purchase/       — requests (+ print)
    reports/        — work-orders (CEO: 6-mode Executive Reports), assets, costs, preventive-maintenance
    store/          — parts, parts-requests (+ print), inventory-movements, low-stock
    technician/     — jobs (mobile dashboard)
  api/
    exports/[kind]/ — Excel export endpoint
    files/          — signed file access
    notifications/  — notification stream
components/
  ui/               — Button, StatusBadge, EmptyState, PageHeader, StatCard, DataTable, etc.
  layout/           — AppLayout, AdminSidebar, MobileNav, NotificationBell
  dashboard/        — role-specific dashboard components
  reports/          — CeoReportModeNav, ReportSummaryGrid, etc.
lib/
  auth/             — context, requirePermission, RBAC helpers
  db/               — prisma client
  notifications/    — events, templates, service, recipients, preferences, delivery, types
  permissions/      — definitions, PERMISSION_KEY map, ROLE_SLUG map
  reports/          — data.ts (canViewCosts, getCeoPurchaseApprovals, etc.)
  work-orders/      — visibility.ts (getWorkOrderVisibilityFilter per role)
  audit/            — audit logging
  exports/          — Excel export helpers
  files/            — signed URL helpers
  numbering/        — auto-numbering for WO/PR/PO
hooks/
types/
  database.ts       — PermissionKey, RoleSlug, and all DB types
supabase/
  migrations/       — 25 migration files
  seed/             — demo data seed
docs/
  CEO_DASHBOARD.md
  CEO_REPORTS.md
  CEO_WORK_ORDERS.md
  COST_CONTROL_WORKFLOW.md
  ROLE_DASHBOARDS.md
  WORK_ORDER_VISIBILITY.md
  WORK_ORDER_OPERATIONS.md
  + 14 other docs
```

---

# 30. Reusable Components

Implemented: ✅

- AppLayout, AdminSidebar, MobileNav ✅
- PageHeader, StatCard, DataTable ✅
- StatusBadge, ApprovalTimeline ✅
- FileUploader ✅
- FormSection, WorkOrderForm, PartsRequestForm ✅
- AssetCard, EmptyState, ConfirmDialog ✅
- PermissionGate, CostVisibilityGuard ✅
- MobileJobCard ✅
- NotificationBell, NotificationCenter, NotificationPreferences ✅
- ArchitecturePresentation ✅
- CeoReportModeNav ✅ _(CEO executive report mode navigation)_

---

# 31. README

`README.md` created with project overview, tech stack, setup instructions, migration guide, seed instructions, Super Admin creation, deployment to Vercel, security notes, demo workflow testing. ✅

---

# 32. Development Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
```

All commands implemented and working. ✅

---

# 33. Development Order

## Phase 1 — Foundation ✅ COMPLETE

Project setup, Tailwind/shadcn, Supabase config, auth, protected routes, RBAC helpers, layouts, database migrations (all tables), departments, users/profiles, settings, basic dashboard, demo seed base.

## Phase 2 — Core Records ✅ COMPLETE

Asset master, spare parts inventory, work order CRUD, auto-numbering, work order details page, PDF/print foundation.

## Phase 3 — Workflow ✅ COMPLETE

Approval workflow, technician assignment, technician mobile dashboard, status history, basic notifications.

## Phase 4 — Parts, Store, Purchase, Finance ✅ COMPLETE

Parts request workflow, store issue, inventory movements, purchase request workflow, finance approval, CEO threshold approval.

## Phase 5 — Dashboards, Reports, Exports ✅ COMPLETE

Role-based dashboards (14 role branches), reports (4 report pages), Excel exports, CEO Executive Dashboard, CEO Executive Reports Center (6 modes).

---

# 34. CEO Executive UX Rules

The CEO / Management role has a fundamentally different UX from operational roles. These rules must be preserved when building or modifying anything the CEO sees.

## CEO Work Orders Page (`/maintenance/work-orders`)

- Title: **"Executive Work Orders"**
- Subtitle: "High-risk work orders, blocked operations, and items needing executive attention."
- **No "Create Request" button** — CEO is not a creator
- **No "Create Request" dropdown** — no work order, parts request, vehicle requisition, or inspection checklist
- Executive KPI cards (6): Needs CEO Decision, High Risk Work, Blocked Operations, Overdue Critical, Cost Exposure, Waiting Finance/Purchase
- Executive quick filters: CEO Decisions, High Risk, Blocked, Overdue, High Cost (cost-gated)
- Executive tabs only: All Executive Items, Needs CEO Decision, High Risk, Blocked, Overdue
- No operational tabs: no Draft, Submitted, Pending Approval, Approved, Assigned, In Progress, etc.
- No Worker Type filter, no Technician filter, no "Needs my action" checkbox
- Table columns: Reference · Department · Asset · Description · **Why CEO Sees This** · Priority · Stage · Age · Cost (gated) · Action
- Action column: "Approve / Reject" (red) if CEO approval needed, otherwise "Review" (outlined)
- Empty state: "No executive work order items need attention right now."

## CEO Dashboard (`/dashboard`)

- Title: **"CEO Executive Dashboard"**
- Financial section eyebrow: **"Executive cost summary"** (not "Cost monitoring")
- Cost card label: **"Recorded Cost Exposure This Month"** (not "Maintenance Spend")
- Cost note: "Recorded cost summary only. Detailed validation handled by Accounting / Cost Controller."
- All cost report links go to `/reports/work-orders?report=cost-exposure`

## CEO Reports (`/reports/work-orders`)

6 executive modes:

1. `executive-summary` — Monthly overview (default)
2. `ceo-approvals` — Purchase requests cleared Finance, pending CEO
3. `cost-exposure` — Pending/active procurement costs (note: detailed validation by Accounting/Cost Controller)
4. `blocked-operations` — Work orders blocked by parts/purchase
5. `department-performance` — WO volumes by department
6. `asset-risk` — High-priority breakdown work by asset

---

# 35. Cost Control Workflow

Cost validation happens **before** Finance approval. The chain:

```
Purchase Officer (supplier quote)
       ↓
Cost Controller / Accounting (cost validation, budget check)
       ↓
Finance Manager (payment authorization)
       ↓
CEO (if amount ≥ 1,000 KWD threshold)
       ↓
Procurement proceeds
```

## New Permissions Added

| Permission key | Description |
|---|---|
| `cost.review` | Review and validate cost items before finance approval |
| `cost.approve` | Approve or flag cost items after review |
| `cost.reports.view` | View cost controller reports and cost summaries |
| `budget.check` | Check budget availability and cost center allocation |
| `cost_center.manage` | Manage cost centers and budget allocations |

## canViewCosts() function

A user can view sensitive cost data if they have any of:
- Role: `super_admin`
- Permission: `costs.view`
- Permission: `finance.reports.view`
- Permission: `cost.reports.view`

## Planned Enhancement

A dedicated "Pending Cost Review" status in the purchase request workflow is planned for future activation once the Cost Controller workflow is fully onboarded. Currently, Cost Controllers access active purchase requests directly.

Full documentation: `docs/COST_CONTROL_WORKFLOW.md`

---

# 36. Technical Patterns and Constraints

These patterns must be followed when adding new code.

## Work Order Visibility

Every query touching `work_orders` must use `getWorkOrderVisibilityFilter(context)` from `lib/work-orders/visibility.ts`. This enforces role-based scoping at the database level. See `docs/WORK_ORDER_VISIBILITY.md`.

## Permission Check Pattern

```typescript
const context = await requirePermission("permission.key");
const slug = context.role?.slug;
const canDo = context.permissions.includes("permission.key");
```

## CEO Early-Return Pattern

Pages that need different UI for CEO use an early-return block:

```typescript
if (context.role?.slug === "ceo_management") {
  // CEO-specific UI
  return (...);
}
// Existing code for all other roles unchanged
```

## Prisma Query Constraints

- No `.neq()` method — use `{ status: { notIn: [...] } }` instead
- `Date.now()` requires `// eslint-disable-next-line react-hooks/purity`
- `new Date()` does NOT need the eslint-disable comment
- `Prisma.Decimal` fields: convert with `Number(val)` or `parseFloat(val.toString())`
- BigInt from `$queryRaw` COUNT: convert with `Number()`

## Notification Pattern

Do not insert notification rows directly from workflow actions. Use the centralized service:

```typescript
import { notifyByEvent } from "@/lib/notifications/service";
await notifyByEvent("work_order.approved", { entityId: wo.id, ... });
```

Notification errors must be caught and logged — never crash the main workflow.

## File Security

Private files use signed URLs. Audit `files.download` on every access. See `docs/security.md` and memory file `project-file-security.md`.

## Cost Visibility Guard

Always gate cost data display behind `canViewCosts(context)`:

```typescript
import { canViewCosts } from "@/lib/reports/data";
const showCosts = canViewCosts(context);
```

---

# 37. Documentation Index

| Document | Purpose |
|---|---|
| `docs/CEO_DASHBOARD.md` | CEO dashboard sections, data sources, KPI card logic |
| `docs/CEO_REPORTS.md` | 6 CEO report modes, filters, tables, empty states |
| `docs/CEO_WORK_ORDERS.md` | Why CEO cannot create WOs, executive tabs, action rules |
| `docs/COST_CONTROL_WORKFLOW.md` | Full cost control chain, roles, permissions, approval limits |
| `docs/ROLE_DASHBOARDS.md` | All role dashboard specifications |
| `docs/WORK_ORDER_VISIBILITY.md` | Per-role work order scoping rules |
| `docs/WORK_ORDER_OPERATIONS.md` | Work order lifecycle and status transitions |
| `docs/DATA_ENTRY_DASHBOARD.md` | Maintenance Data Entry workspace |
| `docs/MAINTENANCE_MANAGER_REPORTS.md` | Manager reports and filters |
| `docs/notifications.md` | Notification system architecture |
| `docs/security.md` | Security model and file access rules |
| `docs/technical-architecture.md` | System architecture overview |
| `docs/architecture.md` | Database and API design |
| `docs/testing-checklist.md` | Testing steps per role |
| `docs/USER_LIFECYCLE.md` | User creation, activation, deactivation flow |
| `docs/REALTIME_EVENTS.md` | Realtime event foundation |
| `docs/BACKUP_AND_RESTORE.md` | Backup and restore procedures |
| `docs/FORM_HEADER_STANDARD.md` | Standard form header layout |
