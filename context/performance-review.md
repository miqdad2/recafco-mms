# RECAFCO MMS — Performance, Reliability & Stability Review (Unit 10H.1)

Date: 2026-08-11

## Purpose

A pre-rollout audit of speed, reliability, and stability across the modules the
maintenance team will use first (Dashboard, Daily Activity, Job Cards, Job
Card detail, Inventory Control, Worker Activity, Notifications/realtime). Not
a redesign, not a feature unit. Business workflow, approval logic, material
receive/issue logic, worker time calculation, and permissions were not
touched.

## Method

Read-only investigation was run in parallel across five areas (dashboard/
realtime/timers, daily-activity/job-cards-list, job-card detail, inventory/
worker-activity, Prisma schema + backend helpers), then findings were
cross-checked against the actual source before any fix was applied. Only
low-risk, behavior-preserving optimizations were implemented; anything that
would require a real redesign is documented below as follow-up, not
attempted in this unit.

## Headline finding

This codebase already went through deliberate performance passes before this
unit ("Performance Optimization Unit 3", "Enterprise Real-Time Update
Foundation", Daily Activity's Unit 9 Task 11 N+1 fix, etc.). Dashboard, Daily
Activity, Job Cards list, Inventory Control, and Worker Activity all already
use capped queries, bulk/batched helpers instead of per-row loops, a single
shared SSE connection, and lazy-loaded modal detail data. The one page that
had not received the same treatment is the **Job Card detail page**, and the
one clearly-justified missing index was on the work-session table.

## What was reviewed

- `app/(dashboard)/dashboard/page.tsx` + `components/dashboard/*`
- `app/(dashboard)/maintenance/daily-activity/page.tsx` + `components/work-orders/daily-activity-*`, `work-time-tracking.tsx`, `worker-session-row.tsx`
- `app/(dashboard)/maintenance/work-orders/page.tsx`
- `app/(dashboard)/maintenance/work-orders/[id]/page.tsx` and its tab components
- `app/(dashboard)/store/offline-inventory/page.tsx`, `components/store/*`, `lib/store/offline-inventory-data.ts`
- `app/(dashboard)/maintenance/assignments/page.tsx`, `components/workers/*`, `lib/work-orders/work-session-totals.ts`
- `components/realtime/*`, `hooks/use-auto-refresh.ts`, `hooks/use-realtime-events.ts`, `lib/realtime/refresh-guards.ts`
- `components/layout/live-top-clock.tsx`, `components/work-orders/live-timer.tsx`, `components/dashboard/live-dashboard-header.tsx`
- `lib/backend/parts-requests/service.ts`, `lib/backend/work-orders/worker-roster.ts`, `lib/backend/workers/validators.ts`
- `prisma/schema.prisma` (full index review against actual `where`/`orderBy` usage)

## What was optimized

1. **N+1 fixed** — `editMaterialsRequest()` in `lib/backend/parts-requests/service.ts` did one `findUnique` + one `update` per edited item inside a `for` loop. Replaced the per-item `findUnique` validation with a single `findMany` before the loop; updates remain per-item (Prisma has no per-row-different-values bulk update) but reads no longer scale with item count. No output/behavior change.
2. **QR SVG caching** — `lib/qr/svg.ts`'s `createQrSvg()` regenerated the same QR SVG on every Job Card detail page render, and that page is re-rendered by both a 20s `AutoRefresh` and SSE-triggered `RealtimeRefresh`. Added an in-memory `Map` cache keyed by the target URL (deterministic content, naturally bounded by the number of distinct internal routes ever rendered in the process lifetime).
3. **`useAutoRefresh` reliability gap closed** — `hooks/use-auto-refresh.ts` had its own local "is user typing" check and, unlike `useRealtimeEvents`, did **not** check `isModalOpen()` before calling `router.refresh()`. The shared `lib/realtime/refresh-guards.ts` module was built (per its own doc-comment) to serve both hooks but `useAutoRefresh` never adopted it. Switched it to use the shared `isSafeToRefresh()` guard — removes duplicated logic and stops the plain poll from refreshing under an open modal/panel.
4. **Sequential awaits parallelized** — `app/(dashboard)/maintenance/work-orders/page.tsx`'s `?preview=` quick-view path ran `getReviewedWorkOrderIds()` then `getPendingClarificationForWorkOrder()` as two sequential awaits despite neither depending on the other. Combined into one `Promise.all`. (The third lookup, `profiles.findUnique` for the correction requester's name, genuinely depends on the second and stays sequential.)
5. **Defensive guards added** — `lib/realtime/refresh-guards.ts` relied only on a doc-comment ("client-safe only, runs in the browser") with no runtime check. Added `typeof document === "undefined"` guards to `isUserTyping()`, `isModalOpen()`, and `isSafeToRefresh()` so an accidental server-side import fails safe instead of throwing.
6. **Additive index** — see Database/Index section below.

