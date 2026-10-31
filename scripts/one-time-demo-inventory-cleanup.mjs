/**
 * ONE-TIME Demo Data Cleanup for the LOCAL development database. Run by hand
 * only; no route, action or button calls this file. Delete it once the
 * cleanup is finished.
 *
 * DRY RUN (default) — runs inside a READ ONLY transaction, changes nothing:
 *   node --env-file=.env scripts/one-time-demo-inventory-cleanup.mjs --out=<report.json>
 *
 * EXECUTE — needs an approved dry-run report, its hash and a verified backup:
 *   node --env-file=.env scripts/one-time-demo-inventory-cleanup.mjs --execute \
 *     --manifest=<report.json> --confirm-sha256=<hash> --backup=<file.dump>
 *
 * Scope, approved by the administrator: every Job Card, Materials Request,
 * General Materials Request and inventory material in this database, plus
 * the records that exist only because of them. The expected counts are
 * pinned in EXPECTED; any difference stops the script.
 *
 * Refuses to run unless the server itself proves it is the authorized local
 * instance (database name, loopback address, port, cluster system identifier
 * and data directory), so a copied .env cannot aim it at another server.
 *
 * How rows leave:
 *   - offline_inventory_movements: soft-deleted (deleted_at), like the 1,499
 *     rows already soft-deleted, which are left alone.
 *   - everything else in DELETE_ORDER: deleted by id, table by table, children
 *     first, so nothing depends on a cascade. Foreign keys stay enforced.
 *   - audit_logs, system_error_logs, import batches and all master data stay.
 *
 * One transaction: any count mismatch, new reference or failed check rolls
 * the whole run back.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const PG_RESTORE = "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe";
const BACKUP_MAX_AGE_MINUTES = 60;
const AUDIT_ACTION = "offline_inventory.demo_cleanup_removed";

// The only server this may run on. --rehearsal additionally allows a *_test
// database on this same cluster, for practising on a restored copy.
const AUTHORIZED = {
  database: "recafco_maintenance",
  port: 5432,
  systemIdentifier: "7653403403654498784",
  dataDirectory: "C:/Program Files/PostgreSQL/18/data",
};

const EXPECTED = {
  work_orders: 17,
  work_order_work_sessions: 24,
  work_order_worker_assignments: 24,
  work_session_time_corrections: 6,
  approvals: 7,
  parts_requests: 12,
  parts_request_items: 15,
  general_inventory_requests: 6,
  general_inventory_request_items: 6,
  work_order_required_parts: 15,
  movements: 67,
  settings: 10,
  activeMaterials: 17,
  archivedMaterials: 9,
  alreadySoftDeletedMovements: 1499,
};

// Must stay empty: rows here would be outside the confirmed demo set.
const MUST_BE_EMPTY = ["purchase_requests", "purchase_request_items", "purchase_orders", "purchase_order_items", "inventory_movements", "parts"];

// Scoped tables, children before parents. `where` selects the demo rows.
const SCOPE_TABLES = [
  { table: "work_session_time_corrections", where: `work_order_id = any($1::uuid[])` },
  { table: "job_card_requirement_confirmations", where: `work_order_id = any($1::uuid[])` },
  { table: "job_card_deletion_requests", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_work_sessions", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_worker_assignments", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_assignments", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_labor", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_technician_notes", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_materials", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_required_parts", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_attachments", where: `work_order_id = any($1::uuid[])` },
  { table: "work_order_status_history", where: `work_order_id = any($1::uuid[])` },
  { table: "approvals", where: `work_order_id = any($1::uuid[]) or parts_request_id = any($2::uuid[])` },
  { table: "parts_request_attachments", where: `parts_request_id = any($2::uuid[])` },
  { table: "parts_request_items", where: `parts_request_id = any($2::uuid[])` },
  { table: "parts_requests", where: `id = any($2::uuid[])` },
  { table: "general_inventory_request_items", where: `request_id = any($3::uuid[])` },
  { table: "general_inventory_requests", where: `id = any($3::uuid[])` },
  { table: "notification_delivery_logs", where: `notification_id in (select id from notifications where entity_id = any($4::uuid[]))` },
  { table: "notifications", where: `entity_id = any($4::uuid[])` },
  { table: "workflow_step_instances", where: `workflow_inst_id in (select id from workflow_instances where entity_id = any($1::uuid[]))` },
  { table: "workflow_instances", where: `entity_id = any($1::uuid[])` },
  { table: "realtime_events", where: `entity_id = any($4::uuid[])` },
];
const DELETE_ORDER = [...SCOPE_TABLES, { table: "work_orders", where: `id = any($1::uuid[])` }];

// Fingerprinted before and after: these must not change at all.
const PROTECTED_TABLES = [
  "profiles", "auth_users", "roles", "permissions", "role_permissions", "user_permission_overrides", "departments",
  "assets", "asset_categories", "asset_locations", "asset_movements", "asset_documents", "worker_profiles",
  "service_contracts", "app_settings", "notification_events", "notification_templates", "workflow_definitions", "workflow_steps",
];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const EXECUTE = args.execute === true;
const REHEARSAL = args.rehearsal === true;

const prisma = new PrismaClient({ log: ["error"] });

const norm = (s) => (s ?? "").toLowerCase().trim();
// Must match buildBalanceKey() in lib/store/offline-inventory-data.ts.
const keyOf = (m) => (m.part_id ? `part:${m.part_id}` : `manual:${norm(m.manual_material_name)}|${norm(m.unit)}`);
const hashOf = (scope) => createHash("sha256").update(JSON.stringify(scope)).digest("hex");
const toJson = (rows) => JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
const q = async (db, sql, ...params) => toJson(await db.$queryRawUnsafe(sql, ...params));

async function verifyEnvironment(db) {
  const [s] = await q(
    db,
    `select current_database() db, host(inet_server_addr()) addr, inet_server_port() port,
            (select system_identifier::text from pg_control_system()) sysid,
            current_setting('data_directory') datadir, version() version`
  );
  console.log(`Server: database=${s.db} address=${s.addr} port=${s.port} system_id=${s.sysid} data=${s.datadir}`);
  const problems = [];
  const databaseOk = s.db === AUTHORIZED.database || (REHEARSAL && /_test$/.test(s.db));
  if (!databaseOk) problems.push(`database is "${s.db}"`);
  if (!["127.0.0.1", "::1"].includes(s.addr)) problems.push(`server address ${s.addr} is not loopback`);
  if (Number(s.port) !== AUTHORIZED.port) problems.push(`port ${s.port}`);
  if (s.sysid !== AUTHORIZED.systemIdentifier) problems.push(`system identifier ${s.sysid}`);
  if (s.datadir !== AUTHORIZED.dataDirectory) problems.push(`data directory ${s.datadir}`);
  if (problems.length) throw new Error(`Not the authorized local database: ${problems.join("; ")}.`);
  return s;
}

async function fingerprint(db) {
  const result = {};
  for (const table of PROTECTED_TABLES) {
    const [r] = await q(db, `select count(*)::int n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') h from public.${table} t`);
    result[table] = `${r.n}:${r.h}`;
  }
  return result;
}

function materialReport(movements, settings, ctx) {
  const byKey = new Map();
  const entry = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, movements: [], settings: null });
    return byKey.get(key);
  };
  for (const m of movements) entry(keyOf(m)).movements.push(m);
  for (const s of settings) entry(keyOf(s)).settings = s;

  return [...byKey.values()]
    .map((e) => {
      const latest = e.movements.at(-1) ?? null;
      let balance = 0;
      for (const m of e.movements) {
        const n = Number(m.quantity);
        if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += n;
        else if (m.movement_type === "ISSUED") balance -= n;
      }
      const lastCost = [...e.movements].sort((a, b) => a.movement_date - b.movement_date || a.created_at - b.created_at).filter((m) => m.unit_cost !== null).at(-1)?.unit_cost ?? null;
      return {
        key: e.key,
        name: latest?.manual_material_name ?? e.settings?.manual_material_name ?? "(no name)",
        unit: latest?.unit ?? e.settings?.unit ?? "",
        itemCode: e.settings?.item_code ?? null,
        location: e.settings?.archived_at ? "archived" : "active",
        balance: Math.round(balance * 1000) / 1000,
        stockValue: balance > 0 && lastCost !== null ? Math.round(balance * Number(lastCost) * 1000) / 1000 : 0,
        received: e.movements.filter((m) => m.movement_type === "RECEIVED").length,
        issued: e.movements.filter((m) => m.movement_type === "ISSUED").length,
        opening: e.movements.filter((m) => m.movement_type === "OPENING_STOCK").length,
        jobCards: [...new Set(e.movements.map((m) => ctx.numberById.get(m.related_work_order_id)).filter(Boolean))].sort(),
        movementIds: e.movements.map((m) => m.id).sort(),
        settingsId: e.settings?.id ?? null,
      };
    })
    .sort((a, b) => a.location.localeCompare(b.location) || a.key.localeCompare(b.key));
}

async function collect(db) {
  const [workOrders, partsRequests, generalRequests, movements, settings] = await Promise.all([
    db.work_orders.findMany({ select: { id: true, work_order_number: true, status: true, ordered_by: true, deleted_at: true }, orderBy: { work_order_number: "asc" } }),
    db.parts_requests.findMany({ select: { id: true, parts_request_number: true, status: true, work_order_id: true }, orderBy: { parts_request_number: "asc" } }),
    db.general_inventory_requests.findMany({ select: { id: true, request_number: true, status: true }, orderBy: { request_number: "asc" } }),
    db.offline_inventory_movements.findMany({ where: { deleted_at: null }, orderBy: { created_at: "asc" } }),
    db.inventory_material_settings.findMany(),
  ]);

  const wo = workOrders.map((w) => w.id).sort();
  const pr = partsRequests.map((r) => r.id).sort();
  const gen = generalRequests.map((r) => r.id).sort();
  const entities = [...wo, ...pr, ...gen];
  const params = [wo, pr, gen, entities];

  // Row ids per scoped table; the approval hash covers every one of them.
  const rows = {};
  for (const { table, where } of DELETE_ORDER) {
    const needed = Math.max(...[...where.matchAll(/\$(\d)/g)].map((m) => Number(m[1])));
    const found = await q(db, `select id::text from public.${table} where ${where} order by id`, ...params.slice(0, needed));
    rows[table] = found.map((r) => r.id);
  }

  const numberById = new Map(workOrders.map((w) => [w.id, w.work_order_number]));
  const materials = materialReport(movements, settings, { numberById });

  // Stop conditions: anything outside the confirmed demo set.
  const blockers = [];
  for (const table of MUST_BE_EMPTY) {
    const [{ n }] = await q(db, `select count(*)::int n from public.${table}`);
    if (n > 0) blockers.push(`${table} has ${n} row(s)`);
  }
  if (partsRequests.some((r) => !r.work_order_id || !wo.includes(r.work_order_id))) blockers.push("a Materials Request is not on a scoped Job Card");
  if (movements.some((m) => m.part_id)) blockers.push("a movement is linked to a catalog part");
  if (settings.some((s) => s.part_id)) blockers.push("a settings row is linked to a catalog part");
  if (settings.some((s) => s.item_code)) blockers.push("a material has an Item Code, so it may be real data");
  if (workOrders.some((w) => w.deleted_at)) blockers.push("a Job Card is already soft-deleted");

  // Generic: any foreign key into a scoped table from a table that this run
  // does not clear must have no rows pointing at scoped rows.
  const cleared = new Set(DELETE_ORDER.map((t) => t.table));
  const fks = await q(
    db,
    `select c.conrelid::regclass::text child, c.confrelid::regclass::text parent, a.attname col, c.confdeltype del
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`
  );
  const setNullLinks = [];
  for (const fk of fks.filter((f) => cleared.has(f.parent) && !cleared.has(f.child))) {
    const ids = rows[fk.parent];
    const [{ n }] = await q(db, `select count(*)::int n from public.${fk.child} where ${fk.col} = any($1::uuid[])`, ids);
    if (n === 0) continue;
    if (fk.child === "offline_inventory_movements") setNullLinks.push({ column: fk.col, rows: n });
    else blockers.push(`${fk.child}.${fk.col} has ${n} row(s) pointing at ${fk.parent}`);
  }

  const [softDeleted, orphanNotifications, orphanWorkflows, orphanRealtime, batches, audit] = await Promise.all([
    db.offline_inventory_movements.count({ where: { deleted_at: { not: null } } }),
    q(db, `select count(*)::int n from notifications where entity_id is not null and not (entity_id = any($1::uuid[]))`, entities),
    q(db, `select count(*)::int n from workflow_instances where not (entity_id = any($1::uuid[]))`, wo),
    q(db, `select count(*)::int n from realtime_events where entity_id is null or not (entity_id = any($1::uuid[]))`, entities),
    db.inventory_material_import_batches.count(),
    db.audit_logs.count(),
  ]);

  const counts = Object.fromEntries(Object.entries(rows).map(([t, ids]) => [t, ids.length]));
  const actual = {
    ...counts,
    movements: movements.length,
    settings: settings.length,
    activeMaterials: materials.filter((m) => m.location === "active").length,
    archivedMaterials: materials.filter((m) => m.location === "archived").length,
    alreadySoftDeletedMovements: softDeleted,
  };
  for (const [name, expected] of Object.entries(EXPECTED)) {
    if (actual[name] !== expected) blockers.push(`${name}: expected ${expected}, found ${actual[name]}`);
  }

  return {
    workOrders,
    partsRequests,
    generalRequests,
    materials,
    rows,
    movementIds: movements.map((m) => m.id).sort(),
    settingsIds: settings.map((s) => s.id).sort(),
    counts: actual,
    blockers,
    setNullLinks,
    retained: {
      softDeletedMovements: softDeleted,
      auditLogs: audit,
      importBatches: batches,
      notificationsOutsideScope: orphanNotifications[0].n,
      workflowInstancesOutsideScope: orphanWorkflows[0].n,
      realtimeEventsOutsideScope: orphanRealtime[0].n,
    },
  };
}

// The approval covers exactly these rows; any change gives a new hash.
const approvalScope = (c) => ({ rows: c.rows, movementIds: c.movementIds, settingsIds: c.settingsIds });

function printReport(c, sha) {
  console.log(`\nMode: ${EXECUTE ? "EXECUTE" : "DRY RUN (read-only transaction)"}\n`);
  console.log(`JOB CARDS (${c.workOrders.length})`);
  for (const w of c.workOrders) console.log(`  ${w.work_order_number}  ${w.status}  ordered by: ${w.ordered_by ?? "-"}  ${w.id}`);
  console.log(`\nMATERIALS REQUESTS (${c.partsRequests.length})`);
  for (const r of c.partsRequests) console.log(`  ${r.parts_request_number}  ${r.status}  ${r.id}`);
  console.log(`\nGENERAL MATERIALS REQUESTS (${c.generalRequests.length})`);
  for (const r of c.generalRequests) console.log(`  ${r.request_number}  ${r.status}  ${r.id}`);
  console.log(`\nMATERIALS (${c.counts.activeMaterials} active, ${c.counts.archivedMaterials} archived)`);
  for (const m of c.materials) {
    console.log(`  ${m.location.padEnd(8)} ${m.key}  code=${m.itemCode ?? "-"} balance=${m.balance} value=${m.stockValue.toFixed(3)} rcv=${m.received} iss=${m.issued} open=${m.opening}${m.jobCards.length ? ` JC: ${m.jobCards.join(", ")}` : ""}`);
  }
  console.log(`\nRECORDS TO REMOVE`);
  for (const [t, ids] of Object.entries(c.rows)) console.log(`  delete       ${t}: ${ids.length}`);
  console.log(`  soft-delete  offline_inventory_movements: ${c.movementIds.length}`);
  console.log(`  delete       inventory_material_settings: ${c.settingsIds.length}`);
  console.log(`\nRETAINED`);
  for (const [k, v] of Object.entries(c.retained)) console.log(`  ${k}: ${v}`);
  for (const s of c.setNullLinks) console.log(`  link cleared by foreign key on deleted Job Cards: offline_inventory_movements.${s.column}, ${s.rows} row(s) (being soft-deleted; numbers kept in the audit record)`);
  console.log(`\nBLOCKERS (${c.blockers.length})`);
  for (const b of c.blockers) console.log(`  ${b}`);
  console.log(`\nApproval hash: ${sha}\n`);
}

function verifyBackup(file) {
  if (!file || !existsSync(file)) throw new Error("--backup file not found.");
  const relative = path.relative(process.cwd(), path.resolve(file));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Backup must be stored outside the application repository.");
  const stat = statSync(file);
  const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
  if (stat.size === 0 || ageMinutes > BACKUP_MAX_AGE_MINUTES) throw new Error(`Backup must be non-empty and under ${BACKUP_MAX_AGE_MINUTES} minutes old.`);
  const listing = execFileSync(PG_RESTORE, ["--list", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const table of ["offline_inventory_movements", "inventory_material_settings", "work_orders", "work_order_work_sessions", "parts_requests", "general_inventory_requests", "audit_logs", "assets", "worker_profiles", "profiles"]) {
    if (!listing.includes(`TABLE DATA public ${table}`)) throw new Error(`Backup has no data for ${table}.`);
  }
  console.log(`Backup verified: ${file} (${stat.size} bytes, ${ageMinutes.toFixed(1)} min old).`);
}

async function execute() {
  verifyBackup(args.backup);
  if (!args.manifest || !args["confirm-sha256"]) throw new Error("--manifest and --confirm-sha256 are required.");
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const sha = args["confirm-sha256"];
  if (hashOf(manifest.scope) !== sha) throw new Error("--confirm-sha256 does not match the report.");

  const actor = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug: "super_admin" } }, select: { id: true } });
  if (!actor) throw new Error("No active Super Admin profile for the audit record.");

  const result = await prisma.$transaction(
    async (tx) => {
      const server = await verifyEnvironment(tx);
      if (manifest.database !== server.db) throw new Error(`Report is for "${manifest.database}", not "${server.db}".`);
      await tx.$executeRaw`select set_config('app.current_profile_id', ${actor.id}, true)`;

      // Hold new work out while checking: Job Card rows plus the same
      // per-material locks Issue Material takes, in a stable order.
      await tx.$queryRawUnsafe(`select id from public.work_orders order by id for update`);
      for (const m of [...manifest.materials].sort((a, b) => a.key.localeCompare(b.key))) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${m.key}, 0))`;
      }

      const current = await collect(tx);
      if (current.blockers.length) throw new Error(`Blocked: ${current.blockers.join("; ")}`);
      if (hashOf(approvalScope(current)) !== sha) throw new Error("Data changed since the approved dry run. Nothing was changed; run a new dry run.");
      const protectedBefore = await fingerprint(tx);

      const now = new Date();
      const updated = await tx.offline_inventory_movements.updateMany({
        where: { id: { in: current.movementIds }, deleted_at: null },
        data: { deleted_at: now, updated_at: now },
      });
      if (updated.count !== current.movementIds.length) throw new Error("Movement count mismatch.");

      const settings = await tx.inventory_material_settings.deleteMany({ where: { id: { in: current.settingsIds } } });
      if (settings.count !== current.settingsIds.length) throw new Error("Settings count mismatch.");

      const removed = {};
      for (const { table } of DELETE_ORDER) {
        const ids = current.rows[table];
        const n = ids.length ? await tx.$executeRawUnsafe(`delete from public.${table} where id = any($1::uuid[])`, ids) : 0;
        if (n !== ids.length) throw new Error(`${table}: expected to remove ${ids.length}, removed ${n}.`);
        removed[table] = n;
      }

      // Evidence that outlives the deleted rows.
      await tx.audit_logs.create({
        data: {
          actor_id: actor.id,
          action: AUDIT_ACTION,
          entity_type: "demo_data_cleanup",
          summary: `One-time local demo cleanup: ${removed.work_orders} Job Cards, ${removed.parts_requests} Materials Requests, ${removed.general_inventory_requests} General Requests, ${current.materials.length} materials`,
          metadata: {
            approvalHash: sha,
            backup: path.resolve(args.backup),
            removed,
            movementsSoftDeleted: updated.count,
            settingsRemoved: settings.count,
            jobCards: current.workOrders.map((w) => w.work_order_number),
            materialsRequests: current.partsRequests.map((r) => r.parts_request_number),
            generalRequests: current.generalRequests.map((r) => r.request_number),
            materials: current.materials.map(({ key, name, unit, balance, location }) => ({ key, name, unit, balance, location })),
          },
        },
      });

      // Post-conditions, still inside the transaction.
      const [after] = await q(
        tx,
        `select (select count(*)::int from work_orders) work_orders,
                (select count(*)::int from work_order_work_sessions) sessions,
                (select count(*)::int from parts_requests) parts_requests,
                (select count(*)::int from general_inventory_requests) general_requests,
                (select count(*)::int from offline_inventory_movements where deleted_at is null) live_movements,
                (select count(*)::int from inventory_material_settings) settings`
      );
      if (Object.values(after).some((n) => n !== 0)) throw new Error(`Post-check failed: ${JSON.stringify(after)}`);
      const protectedAfter = await fingerprint(tx);
      const changed = PROTECTED_TABLES.filter((t) => protectedBefore[t] !== protectedAfter[t]);
      if (changed.length) throw new Error(`Protected data changed: ${changed.join(", ")}`);

      return { removed, movementsSoftDeleted: updated.count, settingsRemoved: settings.count, after };
    },
    { maxWait: 10000, timeout: 180000 }
  );
  console.log("DONE");
  console.log(JSON.stringify(result, null, 2));
}

try {
  if (EXECUTE) {
    await execute();
  } else {
    const { server, report } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return { server: await verifyEnvironment(tx), report: await collect(tx) };
      },
      { timeout: 60000 }
    );
    const scope = approvalScope(report);
    const sha = hashOf(scope);
    printReport(report, sha);
    if (args.out) {
      writeFileSync(args.out, JSON.stringify({ database: server.db, server, generatedAt: new Date().toISOString(), sha256: sha, scope, ...report }, null, 2));
      console.log(`Report written: ${args.out}`);
    }
    if (report.blockers.length) process.exitCode = 2;
  }
} catch (error) {
  console.error(`STOPPED: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
