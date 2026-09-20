# RECAFCO quality and performance assessment — 13 September 2026

**Assessment: a substantial working application with a viable foundation, but not ready for enterprise sign-off. Fix the access-control and work-session integrity findings before expanding use.** The user expects 50–100 concurrent employees on a Windows office-server VM. The measured local performance is encouraging only for the small dataset tested; it does not establish production capacity.

This was an assessment, not a remediation release. No application behavior, schema, inventory, worker records, job cards, or feature flags were changed. Ordinary test logins created session/audit activity. A separate production-mode Next.js instance was launched on loopback port 3107 for testing. The office VM itself was not accessed or benchmarked.

## Executed checks

| Check | Result | What it establishes |
|---|---|---|
| `npm run db:check` | Pass | PostgreSQL accepts SELECT 1; not a full integrity check |
| `npm run lint` | Pass, no reported warnings/errors | Current configured ESLint rules pass; scripts are excluded |
| `npm run typecheck` | Pass | TypeScript compilation passes |
| `npm run build` | Pass | Production compilation and route generation succeed |
| `npm audit --omit=dev --json` | 0 reported vulnerabilities | Registry advisory check of production dependencies |
| `npm audit --json` | 0 reported vulnerabilities | Registry advisory check including development dependencies |
| Existing Playwright permission suite | **2 pass, 1 fail** | Worker Profiles and dashboard UI restrictions pass; wizard test times out finding AST-VEH-0043 |
| Authenticated runtime probes | Both Data Entry and Manager log in; 12 role/route combinations return 200 | Six representative pages per role are reachable |
| Payload inspection | **Salary/rate disclosure reproduced** | Hidden UI does not prevent confidential values reaching Data Entry |
| Synthetic helper probes | **3 security conditions reproduced** | Cost-deny bypass and two invalid path-containment cases |
| Authenticated concurrent HTTP probes | 320/320 responses HTTP 200 | Short read bursts at 10, 50, and 100 concurrent requests per role |

The first sandboxed build failed to fetch the configured Inter font from Google. The permitted network retry passed. This is an external build dependency, not a demonstrated TypeScript/build defect. The documentation claiming there is no external font is stale.

The Playwright failure occurred at `tests/e2e/permissions.spec.ts:31`, waiting for the hardcoded asset picker fixture. It did not reach the cost assertion. The two UI passes do not invalidate the independently reproduced payload disclosure.

## Environment and scope

- Current packages: Next.js 16.2.7, React 19.2.7, Prisma 6; not the Next.js 15 baseline in the supplied overview.
- Local test machine: Intel i7-1165G7, 8 logical CPUs, 16 GiB RAM. Client and server ran on this same machine.
- Local DB snapshot before runtime probes: 11 profiles, **0 work orders**, 171 assets, 2 worker profiles, 0 work sessions, 21 offline inventory movements, 2 notifications, 3 realtime events.
- `inventory_check_enabled` remains false.
- Source inventory: 363 TypeScript/TSX files and approximately 74,017 lines in app/components/lib/hooks, including comments and blank lines.
- Review covered authentication, permissions, file access/storage, session tracking, workflow/transaction paths, materials processing, reports/exports, realtime, build/configuration, tests, and backup documentation. This is a broad targeted review, not a proof that every source line or every possible execution path is correct.
- Historical recovery figures and several architecture/UI/workflow descriptions conflict with current code and DB. They were not treated as current operational facts.

## Findings, ordered for remediation

### 1. P1 — Salary and hourly-rate values reach unauthorized client payloads

**Reproduced using a real Data Entry login.** `/maintenance/work-orders/new` returns nonzero `basic_salary`/`total_salary` and `hourly_rate` values in its serialized response. `/admin/worker-profiles` hides the hourly-rate column but still returns nonzero hourly rates. Values were checked in memory; actual salary figures are not included in these artifacts.

`lib/backend/workers/service.ts:35` leaves `hourly_rate` untouched when stripping salary fields. Its assignment helper returns complete worker rows. `app/(dashboard)/maintenance/work-orders/new/page.tsx:25` passes those rows directly into the client wizard. Other wizard entry points also use this helper, although not all were separately exercised.

**Change:** return role-aware worker DTOs with only the fields that the particular client needs. Apply cost authorization before serialization, including assignment pickers and session/labor summaries. Do not make browser components responsible for confidentiality.

