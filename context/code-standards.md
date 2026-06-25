# Code Standards

## General

- Fix root causes.
- Keep modules focused.
- Do not mix unrelated concerns.
- Prefer small, verifiable units.
- Preserve working behavior.
- Do not report schema-only features as complete.
- Avoid broad refactors without tests.
- Keep documentation synchronized.

## TypeScript

- Strict mode required.
- `allowJs` remains false.
- Avoid `any`.
- Validate unknown input.
- Use explicit domain types.
- Use narrow action result types.
- Never expose internal error objects.

Convert Prisma Decimal with `Number()` or `parseFloat(value.toString())`. Convert BigInt from raw queries with `Number()`.

## Server-Only Modules

Use:

```ts
import "server-only";
```

for auth, repositories, storage, notifications, reports, and secret-dependent helpers.

## Next.js

Default to server components. Use client components only for browser interactivity.

Server actions must validate, authenticate, authorize, call services, and return predictable safe results.

Route handlers must authenticate independently, validate parameters, enforce authorization, and avoid leaking resource existence or internals.

## Layering

Actions own transport boundaries. Services own business rules. Repositories own persistence. Repositories do not decide workflow.

## Authentication and Permissions

- Use `requireUser()` or `requirePermission()`.
- Do not trust cookie presence alone.
- Super Admin bypass occurs first.
- Deny overrides win.
- Never expose password hashes or raw tokens.
- Session cookie: `recafco_session`.

## Work-Order Visibility

Every work-order query uses:

```ts
getWorkOrderVisibilityFilter(context)
```

This includes lists, dashboards, reports, details, attachments, assignments, and notification-linked access.

## Status Transitions

- Backend-controlled only.
- Validate with shared transition rules.
- Record actor, time, and history.
- Audit significant changes.
- Notify after successful state change.
- Use transactions for multi-table operations.

New transitions belong in `lib/workflows/status-rules.ts` and require verification.

## Transactions

Use:

```ts
withBackendTransaction(actorId, operation)
```

for atomic multi-step operations.

## Notifications

Use `notifyByEvent()` only. Never directly insert from business code. Notification errors are isolated and logged.

## Cost Visibility

Use `canViewCosts(context)` before retrieving or rendering sensitive cost data. Client-side hiding is insufficient.

## File Security

Validate bucket, entity, MIME type, size, filename, and path. Prevent traversal. Enforce entity-level authorization. Do not replace bucket logic with a generic files permission.

## Database and Prisma

- Use Prisma repositories for normal access.
- Parameterize raw SQL.
- Do not use unsafe interpolation.
- Do not run `prisma db push`.
- Do not run `prisma migrate dev` on this recovered migration history.
- Apply committed SQL migrations in order.
- Back up before deployment migrations.

Use `{ status: { notIn: [...] } }`, not unsupported `.neq()` patterns.

## Soft Delete

Do not hard delete records that support `deleted_at`.

## Audit Logging

Audit user administration, permissions, status transitions, approvals, inventory changes, purchase decisions, file access where required, settings, and workflow actions.

Include actor, action, entity, safe summary, sanitized metadata, and timestamp.

## Error Handling

Use `AppError` for expected domain failures and `logSystemError()` for non-fatal operational failures. User errors must be clear, safe, actionable, and free of internals.

## UI

- Use shared components.
- Preserve verified tokens.
- Avoid duplicate primitives.
- Use Lucide icons.
- Respect mobile and reduced motion.
- Use executive-only CEO views.
- Gate costs server-side.

## Roles and Permissions

Adding a permission requires type update, definition update, SQL migration, role assignments, page/action guards, navigation update, docs, and verification.

Adding a role requires type, label, migration, permissions, navigation, dashboard, workflow ownership, seed support, verification, and docs.

## App Settings

Read settings from the database. Do not hardcode CEO threshold, feature flags, upload limit, notification settings, or workflow switches.

## Git and Delivery

Use Conventional Commits:

```text
type(scope): description
```

Before commit:

```bash
npm run db:check
npm run lint
npm run typecheck
npm run build
```

Stage only intended files.

## Protected Areas

Do not modify without explicit need:

- Applied historical migrations
- Generated Prisma client
- Generated Next.js files
- Password hashes
- Production secrets
- Upload binaries
- Backup archives
- Shared UI primitives during unrelated work

## Definition of Done

A unit is done only when scope, authorization, invariants, errors, audit, notifications, transaction safety, targeted verification, full checks, and documentation are complete.
