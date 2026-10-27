/**
 * Daily Activity Status Accuracy — HTTP integration checks for
 * /maintenance/daily-activity summary cards vs filtered lists.
 *
 * DESTRUCTIVE: soft-deletes every existing Job Card, then creates ZZDA-*
 * fixture Job Cards, workers, sessions and approvals. Run it ONLY against a
 * throw-away copy of the database, with a server started on that copy:
 *
 *   createdb recafco_da_status_test
 *   pg_dump --no-owner --no-privileges <source url> | psql <test db url>
 *   (apply prisma/migrations/20261026000000_job_card_submission_idempotency)
 *   npm run build
 *   DATABASE_URL=<test db url> npx next start -p 3007
 *   DA_VERIFY_DATABASE_URL=<test db url> DA_VERIFY_BASE_URL=http://localhost:3007 \
 *     node scripts/verify-daily-activity-status.mjs
 *
 * Refuses to run unless the database name contains "test".
 */

import { createHash, randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const DB_URL = process.env.DA_VERIFY_DATABASE_URL;
const BASE = (process.env.DA_VERIFY_BASE_URL ?? "http://localhost:3007").replace(/\/$/, "");

if (!DB_URL) {
  console.error("Set DA_VERIFY_DATABASE_URL to a throw-away test database.");
  process.exit(2);
}
const dbName = new URL(DB_URL).pathname.replace(/^\//, "");
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: DB_URL });
const results = [];

function record(id, name, pass, detail = "") {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
}

