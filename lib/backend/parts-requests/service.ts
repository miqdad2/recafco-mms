import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { dedupeRecipients, notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import {
  assertNoActiveDuplicateMaterialsRequest,
  findPartsRequestForWorkflow,
  findWorkOrderForPartsRequest,
  getJobCardNumber,
  lockPartsRequestForUpdate,
  updatePartsRequestStatus
} from "@/lib/backend/parts-requests/repository";
import { getActiveUserIdsByRoleSlugs } from "@/lib/backend/work-orders/repository";
import type {
  ApprovePartsRequestInput,
  CreatePartsRequestInput,
  EditMaterialsRequestInput,
  IssueMaterialsInput,
  RejectPartsRequestInput
} from "@/lib/backend/parts-requests/validators";
import { AppError } from "@/lib/errors/app-error";
import { canTransition, transitionError } from "@/lib/workflows/status-rules";
import { normalizeCategory } from "@/components/store/offline-inventory-types";
import { emitMaterialsRequestRealtimeEvent, emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";

type PartsRequestResult = {
  partsRequestId: string;
  partsRequestNumber: string | null;
  status: string;
  workOrderId: string | null;
  requestedBy: string | null;
};

// store.issue is the pre-existing, broader permission (also held by
// maintenance_manager); parts_requests.issue is the new, Store-scoped Unit 3
// permission. Checking both preserves Manager's existing issue capability
// (Task 10 says Store "can issue" — it doesn't say Manager's existing access
// must be revoked) without granting Manager a new permission unnecessarily.
function assertCanIssueMaterials(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (context.permissions.includes("parts_requests.issue")) return;
  if (context.permissions.includes("store.issue")) return;
  throw new AppError("You do not have permission to issue materials.", { code: "FORBIDDEN" });
}

function assertCanCreatePartsRequest(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (context.permissions.includes("parts_requests.create")) return;
  if (context.permissions.includes("work_orders.manage")) return;
  throw new AppError("You do not have permission to create parts requests.", { code: "FORBIDDEN" });
}

export async function createPartsRequest(
  context: CurrentUserContext,
  input: CreatePartsRequestInput
): Promise<PartsRequestResult> {
  assertCanCreatePartsRequest(context);

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const workOrder = await findWorkOrderForPartsRequest(tx, input.workOrderId);
    if (!workOrder) {
      throw new AppError("Work order not found.", { code: "NOT_FOUND" });
    }
    await assertNoActiveDuplicateMaterialsRequest(tx, input.workOrderId);

    const total = input.items.reduce(
      (sum, item) => sum + item.quantity_requested * item.unit_price,
      0
    );

    const request = await tx.parts_requests.create({
      data: {
        work_order_id: input.workOrderId,
        asset_id: workOrder.asset_id,
        department_id: workOrder.requested_by_department_id,
        serial_number: workOrder.serial_number,
        requested_by: context.userId,
        prepared_by: context.userId,
        remarks: input.remarks,
        status: "Requested",
        total_price: total,
        created_by: context.userId,
        updated_by: context.userId
      },
      select: { id: true, parts_request_number: true, status: true, work_order_id: true }
    });

    if (input.items.length > 0) {
      await tx.parts_request_items.createMany({
        data: input.items.map((item) => ({
          parts_request_id: request.id,
          part_id: item.part_id,
          description: item.description,
          part_number: item.part_number,
          ss_rec_code: item.ss_rec_code,
          quantity_requested: item.quantity_requested,
          unit_price: item.unit_price,
          remarks: item.remarks
        }))
      });
    }

    // Unit 6: Manager + Engineer (if not the creator) — Store is deliberately
    // NOT notified here (per Task 3: "optionally notify Store only after
    // approval, not immediately").
    const recipients = dedupeRecipients(
      await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager", "maintenance_engineer"]),
      context.userId
    );

    return {
      partsRequestId: request.id,
      partsRequestNumber: request.parts_request_number,
      status: request.status,
      workOrderId: request.work_order_id,
      requestedBy: context.userId,
      jobCardNumber: workOrder.work_order_number,
      recipients
    };
  });

  const { recipients, jobCardNumber, ...result } = inner;

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "material_request.created",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: jobCardNumber ?? "the Job Card", parts_request_number: result.partsRequestNumber }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.create",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Created parts request ${result.partsRequestNumber ?? result.partsRequestId}`
    }),
    emitMaterialsRequestRealtimeEvent(REALTIME_EVENTS.MATERIALS_REQUEST_CREATED, result.partsRequestId, context.userId)
  ]);

  return result;
}

