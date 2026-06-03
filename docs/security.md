# Security

This document tracks RECAFCO security requirements and should be updated whenever auth, permissions, RLS, storage, exports, or cost visibility change.

## Security Principles

- All users must authenticate.
- Inactive users must not access protected features.
- Permissions must be enforced server-side, not only hidden in the UI.
- Supabase Row Level Security should protect business data where possible.
- `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to browser code.
- Private files must be stored in private Supabase Storage buckets.
- File viewing should use signed URLs.
- Zod validation should protect all submitted data.
- Important actions must be audited.

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

Private buckets:

- `work-order-files`
- `asset-files`
- `purchase-files`

Allowed file types:

- PDF, JPG, PNG, XLS, XLSX, DOC, DOCX

File uploads should be audited and linked to business records.

## Review Checklist

- Routes are protected.
- Server-side permission checks are present.
- Supabase RLS policies match role and ownership rules.
- Technicians cannot read unrelated jobs.
- Department requesters cannot read unrelated departments.
- Cost fields are hidden from unauthorized roles.
- Private files require signed URLs.
- Approval, assignment, stock issue, purchase, finance, export, and settings changes create audit logs.

## Phase 1 Security Scope

- The Next.js `proxy.ts` route guard protects `/dashboard`, `/admin`, and `/profile`.
- Auth pages remain public.
- Server actions call `requirePermission` before modifying users, departments, roles, settings, or audit-visible data.
- `profiles.is_active = false` blocks app access after login.
- RLS policies use helper functions to check authenticated user permissions.
- First Super Admin is created through a documented SQL step after the Supabase Auth user exists.
- Service role usage is limited to server-only admin utilities and must not appear in client components.
- Audit logs record Phase 1 admin mutations and login-related events where available.

## Phase 2 Security Scope

- Asset, part, and work order routes require authenticated active users.
- Mutations require module permissions such as `assets.manage`, `parts.manage`, or `work_orders.manage`.
- Work order read access is permission-based in Phase 2; technician-only assignment filtering is finalized in Phase 3.
- Cost fields are stored now but must remain hidden from users without `costs.view` in detail and print views.
- RLS policies protect Phase 2 tables using `public.has_permission(...)`.
- Attachment metadata is protected by the same business-record permissions; private file buckets and signed URL upload flow are completed in later phases.

## Phase 3 Security Scope

- Approval, rejection, assignment, technician update, supervisor verification, and closure actions are guarded by dedicated permissions.
- Technician job routes use assignment membership, not broad work order visibility.
- RLS allows technicians to read only assigned work orders, assignments, labor, attachment metadata, and notes.
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
- Sidebar visibility uses the same permission key and server-loaded user context.
- Live statistics are fetched server-side with the normal Supabase server client.
- The page writes `system_map.viewed` audit logs, but audit failure does not block authorized viewing.

## Phase 5 Security Scope

- Report pages require `reports.view` except cost reports, which also require cost visibility through Super Admin, `costs.view`, or `finance.reports.view`.
- Export route handlers require `reports.export` or finance report access and write `report.export` audit logs.
- Export payloads remove cost and price fields server-side for users without cost visibility.
- Private uploads require `files.upload` plus the relevant business permission or assigned technician relationship.
- Upload actions validate file type and file size before writing to private Supabase Storage.
- `work-order-files`, `asset-files`, and `purchase-files` remain non-public buckets.
- Signed file links are generated server-side with a short expiry and are not created in browser code.
- Purchase, work order, and asset file metadata remains linked to the owning business record.
