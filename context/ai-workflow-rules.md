# AI Workflow Rules

## Approach

Use a spec-driven, incremental workflow. Verify current code and database state before changing behavior. Do not invent behavior from filenames, tables, or historical assumptions.

## Reading Order

1. project-overview.md
2. architecture.md
3. ui-context.md
4. code-standards.md
5. ai-workflow-rules.md
6. progress-tracker.md

## Trust Order

1. Current running code
2. Current database schema and settings
3. Committed migrations
4. Current context docs
5. Older notes

Report conflicts rather than hiding them.

## Scoping

- One feature unit at a time.
- Small, verifiable changes.
- No unrelated domains in one step.
- No architecture redesign during bug fixes.
- No NestJS migration during recovery.
- No feature flag activation without a test plan.
- Schema presence is not proof of usable functionality.

Split work when it mixes unrelated workflows, auth and feature development, storage migration and business logic, realtime architecture and notification fixes, or unresolved business decisions.

## Before Work-Order Changes

Confirm user context, permission, visibility filter, current status, allowed transition, audit, notification, transaction, and feature flag.

Always apply `getWorkOrderVisibilityFilter(context)`.

## Before Notifications

- Use registered event keys.
- Use `notifyByEvent()`.
- Never insert directly.
- Isolate failures.
- Verify category, priority, recipients, preferences, and metadata.
- Audit-only events do not notify.

## Before Permissions

Update type, definition, migration, assignments, page guard, action guard, navigation, docs, and verification.

## Before Roles

Confirm requirement, add type and label, migration, permissions, dashboard, navigation, workflow ownership, seed support, and docs.

Workflow-only roles currently unresolved:

- production_manager
- factory_manager
- purchase_manager

## CEO Rules

CEO views are executive-only. No create/edit buttons, technician operations, store operations, or dense operational tabs.

## Cost Rules

Use `canViewCosts(context)` before retrieving or rendering cost data.

## File Rules

Authenticate, validate bucket/entity/path, prevent traversal, and enforce entity-specific access. `createSignedFileUrl()` is not a real signed URL.

## Workflow Rules

For new transitions: update transition map, implement service, use transaction, write history, audit, notify, verify permission/role, update UI, and update docs.

The frontend never writes arbitrary status.

## Database Rules

- No `prisma db push`.
- No `prisma migrate dev`.
- Do not edit applied migrations.
- Add new migrations for schema changes.
- Back up before deployment.
- Parameterize raw SQL.
- Never expose DATABASE_URL.

Plain PostgreSQL currently requires compatibility bootstrap objects.

## Recovery Rules

Do not assume previous live data exists.

Current key facts:

- Two active users
- Seeded assets, parts, and work orders
- No assignments
- No parts or purchase requests
- No inventory movements
- Inventory check disabled
- No workflow instances

Before workflow testing: recreate users, select a controlled work order, record initial state, test one transition at a time, inspect DB changes, verify notifications, and reset only with documented tools.

## Missing Actions

Do not misrepresent:

- Dedicated requester confirmation
- General reopen
- Dedicated cancel
- Formal purchase order creation
- Production Manager approval
- Factory Manager approval
- Purchase Manager approval
- Construction workflow UI/actions

## Feature Flags

Before changing a DB feature flag, read current value, document effect, define rollback, and define tests.

Current key flag:

```text
inventory_check_enabled = false
```

## Verification

Use targeted DB queries, service checks, route checks, manual role checks, workflow dry runs, permission tests, file tests, and notification inspection.

Before completion run:

```bash
npm run db:check
npm run lint
npm run typecheck
npm run build
```

## Documentation Sync

Update progress-tracker after every meaningful change. Update other context files when scope, roles, architecture, database, flags, UI, standards, or deployment assumptions change.

## Protected Areas

Do not modify applied migrations, generated files, Prisma client, uploads, backups, `.env`, password hashes, tokens, or shared primitives without explicit need.

## Stop Conditions

Stop when a migration fails, build fails, requirements are ambiguous, DB contradicts docs, an invariant would be bypassed, a feature is schema-only, an actor is unclear, a destructive action lacks backup, or scope is too broad.

## Before Next Unit

The current unit must work, authorization must be verified, invariants preserved, DB changes safe, audit and notifications correct, checks passing, docs updated, and git diff limited to intended changes.
