/**
 * Job Card Creation Reliability — HTTP integration checks for
 * POST /api/job-cards and GET /api/job-cards/submissions/[id].
 *
 * DESTRUCTIVE: creates Job Cards, sessions and worker profiles, renames the
 * maintenance workflow definition for a moment and holds row locks. Run it
 * ONLY against a throw-away copy of the database, with a server started on
 * that copy:
 *
 *   createdb -T recafco_maintenance recafco_jc_reliability_test
 *   (apply prisma/migrations/20261026000000_job_card_submission_idempotency)
 *   npm run build
 *   DATABASE_URL=<test db url> npx next start -p 3005
 *   JC_VERIFY_DATABASE_URL=<test db url> JC_VERIFY_BASE_URL=http://localhost:3005 \
 *     node scripts/verify-job-card-creation.mjs
 *
 * Refuses to run unless the database name contains "test".
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const DB_URL = process.env.JC_VERIFY_DATABASE_URL;
const BASE = (process.env.JC_VERIFY_BASE_URL ?? "http://localhost:3005").replace(/\/$/, "");

if (!DB_URL) {
  console.error("Set JC_VERIFY_DATABASE_URL to a throw-away test database.");
  process.exit(2);
}
const dbName = new URL(DB_URL).pathname.replace(/^\//, "");
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: DB_URL });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function sessionFor(roleSlug, { expired = false } = {}) {
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
      user_agent: "verify-job-card-creation",
      expires_at: new Date(Date.now() + (expired ? -60_000 : 60 * 60_000)),
    },
  });
  return { cookie: `recafco_session=${token}`, profileId: row.profile_id };
}

async function worker(name, worker_type) {
  const existing = await prisma.workerProfile.findFirst({ where: { name } });
  if (existing) {
    await prisma.workerProfile.update({ where: { id: existing.id }, data: { is_active: true } });
    return existing.id;
  }
  const created = await prisma.workerProfile.create({ data: { name, worker_type, hourly_rate: 1, skill_category: "Mechanical" } });
  return created.id;
}

async function inventoryMaterialKey() {
  const m = await prisma.offline_inventory_movements.findFirst({
    where: { deleted_at: null },
    orderBy: { created_at: "desc" },
    select: { part_id: true, manual_material_name: true, unit: true },
  });
  if (!m) return null;
  return m.part_id ? `part:${m.part_id}` : `manual:${m.manual_material_name}|${m.unit}`;
}

// ── Requests ─────────────────────────────────────────────────────────────────

let ASSET_ID;

function jobCardForm(overrides = {}, files = []) {
  const fields = {
    submission_id: randomUUID(),
    intent: "submit_for_approval",
    asset_id: ASSET_ID,
    asset_category: "Car",
    serial_number: "",
    plate_number: "",
    supervisor_verification: "",
    maintenance_manager_closure: "",
    operator_requester_confirmation: "",
    ordered_by: "Verify Script",
    date_of_order: new Date().toISOString().slice(0, 10),
    job_location: "Workshop",
    priority: "Normal",
    maintenance_type: "Break Down",
    operator_complaint: "Engine does not start (verification)",
    description_of_work: "",
    worker_type: "Mechanical",
    assigned_supervisor_id: "",
    estimated_labor_hours: "",
    req_parts_inventory_first: "1",
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else if (v !== undefined && v !== null) fd.set(k, v);
  }
  files.forEach((file, i) => {
    fd.set(`doc_attachment_category_${i}`, "Other Document");
    fd.set(`doc_attachment_remarks_${i}`, "");
    fd.set(`doc_attachment_file_${i}`, file);
  });
  return { fd, submissionId: fields.submission_id };
}

async function post(cookie, fd, { signal, origin = BASE } = {}) {
  const res = await fetch(`${BASE}/api/job-cards`, {
    method: "POST",
    body: fd,
    headers: { cookie, origin },
    redirect: "manual",
    signal,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, location: res.headers.get("location"), body };
}

async function status(cookie, submissionId) {
  const res = await fetch(`${BASE}/api/job-cards/submissions/${submissionId}`, { headers: { cookie }, redirect: "manual" });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body };
}

const countBySubmission = (id) => prisma.work_orders.count({ where: { client_submission_id: id } });
// A PNG of the given size: real PNG signature, then filler (uploads are
// checked against their contents, not only the declared type).
const pngFile = (name, bytes) => {
  const data = new Uint8Array(bytes);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([data], name, { type: "image/png" });
};

// ── Checks ───────────────────────────────────────────────────────────────────

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  assert(health, `No server at ${BASE}`);

  const asset = await prisma.assets.findFirst({ where: { deleted_at: null }, orderBy: { asset_code: "asc" }, select: { id: true } });
  ASSET_ID = asset.id;
  const de = await sessionFor("maintenance_data_entry");
  const mgr = await sessionFor("maintenance_manager");
  const expired = await sessionFor("maintenance_data_entry", { expired: true });
  const sup = await worker("ZZ Verify Supervisor", "Supervisor");
  const techA = await worker("ZZ Verify Technician A", "Technician");
  const techB = await worker("ZZ Verify Technician B", "Technician");
  const helper = await worker("ZZ Verify Helper", "Helper/Labor");
  const materialKey = await inventoryMaterialKey();
  const startCount = await prisma.work_orders.count();
  console.log(`Test DB ${dbName}: ${startCount} Job Cards before; server ${BASE}\n`);

  let firstJobCardId = null;

  await check("A", "Data Entry creates a Job Card (no workers, no materials, no attachments: D/E/F)", async () => {
    const { fd, submissionId } = jobCardForm();
    const r = await post(de.cookie, fd);
    assert(r.status === 200 && r.body?.ok, `status ${r.status} ${JSON.stringify(r.body)}`);
    const wo = await prisma.work_orders.findFirst({ where: { client_submission_id: submissionId } });
    assert(wo && wo.created_by === de.profileId, "row not saved for Data Entry");
    assert(wo.status === "Approved", `status ${wo.status}`);
    assert(r.body.jobCard.number === wo.work_order_number, "number in response differs from DB");
    assert(r.body.jobCard.assignedTeam.length === 0, "unexpected team");
    const wf = await prisma.workflowInstance.count({ where: { entity_id: wo.id } });
    assert(wf === 1, `workflow instances ${wf}`);
    firstJobCardId = wo.id;
    return `${wo.work_order_number}, reference ${r.body.reference}`;
  });

  await check("B", "Manager creates a Job Card", async () => {
    const { fd, submissionId } = jobCardForm({ ordered_by: "Manager Verify" });
    const r = await post(mgr.cookie, fd);
    assert(r.status === 200 && r.body?.ok, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert((await countBySubmission(submissionId)) === 1, "not exactly one row");
    return r.body.jobCard.number;
  });

  await check("C", "Missing / invalid required fields are refused with step + field, nothing saved", async () => {
    const cases = [
      [{ operator_complaint: "" }, 2, "operator_complaint"],
      [{ ordered_by: "A" }, 2, "ordered_by"],
      [{ asset_id: "" }, 1, "asset_id"],
      [{ kilometers: "-5" }, 2, "kilometers"],
      [{ worker_type: "" }, 3, "worker_type"],
      [{ date_of_order: "" }, 2, "date_of_order"],
    ];
    const seen = [];
    for (const [overrides, step, field] of cases) {
      const { fd, submissionId } = jobCardForm(overrides);
      const r = await post(de.cookie, fd);
      assert(r.status === 400 && r.body?.category === "validation", `${field}: status ${r.status} ${JSON.stringify(r.body)}`);
      assert(r.body.step === step && r.body.field === field, `${field}: got step ${r.body.step} field ${r.body.field}`);
      assert((await countBySubmission(submissionId)) === 0, `${field}: row was created`);
      seen.push(`${field}→step ${step}`);
    }
    return seen.join(", ");
  });

  await check("P1", "Same submission id works after a validation failure is fixed", async () => {
    const submission_id = randomUUID();
    const bad = await post(de.cookie, jobCardForm({ submission_id, operator_complaint: "" }).fd);
    assert(bad.status === 400, `first ${bad.status}`);
    const good = await post(de.cookie, jobCardForm({ submission_id }).fd);
    assert(good.status === 200 && good.body?.ok && !good.body.replayed, `second ${good.status} ${JSON.stringify(good.body)}`);
    assert((await countBySubmission(submission_id)) === 1, "count");
  });

  let rosterJobCardId = null;
  await check("G", "Job Card with several workers (supervisor + 2 technicians + helper, estimates)", async () => {
    const { fd, submissionId } = jobCardForm({
      assign_now: "on",
      assignment_type: "INTERNAL_TEAM",
      assign_supervisor_id: sup,
      assign_technician_ids: [techA, techB],
      assign_helper_ids: [helper],
      assign_worker_estimates: JSON.stringify({ [sup]: "1", [techA]: "2.3", [techB]: "1.5", [helper]: "0.7" }),
    });
    const r = await post(de.cookie, fd);
    assert(r.status === 200 && r.body?.ok, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert(!r.body.warnings.assignmentFailed, "assignment warning");
    assert(r.body.jobCard.assignedTeam.length === 4, `team ${JSON.stringify(r.body.jobCard.assignedTeam)}`);
    const wo = await prisma.work_orders.findFirst({ where: { client_submission_id: submissionId }, select: { id: true, estimated_labor_hours: true } });
    assert(Number(wo.estimated_labor_hours) === 5.5, `estimated ${wo.estimated_labor_hours}`);
    const rows = await prisma.workOrderWorkerAssignment.count({ where: { work_order_id: wo.id, status: { not: "removed" } } });
    assert(rows === 4, `roster rows ${rows}`);
    rosterJobCardId = wo.id;
    return r.body.jobCard.assignedTeam.join("; ");
  });

  await check("H", "Supervisor already on another active Job Card can be assigned again", async () => {
    const { fd } = jobCardForm({ assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_supervisor_id: sup });
    const r = await post(mgr.cookie, fd);
    assert(r.status === 200 && r.body?.ok && !r.body.warnings.assignmentFailed, `status ${r.status} ${JSON.stringify(r.body)}`);
    const active = await prisma.workOrderWorkerAssignment.count({ where: { worker_id: sup, status: { not: "removed" } } });
    assert(active >= 2, `supervisor active on ${active}`);
    return `supervisor now on ${active} Job Cards`;
  });

  await check("I1", "Unsupported attachment type is refused at Attachments, nothing saved", async () => {
    const { fd, submissionId } = jobCardForm({}, [new File(["hello"], "notes.txt", { type: "text/plain" })]);
    const r = await post(de.cookie, fd);
    assert(r.status === 400 && r.body?.step === 5 && r.body.field === "attachments", `status ${r.status} ${JSON.stringify(r.body)}`);
    assert((await countBySubmission(submissionId)) === 0, "row created");
    return r.body.message;
  });

  await check("I2", "Attachment over the per-file limit is refused at Attachments, nothing saved", async () => {
    const settings = await prisma.app_settings.findFirst({ select: { max_upload_size_mb: true } });
    const maxMb = Number(settings?.max_upload_size_mb ?? 10);
    const { fd, submissionId } = jobCardForm({}, [pngFile("big.png", (maxMb + 1) * 1024 * 1024)]);
    const r = await post(de.cookie, fd);
    assert(r.status === 400 && r.body?.step === 5, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert((await countBySubmission(submissionId)) === 0, "row created");
    return r.body.message;
  });

  await check("I3", "Two 6 MB photos (12 MB request, above the old 10 MB proxy cut-off) are saved", async () => {
    const { fd, submissionId } = jobCardForm({}, [pngFile("photo-1.png", 6 * 1024 * 1024), pngFile("photo-2.png", 6 * 1024 * 1024)]);
    const r = await post(de.cookie, fd);
    assert(r.status === 200 && r.body?.ok && !r.body.warnings.attachmentsFailed, `status ${r.status} ${JSON.stringify(r.body)}`);
    const wo = await prisma.work_orders.findFirst({ where: { client_submission_id: submissionId }, select: { id: true } });
    const files = await prisma.work_order_attachments.count({ where: { work_order_id: wo.id } });
    assert(files === 2, `attachments ${files}`);
    return r.body.jobCard.number;
  });

  await check("I4", "Attachment file write failure keeps the Job Card and reports a warning", async () => {
    // A file-name component longer than NTFS/ext4 allow (255) makes the write fail.
    const { fd, submissionId } = jobCardForm({}, [pngFile(`${"x".repeat(260)}.png`, 1024)]);
    const r = await post(de.cookie, fd);
    assert(r.status === 200 && r.body?.ok, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.warnings.attachmentsFailed === true, "no attachment warning");
    assert((await countBySubmission(submissionId)) === 1, "count");
  });

  await check("J", "Double click: 2 and then 5 simultaneous posts with one submission id → one Job Card", async () => {
    const out = [];
    for (const n of [2, 5]) {
      const submission_id = randomUUID();
      const replies = await Promise.all(Array.from({ length: n }, () => post(de.cookie, jobCardForm({ submission_id }).fd)));
      assert(replies.every((r) => r.status === 200 && r.body?.ok), JSON.stringify(replies.map((r) => [r.status, r.body?.category])));
      const ids = new Set(replies.map((r) => r.body.jobCard.id));
      assert(ids.size === 1, `distinct ids ${ids.size}`);
      assert(replies.filter((r) => !r.body.replayed).length === 1, "not exactly one original");
      assert((await countBySubmission(submission_id)) === 1, "count");
      out.push(`${n} posts → 1 (${n - 1} replayed)`);
    }
    return out.join(", ");
  });

  await check("K", "12 concurrent different submissions from two sessions → 12 Job Cards, unique numbers", async () => {
    const forms = Array.from({ length: 12 }, (_, i) => jobCardForm({ worker_type: i % 2 ? "Mechanical" : "Electrical" }));
    const replies = await Promise.all(forms.map((f, i) => post(i % 2 ? de.cookie : mgr.cookie, f.fd)));
    assert(replies.every((r) => r.status === 200 && r.body?.ok), JSON.stringify(replies.map((r) => [r.status, r.body?.category])));
    const numbers = replies.map((r) => r.body.jobCard.number);
    assert(new Set(numbers).size === 12, `duplicate numbers ${numbers}`);
    return numbers.slice(0, 3).join(", ") + ", …";
  });

  await check("L", "Client gives up after the server committed → status check finds it, retry returns it", async () => {
    const f = jobCardForm({
      assign_now: "on",
      assignment_type: "INTERNAL_TEAM",
      assign_technician_ids: [techA],
      ...(materialKey ? { req_part_description_0: "x", req_part_material_key_0: materialKey, req_part_quantity_0: "1", req_part_entered_unit_0: "" } : {}),
    });
    const controller = new AbortController();
    const pending = post(de.cookie, f.fd, { signal: controller.signal }).catch((e) => ({ aborted: e.name }));
    await sleep(120);
    controller.abort();
    const first = await pending;
    assert(first.aborted || first.status === 200, `first ${JSON.stringify(first)}`);
    let s = null;
    for (let i = 0; i < 40; i++) {
      s = await status(de.cookie, f.submissionId);
      if (s.body?.found) break;
      await sleep(250);
    }
    assert(s?.status === 200 && s.body?.found, `status ${JSON.stringify(s)}`);
    const retry = await post(de.cookie, jobCardForm({ submission_id: f.submissionId }).fd);
    assert(retry.status === 200 && retry.body?.ok && retry.body.replayed, `retry ${retry.status} ${JSON.stringify(retry.body)}`);
    assert(retry.body.jobCard.id === s.body.jobCard.id, "retry returned another Job Card");
    assert((await countBySubmission(f.submissionId)) === 1, "count");
    return `${first.aborted ? "request aborted" : "answered"}; found ${s.body.jobCard.number}; retry replayed`;
  });

  await check("M1", "Failure inside the transaction rolls back: nothing saved, no number used, no recovery draft", async () => {
    const seqBefore = await prisma.$queryRaw`select key, current_value from numbering_sequences where key like 'work_order:%' order by key`;
    const totalBefore = await prisma.work_orders.count();
    await prisma.workflowDefinition.update({ where: { code: "maintenance_work_order" }, data: { code: "maintenance_work_order__verify_off" } });
    let r;
    try {
      r = await post(de.cookie, jobCardForm().fd);
    } finally {
      await prisma.workflowDefinition.update({ where: { code: "maintenance_work_order__verify_off" }, data: { code: "maintenance_work_order" } });
    }
    assert(r.status === 500 && r.body?.category === "unexpected" && r.body.retryable, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert((await prisma.work_orders.count()) === totalBefore, "a row was created (recovery draft?)");
    const seqAfter = await prisma.$queryRaw`select key, current_value from numbering_sequences where key like 'work_order:%' order by key`;
    assert(JSON.stringify(seqBefore) === JSON.stringify(seqAfter), "numbering sequence moved");
    return `reference ${r.body.reference}`;
  });

  await check("M2", "Database lock timeout before commit → 503 'database', nothing saved; retry succeeds", async () => {
    const seq = await prisma.$queryRaw`select key from numbering_sequences where key like 'work_order:%:MECH' limit 1`;
    assert(seq[0], "no MECH sequence row");
    const f = jobCardForm();
    let release;
    const released = new Promise((r) => (release = r));
    const locked = new Promise((ready) => {
      prisma
        .$transaction(
          async (tx) => {
            await tx.$queryRaw`select current_value from numbering_sequences where key = ${seq[0].key} for update`;
            ready();
            await released;
          },
          { timeout: 60_000, maxWait: 5_000 }
        )
        .catch(() => {});
    });
    await locked;
    const started = Date.now();
    const r = await post(de.cookie, f.fd);
    release();
    assert(r.status === 503 && r.body?.category === "database" && r.body.retryable, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert((await countBySubmission(f.submissionId)) === 0, "row created");
    await sleep(300);
    const retry = await post(de.cookie, jobCardForm({ submission_id: f.submissionId }).fd);
    assert(retry.status === 200 && retry.body?.ok && !retry.body.replayed, `retry ${retry.status} ${JSON.stringify(retry.body)}`);
    return `failed after ${Math.round((Date.now() - started) / 1000)} s, reference ${r.body.reference}; retry ${retry.body.jobCard.number}`;
  });

  await check("N", "Session expiry: no cookie → sign-in redirect; expired session → 401 'session'", async () => {
    const none = await post("", jobCardForm().fd);
    assert([302, 307, 308].includes(none.status) && /\/login/.test(none.location ?? ""), `no cookie: ${none.status} ${none.location}`);
    const f = jobCardForm();
    const old = await post(expired.cookie, f.fd);
    assert(old.status === 401 && old.body?.category === "session" && old.body.retryable, `expired: ${old.status} ${JSON.stringify(old.body)}`);
    assert((await countBySubmission(f.submissionId)) === 0, "row created");
    const st = await status(expired.cookie, f.submissionId);
    assert(st.status === 401, `status endpoint ${st.status}`);
  });

  await check("O", "Earlier-step problems found on save: stale material (4), inactive worker (3), deleted asset (1)", async () => {
    const out = [];
    const mat = await post(de.cookie, jobCardForm({ req_part_description_0: "Ghost filter", req_part_material_key_0: "manual:ZZ no such material|PCS", req_part_quantity_0: "1" }).fd);
    assert(mat.status === 400 && mat.body?.step === 4, `material ${mat.status} ${JSON.stringify(mat.body)}`);
    out.push("material→4");

    const gone = await worker("ZZ Verify Gone Technician", "Technician");
    await prisma.workerProfile.update({ where: { id: gone }, data: { is_active: false } });
    const w = await post(de.cookie, jobCardForm({ assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_technician_ids: [gone] }).fd);
    assert(w.status === 400 && w.body?.step === 3 && /no longer available/.test(w.body.message), `worker ${w.status} ${JSON.stringify(w.body)}`);
    out.push("worker→3");

    const spare = await prisma.assets.findFirst({ where: { deleted_at: null, id: { not: ASSET_ID } }, select: { id: true } });
    await prisma.assets.update({ where: { id: spare.id }, data: { deleted_at: new Date() } });
    try {
      const a = await post(de.cookie, jobCardForm({ asset_id: spare.id }).fd);
      assert(a.status === 400 && a.body?.step === 1, `asset ${a.status} ${JSON.stringify(a.body)}`);
      out.push("asset→1");
    } finally {
      await prisma.assets.update({ where: { id: spare.id }, data: { deleted_at: null } });
    }
    return out.join(", ");
  });

  await check("Q", "Save Draft still works (status Created, no workflow instance, no assignment saved)", async () => {
    const { fd, submissionId } = jobCardForm({ intent: "save_draft", operator_complaint: "", assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_technician_ids: [techA] });
    const r = await post(de.cookie, fd);
    assert(r.status === 200 && r.body?.ok && r.body.jobCard.isDraft, `status ${r.status} ${JSON.stringify(r.body)}`);
    const wo = await prisma.work_orders.findFirst({ where: { client_submission_id: submissionId }, select: { id: true, status: true } });
    assert(wo.status === "Created", `status ${wo.status}`);
    assert((await prisma.workflowInstance.count({ where: { entity_id: wo.id } })) === 0, "workflow instance on draft");
    assert((await prisma.workOrderWorkerAssignment.count({ where: { work_order_id: wo.id } })) === 0, "assignment on draft");
    return r.body.jobCard.number;
  });

  await check("S1", "Another user cannot replay or look up someone else's submission id", async () => {
    const f = jobCardForm();
    const ok = await post(de.cookie, f.fd);
    assert(ok.body?.ok, "setup");
    const other = await post(mgr.cookie, jobCardForm({ submission_id: f.submissionId }).fd);
    assert(other.status === 400 && other.body?.category === "bad_request" && !other.body.jobCard, `replay ${other.status} ${JSON.stringify(other.body)}`);
    const st = await status(mgr.cookie, f.submissionId);
    assert(st.status === 200 && st.body?.found === false, `status ${JSON.stringify(st.body)}`);
    const mine = await status(de.cookie, f.submissionId);
    assert(mine.body?.found && mine.body.jobCard.id === ok.body.jobCard.id, "owner lookup");
  });

  await check("S2", "Cross-site Origin is refused", async () => {
    const f = jobCardForm();
    const r = await post(de.cookie, f.fd, { origin: "http://evil.example" });
    assert(r.status === 400 && (await countBySubmission(f.submissionId)) === 0, `status ${r.status}`);
  });

  await check("S3", "Status/id ignored on create: posted id and status=Closed have no effect", async () => {
    const f = jobCardForm({ status: "Closed" });
    const r = await post(de.cookie, f.fd);
    assert(r.body?.ok && r.body.jobCard.status === "Approved", JSON.stringify(r.body));
  });

  await check("S4", "Roles without work_orders.manage (technician, store keeper) cannot create or look up", async () => {
    const out = [];
    for (const slug of ["technician", "store_keeper"]) {
      let s;
      try {
        s = await sessionFor(slug);
      } catch {
        out.push(`${slug}: no user`);
        continue;
      }
      const f = jobCardForm();
      const r = await post(s.cookie, f.fd);
      assert(r.status === 403 && r.body?.category === "permission", `${slug}: ${r.status} ${JSON.stringify(r.body)}`);
      assert((await countBySubmission(f.submissionId)) === 0, `${slug}: row created`);
      const st = await status(s.cookie, f.submissionId);
      assert(st.status === 403, `${slug} status route ${st.status}`);
      out.push(`${slug} 403`);
    }
    return out.join(", ");
  });

  await check("S5", "Deny overrides win: no work_orders.assign → assignment refused at step 3; no work_orders.manage → 403", async () => {
    const deny = (key) =>
      prisma.$executeRaw`insert into user_permission_overrides (profile_id, permission_key, override_type, reason) values (${de.profileId}::uuid, ${key}, 'deny', 'verify-job-card-creation')`;
    try {
      await deny("work_orders.assign");
      const f = jobCardForm({ assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_technician_ids: [techA] });
      const r = await post(de.cookie, f.fd);
      assert(r.status === 400 && r.body?.step === 3 && /permission/.test(r.body.message), `assign: ${r.status} ${JSON.stringify(r.body)}`);
      assert((await countBySubmission(f.submissionId)) === 0, "row created");
      const plain = await post(de.cookie, jobCardForm().fd);
      assert(plain.status === 200, "create without assignment should still work");
      await deny("work_orders.manage");
      const g = jobCardForm();
      const m = await post(de.cookie, g.fd);
      assert(m.status === 403, `manage: ${m.status}`);
      assert((await countBySubmission(g.submissionId)) === 0, "row created");
    } finally {
      await prisma.$executeRaw`delete from user_permission_overrides where profile_id = ${de.profileId}::uuid`;
    }
  });

  await check("T1", "Retries never duplicate the Materials Request, assignment or files", async () => {
    if (!materialKey) return "skipped: no inventory material in test DB";
    const f = jobCardForm(
      {
        assign_now: "on",
        assignment_type: "INTERNAL_TEAM",
        assign_technician_ids: [techB],
        req_part_description_0: "x",
        req_part_material_key_0: materialKey,
        req_part_quantity_0: "1",
        req_part_entered_unit_0: "",
      },
      [pngFile("one.png", 2048)]
    );
    const first = await post(de.cookie, f.fd);
    assert(first.body?.ok, `first ${JSON.stringify(first.body)}`);
    const wo = first.body.jobCard;
    assert(wo.materialsRequests.length === 1 && wo.attachmentsCount === 1 && wo.assignedTeam.length === 1 && wo.finalized, JSON.stringify(wo));
    const again = jobCardForm(
      { submission_id: f.submissionId, assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_technician_ids: [techA, techB], req_part_description_0: "x", req_part_material_key_0: materialKey, req_part_quantity_0: "1", req_part_entered_unit_0: "" },
      [pngFile("one.png", 2048), pngFile("two.png", 2048)]
    );
    for (let i = 0; i < 3; i++) {
      const r = await post(de.cookie, again.fd);
      assert(r.body?.ok && r.body.replayed && r.body.jobCard.id === wo.id, `retry ${i}: ${JSON.stringify(r.body)}`);
    }
    const [mr, roster, files, parts] = await Promise.all([
      prisma.parts_requests.count({ where: { work_order_id: wo.id } }),
      prisma.workOrderWorkerAssignment.count({ where: { work_order_id: wo.id } }),
      prisma.work_order_attachments.count({ where: { work_order_id: wo.id } }),
      prisma.workOrderRequiredPart.count({ where: { work_order_id: wo.id } }),
    ]);
    assert(mr === 1 && roster === 1 && files === 1 && parts === 1, `mr ${mr} roster ${roster} files ${files} parts ${parts}`);
    return "3 retries (one with changed workers/files) → still 1 request, 1 worker, 1 file, 1 material line; later changes not applied";
  });

  await check("T2", "Assignment / Materials Request failure after commit → Job Card kept, failure reported, stored state shown", async () => {
    if (!materialKey) return "skipped: no inventory material in test DB";
    await prisma.$executeRawUnsafe(`create or replace function zz_verify_fail() returns trigger language plpgsql as $$ begin raise exception 'zz verify forced failure'; end $$`);
    await prisma.$executeRawUnsafe(`create trigger zz_verify_fail_roster before insert on work_order_worker_assignments for each row execute function zz_verify_fail()`);
    await prisma.$executeRawUnsafe(`create trigger zz_verify_fail_mr before insert on parts_requests for each row execute function zz_verify_fail()`);
    try {
      const f = jobCardForm({ assign_now: "on", assignment_type: "INTERNAL_TEAM", assign_technician_ids: [techA], req_part_description_0: "x", req_part_material_key_0: materialKey, req_part_quantity_0: "1", req_part_entered_unit_0: "" });
      const r = await post(de.cookie, f.fd);
      assert(r.status === 200 && r.body?.ok, `status ${r.status} ${JSON.stringify(r.body)}`);
      const w = r.body.warnings;
      assert(w.assignmentFailed && w.materialsRequestFailed && !w.attachmentsFailed, `warnings ${JSON.stringify(w)}`);
      const jc = r.body.jobCard;
      assert(jc.assignedTeam.length === 0 && jc.materialsRequests.length === 0 && jc.requiredMaterialsCount === 1 && jc.finalized, JSON.stringify(jc));
      const replay = await post(de.cookie, jobCardForm({ submission_id: f.submissionId }).fd);
      assert(replay.body?.replayed && replay.body.jobCard.assignedTeam.length === 0 && replay.body.jobCard.materialsRequests.length === 0, "replay must report the same stored state");
      return `${jc.number}: kept; assignment + Materials Request reported as not saved`;
    } finally {
      await prisma.$executeRawUnsafe(`drop trigger if exists zz_verify_fail_roster on work_order_worker_assignments`);
      await prisma.$executeRawUnsafe(`drop trigger if exists zz_verify_fail_mr on parts_requests`);
      await prisma.$executeRawUnsafe(`drop function if exists zz_verify_fail()`);
    }
  });

  await check("R", "No duplicate Job Card numbers or submission ids anywhere", async () => {
    const dupNumbers = await prisma.$queryRaw`select work_order_number, count(*)::int n from work_orders group by 1 having count(*) > 1`;
    const dupSubs = await prisma.$queryRaw`select client_submission_id, count(*)::int n from work_orders where client_submission_id is not null group by 1 having count(*) > 1`;
    assert(dupNumbers.length === 0, JSON.stringify(dupNumbers));
    assert(dupSubs.length === 0, JSON.stringify(dupSubs));
    const created = (await prisma.work_orders.count()) - startCount;
    return `${created} Job Cards created by this run, all numbers unique`;
  });

  void firstJobCardId;
  void rosterJobCardId;
}

try {
  await main();
} catch (error) {
  record("SETUP", "harness", false, error instanceof Error ? error.message : String(error));
} finally {
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