// Renamed conceptually to approveMaterialsRequest (Unit 5) — export name kept
// as approvePartsRequest since app/actions/phase4.ts already calls it under
// this name and no rename was required for the fix itself: Requested -> Approved
// (was the now-invalid "Waiting for Store").
export async function approvePartsRequest(
  context: CurrentUserContext,
  input: ApprovePartsRequestInput
): Promise<PartsRequestResult> {
  assertBackendPermission(context, "parts_requests.approve");

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findPartsRequestForWorkflow(tx, input.partsRequestId);
    if (!existing) {
      throw new AppError("Parts request not found.", { code: "NOT_FOUND" });
    }
    // Unified Manager Job Card + Materials Approval Flow Fix Task 8/9: a
    // friendly, explicit error instead of a silent re-notify/re-audit —
    // canTransition's same-status shortcut would otherwise let this through
    // as a harmless-looking no-op re-approval (double click, two tabs, or
    // approveJobCardAndMaterials racing a direct Materials Request approval).
    if (existing.status === "Approved") {
      throw new AppError("This Materials Request is already approved.", { code: "WORKFLOW_ERROR" });
    }
    if (!canTransition("parts_request", existing.status, "Approved")) {
      throw new AppError(
        transitionError("parts_request", existing.status, "Approved"),
        { code: "WORKFLOW_ERROR" }
      );
    }

    const updated = await updatePartsRequestStatus(
      tx,
      input.partsRequestId,
      "Approved",
      context.userId,
      { approved_by: context.userId, approval_comments: input.comments ?? null }
    );

    await tx.approvals.create({
      data: {
        parts_request_id: input.partsRequestId,
        approval_type: "Parts Request",
        status: "Approved",
        decided_by: context.userId,
        comments: input.comments ?? null
      }
    });

    // Unit 6: Store + creator + Engineer (was Store only).
    const storeAndEngineerIds = await getActiveUserIdsByRoleSlugs(tx, ["store_keeper", "maintenance_engineer"]);
    const recipients = dedupeRecipients([updated.requested_by, ...storeAndEngineerIds], context.userId);
    const jobCardNumber = await getJobCardNumber(tx, existing.work_order_id);

    return {
      partsRequestId: updated.id,
      partsRequestNumber: updated.parts_request_number,
      status: updated.status,
      workOrderId: existing.work_order_id,
      requestedBy: updated.requested_by,
      recipients,
      jobCardNumber
    };
  });

  const { recipients, jobCardNumber, ...result } = inner;

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "material_request.approved",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: {
        request_number: result.partsRequestNumber ?? "Materials Request",
        job_card_number: jobCardNumber ?? "the Job Card"
      }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.approve",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Approved ${result.partsRequestNumber ?? result.partsRequestId}`
    }),
    emitMaterialsRequestRealtimeEvent(REALTIME_EVENTS.MATERIALS_REQUEST_APPROVED, result.partsRequestId, context.userId),
    // Task 6: Store's "Send Materials" page and the Job Card list both refresh
    // on job_card.approved — a Materials Request reaching Approved is exactly
    // the "ready for Store to act" signal those pages watch for.
    result.workOrderId ? emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_APPROVED, result.workOrderId, context.userId) : Promise.resolve()
  ]);

  return result;
}

// Disabled (Unit 5) — "Rejected" no longer exists in the simplified Materials
// Request status model. Correction is handled by editing the request while it
// remains Requested/Approved (see editMaterialsRequest) with an audit note,
// not by rejecting it. Kept as a named export so any existing caller gets a
// clear, safe error instead of a broken/removed-function build failure.
export async function rejectPartsRequest(
  _context: CurrentUserContext,
  _input: RejectPartsRequestInput
): Promise<PartsRequestResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}

// ── Unit 5: Materials Request edit, Job Card status sync, and the Offline ──
// ── Inventory Control-backed issue engine.                                ──

const EDITABLE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved"];

function assertCanEditMaterialsRequest(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (context.permissions.includes("parts_requests.edit")) return;
  throw new AppError("You do not have permission to edit materials requests.", { code: "FORBIDDEN" });
}

/**
 * Edits a Materials Request's remarks and/or item quantities/pricing while it
 * is still Requested or Approved — not once any issuing has started
 * (Partially Issued/Waiting Stock/Issued), which would require reconciling
 * already-issued quantities and is out of scope for this unit.
 */