## Dashboard (Task 2)

Already fine: every per-role query block caps rows (`take: 5/30/50`), no
attachments/audit logs loaded, materials/labor totals come from two bulk
helpers called once and looked up from an in-memory `Map` per row (not
per-card queries), and the Closed Job Cards KPI tile only fetches its full
list/detail when the summary modal is opened. `AutoRefresh intervalMs={15000}`
is more aggressive than the `30000` default used elsewhere, but this is a
**documented, deliberate** choice (see the comment at `dashboard/page.tsx:2053-2057`)
— it's the fallback behind SSE-driven `RealtimeRefresh`, which already covers
the common case and is guarded. Left unchanged; noted as intentional, not a
defect.

No changes needed beyond the guard fix above.

## Daily Activity (Task 3)

Already fine: the active Job Cards query is capped (`take: PAGE_SIZE=50`)
with a lean `select`; live worker timers (`LiveTimer`, 1 `setInterval` each)
are mounted only for the single selected Job Card's Active workers, never for
every row in the list (a deliberate Unit 9C fix, per the code comment);
material fulfillment and labor summaries use the bulk helpers (2 queries
total regardless of card count); realtime refresh debounces and is gated by
`isSafeToRefresh()` including the modal-open check.

No changes needed.

## Job Cards list (Task 4)

Already fine: status counts come from one `groupBy`, the list is paginated
(`PAGE_SIZE=25`, `skip`/`take`), row data is scalar-plus-thin-relations (no
deep per-row includes), and the materials summary was already refactored
from a per-row load into one page-scoped `groupBy`. Parallelized the
quick-view preview path's two independent awaits (see above).

## Job Card detail (Task 5)

