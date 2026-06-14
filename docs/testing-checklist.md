# Testing Checklist

Use this checklist before final responses and after major RECAFCO workflow changes.

## Required Commands

Run where possible:

```bash
npm run lint
npm run typecheck
npm run build
```

If a command fails, fix the issue or document the failure and reason.

## Auth and Roles

- Login works for active users.
- Inactive users cannot access protected routes.
- Super Admin can access all modules.
- IT Admin cannot approve maintenance or finance transactions unless permitted.
- Technician can only see assigned jobs.
- Department Requester can only see own department requests.
- Viewer / Auditor access is read-only.

## Work Orders

- Data Entry can create draft and submitted work orders.
- Work order numbers are generated automatically.
- Maintenance Manager can approve or reject.
- Supervisor can assign technicians.
- Technician can start, update, request parts, upload photos, and complete assigned jobs.
- Supervisor can verify completion.
- Maintenance Manager can close.
- Status history records each transition.

## Parts, Store, Purchase, and Finance

- Parts request links to a work order.
- Maintenance Manager can approve or reject parts requests.
- Store Keeper can issue full or partial stock.
- Stock decreases after issue.
- Unavailable parts can create purchase requests.
- Purchase Officer can update purchase status and attachments.
- Finance Manager can approve or reject cost requests.
- CEO approval is required above the configured threshold when enabled.

## Assets and Inventory

- Assets show work orders, parts used, maintenance cost history, next service data, and expiry alerts.
- Low stock parts are visible to Store Keeper.
- Inventory movements are recorded for issues and returns.

## Security and Files

- Cost fields are hidden from unauthorized roles.
- Uploaded files are private.
- Signed URLs are used for viewing private files.
- Invalid form submissions show clear validation errors.
- Important actions are audited.

## UX and Mobile

- Desktop layout has sidebar, top bar, breadcrumbs, filters, tables, and clear primary actions.
- Technician mobile screens have large tap targets and quick actions.
- Manager mobile approval screens are usable.
- Status badges are clear and consistent.
- Error messages are human-readable.
- Empty report, workflow, and file-upload states use helpful business messages.

## Documentation Drift

- `README.md` is accurate if setup or commands changed.
- `AGENTS.md` is accurate if project rules changed.
- `docs/feature-brief.md` reflects the current major feature.
- `docs/architecture.md` reflects current app structure.
- `docs/security.md` reflects current auth/RLS/permission behavior.
- `docs/testing-checklist.md` reflects current workflow expectations.

## Phase 1 Checks

- `/login` signs in through Supabase Auth.
- Anonymous users visiting `/dashboard`, `/admin/users`, `/admin/departments`, `/admin/settings`, `/admin/audit-logs`, or `/profile` are redirected to `/login`.
- Active Super Admin can open dashboard and admin pages.
- Non-admin users cannot mutate departments, profiles, or settings.
- Department create/update forms validate required fields.
- Profile update form validates role, department, active status, and cost visibility.
- Settings update form validates numbering formats, currency, CEO threshold, and workflow toggles.
- Dashboard counts come from Supabase tables.
- Audit log page reads real audit records.

## Phase 2 Checks

- Assets list reads from Supabase and supports create/edit/detail/history routes.
- Asset forms include all required master fields.
- Parts inventory list reads from Supabase and supports creating parts with stock, price, supplier, bin, and compatibility fields.
- Work order create form generates work order numbers automatically.
- Work order create/edit form stores paper-form fields, labor rows, material rows, costs, and next service data.
- Work order detail shows asset data, costs only for authorized users, status history, material/labor tables, attachment metadata, and print action.
- Work order print route has a clean paper-form layout with RECAFCO header.
- Phase 2 RLS prevents unauthorized mutations.
- Demo assets, parts, and work orders appear after migration.

## Phase 3 Checks

- `/maintenance/approvals` shows submitted or pending approval work orders.
- Maintenance Manager can approve and reject eligible work orders.
- `/maintenance/assignments` shows approved work orders and technician selection.
- Supervisor can assign one or more technicians.
- Assigned technician sees the job in `/technician/jobs`.
- Technician job detail allows start, note/labor/photo metadata, and completion.
- Supervisor can verify completed work.
- Maintenance Manager can close verified work.
- Notifications appear for pending approval, approved, rejected, assigned, completed, verified, and closed events.
- Technician cannot see unrelated jobs.

## Phase 4 Checks

- Technician can create a parts request from an assigned job.
- Supervisor can create a parts request from a work order.
- Maintenance Manager can approve or reject parts requests.
- Store Keeper can issue full quantity, partially issue, or mark unavailable.
- Stock decreases on issue and inventory movement is created.
- Unavailable items can create purchase requests.
- Purchase Officer can update supplier, estimate, quotation metadata, ordered, and received status.
- Finance Manager can approve or reject finance approvals when enabled.
- CEO approval is required when enabled and amount exceeds threshold.
- Receiving purchase increases stock and creates inventory movement.
- Cost fields are hidden from roles without `costs.view`.

## System Map Checks

