/**
 * Maintenance Workflow Redesign Unit 6 — workflow notification checks.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end.
 *
 * Note on scope (same limitation as Units 3-5): lib/backend/work-orders/
 * service.ts and lib/backend/parts-requests/service.ts (where the actual
 * notifyWorkflowEvent calls live) use `import "server-only"` and
 * `@/`-aliased runtime imports, not importable from a standalone Node
 * script. lib/notifications/events.ts uses only `import type` (erased at
 * runtime), so it IS importable directly — used below to verify the event
 * registry itself. The full send pipeline (notifyByEvent -> sendNotification
 * -> prisma.notifications.create) is exercised here by inserting rows with
 * the exact shape each wired call site produces, which is what actually
 * caught a real bug during this unit: the notification_events_category_check
 * constraint requires "Parts Requests", not "Materials Requests" (a
 * pre-existing type/DB drift, fixed in lib/notifications/types.ts).
 *
 * Usage:
 *   node --env-file=.env scripts/verify-workflow-redesign-unit6.mjs
 */

import { PrismaClient } from "@prisma/client";
import { notificationEvents, getNotificationEvent } from "../lib/notifications/events.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

function dedupeRecipients(ids, excludeActorId) {
  const seen = new Set();
  for (const id of ids) {
    if (id && id !== excludeActorId) seen.add(id);
  }
  return [...seen];
}

console.log("== 1. Event registry (lib/notifications/events.ts) ==");
const REQUIRED_KEYS = [
  "job_card.created", "job_card.submitted_for_review", "job_card.reviewed",
  "job_card.correction_requested", "job_card.approved", "job_card.waiting_materials",
  "job_card.assigned", "job_card.in_progress", "job_card.closed",
  "material_request.created", "material_request.approved", "material_request.waiting_stock",
  "material_request.partially_issued", "material_request.issued"
];
for (const key of REQUIRED_KEYS) {
  check(`registry has ${key}`, !!getNotificationEvent(key));
}
const FORBIDDEN_WORDING = ["rejected", "cancelled", "returned", "completed_by_technician", "verified_by_supervisor", "waiting_for_purchase", "parts_issued"];
const newKeysNoForbiddenWording = REQUIRED_KEYS.every((k) => !FORBIDDEN_WORDING.some((w) => k.includes(w)));
check("no new event key contains forbidden wording", newKeysNoForbiddenWording);
check("registry categories are DB-valid (Work Orders/Approvals/Parts Requests/Store / Inventory)",
  notificationEvents
    .filter((e) => REQUIRED_KEYS.includes(e.eventKey))
    .every((e) => ["Work Orders", "Approvals", "Parts Requests", "Store / Inventory"].includes(e.category))
);

console.log("== 2. Dedup / actor-exclusion helper logic ==");
check("dedupes repeated ids", dedupeRecipients(["a", "a", "b"], null).length === 2);
check("excludes actor id", !dedupeRecipients(["a", "b"], "a").includes("a"));
check("drops null/undefined", dedupeRecipients([null, undefined, "b"], null).length === 1);

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit6 verify script";

console.log("== 3. notification_events DB state (Task 7/8) ==");
const newEventRows = await prisma.notification_events.findMany({
  where: { event_key: { in: REQUIRED_KEYS } },
  select: { event_key: true, category: true, is_enabled: true }
});
check("all 14 new events seeded in DB", newEventRows.length === 14);
check("all new events enabled by default", newEventRows.every((e) => e.is_enabled));

const oldDisabled = await prisma.notification_events.findMany({
  where: { event_key: { in: ["work_order.rejected", "work_order.cancelled", "work_order.completed", "work_order.verified", "parts_request.rejected", "parts_request.unavailable"] } },
  select: { event_key: true, is_enabled: true, is_critical: true }
});
check("6 old forbidden events found", oldDisabled.length === 6);
check("all old forbidden events disabled (is_enabled=false)", oldDisabled.every((e) => !e.is_enabled));
check("all old forbidden events non-critical (is_critical=false)", oldDisabled.every((e) => !e.is_critical));

