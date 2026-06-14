# Security

This document tracks RECAFCO security requirements and should be updated whenever auth, permissions, RLS, storage, exports, or cost visibility change.

## Security Principles

- All users must authenticate.
- Inactive users must not access protected features.
- Permissions must be enforced server-side, not only hidden in the UI.
- Business data access must be protected by server-side RBAC and route/action guards.
- Database credentials must never be exposed to browser code.
- Private files must be stored outside public assets and served only through authenticated route handlers.
- Zod validation should protect all submitted data.
- Important actions must be audited.
- Notifications must not expose unauthorized cost data in metadata or message content.

## Role-Sensitive Access

- Super Admin has full access.
- IT Admin supports users, departments, settings, and audit logs, but does not approve maintenance or finance transactions unless explicitly granted.
- Technicians see assigned jobs only.
- Department Requesters see their own department data only.
- Finance and CEO roles can see approval and cost workflows according to permission settings.
- Viewers and auditors are read-only within their permitted scope.

## Cost Visibility

Sensitive pricing, labor cost, material cost, total work order cost, purchase values, and finance reports must be permission-protected. Do not rely only on UI hiding; restrict queries and server responses.

## File Uploads

Logical private buckets:

- `work-order-files`
- `asset-files`
- `purchase-files`

Allowed file types:

- PDF, JPG, PNG, XLS, XLSX, DOC, DOCX

File uploads should be audited and linked to business records.

## Review Checklist

- Routes are protected.
- Server-side permission checks are present.
- Server-side guards match role and ownership rules.
- Technicians cannot read unrelated jobs.
- Department requesters cannot read unrelated departments.
- Cost fields are hidden from unauthorized roles.
- Private files require authenticated route-handler access.
- Approval, assignment, stock issue, purchase, finance, export, and settings changes create audit logs.

## Phase 1 Security Scope

- The Next.js `proxy.ts` route guard protects `/dashboard`, `/admin`, and `/profile`.
- Auth pages remain public.
- Server actions call `requirePermission` before modifying users, departments, roles, settings, or audit-visible data.
- `profiles.is_active = false` blocks app access after login.
- Local sessions are stored as HTTP-only cookies and backed by hashed session tokens in `auth_sessions`.
- First Super Admin login is created with `npm run auth:set-password` for an existing profile.
- Database access is limited to server-only utilities and must not appear in client components.
- Audit logs record Phase 1 admin mutations and login-related events where available.

## Phase 2 Security Scope

- Asset, part, and work order routes require authenticated active users.
- Mutations require module permissions such as `assets.manage`, `parts.manage`, or `work_orders.manage`.
- Work order read access is permission-based in Phase 2; technician-only assignment filtering is finalized in Phase 3.
- Cost fields are stored now but must remain hidden from users without `costs.view` in detail and print views.
- Phase 2 table access is protected by server-side permission checks and ownership-aware routes/actions.
- Attachment metadata is protected by the same business-record permissions; private local file upload flow is completed in later phases.

## Phase 3 Security Scope

- Approval, rejection, assignment, technician update, supervisor verification, and closure actions are guarded by dedicated permissions.
- Technician job routes use assignment membership, not broad work order visibility.
- Server-side route and action guards allow technicians to read only assigned work orders, assignments, labor, attachment metadata, and notes.
- Notifications are visible only to the recipient or users with audit/admin visibility.
- All workflow state changes write audit logs and status history.

## Phase 4 Security Scope

- Parts request, store issue, purchase, finance, and CEO actions use dedicated permissions and server actions.
- Technicians can create and view only parts requests linked to their assigned work orders.
- Cost fields are omitted or hidden for users without `costs.view`.
- Store issue and purchase receive actions are the only workflow paths that mutate stock.
- Inventory movements are append-only through server actions.
- Finance and CEO approvals are settings-aware and audited.

## System Map Security Scope

- `/admin/system-map` requires an authenticated active user.
- Super Admin can access by role; IT Admin and CEO / Management require `system_map.view`.
- `/admin/system-map/edit` is Super Admin-only and redirects all other roles to `/dashboard?error=super-admin-required`.
- Sidebar visibility uses the same permission key and server-loaded user context.
- Live statistics are fetched server-side through the local database compatibility client.
- The page writes `system_map.viewed` audit logs, but audit failure does not block authorized viewing.
- Editable workflow map saves write `workflow_map.draft` or `workflow_map.publish` audit logs.
- Editable diagram versions are planning records and must not automatically change live workflow rules, permissions, approvals, cost visibility, or routing.

## Technical Architecture Page Security Scope

- `/admin/architecture` requires an authenticated active user.
- Super Admin can access by role; IT Admin requires `architecture.view`.
- Other roles redirect server-side to `/dashboard?error=permission-denied`.
- Sidebar visibility uses the same `architecture.view` permission key.
- Live technical stats are fetched server-side and gracefully fall back to zero if a table is unavailable.
- The page writes `architecture.viewed` audit logs, but audit failure does not block authorized viewing.
- The page documents security architecture only; it must not expose secrets, environment values, service role keys, signed URLs, or sensitive cost data.

## Phase 5 Security Scope

- Report pages require `reports.view` except cost reports, which also require cost visibility through Super Admin, `costs.view`, or `finance.reports.view`.
- Export route handlers require `reports.export` or finance report access and write `report.export` audit logs.
- Export payloads remove cost and price fields server-side for users without cost visibility.
- Private uploads require `files.upload` plus the relevant business permission or assigned technician relationship.
- Upload actions validate file type and file size before writing to local private storage under `UPLOADS_DIR`.
- `work-order-files`, `asset-files`, and `purchase-files` remain non-public logical buckets.
- Private file links resolve through authenticated route handlers and are not exposed as public static assets.
- Purchase, work order, and asset file metadata remains linked to the owning business record.

## Notification System Security Scope

- Users can read only notifications addressed to their own `recipient_user_id` or legacy `recipient_id`.
- Users can update only their own read/archive state.
- Super Admin and IT Admin can manage notification events, templates, and delivery logs through `admin.notification_settings.manage`.
- Legacy notification rows remain readable through the old recipient fields while new rows use the expanded notification schema.
- Notification metadata should contain identifiers, status, and route context only. Sensitive cost details must stay behind existing cost-visible report and detail routes.
- Critical workflow notifications can be forced by `app_settings.force_critical_notifications` so users cannot opt out of required approval and execution alerts.
- External channels are schema-ready but disabled until provider security, consent, and data-leak rules are reviewed.
