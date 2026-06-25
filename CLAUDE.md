# RECAFCO Maintenance Management System — Development Context

## Required Reading Order

Before implementing or making an architectural decision, read:

1. `context/project-overview.md`
2. `context/architecture.md`
3. `context/ui-context.md`
4. `context/code-standards.md`
5. `context/ai-workflow-rules.md`
6. `context/progress-tracker.md`

Update `context/progress-tracker.md` after every meaningful implementation or database-state change. Update the relevant context file whenever architecture, scope, standards, UI conventions, feature flags, or deployment assumptions change.

## Project Identity

- Application: RECAFCO Maintenance Management System
- Company: RECAFCO
- Region: Kuwait
- Currency: KWD
- Purpose: Internal enterprise maintenance, store, purchase, finance, asset, and work-order management
- Model: Single-tenant internal application
- Public access: Out of scope

## Current Verified Stack

| Area | Technology |
|---|---|
| Framework | Next.js 15 App Router |
| Language | TypeScript strict mode |
| UI | React + Tailwind CSS v4 |
| Components | Custom shared components |
| Icons | `lucide-react` |
| Database | PostgreSQL |
| ORM | Prisma 6 |
| Authentication | Custom local authentication |
| Password hashing | `bcryptjs`, cost factor 12 |
| Sessions | Database-backed, HTTP-only cookie |
| File storage | Local filesystem under `uploads/` |
| Notifications | In-app database notifications |
| Realtime | SSE notification stream |
| Validation | Zod |
| Excel export | `exceljs` |
| QR codes | `qrcode` |
| Package manager | npm |

Do not assume Supabase Auth, Supabase Storage, shadcn/ui, Radix UI, Recharts, React Hook Form, TanStack Table, next-pwa, Socket.IO, MinIO, Redis, Valkey, or NestJS are active.

## Current Database State

The previous local PostgreSQL operational database was not recovered. The codebase and migration history were recovered from Git. A fresh PostgreSQL database was created and all 29 SQL migrations were applied.

Verified baseline:

- 17 roles
- 55 permissions
- 276 role-permission assignments
- 7 departments
- 15 assets
- 25 spare parts
- 20 seeded work orders
- 2 active users: Super Admin and Maintenance Data Entry
- 0 technician assignments
- 0 parts requests
- 0 purchase requests
- 0 purchase orders
- 0 inventory movements
- 0 workflow instances
- Inventory check implemented but disabled: `inventory_check_enabled = false`

Do not claim that the previous live operational data was recovered.

## Authentication Model

Active tables:

- `public.auth_users`
- `public.auth_sessions`
- `public.profiles`
- `public.roles`
- `public.permissions`
- `public.role_permissions`
- `public.user_permission_overrides`

The application does not use `auth.users` for active authentication.

Early migrations still reference Supabase-style compatibility objects: `auth.users`, `auth.uid()`, `anon`, `authenticated`, `service_role`, `storage.buckets`, and `storage.objects`. These are migration compatibility objects only.

### Session Flow

1. Login finds `public.auth_users` by normalized email.
2. Password is verified with bcrypt.
3. Account and profile active flags are checked.
4. Lockout state is checked.
5. A random token is created.
6. Only its SHA-256 hash is stored in `public.auth_sessions`.
7. Browser receives the `recafco_session` HTTP-only cookie.
8. The current-user context loads profile, department, role, permissions, and overrides.

### Permission Rules

- Super Admin bypasses normal permission checks.
- Deny overrides always win.
- Allow overrides add permissions.
- Super Admin is immune to overrides.
- `profiles.can_view_costs = true` grants cost visibility.
- Authorization must be enforced in both pages/routes and server actions/services.

## Mandatory Invariants

1. Every work-order query applies `getWorkOrderVisibilityFilter(context)`.
2. Notifications use `notifyByEvent()`, never direct inserts.
3. Notification failures never abort the main workflow.
4. Multi-step writes use `withBackendTransaction(actorId, operation)`.
5. Cost fields are gated through `canViewCosts(context)`.
6. File access uses bucket-specific and entity-specific authorization.
7. Super Admin bypass occurs before override evaluation.
8. Deny overrides win.
9. CEO pages are executive-only and non-operational.
10. Server-only modules use `import "server-only"`.
11. Soft-deletable records are not hard deleted.
12. Work-order transitions are backend validated.
13. The frontend never sets arbitrary workflow status.
14. Secrets and password hashes are never exposed.
15. App settings are read from the database.