- Super Admin can open `/admin/system-map`.
- IT Admin can open `/admin/system-map` after `system_map.view` migration is applied.
- CEO / Management can open `/admin/system-map` when `system_map.view` exists.
- Other roles redirect to `/dashboard?error=permission-denied`.
- Sidebar shows `System Map` only to authorized users.
- Live data snapshot renders Supabase counts or zero fallback.
- Executive workflow strip renders the high-level request-to-reports flow.
- Management monitoring cards explain operational, financial, and asset visibility.
- Workflow diagram nodes and module cards link to operational routes.
- Presentation mode opens a full-screen view and exit link returns to the normal page.
- Super Admin sees `Editable Workshop Map` from `/admin/system-map` and `Map Editor` in navigation.
- Super Admin can open `/admin/system-map/edit`; other roles redirect to `/dashboard?error=super-admin-required`.
- Editor loads the latest full official workflow when no saved version exists.
- Editor supports dragging workflow cards, editing selected step text, adding notes, adding/deleting handoff arrows, resetting to the latest official diagram, and exporting JSON.
- Saving draft creates a `workflow_map_versions` row with status `draft`; publishing archives older published rows and creates a `published` row.
- Saving or publishing writes audit logs and creates a non-blocking `system_map.updated` notification.
- Editable workflow versions do not automatically alter live workflow permissions or business logic.

## Phase 5 Checks

- `/reports/work-orders` loads real work order rows, KPI cards, group summaries, and filters.
- `/reports/assets` loads asset list, expiry alerts, next service due, and breakdown ranking.
- `/reports/costs` is blocked for users without cost visibility and visible to authorized cost users.
- `/reports/preventive-maintenance` shows overdue, 7/15/30 day, kilometer, and running-hours due counts.
- Export buttons download native `.xlsx` files from `/api/exports/[kind]` and write `report.export` audit logs.
- Excel workbooks have correct sheet names, formatted header rows, frozen headers, filters, and useful column widths.
- Unauthorized users do not receive cost/price/total columns in non-cost exports.
- Work order detail uploads to `work-order-files` and renders signed file links.
- Technician job detail uploads before/after/photo files only for assigned jobs.
- Asset detail uploads to `asset-files` and renders signed file links.
- Purchase request detail uploads quotation, invoice, and delivery-note files to `purchase-files`.
- Uploaded files reject unsupported type or files larger than 10 MB.
- Work order, parts request, purchase request, and asset history print pages render RECAFCO headers, tables, generated date, approvals/status where available, and signature sections.
- Manifest and app icon load; mobile browsers use the RECAFCO red theme color.
- Mobile bottom navigation appears on small screens without horizontal overflow.
- Mobile drawer menu exposes every route permitted for the current role, not only the first quick links.
- Production build registers the service worker, caches the app shell assets, and shows `/offline.html` for failed navigations while secure data workflows remain online-only.
- Asset and work order detail pages show scannable QR cards.
- Asset history print and work order print pages show scannable QR codes for internal routes.
- `lib/system-map/config.ts` shows Phase 5 completed and Phase 6 future items.

## Technical Architecture Page Checks

- Super Admin can open `/admin/architecture`.
- IT Admin can open `/admin/architecture` after `architecture.view` migration is applied.
- Other roles redirect to `/dashboard?error=permission-denied`.
- Sidebar shows `Architecture` only to authorized users.
- Hero actions link to System Map, Demo Guide, Presentation Mode, and refresh.
- Live health stats render real counts or graceful zero fallback.
- High-level architecture diagram shows device, UI, server, permission, Supabase/RLS, and output flow.
- Security model documents Supabase Auth, server-side RBAC, active profile checks, RLS, private buckets, signed URLs, audit logs, cost visibility, and notification permissions.
- Database model groups core, maintenance, store/parts, purchase/finance, and notification tables.
- Notification, file storage, workflow, reporting, deployment, and scalability sections render from config.
- Presentation Mode at `/admin/architecture?presentation=1` hides the normal shell content and emphasizes architecture, security, database, notifications, and deployment.
- Opening the page writes a non-blocking `architecture.viewed` audit log.

## Notification System Checks

- Header bell shows the current user's unread count.
- Bell dropdown shows the latest notifications on desktop and links to `/notifications`.
- Mark single notification as read clears unread state for that row.
- Mark all read clears the current user's unread count without changing archived rows.
- Archive hides a notification from the active Notification Center list.
- `/notifications` supports unread/read/archive, category, priority, and title/message search filters.
- `/profile/notifications` saves in-app preferences for noncritical events.
- Critical events remain enabled when `force_critical_notifications` is active.
- `/admin/notification-settings` is available only to Super Admin and IT Admin with `admin.notification_settings.manage`.
- Admin event disabling prevents new noncritical in-app notifications for that event.
- Delivery logs show sent, failed, or disabled attempts.
- Workflow actions create notifications through `notifyByEvent()` and still succeed if notification creation fails.
- Legacy notifications with only `recipient_id`, `notification_type`, and `is_read` remain visible.
- Notification metadata does not include unauthorized cost details.

## Final Demo Polish Checks

- Super Admin can open `/admin/demo-guide`.
- Non-Super Admin users redirect from `/admin/demo-guide` to `/dashboard?error=super-admin-required`.
- The demo guide links to System Map, Dashboard, Assets, Work Orders, Approval, Technician Job, Parts Request, Store Issue, Purchase, Finance, and Reports.
- System Map shows Management Demo Polish completed and keeps Phase 6 as future roadmap.
- Report pages, file panels, technician jobs, and approval queues show polished empty states.
- Mobile-width technician jobs, manager approvals, work order detail, and report pages avoid broken horizontal overflow outside intentionally scrollable tables.
