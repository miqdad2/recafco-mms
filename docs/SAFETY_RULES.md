# RECAFCO MMS — Development Safety Rules

These rules exist to protect a production-intended system from accidental breakage.  
Every developer and AI assistant working on this codebase must follow these rules.

---

## Rule 1 — Build must pass before any commit

```bash
npm run typecheck   # must exit 0
npm run lint        # must exit 0
npm run build       # must complete without errors
```

**Never commit code that fails any of these three checks.**  
If a check fails, fix only the specific error reported. Do not do broad cleanup or refactoring.

---

## Rule 2 — No schema change without a database backup

Before changing `prisma/schema.prisma` or applying any SQL migration:

1. Take a database backup using `scripts/backup-db.ps1`.
2. Confirm the backup file exists and is non-zero in size.
3. Apply the migration to a local copy first before running against production.
4. Run `npm run prisma:generate` after any schema change.
5. Run `npm run build` to confirm the app still compiles.

**Never run destructive SQL (DROP TABLE, TRUNCATE, DROP COLUMN) without a verified backup.**

---

## Rule 3 — No auth or session change without a login test

The authentication system is custom and session-based (`auth_users`, `auth_sessions`, cookie).  
It has no external provider to fall back on.

Before changing anything in:
- `lib/auth/context.ts`
- `lib/auth/session.ts`
- `lib/auth/password.ts`
- `lib/auth/constants.ts`
- `proxy.ts` (middleware)

You must manually verify after the change:
1. Login with a valid user — succeeds and lands on `/dashboard`.
2. Login with a wrong password — fails with the correct error message.
3. Access a protected route without a session cookie — redirects to `/login`.
4. Session cookie is `httpOnly` and not visible in browser JavaScript.

Do not change the cookie name, hash algorithm, or session table structure without full regression testing.

---

## Rule 4 — No workflow change without explicit approval

The approval workflow state machine in `lib/workflows/status-rules.ts` controls:
- Work order status transitions
- Parts request status transitions
- Purchase request status transitions

Changing an allowed transition, adding a new status, or removing a status may silently break:
- Dashboard KPI counts
- Role-based visibility filters
- Print layouts that display status history
- Notification events triggered on status change
- Audit log entries

Before changing `lib/workflows/status-rules.ts`:
1. Document the proposed change and the reason.
2. Identify every location that reads or checks the affected status value.
3. Get explicit approval from the project lead.
4. Test the full workflow path manually end-to-end.

---

## Rule 5 — Do not delete the LocalQueryClient adapter

The file `lib/db/local-query-client.ts` is a compatibility adapter that allows code written
in the Supabase JS client style (`supabase.from('table').select('*').eq('id', x)`) to work
against the local PostgreSQL database through Prisma.

It is referenced by 67+ call sites across the codebase via:
- `createSupabaseServerClient()` in `lib/supabase/server.ts`
- `createSupabaseAdminClient()` in `lib/supabase/admin.ts`

**Do not delete or modify this adapter until every call site has been migrated to direct
Prisma calls and the build, typecheck, and lint checks all still pass.**

Migration progress must be tracked explicitly. Deleting the adapter before all 67+ usages
are replaced will cause an immediate runtime crash.

---

## Rule 6 — No large refactoring without a phase plan

"Large" means any change that touches more than 5 files or more than one module.

Large changes must:
1. Be broken into small, independently-buildable phases.
2. Have the first phase be purely additive (no deletions, no moves).
3. Keep the running app working at the end of each phase.
4. Have a rollback plan documented before starting.

---

## Rule 7 — No new dependencies without review

Before `npm install <package>`:
1. Check if the functionality already exists in the codebase (e.g., do not add a date library if `Date` is sufficient).
2. Check bundle size impact for client-side packages.
3. Check for security advisories (`npm audit`).
4. Do not install major framework packages (NestJS, Express, Fastify, Prisma migrations, Socket.IO) until the corresponding architecture phase is planned and approved.

---

## Rule 8 — Environment variables

`DATABASE_URL` and any secret keys must only exist in `.env` (git-ignored).  
They must never be:
- Hardcoded in source files
- Logged to the console (even in development)
- Committed to the repository

If you need to add a new environment variable:
1. Add it to `.env.example` with a placeholder value (no real secrets).
2. Document it in `docs/LOCAL_DEVELOPMENT.md`.

---

## Rule 9 — Do not modify database data through scripts without dry-run

Scripts that modify database data (like `scripts/set-local-password.mjs`) must be run
intentionally with correct arguments. Before running any script that writes to the database:

1. Read the script source to understand what it does.
2. Confirm you have the correct arguments.
3. If in doubt, run `npm run db:check` first to confirm you are connected to the right database.

---

## Quick reference checklist before pushing code

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes  
- [ ] `npm run build` passes
- [ ] No `.env` or secrets committed
- [ ] No `console.log` debug statements left in production code
- [ ] No hardcoded UUIDs or passwords
- [ ] `uploads/` is not tracked by git
- [ ] If schema changed: backup taken, `prisma:generate` run, build passes
- [ ] If auth changed: login flow manually tested
- [ ] If workflow changed: explicit approval obtained
