# RECAFCO Enterprise Maintenance Management System

Working enterprise maintenance management prototype for RECAFCO. The app now targets private local deployment with PostgreSQL, Prisma ORM, local email/password authentication, HTTP-only cookie sessions, local private file storage, server-side RBAC, protected Next.js App Router routes, Tailwind UI, and real database-backed maintenance workflows.

## Local PostgreSQL Deployment

Set `.env` from `.env.example`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/recafco_maintenance?schema=public
NEXT_PUBLIC_APP_URL=http://localhost:3000
UPLOADS_DIR=uploads
```

Apply the additive local-auth migration after the imported Supabase public schema is present:

```txt
supabase/migrations/20260606100000_local_auth_replacement.sql
```

Then generate Prisma Client:

```bash
npm run prisma:generate
```

Create or reset a local login for an existing imported profile:

```bash
npm run auth:set-password -- <profile-id> admin@example.com "change-this-password"
```

Supabase Auth, Supabase Storage, Supabase Realtime, anon keys, and service-role keys are no longer required for the private local version. Notifications and dashboard refreshes use polling; uploaded files are stored under `UPLOADS_DIR` and served through authenticated `/api/files/...` routes.

## Built So Far

- Phase 1: Auth, RBAC, Super Admin, departments, users/profiles, roles, settings, dashboard, and audit logs.
- Phase 2: Asset master, spare parts inventory, work order CRUD, auto-numbering, work order details, maintenance history, demo data, and print foundation.
- Phase 3: Work order approval/rejection, technician assignment, technician mobile job execution, status history, notifications, supervisor verification, and manager closure.
- Phase 4: Parts requests, store issue, inventory movements, purchase requests, finance approval, CEO threshold approval, cost visibility, store/purchase/finance queues, notifications, and audit logs.
- Phase 5: Advanced reports, native `.xlsx` exports, print/PDF layout improvements, real private file upload with signed URL viewing, PWA polish, scannable QR codes, and preventive maintenance reporting.
- Notification System: centralized notification events, templates, Notification Center, header bell, unread counts, mark read/archive actions, user preferences, admin settings, delivery logs, and workflow integration for in-app notifications.
- Technical Architecture: `/admin/architecture` protected IT presentation page covering layers, RBAC/RLS, database, notifications, storage, workflow engine, reporting, deployment, and scalability.
- Final demo polish: Super Admin demo guide, clean empty states, mobile usability tightening, native Excel formatting, and real QR codes on asset/work-order detail and print pages.
- System Map: `/admin/system-map` premium Enterprise Operations Control Center showing the executive workflow strip, detailed animated workflow map, role swimlanes, management monitoring cards, modules, live local database stats, presentation mode, and roadmap.
- Editable Workflow Map: `/admin/system-map/edit` Super Admin workshop board for department meetings, draggable workflow steps, handoff editing, notes, JSON export, draft versions, and published map versions.

## Tech Stack

- Next.js App Router
- TypeScript strict mode
- Tailwind CSS
- PostgreSQL with Prisma ORM
- Local email/password auth with HTTP-only cookie sessions
- Local private file storage behind authenticated route handlers
- Zod validation
- npm

## Setup

```bash
npm install
npm run prisma:generate
```

Create `.env` from `.env.example`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/recafco_maintenance?schema=public
NEXT_PUBLIC_APP_URL=http://localhost:3000
UPLOADS_DIR=uploads
POSTGRES_SERVICE_NAME=postgresql-x64-17
```

Do not commit real `.env` values.

## Database Migrations

Apply migrations in order:

```txt
supabase/migrations/20260603093000_phase_1_foundation.sql
supabase/migrations/20260603110000_phase_2_assets_parts_work_orders.sql
supabase/migrations/20260603130000_phase_3_workflow_notifications.sql
supabase/migrations/20260603150000_phase_4_store_purchase_finance.sql
supabase/migrations/20260603162000_system_map_permission.sql
supabase/migrations/20260603180000_phase_5_reports_files_pwa.sql
supabase/migrations/20260604120000_notification_system_upgrade.sql
supabase/migrations/20260604143000_architecture_view_permission.sql
supabase/migrations/20260604153000_technician_notification_templates.sql
supabase/migrations/20260606100000_local_auth_replacement.sql
supabase/migrations/20260606113000_system_audit_real_data.sql
supabase/migrations/20260606140000_workflow_map_versions.sql
```

The earlier migrations keep the original public schema and demo data. The local-auth migration adds `auth_users` and `auth_sessions` for private deployment without Supabase Auth.

Create or reset the first local login for an existing Super Admin profile:

```bash
npm run auth:set-password -- <profile-id> admin@example.com "change-this-password"
```

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000/login`.

## Deploy to Vercel

Use Vercel's standard Next.js deployment.

Build settings:

- Framework preset: `Next.js`
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave default

Set these environment variables for Production, Preview, and Development as needed:

```env
DATABASE_URL=
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
UPLOADS_DIR=uploads
```

Important deployment notes:

- Set `NEXT_PUBLIC_APP_URL` to the deployed Vercel URL so generated QR codes point to the hosted app.
- For Vercel, local filesystem uploads are ephemeral. Use this mode for demos only unless persistent shared storage is added.
- For company-server deployment, set `UPLOADS_DIR` to a protected persistent directory and put the app behind the approved internal network/VPN boundary.
- `.env` is ignored by git. `.env.example` must stay as placeholders only.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

## System Map

Open `/admin/system-map` to present the complete workflow to IT and management.
Open `/admin/system-map/edit` as Super Admin to modify a workshop copy of the latest full workflow during department meetings.
Open `/admin/architecture` to present the technical system architecture to the IT Manager and technical management.
Open `/admin/demo-guide` as Super Admin for the recommended IT Manager / management presentation script.

Access:

- Super Admin: full access.
- IT Admin: view access through `system_map.view`.
- IT Admin: architecture view access through `architecture.view`.
- CEO / Management: view access through `system_map.view`.
- Other roles: blocked server-side.

The page includes:

- premium RECAFCO-branded hero
- executive workflow strip
- phase progress timeline
- detailed animated workflow diagram
- role swimlanes
- management monitoring cards
- clickable module cards
- live local database statistics
- editable workshop map link for Super Admin
- upcoming roadmap
- presentation mode

Future phases should be updated in `lib/system-map/config.ts`. The official page renders phases, executive workflow steps, modules, workflow nodes, workflow edges, role swimlanes, management monitoring cards, and roadmap items from that config. The editor saves planning versions in `workflow_map_versions`; it does not automatically change live workflow permissions or business rules.

## Workflow Testing

1. Login as Super Admin.
2. Open `/dashboard` and confirm live counts.
3. Create or open a work order in `/maintenance/work-orders`.
4. Approve it from `/maintenance/approvals`.
5. Assign technicians from `/maintenance/assignments`.
6. Login as a technician and use `/technician/jobs`.
7. Create a parts request from the job or work order detail page.
8. Approve the parts request, issue stock from `/store/parts-requests`, or mark items unavailable.
9. Create a purchase request from unavailable items in `/purchase/requests`.
10. Approve finance/CEO steps when enabled.
11. Receive purchase stock and confirm inventory movement records in `/store/inventory-movements`.

## Notification System

Open `/notifications` for the current user's Notification Center. The header bell shows the unread count and recent notifications, with actions to mark one or all as read.

Open `/profile/notifications` to manage in-app preferences for noncritical notification events. Email, WhatsApp, SMS, and push channels are represented as future disabled channels.

Open `/admin/notification-settings` as Super Admin or IT Admin to review notification events, enable/disable noncritical events, edit simple in-app templates, and inspect recent delivery logs. Critical workflow notifications remain protected by `force_critical_notifications`.

Workflow actions now use `lib/notifications/service.ts` so notification failures are logged and do not block the main business action.

## Phase 5 Reports and Exports

Open:

- `/reports/work-orders`
- `/reports/assets`
- `/reports/costs`
- `/reports/preventive-maintenance`

Reports use live local database data and support filters for date range, department, asset, status, maintenance type, worker type, technician, priority, and cost range where the user can view costs.

Export buttons download audited native `.xlsx` workbooks for work orders, assets, parts inventory, parts requests, purchase requests, inventory movements, cost reports, and preventive maintenance. Workbooks include proper sheet names, formatted headers, frozen header rows, filters, and column widths. Cost columns are removed server-side for users without cost visibility.

## Private File Uploads

Phase 5 creates private Supabase Storage buckets:

- `work-order-files`
- `asset-files`
- `purchase-files`

Upload locations:

- Work order detail and technician job detail for photos/documents.
- Asset detail for asset documents.
- Purchase request detail for quotations, invoices, and delivery notes.

Files are validated server-side, stored in private buckets, written to metadata tables/columns, audited, and viewed through server-created signed URLs.

## PWA, Mobile, and QR Codes

The app includes a manifest, RECAFCO icon placeholder, red mobile theme color, standalone start URL, production service worker registration, an offline fallback shell, and role-aware mobile navigation with quick links plus a full drawer menu. Secure Supabase workflows still require a live connection for login, permissions, signed files, approvals, and fresh data.

Asset and work order detail pages and print pages generate scannable QR SVGs for internal `/assets/[id]` and `/maintenance/work-orders/[id]` routes. Set `NEXT_PUBLIC_APP_URL` so scanned QR codes resolve to the correct deployed/internal base URL.

## Cost Visibility

Cost fields are visible only to Super Admin and users with `costs.view`. Finance Manager and CEO / Management receive cost visibility through permissions; technicians and normal requesters do not see sensitive cost fields by default.

## Security Notes

- All secure routes require login.
- Permissions are checked in server components and server actions.
- RLS policies protect Supabase tables.
- Inactive users cannot access protected application context.
- Service role key is not exposed to the browser.
- Workflow actions write audit logs where practical.
- `/admin/system-map` writes `system_map.viewed` audit logs without blocking the page if audit insert fails.

## Current Limitations

- Browser print is used for PDF output; a dedicated server-side PDF library can be added later.
- QR codes point to internal authenticated routes, so scanning requires network access and a logged-in authorized user.
- Camera-based QR scanning, offline mode, Arabic support, ERP integration, WhatsApp/email notifications, preventive calendar, and advanced analytics remain Phase 6 roadmap items.
