/**
 * ONE-TIME removal of one Material Master import batch from the LOCAL
 * development database. Run by hand only; no route, action or button calls
 * this file. Delete it once the cleanup is finished.
 *
 * DRY RUN (default) — runs inside a READ ONLY transaction, changes nothing:
 *   node --env-file=.env scripts/one-time-import-batch-cleanup.mjs --out=<report.json>
 *
 * EXECUTE — needs the dry-run report, its hash and a verified backup:
 *   node --env-file=.env scripts/one-time-import-batch-cleanup.mjs --execute \
 *     --manifest=<report.json> --confirm-sha256=<hash> --backup=<file.dump>
 *
 * Scope: only the materials created by BATCH_ID. Each is one zero-quantity
 * OPENING_STOCK registration row plus one settings row. The run stops if any
 * active material is outside the batch, or if a material has stock, a cost, a
 * link, a reference or an edit since it was imported.
 *
 * Registration rows are soft-deleted (deleted_at) and settings rows removed,
 * as the Inventory Control delete does. Earlier soft-deleted rows and the
 * import batch record are not touched; one audit record marks the removal.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const BATCH_ID = "c54d4187-2507-461e-8190-fd61942fed33";
const BATCH_REFERENCE = "MATERIAL-IMPORT-20261031-084634-QRT6";
const EXPECTED_MATERIALS = 1523;

const PG_RESTORE = "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe";
const BACKUP_MAX_AGE_MINUTES = 60;
const IMPORT_LOCK_KEY = "inventory_material_master_import";

const AUTHORIZED = {
  database: "recafco_maintenance",
  port: 5432,
  systemIdentifier: "7653403403654498784",
  dataDirectory: "C:/Program Files/PostgreSQL/18/data",
};

// Must be empty: anything here means the materials may be in use.
const MUST_BE_EMPTY = [
  "work_orders", "work_order_required_parts", "work_order_materials", "work_order_work_sessions",
  "parts_requests", "parts_request_items", "general_inventory_requests", "general_inventory_request_items",
  "purchase_requests", "purchase_request_items", "purchase_orders", "purchase_order_items", "inventory_movements", "parts",
];

// Fingerprinted before and after: these must not change at all.
const PROTECTED_TABLES = [
  "profiles", "auth_users", "roles", "permissions", "role_permissions", "user_permission_overrides", "departments",
  "assets", "asset_categories", "asset_locations", "asset_movements", "worker_profiles", "service_contracts",
  "app_settings", "inventory_material_import_batches",
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
const keyOf = (m) => `manual:${norm(m.manual_material_name)}|${norm(m.unit)}`;
const hashOf = (scope) => createHash("sha256").update(JSON.stringify(scope)).digest("hex");
const q = async (db, sql, ...params) => JSON.parse(JSON.stringify(await db.$queryRawUnsafe(sql, ...params), (_, v) => (typeof v === "bigint" ? Number(v) : v)));

async function verifyEnvironment(db) {
  const [s] = await q(
    db,
    `select current_database() db, host(inet_server_addr()) addr, inet_server_port() port,
            (select system_identifier::text from pg_control_system()) sysid, current_setting('data_directory') datadir`
  );
  console.log(`Server: database=${s.db} address=${s.addr} port=${s.port} system_id=${s.sysid} data=${s.datadir}`);
  const problems = [];
  if (!(s.db === AUTHORIZED.database || (REHEARSAL && /_test$/.test(s.db)))) problems.push(`database is "${s.db}"`);
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

async function collect(db) {
  const blockers = [];
  const [batch, movements, settings, softDeleted] = await Promise.all([
    db.inventory_material_import_batches.findUnique({ where: { id: BATCH_ID } }),
    db.offline_inventory_movements.findMany({ where: { deleted_at: null } }),
    db.inventory_material_settings.findMany(),
    db.offline_inventory_movements.count({ where: { deleted_at: { not: null } } }),
  ]);
  if (!batch) blockers.push(`Import batch ${BATCH_ID} not found.`);
  else {
    if (batch.batch_reference !== BATCH_REFERENCE) blockers.push(`Batch reference is ${batch.batch_reference}.`);
    if (batch.imported_count !== EXPECTED_MATERIALS) blockers.push(`Batch imported_count is ${batch.imported_count}.`);
  }

  for (const table of MUST_BE_EMPTY) {
    const [{ n }] = await q(db, `select count(*)::int n from public.${table}`);
    if (n > 0) blockers.push(`${table} has ${n} row(s).`);
  }
  const fks = await q(
    db,
    `select conrelid::regclass::text child from pg_constraint
      where contype = 'f' and confrelid::regclass::text in ('offline_inventory_movements', 'inventory_material_settings')`
  );
  for (const fk of fks) blockers.push(`Unexpected foreign key from ${fk.child}.`);

  const count = (f) => movements.filter(f).length;
  const outside = count((m) => m.reference_number !== BATCH_REFERENCE);
  if (outside) blockers.push(`${outside} active movement(s) are outside the batch.`);
  const notRegistration = count((m) => m.movement_type !== "OPENING_STOCK" || Number(m.quantity) !== 0);
  if (notRegistration) blockers.push(`${notRegistration} movement(s) are not zero-quantity registrations.`);
  const priced = count((m) => m.unit_cost !== null || m.total_cost !== null);
  if (priced) blockers.push(`${priced} movement(s) have a cost.`);
  const linked = count((m) => m.part_id || m.related_work_order_id || m.parts_request_id);
  if (linked) blockers.push(`${linked} movement(s) are linked to a part, Job Card or request.`);
  if (movements.length !== EXPECTED_MATERIALS) blockers.push(`Expected ${EXPECTED_MATERIALS} active movements, found ${movements.length}.`);
  if (settings.length !== EXPECTED_MATERIALS) blockers.push(`Expected ${EXPECTED_MATERIALS} settings rows, found ${settings.length}.`);

  const movementByKey = new Map();
  for (const m of movements) {
    if (movementByKey.has(keyOf(m))) blockers.push(`More than one movement for ${keyOf(m)}.`);
    movementByKey.set(keyOf(m), m);
  }
  const materials = [];
  for (const s of settings) {
    const m = movementByKey.get(keyOf(s));
    if (!m) blockers.push(`Settings row ${s.id} has no batch movement.`);
    if (!s.item_code) blockers.push(`Settings row ${s.id} has no Item Code.`);
    if (s.archived_at) blockers.push(`Settings row ${s.id} is archived.`);
    if (s.part_id) blockers.push(`Settings row ${s.id} is a catalog part.`);
    const edited = s.category !== null || s.part_number !== null || s.ss_rec_code !== null || s.location !== null || s.remarks !== null ||
      s.minimum_stock_quantity !== null || s.reorder_quantity !== null || s.purchase_unit !== null || s.conversion_quantity !== null ||
      s.updated_at.getTime() !== s.created_at.getTime();
    if (edited) blockers.push(`Material ${s.item_code} was changed after import.`);
    if (m) materials.push({ itemCode: s.item_code, name: m.manual_material_name, unit: m.unit, movementId: m.id, settingsId: s.id });
  }
  materials.sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  const balance = movements.reduce((sum, m) => sum + (m.movement_type === "ISSUED" ? -Number(m.quantity) : ["RECEIVED", "OPENING_STOCK"].includes(m.movement_type) ? Number(m.quantity) : 0), 0);
  return { batch, materials, balance, softDeleted, activeMovements: movements.length, settingsRows: settings.length, blockers };
}

function printReport(c, sha) {
  console.log(`\nMode: ${EXECUTE ? "EXECUTE" : "DRY RUN (read-only transaction)"}`);
  console.log(`Batch: ${c.batch?.id} ${c.batch?.batch_reference} file=${c.batch?.file_name} rows=${c.batch?.total_rows} imported=${c.batch?.imported_count}`);
  console.log(`Materials selected: ${c.materials.length}   Archived: 0   Balance: ${c.balance}`);
  console.log(`First: ${c.materials[0]?.itemCode}  ${c.materials[0]?.name}`);
  console.log(`Last:  ${c.materials.at(-1)?.itemCode}  ${c.materials.at(-1)?.name}`);
  console.log(`Linked Job Cards: 0   Linked requests: 0   (those tables must be empty to pass)`);
  console.log(`Proposed: soft-delete ${c.activeMovements} registration row(s), remove ${c.settingsRows} settings row(s), write 1 audit record.`);
  console.log(`Retained: ${c.softDeleted} earlier soft-deleted movement(s), all import batches, all audit logs.`);
  console.log(`Blockers: ${c.blockers.length}`);
  for (const b of c.blockers.slice(0, 40)) console.log(`  ${b}`);
  console.log(`Approval hash: ${sha}\n`);
}

function verifyBackup(file) {
  if (!file || !existsSync(file)) throw new Error("--backup file not found.");
  const relative = path.relative(process.cwd(), path.resolve(file));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Backup must be stored outside the application repository.");
  const stat = statSync(file);
  const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
  if (stat.size === 0 || ageMinutes > BACKUP_MAX_AGE_MINUTES) throw new Error(`Backup must be non-empty and under ${BACKUP_MAX_AGE_MINUTES} minutes old.`);
  const listing = execFileSync(PG_RESTORE, ["--list", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const table of ["offline_inventory_movements", "inventory_material_settings", "inventory_material_import_batches", "audit_logs", "assets", "worker_profiles", "profiles"]) {
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

      // The import lock, then the per-material lock Issue Material also takes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))`;
      for (const key of [...new Set(manifest.scope.map(keyOf2))].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      }

      const current = await collect(tx);
      if (current.blockers.length) throw new Error(`Blocked: ${current.blockers.slice(0, 5).join(" ")}`);
      if (hashOf(current.materials) !== sha) throw new Error("Data changed since the approved dry run. Nothing was changed; run a new dry run.");
      const protectedBefore = await fingerprint(tx);

      const now = new Date();
      const movementIds = current.materials.map((m) => m.movementId);
      const settingsIds = current.materials.map((m) => m.settingsId);
      const movements = await tx.offline_inventory_movements.updateMany({ where: { id: { in: movementIds }, deleted_at: null }, data: { deleted_at: now, updated_at: now } });
      if (movements.count !== movementIds.length) throw new Error("Movement count mismatch.");
      const settings = await tx.inventory_material_settings.deleteMany({ where: { id: { in: settingsIds } } });
      if (settings.count !== settingsIds.length) throw new Error("Settings count mismatch.");

      await tx.audit_logs.create({
        data: {
          actor_id: actor.id,
          action: "offline_inventory.material_import_removed",
          entity_type: "inventory_material_import_batch",
          entity_id: BATCH_ID,
          summary: `One-time local cleanup removed all ${movements.count} materials imported by ${BATCH_REFERENCE}`,
          metadata: {
            batchId: BATCH_ID,
            batchReference: BATCH_REFERENCE,
            approvalHash: sha,
            backup: path.resolve(args.backup),
            movementsSoftDeleted: movements.count,
            settingsRemoved: settings.count,
            itemCodes: current.materials.map((m) => m.itemCode),
          },
        },
      });

      const [after] = await q(
        tx,
        `select (select count(*)::int from offline_inventory_movements where deleted_at is null) live,
                (select count(*)::int from offline_inventory_movements where deleted_at is not null) soft_deleted,
                (select count(*)::int from inventory_material_settings) settings`
      );
      if (after.live !== 0 || after.settings !== 0 || after.soft_deleted !== current.softDeleted + movements.count) throw new Error(`Post-check failed: ${JSON.stringify(after)}`);
      const protectedAfter = await fingerprint(tx);
      const changed = PROTECTED_TABLES.filter((t) => protectedBefore[t] !== protectedAfter[t]);
      if (changed.length) throw new Error(`Protected data changed: ${changed.join(", ")}`);
      return { movementsSoftDeleted: movements.count, settingsRemoved: settings.count, after };
    },
    { maxWait: 10000, timeout: 120000 }
  );
  console.log("DONE");
  console.log(JSON.stringify(result));
}

const keyOf2 = (m) => keyOf({ manual_material_name: m.name, unit: m.unit });

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
    const sha = hashOf(report.materials);
    printReport(report, sha);
    if (args.out) {
      writeFileSync(args.out, JSON.stringify({ database: server.db, server, generatedAt: new Date().toISOString(), sha256: sha, scope: report.materials, blockers: report.blockers }, null, 2));
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
