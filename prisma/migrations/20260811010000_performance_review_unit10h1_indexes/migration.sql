-- Performance, Reliability, and Stability Optimization Review Unit 10H.1.
--
-- Additive only — CREATE INDEX IF NOT EXISTS, no data change, no column/table
-- change, nothing dropped.
--
-- work_order_work_sessions is an append-only, ever-growing table (one row
-- per start/pause/stop per worker per Job Card) that previously had no index
-- on started_at or worker_id at all. It is filtered/sorted by started_at in
-- several hot, frequently-re-run paths:
--   - lib/work-orders/work-session-totals.ts getWorkerActivitySummaries()
--     (Worker Activity page + dashboard "who's working now" widgets):
--     `where: { worker_id: { in }, status: {...}, started_at: { gte } }`
--     via groupBy, run for today AND month totals on every page load.
--   - lib/work-orders/work-session-totals.ts getWorkerActivityDetail()
--     (worker detail modal): `where: { worker_id, started_at: { gte } }`.
--   - lib/work-orders/work-session-totals.ts getLaborPeriodTotals() /
--     getWorkerLaborTotals(): plain `started_at: { gte/lte }` range filters.
--   - Several `orderBy: { started_at: "desc" }` call sites.
--
-- idx_wows_started_at serves the plain started_at range/sort queries.
-- idx_wows_worker_started_at serves the worker_id + started_at combined
-- filter used by the Worker Activity summaries (the most frequently re-run
-- query in this set, since it backs both the Worker Activity page and the
-- dashboard's worker widgets and is re-triggered by AutoRefresh/SSE refresh).
--
-- Plain CREATE INDEX (not CONCURRENTLY) is safe to run as-is at this
-- system's current data volume (tens of work orders, zero technician
-- assignments recorded live yet per CLAUDE.md's verified baseline) — the
-- brief write-lock during index build is negligible at this size. If this
-- migration is deferred and applied after substantial production data
-- growth, run the CREATE INDEX statements below manually with CONCURRENTLY
-- first (outside a transaction) instead of a blind `prisma migrate deploy`.

CREATE INDEX IF NOT EXISTS "idx_wows_started_at"
  ON "public"."work_order_work_sessions" ("started_at");

CREATE INDEX IF NOT EXISTS "idx_wows_worker_started_at"
  ON "public"."work_order_work_sessions" ("worker_id", "started_at");