**Acceptance:** inspect HTML/RSC and server-action responses with costs denied; no confidential fields or nonzero cost values should be sent. Test Data Entry, explicit-deny users, Managers, and Super Admin.

### 2. P1 — Session-history action lacks entity and cost authorization

**Verified by code tracing; no live session records were available to reproduce disclosure.** `app/actions/work-sessions.ts:134` authenticates with `requireUser()` and returns `getSessionsForAssignment(workerAssignmentId)` without checking permission, assignment ownership, or work-order visibility. `lib/work-orders/work-session-totals.ts:431` queries the supplied assignment ID and returns `hourly_rate_snapshot`, `calculated_amount`, notes, and staff names.

Any signed-in caller who obtains an assignment identifier can reach this server action; a protected page containing its button is not an authorization boundary for the action itself.

**Change:** validate the identifier, load the parent job card with `getWorkOrderVisibilityFilter(context)`, require the intended read permission, and omit cost fields when denied.

**Acceptance:** an authenticated user outside the job-card scope cannot fetch its history; a visible job card still does not expose costs to a user without cost access.

### 3. P1 — Private-file authorization and path containment are incomplete

**Verified by code and pure resolver probes; no unauthorized real file was downloaded.** `app/api/files/[bucket]/[...path]/route.ts:61` permits any existing work order when the caller has `work_orders.view`, without the mandatory visibility filter or deleted-record exclusion. This can expose another department's/job-card owner's attachments when its URL is known.

The same route derives the authorized entity from the first segment before reading the normalized path. `lib/files/local-storage.ts:12` accepts `authorized-entity/../different-entity/file.pdf`. Its `startsWith(bucketRoot)` comparison also accepts a sibling directory whose name starts with the bucket name. Both containment failures were reproduced with synthetic paths. Whether every encoded HTTP variant survives the deployment proxy/router was not tested.

**Change:** reject dot segments and embedded separators, resolve against the authorized entity directory, use a boundary-safe relative-path check, and enforce the same entity visibility as the page. Validate against stored attachment metadata rather than trusting an arbitrary storage path.

**Acceptance:** negative tests for other entities, soft-deleted records, dot segments, encoded separators, double decoding, and sibling-prefix directories.

### 4. P1 — Explicit cost deny can be overridden by the profile flag

**Reproduced by executing the actual permission helper with synthetic context.** `lib/auth/context.ts` removes denied permissions, but `lib/security/permissions.ts:12` subsequently ORs the result with `profile.can_view_costs`. With an empty resolved permission list and that flag true, `canViewCosts()` returns true. This violates the documented deny-wins rule.

`lib/reports/data.ts:58` defines a second cost helper with a different rule, accepting finance/cost-report permissions as alternatives. Cost policy is therefore inconsistent across modules.

**Change:** have a single effective cost policy after overrides are evaluated, preserving the Super Admin bypass. Explicitly define how report permissions interact with cost denial.

**Acceptance:** a permission truth table covering role grants, profile flag, allow, deny, and Super Admin, applied to both page and action payloads.

### 5. P1 — Reports do not apply the mandatory job-card visibility scope

**Verified by code tracing.** `lib/reports/data.ts:103` accepts only filters, with no user context, and queries all matching work orders. Both `app/(dashboard)/reports/work-orders/page.tsx` and `app/api/exports/[kind]/route.ts` call it. Their special Maintenance Manager department filter is not the shared visibility policy for other roles. Data Entry reached the report page in the runtime probe, but the empty local work-order table prevented a live cross-record test.

**Change:** require context and AND the shared visibility filter into report queries and exports. Keep UI filters subordinate to authorization.

**Acceptance:** create owned and foreign job cards in an isolated test DB; compare list, report, and export results for every supported role and override combination.

### 6. P1 — Work-session start/closure rules do not protect against conflicting operations

**Verified by code and live index inspection; not exercised with business-data writes.** `lib/backend/work-orders/work-sessions.ts:150` checks for an Active session and then inserts one. The transaction uses default isolation; there is no assignment lock or conditional insert. The live DB has no partial unique index limiting each assignment to one Active session. Two simultaneous starts can both pass the read.