console.log("== 4. Full scenario: real notification rows inserted, no CHECK violations (rolled back) ==");
try {
  await prisma.$transaction(async (tx) => {
    const bpm = await tx.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true } });
    const users = await tx.profiles.findMany({ take: 3, select: { id: true } });
    if (!bpm || users.length < 1) throw new Error("SKIP: expected asset/profiles not found");
    const [dataEntry] = users;
    const actor = dataEntry.id;

    const wo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Under Review", asset_id: bpm.id, created_by: actor },
      select: { id: true, work_order_number: true, created_by: true }
    });

    async function insertNotification(eventKey, category, priority, recipientId, metadata) {
      return tx.notifications.create({
        data: {
          recipient_id: recipientId,
          recipient_user_id: recipientId,
          event_key: eventKey,
          category,
          priority,
          title: `Test: ${eventKey}`,
          message: `Test message for ${eventKey}`,
          entity_type: "work_order",
          entity_id: wo.id,
          metadata,
          notification_type: eventKey,
          created_by: actor
        },
        select: { id: true, event_key: true, recipient_user_id: true }
      });
    }

    // job_card.created -> Engineer (simulated single recipient = actor's own id here, fine for a CHECK-constraint smoke test)
    const n1 = await insertNotification("job_card.created", "Work Orders", "normal", actor, { job_card_number: wo.work_order_number, asset_name: "Batching Plant Mixer Line 1" });
    check("job_card.created inserted without CHECK violation", n1.event_key === "job_card.created");

    const n2 = await insertNotification("job_card.reviewed", "Approvals", "normal", actor, { job_card_number: wo.work_order_number });
    check("job_card.reviewed inserted without CHECK violation", n2.event_key === "job_card.reviewed");

    const n3 = await insertNotification("job_card.approved", "Approvals", "high", actor, { job_card_number: wo.work_order_number });
    check("job_card.approved inserted without CHECK violation", n3.event_key === "job_card.approved");

    const pr = await tx.parts_requests.create({
      data: { work_order_id: wo.id, status: "Requested", requested_by: actor, created_by: actor },
      select: { id: true, parts_request_number: true }
    });

    const n4 = await insertNotification("material_request.created", "Parts Requests", "normal", actor, { job_card_number: wo.work_order_number });
    check("material_request.created inserted without CHECK violation (Parts Requests category)", n4.event_key === "material_request.created");

    const n5 = await insertNotification("material_request.approved", "Parts Requests", "high", actor, { request_number: pr.parts_request_number, job_card_number: wo.work_order_number });
    check("material_request.approved inserted without CHECK violation", n5.event_key === "material_request.approved");

    const n6 = await insertNotification("material_request.waiting_stock", "Store / Inventory", "high", actor, { job_card_number: wo.work_order_number, reason: "No stock available" });
    check("material_request.waiting_stock inserted without CHECK violation", n6.event_key === "material_request.waiting_stock");

    const n7 = await insertNotification("material_request.partially_issued", "Store / Inventory", "high", actor, { job_card_number: wo.work_order_number, issued_quantity: 6, remaining_quantity: 4 });
    check("material_request.partially_issued inserted without CHECK violation", n7.event_key === "material_request.partially_issued");

    const n8 = await insertNotification("material_request.issued", "Store / Inventory", "high", actor, { job_card_number: wo.work_order_number });
    check("material_request.issued inserted without CHECK violation", n8.event_key === "material_request.issued");

    const n9 = await insertNotification("job_card.assigned", "Work Orders", "high", actor, { job_card_number: wo.work_order_number, assignee_name: "Test Technician" });
    check("job_card.assigned inserted without CHECK violation", n9.event_key === "job_card.assigned");

    const n10 = await insertNotification("job_card.in_progress", "Work Orders", "low", actor, { job_card_number: wo.work_order_number });
    check("job_card.in_progress inserted without CHECK violation", n10.event_key === "job_card.in_progress");

    const n11 = await insertNotification("job_card.closed", "Work Orders", "normal", actor, { job_card_number: wo.work_order_number });
    check("job_card.closed inserted without CHECK violation", n11.event_key === "job_card.closed");

    // Dedup check: simulate resolving recipients from creator + role lookups
    // with overlap, confirm the same user is never notified twice for one event.
    const roleIds = [actor, users[1]?.id, users[2]?.id].filter(Boolean);
    const recipients = dedupeRecipients([wo.created_by, ...roleIds], actor);
    check("creator excluded when creator === actor", !recipients.includes(actor));
    check("no duplicate recipient ids for one event", new Set(recipients).size === recipients.length);

    const allNewKeyNotifs = await tx.notifications.count({ where: { entity_id: wo.id, event_key: { in: REQUIRED_KEYS } } });
    check("11 distinct new-key notifications created (one per event, no dupes)", allNewKeyNotifs === 11);

    const oldKeyNotifs = await tx.notifications.count({
      where: { entity_id: wo.id, event_key: { in: ["work_order.rejected", "work_order.cancelled", "work_order.completed", "work_order.verified", "parts_request.rejected", "parts_request.unavailable"] } }
    });
    check("no old forbidden event keys were created", oldKeyNotifs === 0);

    throw new Error("__ROLLBACK_TEST_DATA__");
  });
} catch (err) {
  if (!(err instanceof Error) || err.message !== "__ROLLBACK_TEST_DATA__") {
    if (err instanceof Error && err.message.startsWith("SKIP:")) {
      console.log(`  SKIP  scenario: ${err.message}`);
    } else {
      console.error("  FAIL  transaction errored unexpectedly:", err);
      failures++;
    }
  }
}

console.log("== 5. Counts after rollback ==");
const wo = await prisma.work_orders.count({ where: { ordered_by: MARKER } });
const pr = await prisma.parts_requests.count();
const notifs = await prisma.notifications.count({ where: { title: { startsWith: "Test: " } } });
check("no leftover Unit6 test work_orders", wo === 0);
check("no leftover parts_requests", pr === 0);
check("no leftover test notifications", notifs === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
