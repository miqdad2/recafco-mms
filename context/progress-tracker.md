# Progress Tracker

Update this file after every meaningful implementation or database-state change.

## Current Phase

**Advanced codebase recovery and controlled multi-role workflow verification**

The codebase is substantially implemented and quality checks pass. The PostgreSQL database was rebuilt from committed migrations after the previous operational database became unavailable.

## Current Goal

Create missing role users and verify one controlled work order through:

```text
Create → Submit → Approve → Assign → Start → Complete → Verify → Close
```

Confirm permissions, visibility, history, audit, notifications, reports, cost visibility, and file authorization.

## Current Verified Baseline

Repository:

- Branch: main
- HEAD: fd7a649
- Working tree: only generated next-env.d.ts modification
- Package manager: npm

Quality:

- db:check pass
- lint pass
- typecheck pass
- build pass
- 41 static pages
- 53 dynamic routes
- No automated tests

Database:

- 29 SQL migrations applied
- 7 departments
- 17 roles
- 55 permissions
- 276 role-permission assignments
- 15 assets
- 25 parts
- 20 work orders
- 2 profiles
- 2 auth users
- 2 sessions
- 0 assignments
- 0 required parts
- 0 parts requests
- 0 purchase requests
- 0 purchase orders
- 0 inventory movements
- 1 notification
- 231 audit logs
- 0 system errors
- 2 workflow definitions
- 30 workflow steps
- 0 workflow instances
- 0 workflow step instances
- 0 clarification requests

Active users:

- Super Admin
- Maintenance Data Entry

Current settings:

- Company: RECAFCO
- Currency: KWD
- CEO threshold: 1000 KWD
- Requester confirmation: enabled
- Finance approval: enabled
- CEO approval: enabled
- Inventory check: disabled
- Upload limit: 10 MB
- Signed URL expiry setting: 300 seconds, not enforced
- Notification retention: 180 days

## Completed

- Foundation: auth, RBAC, departments, users, settings, audit
- Core records: assets, parts, work orders, history, files, print
- Workflow: submit, approve, reject, clarify, assign, start, complete, verify, close
- Store/purchase/finance: parts requests, store issue, shortage, purchase request, finance, CEO, receipt, inventory update
- Dashboards and reports
- Notification center and SSE
- System map and architecture pages
- System health and backup logs
- Workflow engine schema and seed
- Inventory-check schema, UI, and assignment gate
- Fresh DB reconstruction
- New Super Admin setup
- Local application startup
- R2.1: `scripts/seed-demo-users.mjs` — idempotent demo user seed utility written; `seed:demo-users` npm script added; `DEMO_USER_PASSWORD` documented in `.env.example`. Script not yet executed. Database state unchanged.

## Implemented but Feature-Flagged

Inventory check is implemented but `inventory_check_enabled = false`.

## Partial

- Requester confirmation
- General reopen
- Cancellation
- Automatic shortage-to-purchase progression

## Schema or Definition Only

- Formal purchase-order lifecycle
- Production Manager approval
- Factory Manager approval
- Purchase Manager approval
- Construction Project Request application flow
- Realtime event consumer
- External notification delivery

## In Progress

- Missing multi-role users (seed script written, not yet executed — see R2.1)
- No controlled post-recovery lifecycle verification
- Manual PostgreSQL bootstrap not yet committed
- Backup routine not yet revalidated on the new machine

## Next Up

### R2.2 — Execute Demo User Seed

Run `DEMO_USER_PASSWORD=<password> npm run seed:demo-users` and verify all 7 users are created. Confirm profiles, roles, departments, active status, cost visibility, and must_reset_password in the database. Do not run until a suitable demo password is ready.

### R2 — Recreate Essential Users (tracking)

Seed script implemented (R2.1 complete). Execution and verification pending (R2.2).

### R3 — Controlled Work Order

Select or create one controlled demo work order and record its ID, number, initial status, requester, required parts, technician, and expected transitions.

### R4 — Lifecycle Dry Run

Verify submit, approve, assign, start, complete, verify, and close. Inspect status, history, assignment, workflow records, audit, and notifications after each step.

### R5 — Store and Purchase Dry Run

After the lifecycle is stable, enable inventory checking only in a controlled environment and verify required parts, availability, assignment gate, shortage, purchase, approvals, receipt, movement, and continuation.

## Stabilization Backlog

1. Automated tests
2. Version-controlled PostgreSQL bootstrap
3. ~~Idempotent development seed command~~ — done (R2.1)
4. Backup revalidation
5. Restore test documentation
6. Real signed URL implementation or renaming
7. MinIO/S3 plan
8. Workflow-engine source-of-truth decision
9. Resolve workflow-only manager roles
10. Requester confirmation action
11. Cancel action
12. General reopen action
13. Formal purchase-order scope
14. Construction workflow scope

## Future Architecture Backlog

- Monorepo
- NestJS backend
- Redis/Valkey
- MinIO/S3
- Realtime gateway
- Background worker
- Multi-instance deployment
- API versioning

## Open Questions

1. Are Production, Factory, and Purchase Manager approvals required?
2. When should inventory checking be enabled?
3. Who performs requester confirmation?
4. Is requester confirmation mandatory before closure?
5. What is the cancellation policy?
6. Which statuses can be reopened?
7. Should shortages automatically create parts requests?
8. Should shortages automatically create purchase requests?
9. Is formal purchase-order management required?
10. Is Construction Project Request in scope?
11. Should the workflow engine replace status strings?
12. What is the target deployment environment?
13. When should local storage move to MinIO/S3?
14. What backup retention and recovery objectives are required?

## Architecture Decisions

- Custom local auth remains active.
- Local filesystem remains active for development and single-instance deployment.
- Status strings remain the operational source of truth.
- Workflow engine remains a tracking/future layer.
- SSE remains the active notification realtime method.
- Recovery and verification take priority over broad new features.

## Session Notes

- The previous operational database was not recovered.
- Current DB contains migration-seeded demo assets, parts, work orders, and audit data.
- Two usable accounts exist.
- Super Admin was recreated manually.
- Inventory checking is off.
- The project runs locally.
- Next coding begins after missing role users and a controlled lifecycle test are prepared.