Separately, `loadOpenWorkOrder` rejects only Closed, allowing starts while closure is requested. `lib/backend/work-orders/service.ts:1101` approves closure by checking the pending-closure status and updating it to Closed, without rechecking active sessions/material readiness. A session can start after closure is requested and remain Active when closure is approved. A check when requesting closure does not protect the later approval.

**Change:** coordinate start/stop/closure with a common job-card/assignment locking policy, a partial unique Active-session constraint, allowed-status validation, and final readiness checks inside the closure transaction. Use conditional updates for conflicting stop/pause transitions.

**Acceptance:** simultaneous starts yield exactly one Active row; starting after closure request is rejected or closure approval blocks; competing start/close operations cannot produce a closed job with an active timer.

### 7. P2 — Operational reports still use obsolete workflow statuses and mask failures

`app/(dashboard)/reports/work-orders/page.tsx:230` selects legacy `Waiting for Parts`, `Waiting for Purchase`, and `Parts Issued`. The active simplified materials flow uses `Waiting Materials`, `Partially Issued`, and `Materials Issued`. The current waiting-material report can omit relevant jobs. Several summaries use the same old vocabulary.

`lib/reports/data.ts:156` and other report queries catch database errors and return empty arrays, presenting query failures as apparently valid zero-record reports.

**Change:** derive report groups from the active shared status definitions, preserve needed legacy coverage explicitly, and show a distinguishable report-load failure.

**Acceptance:** fixtures for each current status appear in the intended report; a forced query failure displays an error rather than zero work orders/costs.

### 8. P2 — Long-lived SSE streams do not revalidate sessions

`app/api/notifications/stream/route.ts:118` authenticates once, then polls indefinitely for the captured user ID. Revocation, expiration, or deactivation does not cause that already-open stream to reauthenticate. Subsequent notification titles/events can continue to be delivered until disconnect.

Its time cursors are advanced before reads, and reads have fixed 10/20-row limits. Bursts above those limits or failed reads can drop stream events. Records remain in the database; this is a delivery/refresh gap, not notification-row deletion.

**Change:** periodically revalidate or bound connection lifetimes, and use stable successful-read cursors with pagination or a reliable aggregate refresh signal.

**Acceptance:** revoke an active session and verify its stream closes; burst and interrupted-read tests must not silently miss relevant refreshes.

### 9. P2 — Public health endpoints expose raw database error messages

`app/api/health/route.ts` returns `databaseError: err.message`; `/api/health/database` similarly returns raw errors without authentication. Under failures these can disclose server/query/connection details. Healthy responses do not prove the failure path is safe.

**Change:** return a generic public failure status; retain diagnostics in protected logs/admin health tools.

### 10. P2 — Regression tests depend on mutable local fixtures and UI-only checks

The existing permission suite failed on its hardcoded asset fixture. It checks hidden cost text/columns, which passed while the payload actually exposed costs. The workflow suite also reuses existing worker/material records, and its helper contains plaintext test-account credentials. These credentials were accepted locally during this audit; whether they exist on the office VM was not checked and no credential values are reproduced here.

**Change:** dedicated isolated test database with deterministic setup/teardown; environment-provided test credentials; direct action/API and payload tests; concurrency tests. Keep test credentials out of the production identity set. Add unit/integration checks for policy, transitions, quantity arithmetic, time calculation, and database constraints.

## Measured performance

Production-mode HTTP requests downloaded complete uncompressed HTML bodies for a mix of `/dashboard`, `/maintenance/work-orders`, and `/maintenance/daily-activity`. Each burst reused one authenticated session for its role. There were no simulated user think times and no 100-browser session population. Two role series ran sequentially. These are **short concurrent-request probes, not a sustained 100-user load test**.

| Role | Concurrent requests | p50 | p95 | Throughput during burst | HTTP errors |
|---|---:|---:|---:|---:|---:|
| Data Entry | 10 | 160 ms | 165 ms | 60.4 req/s | 0 |
| Data Entry | 50 | 877 ms | 892 ms | 55.8 req/s | 0 |
| Data Entry | 100 | 2,092 ms | 2,178 ms | 45.8 req/s | 0 |
| Manager | 10 | 176 ms | 178 ms | 55.8 req/s | 0 |
| Manager | 50 | 957 ms | 968 ms | 51.5 req/s | 0 |
| Manager | 100 | 1,719 ms | 1,736 ms | 57.4 req/s | 0 |

