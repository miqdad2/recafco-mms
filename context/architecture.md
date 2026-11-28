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
- `prisma/` — Prisma schema, migrations, and generated model boundary
- `docs/archive/supabase-migrations/` — historical SQL migrations, archived for reference only
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

### Inventory Control materials and Opening Stock import

- A material is a ledger identity in `offline_inventory_movements`, keyed by `buildBalanceKey()`: `part:<id>` or `manual:<lower(trim(name))>|<lower(trim(unit))>`. `inventory_material_settings` is its optional master row (Item Code, archive, master category / part number / location). There is no material table. The 1,523 registered materials are manual identities from the Material Master import (zero-quantity Opening Stock row + settings row with Item Code).
- Import Opening Stock (`/store/offline-inventory/import-opening-stock`): rules in `lib/store/opening-stock-matching.ts` (pure), service `lib/backend/store/opening-stock-import.ts`, actions `app/actions/opening-stock-import.ts`. Preview never writes; confirm re-reads the file and writes everything in one `withBackendTransaction` under a global advisory lock plus the per-material Issue locks.
- Stock for an existing material is always posted with its exact stored name and unit. Units are never converted; PCS and Nos are the same counting unit only for a confirmed material.
- Partial import (business decision 2026-11-25): clear rows post at import time — Existing only for one candidate by same name or exact part reference with agreeing type, make, ratings and unit; New only when no candidate or weak evidence exists. Every uncertain row is held with no stock (Needs Review, Duplicate in File); invalid / already-imported rows fail; neither blocks the rest of the batch.
- Held rows are resolved later from the stored batch (`resolveHeldOpeningStockRows`, approvers only): Use existing / Register as new / Do not import (reason) — one transaction, batch rows locked, rows no longer held never re-posted. Register as new is refused when an existing material has the same name or the row's exact part number. Uncertain matches are never merged automatically.
- Every source row is stored in `opening_stock_import_rows` (verbatim source values, classification, outcome, approver, resolution time and note, movement). Batches in `opening_stock_import_batches` are unique by submission id, file SHA-256 and row-content SHA-256; a unique index allows one posted opening-stock row per material across all batches.
- New materials from this import get Item Codes in the AMSOS series (`allocateItemCodes`), after the highest AMSOS code in settings (archived included) or ever issued by an import; the import holds the Material Master import lock, and the case-insensitive unique index is the final guard.
- Needs Verification (`/store/offline-inventory/needs-verification`; rules `lib/store/opening-stock-verification-rules.ts`, service `lib/backend/store/opening-stock-verification.ts`): held rows are corrected by Data Entry (draft / submit) and decided by Maintenance Manager / Super Admin. Corrections live in `corrected_*` columns over the immutable `source_*` values (trigger `opening_stock_import_rows_keep_source`); every step writes `opening_stock_row_events`; `row_version` gives optimistic concurrency. Decisions post only through `resolveHeldOpeningStockRows`, which classifies the corrected row again, so corrections never bypass duplicate, reference or unit checks.
- Register as Different Material: the only exception to "never register a material whose exact part number already exists". Approver only, explicit confirmation, explanation and a comparison with every same-number material; never for a unit mismatch alone or for an identical description. Recorded as event `registered_different` and its own audit entry; the existing material is untouched.
- Exact match guard: a row matching an existing material on complete part number, unit, type, make / equipment and specification (only spelling or punctuation differs) cannot be registered as different without a separate exceptional approval with documented specification or physical evidence (own audit record). A part number split by a space or punctuation is treated as the same part number for every registration decision.
- Job Card requirements (work_order_required_parts) are entry_type 'inventory' (default, every older row) or 'manual' (typed material / outside service, lib/work-orders/manual-requirements.ts). Only Inventory rows are tracked by material fulfillment, Process Materials, Materials Requests and the Inventory Check; manual rows never touch stock and are listed separately on the Job Card detail, print and Edit Job Card.

## Notification Architecture

- Active: in-app notifications and SSE.
- SSE poll: 15 seconds.
- SSE heartbeat: 25 seconds.
- Inactive: email, SMS, WhatsApp, push.
- `realtime_events` has no consumer.

## Auto-Refresh Architecture (Phase Realtime-01)