export async function editMaterialsRequest(context: CurrentUserContext, input: EditMaterialsRequestInput) {
  assertCanEditMaterialsRequest(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findPartsRequestForWorkflow(tx, input.partsRequestId);
    if (!existing) throw new AppError("Materials request not found.", { code: "NOT_FOUND" });
    if (!EDITABLE_MATERIALS_REQUEST_STATUSES.includes(existing.status)) {
      throw new AppError(
        `Materials request can only be edited while Requested or Approved. Current status: "${existing.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    if (input.remarks !== undefined) {
      await tx.parts_requests.update({
        where: { id: input.partsRequestId },
        data: { remarks: input.remarks, updated_by: context.userId }
      });
    }

    if (input.items?.length) {
      for (const item of input.items) {
        const { itemId, ...fields } = item;
        const data: Record<string, unknown> = {};
        if (fields.description !== undefined) data.description = fields.description;
        if (fields.quantity_requested !== undefined) data.quantity_requested = fields.quantity_requested;
        if (fields.unit_price !== undefined) data.unit_price = fields.unit_price;
        if (fields.remarks !== undefined) data.remarks = fields.remarks;
        if (Object.keys(data).length === 0) continue;

        const row = await tx.parts_request_items.findUnique({ where: { id: itemId }, select: { parts_request_id: true } });
        if (!row || row.parts_request_id !== input.partsRequestId) {
          throw new AppError("Materials request item not found on this request.", { code: "NOT_FOUND" });
        }
        await tx.parts_request_items.update({ where: { id: itemId }, data });
      }
    }

    return {
      partsRequestId: existing.id,
      partsRequestNumber: existing.parts_request_number,
      status: existing.status,
      workOrderId: existing.work_order_id
    };
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "parts_request.edit",
    entityType: "parts_request",
    entityId: result.partsRequestId,
    summary: `Edited ${result.partsRequestNumber ?? result.partsRequestId}`
  });

  return result;
}

/**
 * Re-derives the Job Card's status from its linked Materials Requests and
 * applies it only if the transition is valid (canTransition) and the Job Card
 * isn't already Closed. Silent no-op (not an error) if the Job Card has moved
 * past the materials stage (e.g. already Assigned/In Progress) — syncing
 * backward would be invalid and isn't a user-facing mistake to report.
 *
 * Priority when multiple linked requests disagree: Partially Issued (most
 * informative "in progress" signal) beats Waiting-Stock-with-nothing-issued,
 * which beats "all Issued". This ordering isn't explicitly specified — it's
 * the most sensible tie-break given a Job Card has only one status field.
 */
async function syncJobCardMaterialStatusInTx(tx: BackendTransaction, context: CurrentUserContext, workOrderId: string) {
  const wo = await tx.work_orders.findUnique({ where: { id: workOrderId }, select: { status: true } });
  if (!wo || wo.status === "Closed") return;

  const requests = await tx.parts_requests.findMany({
    where: { work_order_id: workOrderId },
    select: { status: true }
  });
  if (requests.length === 0) return; // no materials required — leave the Job Card alone

  const anyPartiallyIssued = requests.some((r) => r.status === "Partially Issued");
  const anyIssuedProgress = requests.some((r) => r.status === "Partially Issued" || r.status === "Issued");
  const anyWaitingStock = requests.some((r) => r.status === "Waiting Stock");
  const allIssued = requests.every((r) => r.status === "Issued");

  let target: string | null = null;
  if (anyPartiallyIssued) target = "Partially Issued";
  else if (anyWaitingStock && !anyIssuedProgress) target = "Waiting Materials";
  else if (allIssued) target = "Materials Issued";

  if (!target || target === wo.status) return;
  if (!canTransition("work_order", wo.status, target)) return;

  await tx.work_orders.update({ where: { id: workOrderId }, data: { status: target, updated_by: context.userId } });
}

/** Public, transaction-wrapped entry point for syncJobCardMaterialStatusInTx. */
export async function syncJobCardMaterialStatus(context: CurrentUserContext, workOrderId: string) {
  return withBackendTransaction(context.userId, (tx) => syncJobCardMaterialStatusInTx(tx, context, workOrderId));
}

/**
 * Requested -> Approved. Store can see the request once approved.
 */
export async function approveMaterialsRequest(context: CurrentUserContext, input: ApprovePartsRequestInput) {
  return approvePartsRequest(context, input);
}

const WAITING_STOCK_SOURCE_STATUSES = ["Approved"];

/**
 * Approved -> Waiting Stock. No inventory movement, no quantity change — just
 * records that Store currently has none of what's needed, with a required
 * reason, and pushes the Job Card to "Waiting Materials".
 *
 * Partially Issued -> Waiting Stock is intentionally NOT supported: the
 * locked Unit 3 parts_request transition map has no such edge ("Partially
 * Issued" only goes to itself or "Issued"), so canTransition correctly
 * rejects it. See Unit 5 report for this known, deferred limitation.
 */
export async function markWaitingStock(context: CurrentUserContext, input: { partsRequestId: string; reason: string }) {
  assertBackendPermission(context, "parts_requests.mark_waiting_stock");

  if (!input.reason || input.reason.trim().length < 5) {
    throw new AppError("A reason is required to mark a materials request as waiting stock.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const request = await lockPartsRequestForUpdate(tx, input.partsRequestId);
    if (!request) throw new AppError("Materials request not found.", { code: "NOT_FOUND" });
    if (!WAITING_STOCK_SOURCE_STATUSES.includes(request.status) || !canTransition("parts_request", request.status, "Waiting Stock")) {
      throw new AppError(transitionError("parts_request", request.status, "Waiting Stock"), { code: "WORKFLOW_ERROR" });
    }

    await tx.parts_requests.update({
      where: { id: input.partsRequestId },
      data: { status: "Waiting Stock", store_issue_comments: input.reason.trim(), updated_by: context.userId }
    });

    if (request.work_order_id) {
      await syncJobCardMaterialStatusInTx(tx, context, request.work_order_id);
    }

    // Unit 6: Manager + Engineer + creator (was creator only).
    const roleIds = await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager", "maintenance_engineer"]);
    const recipients = dedupeRecipients([request.requested_by, ...roleIds], context.userId);
    const jobCardNumber = await getJobCardNumber(tx, request.work_order_id);

    return {
      partsRequestId: request.id,
      partsRequestNumber: request.parts_request_number,
      status: "Waiting Stock",
      workOrderId: request.work_order_id,
      requestedBy: request.requested_by,
      recipients,
      jobCardNumber
    };
  });

  const { recipients, jobCardNumber, ...outcome } = result;

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "material_request.waiting_stock",
      entityType: "parts_request",
      entityId: outcome.partsRequestId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: jobCardNumber ?? "the Job Card", reason: input.reason.trim() }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.waiting_stock",
      entityType: "parts_request",
      entityId: outcome.partsRequestId,
      summary: `Marked ${outcome.partsRequestNumber ?? outcome.partsRequestId} as Waiting Stock`,
      metadata: { reason: input.reason.trim() }
    })
  ]);

  return outcome;
}

const ISSUABLE_MATERIALS_REQUEST_STATUSES = ["Approved", "Waiting Stock", "Partially Issued"];
const MATERIALS_REQUEST_ITEM_UNIT = "PCS"; // parts_request_items has no unit column (Unit 5 — see report)

/**
 * Records materials Store has sent against a Materials Request — the active,
 * sole material-send pipeline. Store Send Materials Flow Unit: this does NOT
 * check system stock/opening/received balance — Store physically handles
 * material availability, and this function only records what was sent. The
 * offline_inventory_movements row it creates is a tracking record for the
 * Material Ledger, not a stock gate.
 *
 * `quantity` per item is the ABSOLUTE new total sent for that item (not a
 * delta) — matching the existing StoreIssuePanel UI, which pre-fills each
 * input with the item's current issued_quantity and lets Store edit it
 * upward. The Offline Inventory ledger movement created for each item records
 * only the DELTA (new total minus what was already sent), since the ledger is
 * an append-only log of discrete events, not a running total.
 *
 * Race-condition safety: locks the parts_requests row with SELECT ... FOR
 * UPDATE before re-reading items/issued quantities, so two concurrent send
 * attempts against the SAME request serialize instead of both reading the
 * same stale issued_quantity.
 */
export async function issueMaterials(context: CurrentUserContext, input: IssueMaterialsInput) {
  assertCanIssueMaterials(context);

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const request = await lockPartsRequestForUpdate(tx, input.partsRequestId);
    if (!request) throw new AppError("Materials request not found.", { code: "NOT_FOUND" });
    if (!ISSUABLE_MATERIALS_REQUEST_STATUSES.includes(request.status)) {
      throw new AppError(
        `Materials request is not in a valid status for issue. Current status: "${request.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    // Store Send Materials Approval Gate Unit Task 2: Store must not send
    // materials before the linked Job Card has been Manager-approved, even
    // if the Materials Request itself already says Approved/Waiting Stock/
    // Partially Issued — those statuses only describe Store's own workflow,
    // not whether the Manager has approved the Job Card yet. Does not check
    // stock/balance (unchanged, out of scope for this gate).
    if (request.work_order_id) {
      const linkedJobCard = await tx.work_orders.findUnique({
        where: { id: request.work_order_id },
        select: { status: true }
      });
      if (linkedJobCard && (linkedJobCard.status === "Created" || linkedJobCard.status === "Under Review")) {
        throw new AppError(
          "Materials cannot be sent yet. This Job Card is waiting Manager approval.",
          { code: "WORKFLOW_ERROR" }
        );
      }
    }

    const items = await tx.parts_request_items.findMany({
      where: { parts_request_id: input.partsRequestId },
      select: {
        id: true,
        part_id: true,
        description: true,
        part_number: true,
        ss_rec_code: true,
        quantity_requested: true,
        issued_quantity: true
      }
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const newIssuedById = new Map(items.map((item) => [item.id, Number(item.issued_quantity)]));

    // Unit 7: per-item issue detail for the Job Card timeline (Task 4/5) —
    // the audit log previously only recorded the overall request status, not
    // which material/quantity actually moved in this call.
    const issuedLines: { description: string; issuedNow: number; newTotal: number; requested: number }[] = [];

    let anyDeltaApplied = false;

    for (const line of input.items) {
      const item = itemById.get(line.itemId);
      if (!item) {
        throw new AppError("Materials request item not found on this request.", { code: "NOT_FOUND" });
      }

      const newTotal = line.quantity;
      const alreadyIssued = Number(item.issued_quantity);
      const requested = Number(item.quantity_requested);

      if (newTotal < alreadyIssued - 1e-9) {
        throw new AppError(
          `Issued quantity cannot be decreased for "${item.description}" (already issued: ${alreadyIssued}).`,
          { code: "VALIDATION_ERROR" }
        );
      }
      if (newTotal > requested + 1e-9) {
        throw new AppError(
          `Cannot issue more than requested for "${item.description}". Requested: ${requested}.`,
          { code: "VALIDATION_ERROR" }
        );
      }

      const delta = newTotal - alreadyIssued;
      if (delta <= 1e-9) continue; // no change for this item — nothing to record

      // Store Send Materials Flow Unit Task 2: no system stock/balance check
      // here by design — Store sends materials based on the approved
      // Materials Request and physically handles availability themselves.
      // The only quantity rules are: cannot decrease, cannot exceed
      // requested (both checked above), and cannot re-record a zero delta
      // (checked just above) — the offline_inventory_movements row created
      // below is a tracking record of what was sent, not a stock gate.

      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "ISSUED",
          movement_date: new Date(),
          part_id: item.part_id,
          manual_material_name: item.part_id ? null : item.description,
          manual_part_number: item.part_id ? null : item.part_number,
          ss_rec_code: item.ss_rec_code,
          category: normalizeCategory(null),
          quantity: delta,
          unit: MATERIALS_REQUEST_ITEM_UNIT,
          counterparty: input.issuedTo ?? null,
          purpose: `Material issue — ${request.parts_request_number ?? request.id}`,
          related_work_order_id: request.work_order_id,
          parts_request_id: request.id,
          remarks: input.reason ?? null,
          created_by: context.userId
        }
      });

      newIssuedById.set(item.id, newTotal);
      await tx.parts_request_items.update({
        where: { id: item.id },
        data: {
          issued_quantity: newTotal,
          stock_availability: newTotal >= requested ? "Available" : "Partial"
        }
      });
      anyDeltaApplied = true;
      issuedLines.push({ description: item.description, issuedNow: delta, newTotal, requested });
    }

    if (!anyDeltaApplied) {
      throw new AppError("Enter a quantity to issue for at least one item.", { code: "VALIDATION_ERROR" });
    }

    const totalRequested = items.reduce((sum, item) => sum + Number(item.quantity_requested), 0);
    const totalIssuedAfter = items.reduce((sum, item) => sum + (newIssuedById.get(item.id) ?? Number(item.issued_quantity)), 0);
    const nextStatus = totalIssuedAfter >= totalRequested - 1e-9 ? "Issued" : "Partially Issued";

    if (!canTransition("parts_request", request.status, nextStatus)) {
      throw new AppError(transitionError("parts_request", request.status, nextStatus), { code: "WORKFLOW_ERROR" });
    }

    await tx.parts_requests.update({
      where: { id: input.partsRequestId },
      data: { status: nextStatus, store_issue_comments: input.reason ?? null, updated_by: context.userId }
    });

    if (request.work_order_id) {
      await syncJobCardMaterialStatusInTx(tx, context, request.work_order_id);
    }

    // Unit 6: Manager + Engineer + creator (was creator only). Partial and
    // final issue fire distinct events per Task 6, with issued/remaining
    // quantity totals in the message for the partial case.
    // Enterprise Real-Time Notifications Unit Task 2 (matrix G): also notify
    // any technician already assigned to the linked Job Card — materials can
    // arrive after assignment (e.g. a technician's own "Request Extra
    // Materials" mid-job), and the matrix calls for that technician to know
    // materials showed up.
    const [roleIds, assignments] = await Promise.all([
      getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager", "maintenance_engineer"]),
      request.work_order_id
        ? tx.work_order_assignments.findMany({ where: { work_order_id: request.work_order_id, technician_id: { not: null } }, select: { technician_id: true } })
        : Promise.resolve([])
    ]);
    const technicianIds = assignments.map((a) => a.technician_id).filter((id): id is string => Boolean(id));
    const recipients = dedupeRecipients([request.requested_by, ...roleIds, ...technicianIds], context.userId);
    const jobCardNumber = await getJobCardNumber(tx, request.work_order_id);

    return {
      partsRequestId: request.id,
      partsRequestNumber: request.parts_request_number,
      status: nextStatus,
      workOrderId: request.work_order_id,
      requestedBy: request.requested_by,
      recipients,
      jobCardNumber,
      totalRequested,
      totalIssuedAfter,
      issuedLines
    };
  });

  const { recipients, jobCardNumber, totalRequested, totalIssuedAfter, issuedLines, ...outcome } = inner;
  const notifEventKey = outcome.status === "Issued" ? "material_request.issued" : "material_request.partially_issued";

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: notifEventKey,
      entityType: "parts_request",
      entityId: outcome.partsRequestId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: {
        job_card_number: jobCardNumber ?? "the Job Card",
        issued_quantity: totalIssuedAfter,
        remaining_quantity: totalRequested - totalIssuedAfter
      }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.issue",
      entityType: "parts_request",
      entityId: outcome.partsRequestId,
      summary: `Issued materials for ${outcome.partsRequestNumber ?? outcome.partsRequestId} — status: ${outcome.status}`,
      // Unit 7: per-item lines so the Job Card timeline can show material
      // name + issued/remaining quantity without re-deriving it from the
      // ledger (issuedLines is the delta issued in THIS call per item).
      metadata: {
        status: outcome.status,
        totalRequested,
        totalIssuedAfter,
        remainingTotal: totalRequested - totalIssuedAfter,
        lines: issuedLines.map((l) => ({
          description: l.description,
          issuedNow: l.issuedNow,
          newTotal: l.newTotal,
          requested: l.requested,
          remaining: l.requested - l.newTotal
        }))
      }
    }),
    // Enterprise Real-Time Update Foundation Unit Task 6/7: Store Send
    // Materials sends three signals per the page-subscription design —
    // materials_request.sent (or .updated for a partial send) for the
    // Materials Requests list/detail, store_materials.sent for Store's own
    // Sent Materials page, and material_ledger.updated for the Offline
    // Inventory / Material Ledger view every other role uses to see what
    // Store just sent. No duplicate notification rows — these are
    // realtime_events only, alongside the notification already sent above.
    emitMaterialsRequestRealtimeEvent(
      outcome.status === "Issued" ? REALTIME_EVENTS.MATERIALS_REQUEST_SENT : REALTIME_EVENTS.MATERIALS_REQUEST_UPDATED,
      outcome.partsRequestId,
      context.userId
    ),
    emitMaterialsRequestRealtimeEvent(REALTIME_EVENTS.STORE_MATERIALS_SENT, outcome.partsRequestId, context.userId),
    emitMaterialsRequestRealtimeEvent(REALTIME_EVENTS.MATERIAL_LEDGER_UPDATED, outcome.partsRequestId, context.userId),
    outcome.workOrderId ? emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, outcome.workOrderId, context.userId) : Promise.resolve()
  ]);

  return outcome;
}