## Work-Order Lifecycle

Statuses include Draft, Submitted, Pending Approval, Approved, Assigned, In Progress, Waiting for Parts, Waiting for Purchase, Parts Issued, Completed by Technician, Verified by Supervisor, Confirmed by Requester, Closed, Rejected, Cancelled, and Reopened.

Backend transitions must use `lib/workflows/status-rules.ts`.

### Implemented

- Draft creation and update
- Submission
- Manager approval and rejection
- Clarification request and response
- Technician assignment
- Technician start and completion
- Supervisor verification
- Manager closure
- Store issue
- Shortage handling
- Purchase request creation
- Finance approval
- CEO approval
- Purchase receipt and inventory update

### Partial or Incomplete

- Dedicated requester-confirmation action
- General reopen action
- Dedicated cancel action
- Formal purchase-order creation
- Production Manager approval UI/action
- Factory Manager approval UI/action
- Purchase Manager approval UI/action
- Construction Project Request application flow

Do not describe schema-only or workflow-definition-only features as implemented.

## Workflow Engine

Two mechanisms coexist:

1. Status-string transition system: primary operational mechanism.
2. Workflow engine tables: definitions, steps, instances, step instances, and clarification tracking.

Do not replace either system without an explicit architecture decision.

## Inventory Check

- Route: `/store/inventory-check`
- Required parts: `work_order_required_parts`
- Store Keeper can classify availability.
- Confirmation does not deduct stock.
- Assignment can be blocked while items are unchecked.
- Gate applies only when `inventory_check_enabled = true`.
- Shortage-to-purchase is not fully automatic.

Do not enable the feature until a controlled end-to-end verification is completed.

## Purchase Workflow

Implemented: purchase requests, finance approval, CEO approval, configured threshold, receipt, inventory increase, and inventory movement creation.

Not fully implemented: formal purchase-order service/UI, Production Manager approval, Factory Manager approval, Purchase Manager approval, fully automatic shortage progression.

## Notifications

- Use `notifyByEvent()` only.
- In-app delivery only.
- SSE database poll: 15 seconds.
- SSE heartbeat: 25 seconds.
- External email, SMS, WhatsApp, and push are inactive.
- `realtime_events` has no active consumer.
- `system_map.viewed` is audit-only.
- Notification errors are isolated and logged.

## File Storage

Current provider: local filesystem.

Path:

```text
uploads/{bucket}/{entity-id}/{timestamp}-{safe-filename}
```

Buckets:

- `work-order-files`
- `asset-files`
- `purchase-files`

`createSignedFileUrl()` returns a protected proxy route, not a cryptographic expiring URL. `signed_url_expiry_seconds` is not enforced.

Local storage is not suitable for Vercel serverless or multi-instance deployment. MinIO/S3 remains a future decision.

## UI Rules

- Primary: `#ed1c24`
- Background: `#f5f6f8`
- Foreground: `#111827`
- Charcoal: `#2b2b2b`
- Border: `#e5e7eb`
- Tailwind CSS v4
- No shadcn/ui
- Lucide icons
- Minimum mobile target: 44px
- Mobile breakpoint: 640px
- Respect reduced motion
- CEO UI remains executive-only

## Development Workflow

Before coding:

1. Read context files.
2. Inspect current implementation.
3. Confirm current DB and feature flags.
4. Define one small unit.
5. Define verification.

After coding:

1. Run targeted checks.
2. Run `npm run db:check`, `npm run lint`, `npm run typecheck`, and `npm run build`.
3. Update `context/progress-tracker.md`.
4. Update other context files when needed.
5. Commit only intended files using Conventional Commits.

## Current Phase

Advanced codebase recovery and controlled multi-role workflow verification.

Immediate priorities:

1. Recreate missing role users.
2. Add repeatable idempotent seed tooling.
3. Run a controlled lifecycle from creation through closure.
4. Verify notifications, reports, and permissions.
5. Resolve incomplete workflow actions.
6. Decide whether workflow-only roles remain in scope.
7. Add automated tests before major refactoring.
