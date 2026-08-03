/**
 * Backend Reliability Fix Unit 1, Task 7 — read-only verification of how
 * work_orders.work_order_number is actually generated in the connected
 * database.
 *
 * Why this exists: the tracked migration history under prisma/migrations/
 * contains no CREATE FUNCTION / CREATE TRIGGER / CREATE SEQUENCE statement
 * for work order numbering, and app/actions/maintenance.ts's
 * upsertWorkOrderAction never sets work_order_number itself — it only reads
 * it back after insert. The only implementation of an atomic, concurrency-
 * safe numbering trigger found anywhere in this repo lives in an ARCHIVED
 * pre-Prisma Supabase migration
 * (docs/archive/supabase-migrations/20260603110000_phase_2_assets_parts_work_orders.sql),
 * which is not part of the deployable migration history. Prisma migrate does
 * not track functions/triggers, so this cannot be confirmed by reading
 * schema.prisma or the migrations folder alone — it must be checked against
 * the live database's actual pg_trigger/pg_proc catalogs.
 *
 * This script only runs read-only catalog queries (pg_trigger, pg_proc,
 * information_schema, and a row count against numbering_sequences if that
 * table exists). It makes no schema or data changes and creates no
 * migration — per this unit's explicit instruction not to implement a
 * migration until the result here is reviewed and approved.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-work-order-numbering.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["error"] });

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 70 - title.length))}`);
}

try {
  section("1. Triggers on public.work_orders");
  const triggers = await prisma.$queryRaw`
    SELECT
      t.tgname AS trigger_name,
      p.proname AS function_name,
      CASE t.tgtype::int & 66
        WHEN 2 THEN 'BEFORE'
        WHEN 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
      END AS timing,
      t.tgenabled AS enabled_flag
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'work_orders'
      AND NOT t.tgisinternal
    ORDER BY t.tgname;
  `;
  if (triggers.length === 0) {
    console.log("  No user-defined triggers found on public.work_orders.");
  } else {
    for (const t of triggers) {
      console.log(`  ${t.trigger_name}  (${t.timing}, enabled='${t.enabled_flag}')  -> function ${t.function_name}()`);
    }
  }

  section("2. Functions whose name looks numbering-related");
  const functions = await prisma.$queryRaw`
    SELECT p.proname AS function_name, n.nspname AS schema_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname ILIKE '%work_order%number%'
       OR p.proname ILIKE '%numbering%'
       OR p.proname ILIKE '%wo_number%'
    ORDER BY function_name;
  `;
  if (functions.length === 0) {
    console.log("  No matching functions found in any schema.");
  } else {
    for (const f of functions) {
      console.log(`  ${f.schema_name}.${f.function_name}()`);
    }
  }

  section("3. numbering_sequences table (legacy Supabase-era mechanism)");
  const tableExists = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'numbering_sequences'
    ) AS exists;
  `;
  if (!tableExists[0]?.exists) {
    console.log("  Table public.numbering_sequences does not exist.");
  } else {
    const rows = await prisma.$queryRaw`
      SELECT key, current_value FROM public.numbering_sequences ORDER BY key;
    `;
    console.log(`  Table exists with ${rows.length} row(s):`);
    for (const r of rows) {
      console.log(`    ${r.key} = ${r.current_value}`);
    }
  }

  section("4. Sample of recent work_order_number values");
  const samples = await prisma.$queryRaw`
    SELECT work_order_number, created_at
    FROM public.work_orders
    ORDER BY created_at DESC
    LIMIT 5;
  `;
  if (samples.length === 0) {
    console.log("  No work_orders rows found.");
  } else {
    for (const s of samples) {
      console.log(`  ${s.work_order_number ?? "(NULL)"}  — created ${s.created_at.toISOString()}`);
    }
  }
  const nullCount = await prisma.work_orders.count({ where: { work_order_number: null } });
  console.log(`\n  work_orders with a NULL work_order_number: ${nullCount}`);

  section("Result");
  const hasTrigger = triggers.length > 0;
  const hasNullNumbers = nullCount > 0;
  if (hasTrigger) {
    console.log("  A trigger IS installed on public.work_orders. Numbering is being generated");
    console.log("  by the live database, not by application code or a tracked migration.");
    console.log("  RECOMMENDATION: create a tracked Prisma migration in a later unit that");
    console.log("  codifies this exact trigger/function, so a database rebuilt from");
    console.log("  prisma/migrations/ alone reproduces the same numbering behavior.");
  } else if (hasNullNumbers) {
    console.log("  No trigger found, AND work_orders rows with NULL work_order_number exist.");
    console.log("  Numbering is not currently being generated at all for at least some rows —");
    console.log("  investigate before making further changes to work order creation.");
  } else {
    console.log("  No trigger/function found, but existing work_order_number values are all");
    console.log("  non-NULL. Numbering may be generated by a mechanism this script does not");
    console.log("  recognize (e.g. a differently-named function) — investigate further before");
    console.log("  concluding this is safe.");
  }
} finally {
  await prisma.$disconnect();
}