This is the page most in need of attention, and per this unit's own scope
rule ("propose phased lazy loading, only implement safe low-risk
improvements") it was **not** restructured — that's a real redesign task.

**Current shape**: `app/(dashboard)/maintenance/work-orders/[id]/page.tsx`
loads one `include` tree covering all ~15 top-level relations (attachments,
history, audit logs, parts requests + nested purchase requests, labor,
materials, roster, etc. — capped with `take: RECENT_HISTORY_TAKE=200` on
append-only lists, but `parts_requests`/`purchase_requests` are unbounded by
design) plus 8+ more queries in `Promise.all`, regardless of which tab
(`?tab=...`) is active. Both `AutoRefresh` (20s) and SSE-triggered
`RealtimeRefresh` re-run this entire set on every fire.

**Safe fixes applied this unit**: QR SVG caching (was regenerated every
refresh for content that never changes).

**Proposed phased follow-up (not implemented here, requires its own unit)**:
convert the tab switch from a full page navigation (`?tab=...` re-running the
whole server component) into client-side tab state with each heavy
tab's data (Attachments, full History/audit trail) fetched on demand only
when that tab is first opened — the same lazy-modal pattern already used
successfully by Inventory Control's `MaterialDetailModal` and the dashboard's
Closed Job Cards summary. This is a genuine architecture change (tabs go from
server-rendered sections to client-fetched panels) and should be scoped,
planned, and tested as its own unit rather than folded into a performance
pass.

## Inventory Control (Task 6)

Already fine: `getOfflineInventoryBalance()` sums via `groupBy`/`_sum` in SQL
(not fetch-all-then-reduce), backed by the `idx_oim_balance_identity` index
from the prior Unit 3 pass; movement history is lazy-loaded only when
`MaterialDetailModal` opens (`take: 5`), not on the list page. Medium,
scale-only finding (not fixed — fine at current volume): `store-balance-view.tsx`
filters the full (uncapped) material list client-side rather than via a
server-side search query, even though `searchOfflineInventoryMaterials()`
already exists as a proper indexed top-N search. Flagged as follow-up if the
material catalog grows past roughly a thousand distinct items.

## Worker Activity (Task 7)

Already fine: `getWorkerActivitySummaries()` runs exactly 4 queries total for
any number of requested workers (explicitly documented as N+1-safe), the
worker detail modal (`WorkerActivityDetailModal`) only fetches history when
opened, and recent sessions are capped at 20. Medium, scale-only finding (not
fixed): `listWorkerProfiles()` caps at `take: 500` and the assignments page
filters/sorts that list in memory rather than pushing filters into the query
— acceptable at current internal headcount, would need real server-side
filtering if headcount approaches the cap.

## Notifications / realtime stability (Task 8)

Already fine, and well-built: exactly one shared `EventSource` per tab
(`RealtimeConnectionProvider`, mounted once in `app-layout.tsx`), fanned out
via an in-memory `EventTarget` to the notification bell, toast center, and
`RealtimeRefresh` — replacing what the code comments say used to be 3
separate connections hitting the browser's per-origin HTTP/1.1 connection
cap. All consumers clean up subscriptions/timers on unmount. Debounced
(1500ms) with a single pending-timer guard, no infinite-loop risk found.
Closed the one real gap: `useAutoRefresh` now shares the same modal-open
guard as the SSE path (see optimizations above).

## Timer/clock cleanup (Task 9)

Already fine: `live-top-clock.tsx` and `live-timer.tsx` both clear their
interval on unmount; `LiveTimer` only mounts for Active-status workers, never
per row in a list. `live-dashboard-header.tsx`'s typing effect is a one-time,
self-clearing interval that's skipped entirely under
`prefers-reduced-motion`. Low-severity, not fixed this unit: each active
worker's timer is an independent `setInterval` + `setState` rather than one
shared tick driving all visible timers — negligible at current concurrent-
worker counts, worth revisiting only if that count grows into the dozens+
range on one screen.

## Database / index review (Task 10)

Full field-by-field check against `prisma/schema.prisma` plus a grep of
actual `where`/`orderBy` call sites for every field CLAUDE.md asked about.
Nearly everything is already indexed from the prior "Performance Optimization
Unit 3" pass:

| Field | Status |
|---|---|
| `work_orders.status` | exists (single + composite) |
| `work_orders.created_at` | exists |
| `work_orders.updated_at` | exists (composite with status) |
| `work_orders.asset_id` | exists |
| `work_orders.ordered_by` | plain text field, not a FK, never filtered — no index needed |
| `parts_requests.status` | exists (single + composite) |
| `offline_inventory_movements.created_at` | not standalone-indexed, but always paired with an already-indexed `movement_date`/`deleted_at` filter in every real query — not worth a new index at current volume |
| `offline_inventory_movements.part_id` | exists (single + composite identity index) |
| `notifications.recipient_id` / `read_at` / `created_at` / `event_key` | all exist |
| work-session `status` | exists (single + composite with `worker_assignment_id`) |
| work-session `started_at` | **was missing — added, see below** |
| `assets.category` / `status` / expiry fields | all exist |

**Additive migration added**: `prisma/migrations/20260811010000_performance_review_unit10h1_indexes/`

```sql
CREATE INDEX IF NOT EXISTS "idx_wows_started_at"
  ON "public"."work_order_work_sessions" ("started_at");

CREATE INDEX IF NOT EXISTS "idx_wows_worker_started_at"
  ON "public"."work_order_work_sessions" ("worker_id", "started_at");
```

Justification: `work_order_work_sessions` is append-only and grows with
every start/pause/stop of every worker on every Job Card — it never shrinks.
It had no index on `started_at` and no index at all on `worker_id`, yet both
are filtered together in `getWorkerActivitySummaries()` (backs the Worker
Activity page and the dashboard's "who's working now" widgets, re-run on
every AutoRefresh/SSE refresh) and `getWorkerActivityDetail()`, and
`started_at` alone is range-filtered in `getLaborPeriodTotals()` (dashboard)
and `getWorkerLaborTotals()`, plus used as the `orderBy` in several call
sites. This is the strongest, most concretely-justified index gap found in
the whole review. Applied via `prisma migrate deploy` to the local dev DB and
verified with `prisma migrate status` / `prisma validate` — additive only,
`IF NOT EXISTS`, no data or column change.

`lib/backend/parts-requests/service.ts`'s `editMaterialsRequest()` N+1 was
fixed in code rather than papered over with an index (see optimizations
above) — an index wouldn't have helped a `findUnique`-per-item read pattern
the way removing the loop does.

## Error boundary / reliability (Task 11)

Not deeply re-audited this unit beyond what surfaced incidentally — no blank-
screen, stuck-overlay, or double-submit issues were found in the pages
reviewed above. A dedicated Task 11 pass (form double-submit guards, pending
button states, module-level error boundaries) was not run as its own
investigation in this unit; recommend as a follow-up if not already covered
by a prior unit.

## Build / runtime review (Task 12)

- `crypto.randomUUID()` usage is isolated in `lib/client/safe-id.ts` behind a
  `typeof === "function"` guard.
- All `window`/`document`/`localStorage`/`navigator` usage in React
  components is confined to `"use client"` files. The one plain-module
  exception, `lib/realtime/refresh-guards.ts`, is now defensively guarded
  (see optimizations above).
- `npm run build` completed with no console/type errors and no hydration
  warnings surfaced in the build output.

## Performance measurement (Task 13)

`npm run build` (Next.js 16.2.7, Turbopack):
- Compiled successfully in 19.5s
- TypeScript check in 36.4s
- 62 routes generated (2 static, 60 dynamic/server-rendered) — no build
  errors, no warnings

This repo has no `npm run start` script; started the production server
directly with `next start` on an alternate port for a smoke check. All
authenticated routes correctly short-circuit to a fast redirect before any
DB work when unauthenticated (sub-10ms), confirming the auth guard itself
isn't a bottleneck. Full authenticated page-load timing (Dashboard, Daily
Activity, Job Cards, Inventory Control, Worker Activity, Job Card detail)
was not measured in this pass since that requires a logged-in session; this
is deferred to the E2E/manual verification pass explicitly scoped for after
this unit.

