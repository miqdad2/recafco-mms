# Architecture Context

## Stack

| Layer | Technology | Role |
|---|---|---|
| Framework | Next.js 15 App Router | Pages, layouts, routes, actions |
| Language | TypeScript strict mode | Type-safe implementation |
| UI | React + Tailwind CSS v4 | Responsive interface |
| Components | Custom shared components | Reusable UI |
| Validation | Zod | Boundary validation |
| Business logic | Backend services | Domain rules and workflows |
| Data access | Repositories | Prisma persistence |
| ORM | Prisma 6 | PostgreSQL access |
| Database | PostgreSQL | Transactional business data |
| Authentication | Custom local auth | Users and sessions |
| Files | Local filesystem | Private attachments |
| Notifications | PostgreSQL + SSE | In-app delivery |
| Reports | Server queries + ExcelJS | Reports and exports |

## High-Level Flow

```text
Browser
  ↓
Next.js page / server action / route handler
  ↓
Authentication and permission guards
  ↓
Backend service
  ↓
Repository
  ↓
Prisma
  ↓
PostgreSQL
```

## System Boundaries

- `app/` — pages, layouts, route handlers, server actions, page guards
- `app/actions/` — input parsing, authentication, authorization, service calls
- `app/api/` — HTTP endpoints, protected files, SSE stream
- `components/` — reusable and domain UI
- `components/ui/` — custom shared UI primitives
- `lib/backend/` — services, repositories, transactions, domain rules
- `lib/auth/` — session reading, user context, guards
- `lib/notifications/` — events, templates, recipients, persistence
- `lib/files/` — local storage and safe URL generation
- `lib/workflows/` — transition rules and workflow helpers
- `lib/work-orders/` — visibility rules
- `lib/reports/` — reporting and cost visibility
- `prisma/` — Prisma schema and generated model boundary
- `supabase/migrations/` — historical SQL migrations applied to PostgreSQL
- `scripts/` — health, backup, password, and demo utilities
- `uploads/` — local file bytes

## Authentication and Access Model

Active auth tables:

- `public.auth_users`
- `public.auth_sessions`
- `public.profiles`
- `public.roles`
- `public.permissions`
- `public.role_permissions`
- `public.user_permission_overrides`

Login sequence:

1. Normalize email.
2. Query auth user.
3. Verify bcrypt password.
4. Verify account and profile active state.
5. Check lockout.
6. Generate random token.
7. Store SHA-256 token hash.
8. Set HTTP-only `recafco_session` cookie.
9. Load full user context for protected requests.

Authorization rules:

- Page and mutation boundaries both enforce permissions.
- Super Admin bypasses normal permission checks.
- Deny overrides win.
- `can_view_costs` adds cost access.

## Migration Compatibility

Early migrations reference Supabase-managed objects. Plain PostgreSQL setup requires a bootstrap for:

- `auth.users`
- `auth.uid()`
- `anon`
- `authenticated`
- `service_role`
- `storage.buckets`
- `storage.objects`

These are compatibility objects only. Application code uses public auth tables and local files.

A version-controlled bootstrap script is required in a future stabilization unit.

## Storage Model

### PostgreSQL

Stores users, sessions, profiles, roles, permissions, departments, settings, work orders, assets, parts, requests, approvals, inventory movements, notifications, audit logs, workflow records, system errors, backup logs, and file metadata.

### Local Filesystem

Stores attachment bytes under:

```text
uploads/{bucket}/{entity-id}/{timestamp}-{safe-filename}
```

Private buckets:

- work-order-files
- asset-files
- purchase-files

Files are served through protected API routes. `createSignedFileUrl()` is a proxy URL, not a signed expiring URL.

## Workflow Architecture

Current primary source of operational state: string statuses with backend transition validation.

Secondary structured layer:

- workflow definitions
- workflow steps
- workflow instances
- workflow step instances
- clarification requests

A future decision must define whether the workflow engine remains tracking-only or becomes the source of truth.

## Inventory Architecture

- Required parts live in `work_order_required_parts`.
- Store Keeper classifies availability.
- Confirmation does not deduct stock.
- Store issue changes stock.
- Assignment can be blocked while parts are unchecked.
- Feature flag: `inventory_check_enabled`, currently false.

## Notification Architecture

- Active: in-app notifications and SSE.
- SSE poll: 15 seconds.
- SSE heartbeat: 25 seconds.
- Inactive: email, SMS, WhatsApp, push.
- `realtime_events` has no consumer.

## Transaction Architecture

Use `withBackendTransaction(actorId, operation)` for multi-step writes such as approval plus history, inventory plus movement, purchase receipt plus stock update, and assignment plus workflow update.

## Error and Audit Architecture

- Expected domain failures use `AppError`.
- Non-fatal operational failures may use `logSystemError()`.
- Significant actions create audit records.
- Secrets and hashes are never logged.

## Deployment Assumptions

Suitable now:

- Local development
- Single-instance internal Node.js server
- Persistent PostgreSQL
- Persistent local disk

Not suitable without changes:

- Vercel serverless
- Multi-instance stateless deployment
- Horizontal scaling
- Ephemeral filesystem

## Future Target

Possible future stack:

- Monorepo
- Next.js frontend
- NestJS backend
- PostgreSQL
- Redis/Valkey
- MinIO/S3
- Realtime gateway
- Background worker

This is planned, not current.

NestJS readiness gates:

1. Verify current lifecycle end to end.
2. Add automated tests for critical transitions.
3. Document service/repository contracts.
4. Add repeatable migration and seed tooling.
5. Decide storage architecture.
6. Clarify realtime and background jobs.
7. Resolve incomplete workflow actions.
8. Document API contracts.

## Invariants

1. Work-order visibility filtering is mandatory.
2. Notifications go through the notification service.
3. Notification failure does not abort business operations.
4. Cost data is permission-gated.
5. File access is entity-specific.
6. Multi-step writes are transactional.
7. Status changes are backend-controlled.
8. Super Admin bypass precedes override evaluation.
9. Deny overrides win.
10. CEO views are non-operational.
11. Server-only code does not leak to clients.
12. Soft-delete rules are preserved.
13. Secrets are never logged.
14. Feature flags come from the database.
15. Schema-only features are not reported as active.