Polling strategy used because it is simple, reliable, and safe for internal LAN deployment.

**Client hook**: `hooks/use-auto-refresh.ts` — wraps `router.refresh()` on a configurable interval. Pauses when the tab is hidden or a form input is focused. Resumes and fires immediately when the tab becomes active again.

**Client component**: `components/auto-refresh.tsx` — thin wrapper, renders nothing. Drop into any server-rendered page.

**Intervals applied**:
- Dashboard: 30 s
- Repair Orders list: 30 s
- Repair Order detail: 20 s (disabled when status is Closed or Cancelled)
- Parts Requests list: 30 s
- Technician My Jobs: 20 s
- Notifications bell: existing SSE stream + 45 s fallback polling (unchanged)

**Pages excluded** (unsaved form state risk): New Repair Order wizard, New Parts Request wizard, New Asset form, New Spare Part form, Create User drawer.

**Future enhancement**: Use Server-Sent Events to push repair order and technician job status changes directly to clients, replacing the timer-based refresh. SSE infrastructure already exists at `/api/notifications/stream` and could be extended. Polling is the correct first step because it requires no schema changes, no separate process, and works identically on a single-node Windows LAN server.

## Transaction Architecture

Use `withBackendTransaction(actorId, operation)` for multi-step writes such as approval plus history, inventory plus movement, purchase receipt plus stock update, and assignment plus workflow update.

## Error and Audit Architecture

- Expected domain failures use `AppError`.
- Non-fatal operational failures may use `logSystemError()`.
- Significant actions create audit records.
- Secrets and hashes are never logged.

## External Integrations (MMS-FMP-INTEGRATION-01)

- `GET /api/integrations/fmp/maintenance-dashboard/live` — read-only, live Maintenance dashboard summary for the separate Factory Management Platform (FMP). MMS stays the source of truth.
- Server-to-server auth: `x-fmp-integration-key` header compared (SHA-256 + `timingSafeEqual`) to `FMP_INTEGRATION_KEY` (min 32 chars). Unset key → 503 (disabled); missing header → 401; wrong key → 403.
- `proxy.ts` exempts `/api/integrations/fmp/*` from the session-cookie redirect and rate-limits it (120/min/IP); the route handler does all authentication.
- Company-wide scope with no MMS user context — documented exception to `getWorkOrderVisibilityFilter()`, equivalent to full-access roles. No cost fields are selected or returned.
- Reads only (`count`/`findMany`/`findFirst`); no audit logs, notifications, or `system_errors` rows per poll (failures log to console only).
- 10-second in-process cache with in-flight dedupe; `Cache-Control: no-store`. `openUrl` base: `MMS_PUBLIC_BASE_URL` (runtime) → `NEXT_PUBLIC_APP_URL`.
- FMP-MAINT-04 executive summary: the same endpoint also returns `links`, `jobCards`, `materialsRequests`, `inventory`, `assets`, `vehicleCompliance`, `labor`, and `managerAttention` (`lib/integrations/fmp/executive-summary.ts`). Additive only; each section is `null` if its query fails (logged to console) while the original fields still fail the request with 500.
- Cost figures (labor cost, stock/received/issued value) are included unless `FMP_INTEGRATION_INCLUDE_COSTS=false`. This is a deliberate exception to `canViewCosts(context)`: there is no MMS user behind the request, so the env switch is the gate.
- Code: `lib/integrations/fmp/`; unit tests: `npm run test:unit` (`tests/unit/`, Node built-in test runner with type stripping).

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

## Lightweight Monitoring Health Route

- `GET /api/health` is an intentional session-authentication exception for monitoring.
- The existing health-request rate limit runs before this exact route bypass.
- `/api/health/database`, sibling paths, other methods, and other application routes retain their existing authentication behavior.
- The route performs only `SELECT 1`: HTTP 200 with `status: ok` / `database: connected`, otherwise HTTP 503 with `status: degraded` / `database: error`.
- Raw database errors are not returned or logged by this route. Responses use `Cache-Control: no-store`.
- No schema, workflow, role, permission, or integration-key changes are required.

Current staging base: 3ac4f944ea9770d3a6e82d8021be323750b12532. Validation pending.