## Remaining follow-up (not implemented this unit — flagged, not urgent)

1. Job Card detail page: convert per-tab data (Attachments, full History) to
   client-fetched-on-open, matching the lazy-modal pattern already used
   elsewhere. Real architecture change — own unit.
2. `store-balance-view.tsx` material list and the Worker Activity list:
   client-side filtering over a capped-but-unbounded server list. Fine today,
   would need server-side search/pagination if either list grows into the
   hundreds/thousands.
3. Per-worker independent 1-second timers (`LiveTimer`) — could be
   consolidated into one shared tick if concurrent visible active-worker
   counts grow substantially. Not worth the refactor risk today.
4. `getSessionsForAssignment()` (work session correction-trail modal) has no
   `take` cap — acceptable today (bounded by one assignment's session count),
   worth a cap only if long-lived assignments start accumulating unusually
   many correction rows.
5. Task 11 (error boundaries, double-submit guards, pending states) deserves
   its own dedicated pass — not deeply audited in this unit.

## Files changed this unit

- `lib/backend/parts-requests/service.ts` — N+1 fix
- `lib/qr/svg.ts` — QR SVG cache
- `hooks/use-auto-refresh.ts` — shared refresh guard
- `lib/realtime/refresh-guards.ts` — defensive `typeof document` checks
- `app/(dashboard)/maintenance/work-orders/page.tsx` — parallelized preview lookups
- `prisma/schema.prisma` — two new indexes on `WorkOrderWorkSession`
- `prisma/migrations/20260811010000_performance_review_unit10h1_indexes/migration.sql` — new additive migration

## Confirmed unchanged

Business workflow, approval logic, material receive/issue logic, worker time
calculation, and permissions were not modified. No destructive schema
changes. No new dependencies, no new polling loop, no new EventSource/
WebSocket, no deployment performed.