Across the sequential six-page checks, measured full-response times ranged from 26–288 ms. The worker wizard returned roughly 220–222 KB of uncompressed HTML with 171 assets and only two workers. These are response-completion measurements, not LCP, INP, or browser-render timings.

### Scaling work indicated by code

1. Reports fetch complete matching datasets and calculate/filter in memory. Add bounded queries and server pagination; push aggregates and technician filters into SQL. Large exports need explicit limits or a controlled streaming/background path.
2. `lib/backend/work-orders/material-processing.ts:80` reads all historical movements for a material inside its transaction before calculating balances. History growth increases time holding locks. Use database aggregation and measure plans with realistic ledger volumes.
3. `getCurrentUserContext()` performs multiple sequential DB reads and is called independently by layout and page paths. Request-scoped memoization can eliminate repeated authorization loads without introducing stale cross-request permissions.
4. SSE executes approximately three DB reads per connection every 15 seconds: 100 open tabs imply approximately 20 queries/second before page refreshes, notification fallbacks, and other activity. The route's comment saying roughly six queries per 15 seconds for 50 users is inaccurate. Multiple tabs increase this further. Shared realtime connection infrastructure already exists and is a positive design choice.
5. Several pages are 2,000–2,900 lines. The codebase mixes service/repository layering with substantial page-level querying, duplicated authorization helpers, and historical implementation commentary. Extract cohesive query/DTO/policy modules after behavior tests exist; a framework rewrite is not required to fix the demonstrated issues.

## Enterprise deployment and verification gate

The current single-instance Node/PostgreSQL/local-disk model is compatible with the stated Windows VM setup in principle. This audit did not inspect VM CPU/RAM allocation, IIS/reverse proxy, HTTPS, Windows service supervision, PostgreSQL connection limits, endpoint protection impact, storage latency, or actual backup schedules.

Backup tooling and restoration documentation exist. The DB backup script covers PostgreSQL, while the documentation separately explains backing up `uploads/`. Verify that **both are actually scheduled and restorable together**; the presence of documentation is not a tested recovery result. No backup archive was created, deleted, or restored in this assessment.

Before enterprise sign-off:

1. Resolve P1 confidentiality, entity-scope, and session-integrity findings, with regression tests.
2. Run the full create → materials receive/issue → timer → closure workflow on an isolated, representative database. Test denied operations, rollback/failure paths, duplicate requests, and concurrency. The full mutating suite was not run against this local operational DB because it reuses existing stock/worker fixtures and is not isolated.
3. Correct stale report statuses and make test fixtures repeatable. Keep a passing CI build/lint/typecheck plus service/integration/E2E checks.
4. Benchmark on a staging VM matching the office VM with representative years of job-card/material/session history. Run 50 then 100 distinct users with realistic think times, SSE connections, report/export activity, uploads, and writes for at least 30–60 minutes. Record p95/p99, error rates, CPU, resident memory, event-loop lag, pool wait, SQL timings/locks, and disk latency. Include a longer soak run for growth/leaks.
5. Agree response-time and recovery targets with the company before declaring pass/fail. An initial target could be p95 under two seconds for ordinary page interactions under the agreed workload, subject to business acceptance; this is a proposed target, not a measured production guarantee.
6. Verify TLS, production cookie behavior, service restart after VM reboot, coordinated DB/upload backup, and an actual restore drill.

## Artifacts and reproduction

- `docs/quality-audit-20260913-results.json`: raw non-sensitive DB counts, page probes, and load measurements.
- `docs/quality-audit-20260913-security-probes.json`: synthetic containment and permission results.
- `scripts/quality-audit-20260913.mjs`: local-only read probes; requires the production app at 127.0.0.1:3107, installed Chromium, `.env`, and the existing local test accounts. Logins write normal auth records.
- `scripts/quality-audit-security-20260913.mjs`: executes existing pure helpers with synthetic inputs; no DB writes or attachment reads.
- Existing browser failure artifacts: `test-results/quality-audit-20260913/` (gitignored).

No exhaustive penetration test, accessibility audit, all-role lifecycle test, production load test, sustained SSE test, or restore drill was completed. No production-readiness certification is implied by passing compilation or the zero-vulnerability dependency audit.