async function check(id, name, fn) {
  try {
    const detail = await fn();
    record(id, name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(id, name, false, error instanceof Error ? error.message : String(error));
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function sessionFor(roleSlug) {
  const rows = await prisma.$queryRaw`
    select p.id as profile_id, au.id as user_id
    from profiles p
    join roles r on r.id = p.role_id
    join auth_users au on au.profile_id = p.id
    where r.slug = ${roleSlug} and p.is_active and au.is_active and au.deleted_at is null
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error(`No active ${roleSlug} user in the test database.`);
  const token = randomBytes(32).toString("base64url");
  await prisma.auth_sessions.create({
    data: {
      user_id: row.user_id,
      profile_id: row.profile_id,
      session_token_hash: createHash("sha256").update(token).digest("hex"),
      user_agent: "verify-daily-activity-status",
      expires_at: new Date(Date.now() + 60 * 60_000),
    },
  });
  return { cookie: `recafco_session=${token}`, profileId: row.profile_id };
}

async function worker(name, worker_type = "Technician") {
  const created = await prisma.workerProfile.create({ data: { name, worker_type, hourly_rate: 1, skill_category: "Mechanical" } });
  return created.id;
}

async function jobCard(number, { status = "In Progress", createdBy, team = "Mechanical" }) {
  const wo = await prisma.work_orders.create({
    data: {
      work_order_number: number,
      status,
      ordered_by: "Verify Script",
      maintenance_type: "Repair",
      worker_type: team,
      operator_complaint: `Daily Activity verification ${number}`,
      created_by: createdBy,
    },
    select: { id: true },
  });
  return wo.id;
}

async function assign(workOrderId, workerId, { finished = false, role = "Technician" } = {}) {
  const a = await prisma.workOrderWorkerAssignment.create({
    data: { work_order_id: workOrderId, worker_id: workerId, worker_role: role, hourly_rate_snapshot: 1, status: finished ? "finished" : "active" },
    select: { id: true },
  });
  return a.id;
}

// Session rows written exactly the way lib/backend/work-orders/work-sessions.ts
// leaves them: Active (running), Paused (pause), Completed (finish while running).
async function session(workOrderId, assignmentId, workerId, sessionStatus, minutesAgo) {
  const started = new Date(Date.now() - minutesAgo * 60_000);
  await prisma.workOrderWorkSession.create({
    data: {
      work_order_id: workOrderId,
      worker_assignment_id: assignmentId,
      worker_id: workerId,
      started_at: started,
      hourly_rate_snapshot: 1,
      status: sessionStatus,
      paused_at: sessionStatus === "Paused" ? new Date(started.getTime() + 10 * 60_000) : null,
      stopped_at: sessionStatus === "Completed" ? new Date(started.getTime() + 10 * 60_000) : null,
      duration_minutes: sessionStatus === "Active" ? 0 : 10,
      calculated_amount: 0,
    },
  });
}

function kuwaitTodayStart(now = new Date()) {
  const offset = 3 * 3600_000;
  const day = 24 * 3600_000;
  return new Date(Math.floor((now.getTime() + offset) / day) * day - offset);
}

// ── Page reading ─────────────────────────────────────────────────────────────

const CARD_LABELS = {
  open: "Open Job Cards",
  working: "Working Now",
  paused: "Paused",
  ready: "Ready to Close",
  waiting: "Waiting for Approval",
  closed: "Closed Job Cards",
};

async function page(cookie, query = "") {
  const res = await fetch(`${BASE}/maintenance/daily-activity${query ? `?${query}` : ""}`, { headers: { cookie }, redirect: "manual" });
  assert(res.status === 200, `GET ${query || "(no filter)"} returned ${res.status}`);
  const html = await res.text();
  const counts = {};
  for (const [key, label] of Object.entries(CARD_LABELS)) {
    const m = html.match(new RegExp(`>(\\d+)</p><p class="mt-1 truncate text-xs font-bold leading-tight text-\\[#374151\\]">${label}</p>`));
    assert(m, `summary card "${label}" not found`);
    counts[key] = Number(m[1]);
  }
  const workersWorking = Number(html.match(/>(\d+) workers? working</)?.[1] ?? NaN);
  const workersPaused = Number(html.match(/>(\d+) workers? paused</)?.[1] ?? NaN);
  const rows = [...html.matchAll(/<span class="min-w-0 flex-1 truncate text-\[13px\][^"]*">([^<]+)<\/span>/g)].map((m) => m[1]).sort();
  const emptyTitle = html.match(/<h3 class="mt-3 text-sm font-bold text-\[#111827\]">([^<]+)<\/h3>/)?.[1] ?? null;
  return { html, counts, workersWorking, workersPaused, rows, emptyTitle };
}

const FILTER_FOR = { open: "", working: "status=working", paused: "status=paused", ready: "status=ready-closure", waiting: "status=waiting-approval", closed: "status=closed" };

// For every summary card: clicking it (its filter URL, same scope) lists
// exactly that many Job Cards.
async function assertCardsMatchLists(cookie, scope = "") {
  const base = await page(cookie, scope);
  for (const [key, filter] of Object.entries(FILTER_FOR)) {
    const q = [scope, filter].filter(Boolean).join("&");
    const p = await page(cookie, q);
    assertEqual(p.counts, base.counts, `counts stable on "${q || "all"}"`);
    // The list renders at most 50 rows ("Showing the first 50 of N"); the card counts all.
    assertEqual(p.rows.length, Math.min(base.counts[key], 50), `"${CARD_LABELS[key]}" card ${base.counts[key]} vs list rows (${p.rows.join(",")})`);
  }
  return base;
}

async function tableCounts() {
  const [wo, sessions, assignments, approvals] = await Promise.all([
    prisma.work_orders.findMany({ select: { id: true, status: true, updated_at: true } }),
    prisma.workOrderWorkSession.count(),
    prisma.workOrderWorkerAssignment.count(),
    prisma.approvals.count(),
  ]);
  return JSON.stringify({ wo, sessions, assignments, approvals });
}

// ── Checks ───────────────────────────────────────────────────────────────────

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  assert(health, `No server at ${BASE}`);

  const de = await sessionFor("maintenance_data_entry");
  const mgr = await sessionFor("maintenance_manager");
  console.log(`Test DB ${dbName}; server ${BASE}\n`);

  // Real (cloned) data first — the report's before/after example.
  await check("R", "Cloned real data: every summary card matches its list (Manager)", async () => {
    const p = await assertCardsMatchLists(mgr.cookie);
    return JSON.stringify({ ...p.counts, workersWorking: p.workersWorking, workersPaused: p.workersPaused });
  });

  // Clean slate: soft-delete every existing Job Card in the clone.
  await prisma.work_orders.updateMany({ where: { deleted_at: null }, data: { deleted_at: new Date() } });

  await check("1", "No Job Cards: all zero, honest empty state, Paused filter says nothing is paused", async () => {
    const all = await page(mgr.cookie);
    assertEqual(all.counts, { open: 0, working: 0, paused: 0, ready: 0, waiting: 0, closed: 0 }, "counts");
    assertEqual(all.emptyTitle, "No open Job Cards", "empty title");
    const paused = await page(mgr.cookie, "status=paused");
    assertEqual(paused.emptyTitle, "No paused Job Cards", "paused empty title");
  });

  const D = de.profileId;
  const M = mgr.profileId;
  const w = {};
  for (const n of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) w[n] = await worker(`ZZDA Worker ${n}`);
  const sup = await worker("ZZDA Supervisor", "Supervisor");

  // 2 — open, not started, no workers.
  const f2 = await jobCard("ZZDA-02", { status: "Approved", createdBy: D });
  // 3 — one worker currently working.
  const f3 = await jobCard("ZZDA-03", { status: "Assigned", createdBy: D });
  const a3 = await assign(f3, w.A);
  await session(f3, a3, w.A, "Active", 30);
  // 4 — one paused worker.
  const f4 = await jobCard("ZZDA-04", { createdBy: D });
  const a4 = await assign(f4, w.B);
  await session(f4, a4, w.B, "Paused", 60);
  // 5 — two paused workers on the same Job Card.
  const f5 = await jobCard("ZZDA-05", { createdBy: D });
  const a5a = await assign(f5, w.C);
  const a5b = await assign(f5, w.D);
  await session(f5, a5a, w.C, "Paused", 60);
  await session(f5, a5b, w.D, "Paused", 50);
  // 6 — historically paused, since resumed.
  const f6 = await jobCard("ZZDA-06", { createdBy: D });
  const a6 = await assign(f6, w.E);
  await session(f6, a6, w.E, "Paused", 120);
  await session(f6, a6, w.E, "Active", 20);
  // 7 — work finished, ready to request closure.
  const f7 = await jobCard("ZZDA-07", { createdBy: D });
  const a7 = await assign(f7, w.F, { finished: true });
  await session(f7, a7, w.F, "Completed", 90);
  // 8 — closure requested; both workers Finished from a PAUSED state (the
  // exact shape that produced the original "Paused 2 / empty list" bug).
  const f8 = await jobCard("ZZDA-08", { status: "Closure Requested", createdBy: D });
  const a8a = await assign(f8, w.G, { finished: true });
  const a8b = await assign(f8, w.H, { finished: true });
  await session(f8, a8a, w.G, "Paused", 100);
  await session(f8, a8b, w.H, "Paused", 95);
  // 9 — closed today (approval decided just now, and one just after Kuwait
  // midnight), and one closed one minute before Kuwait midnight (yesterday).
  const todayStart = kuwaitTodayStart();
  const f9 = await jobCard("ZZDA-09", { status: "Closed", createdBy: D });
  await prisma.approvals.create({ data: { work_order_id: f9, status: "Closed", decided_by: M, decided_at: new Date() } });
  const f9m = await jobCard("ZZDA-09M", { status: "Closed", createdBy: D });
  await prisma.approvals.create({ data: { work_order_id: f9m, status: "Closed", decided_by: M, decided_at: new Date(todayStart.getTime() + 60_000) } });
  const f9y = await jobCard("ZZDA-09Y", { status: "Closed", createdBy: D });
  await prisma.approvals.create({ data: { work_order_id: f9y, status: "Closed", decided_by: M, decided_at: new Date(todayStart.getTime() - 60_000) } });
  // 10 — "returned for further work": no reject/return transition exists in
  // the app, so this simulates the end state — an earlier Closure Requested
  // approval row, Job Card back In Progress with a worker working.
  const f10 = await jobCard("ZZDA-10", { createdBy: D });
  await prisma.approvals.create({ data: { work_order_id: f10, status: "Closure Requested", decided_by: D } });
  const a10 = await assign(f10, w.I);
  await session(f10, a10, w.I, "Active", 15);
  // 11 — one supervisor across two active Job Cards: working on one, paused on the other.
  const f11a = await jobCard("ZZDA-11A", { createdBy: D });
  const f11b = await jobCard("ZZDA-11B", { createdBy: D });
  const a11a = await assign(f11a, sup, { role: "Supervisor" });
  const a11b = await assign(f11b, sup, { role: "Supervisor" });
  await session(f11b, a11b, sup, "Paused", 80);
  await session(f11a, a11a, sup, "Active", 10);
  // 12 — an Electrical Job Card with a worker working (team filter).
  const f12 = await jobCard("ZZDA-12E", { createdBy: D, team: "Electrical" });
  const a12 = await assign(f12, w.J);
  await session(f12, a12, w.J, "Active", 25);
  // 13 — created by the Manager: invisible to Data Entry.
  const f13 = await jobCard("ZZDA-13M", { createdBy: M });
  const a13 = await assign(f13, w.K);
  await session(f13, a13, w.K, "Active", 5);
  void f2;

  const expectedMgr = { open: 12, working: 6, paused: 3, ready: 1, waiting: 1, closed: 2 };

  await check("2-11", "Manager: each state lands in the right card, and every card matches its list", async () => {
    const p = await assertCardsMatchLists(mgr.cookie);
    assertEqual(p.counts, expectedMgr, "manager counts");
    assertEqual([p.workersWorking, p.workersPaused], [6, 4], "worker headcounts (working, paused)");
    assertEqual((await page(mgr.cookie, "status=paused")).rows, ["ZZDA-04", "ZZDA-05", "ZZDA-11B"], "paused rows");
    assertEqual((await page(mgr.cookie, "status=working")).rows, ["ZZDA-03", "ZZDA-06", "ZZDA-10", "ZZDA-11A", "ZZDA-12E", "ZZDA-13M"], "working rows");
    assertEqual((await page(mgr.cookie, "status=ready-closure")).rows, ["ZZDA-07"], "ready rows");
    assertEqual((await page(mgr.cookie, "status=waiting-approval")).rows, ["ZZDA-08"], "waiting rows");
    assertEqual((await page(mgr.cookie, "status=closed")).rows, ["ZZDA-09", "ZZDA-09M"], "closed-today rows (yesterday excluded)");
    return JSON.stringify(p.counts);
  });

  await check("9", "Closed Job Cards never appear under All Active", async () => {
    const p = await page(mgr.cookie);
    assert(!p.rows.some((r) => r.startsWith("ZZDA-09")), `closed rows in All Active: ${p.rows.join(",")}`);
  });

  await check("12", "Search and Work Team filters: counts and lists stay in the same scope, filters are named", async () => {
    const team = await assertCardsMatchLists(mgr.cookie, "team=Electrical");
    assertEqual(team.counts, { open: 1, working: 1, paused: 0, ready: 0, waiting: 0, closed: 0 }, "Electrical counts");
    assert(team.html.includes("Counts include only:") && team.html.includes("Work Team: Electrical"), "applied-filter notice missing");
    const search = await assertCardsMatchLists(mgr.cookie, "q=ZZDA-05");
    assertEqual(search.counts, { open: 1, working: 0, paused: 1, ready: 0, waiting: 0, closed: 0 }, "search counts");
    const empty = await page(mgr.cookie, "team=Electrical&status=paused");
    assertEqual(empty.emptyTitle, "No paused Job Cards", "empty title with filters");
    assert(empty.html.includes("Reset filters"), "Reset action missing on filtered empty state");
  });

  await check("13", "Data Entry sees only own Job Cards; counts still match lists", async () => {
    const p = await assertCardsMatchLists(de.cookie);
    assertEqual(p.counts, { ...expectedMgr, open: 11, working: 5 }, "data entry counts");
    assert(!p.rows.includes("ZZDA-13M"), "Manager-created Job Card leaked to Data Entry");
  });

  await check("13b", "No new actions: closed card read-only; only Manager gets Review Closure", async () => {
    for (const who of [de, mgr]) {
      const closed = await page(who.cookie, "status=closed");
      for (const label of ["Request Closure", "Process Materials", "Assign Workers", "Review Closure &amp; Approve"]) {
        assert(!closed.html.includes(`>${label}<`) && !closed.html.includes(`> ${label}<`), `closed panel shows "${label}"`);
      }
    }
    const deWaiting = await page(de.cookie, "status=waiting-approval");
    assert(!deWaiting.html.includes("Review Closure &amp; Approve"), "Data Entry sees Review Closure & Approve");
    const mgrWaiting = await page(mgr.cookie, "status=waiting-approval");
    assert(mgrWaiting.html.includes("Review Closure &amp; Approve"), "Manager lost Review Closure & Approve");
  });

  await check("RO", "Rendering the page never writes Job Card / session / approval data", async () => {
    const before = await tableCounts();
    for (const f of Object.values(FILTER_FOR)) await page(mgr.cookie, f);
    await page(de.cookie);
    assertEqual(await tableCounts(), before, "table snapshot");
  });

  await check("14", "Status transitions update the dashboard on the next refresh", async () => {
    // Resume ZZDA-04: Paused row stays (history), a new Active session starts.
    await session(f4, a4, w.B, "Active", 1);
    let p = await assertCardsMatchLists(mgr.cookie);
    assertEqual([p.counts.paused, p.counts.working], [2, 7], "after resume (paused, working)");
    // Finish both ZZDA-05 workers from Paused: assignment -> finished, last
    // session row left as "Paused" (finishWorkSession's real behavior).
    await prisma.workOrderWorkerAssignment.updateMany({ where: { id: { in: [a5a, a5b] } }, data: { status: "finished" } });
    p = await assertCardsMatchLists(mgr.cookie);
    assertEqual([p.counts.paused, p.counts.ready, p.workersPaused], [1, 2, 1], "after finish-from-paused (paused, ready, paused workers)");
    // Manager approves ZZDA-08: Closed + Closed approval row now.
    await prisma.work_orders.update({ where: { id: f8 }, data: { status: "Closed" } });
    await prisma.approvals.create({ data: { work_order_id: f8, status: "Closed", decided_by: M } });
    p = await assertCardsMatchLists(mgr.cookie);
    assertEqual([p.counts.waiting, p.counts.closed, p.counts.open], [0, 3, 11], "after approval (waiting, closed, open)");
    return JSON.stringify(p.counts);
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
