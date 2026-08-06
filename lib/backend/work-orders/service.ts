import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";
import { dedupeRecipients, notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { advanceMaintenanceManagerReview, requestMaintenanceManagerClarification, respondToMaintenanceManagerClarification } from "@/lib/backend/workflows/engine";
import {
  findWorkflowWorkOrder,
  getActiveUserIdsByRoleSlugs,
  isTechnicianAssigned,
  updateWorkOrderStatus
} from "@/lib/backend/work-orders/repository";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import type { TechnicianAssignmentInput, TechnicianUpdateInput } from "@/lib/backend/work-orders/validators";
import { writeAuditLog } from "@/lib/audit/log";
import { AppError } from "@/lib/errors/app-error";
import { canTransition, transitionError } from "@/lib/workflows/status-rules";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { approvePartsRequest } from "@/lib/backend/parts-requests/service";
import { CLOSURE_REQUESTED_STATUS } from "@/lib/work-orders/simplified-status-display";
import { getMaterialFulfillmentForWorkOrder, anyMaterialsIncomplete } from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";

type WorkflowResult = {
  workOrderId: string;
  workOrderNumber: string | null;
  status: string;
};

async function transitionWorkOrder(context: CurrentUserContext, workOrderId: string, nextStatus: string) {
  assertActiveUser(context);

  return withBackendTransaction(context.userId, (tx) => transitionWorkOrderInTransaction(tx, context, workOrderId, nextStatus));
}

async function transitionWorkOrderInTransaction(tx: BackendTransaction, context: CurrentUserContext, workOrderId: string, nextStatus: string): Promise<WorkflowResult & { createdBy: string | null; wasAlreadyInStatus: boolean; assetName: string | null }> {
  const existing = await findWorkflowWorkOrder(tx, workOrderId);
  if (!existing) {
    throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
  }

  if (!canTransition("work_order", existing.status, nextStatus)) {
    throw new AppError(transitionError("work_order", existing.status, nextStatus), { code: "WORKFLOW_ERROR" });
  }

  const wasAlreadyInStatus = existing.status === nextStatus;
  const row = wasAlreadyInStatus ? existing : await updateWorkOrderStatus(tx, workOrderId, nextStatus, context.userId);

  return {
    workOrderId: row.id,
    workOrderNumber: row.work_order_number,
    status: row.status,
    createdBy: row.created_by,
    wasAlreadyInStatus,
    assetName: existing.assets?.asset_name ?? null
  };
}

// Unit 4: "Closed" is only a direct transition target from "In Progress" in the
// simplified map (matches the locked Unit 3 design). Work completed straight
// from "Assigned" — the normal case for external assignees, who have no
// technician account and so can never call startTechnicianJob themselves —
// hops through "In Progress" first, in the same transaction, so completion
// always succeeds instead of hitting a dead end at "Assigned".
async function closeFromInFlightStatus(tx: BackendTransaction, context: CurrentUserContext, workOrderId: string) {
  const existing = await findWorkflowWorkOrder(tx, workOrderId);
  if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
  if (existing.status === "Assigned") {
    await transitionWorkOrderInTransaction(tx, context, workOrderId, "In Progress");
  }
  return transitionWorkOrderInTransaction(tx, context, workOrderId, "Closed");
}

async function auditWorkflow(context: CurrentUserContext, action: string, result: WorkflowResult, summary: string, metadata: Record<string, unknown> = {}) {
  await writeAuditLog({
    actorId: context.userId,
    action,
    entityType: "work_order",
    entityId: result.workOrderId,
    summary,
    metadata: { status: result.status, ...metadata }
  });
}

// Maintenance Workflow Redesign Unit 6: resolves "creator + these roles" down
// to a deduped, actor-excluded user-id list for a single notifyWorkflowEvent
// call — used by every Job Card notification below so recipients are always
// merged and deduped up front, never split across multiple notify calls for
// one action (which would risk duplicates).
async function jobCardRecipients(
  tx: BackendTransaction,
  roleSlugs: string[],
  creatorId: string | null | undefined,
  actorId: string
): Promise<string[]> {
  const roleIds = roleSlugs.length ? await getActiveUserIdsByRoleSlugs(tx, roleSlugs) : [];
  return dedupeRecipients([creatorId, ...roleIds], actorId);
}

// job_card.closed recipients: creator + Engineer + Manager + any assigned
// internal technician(s) — shared by closeWorkOrder, completeTechnicianJob,
// and markExternalWorkCompleted, since all three now end at "Closed".
async function jobCardClosedRecipients(
  tx: BackendTransaction,
  workOrderId: string,
  creatorId: string | null | undefined,
  actorId: string
): Promise<string[]> {
  const [roleIds, assignments] = await Promise.all([
    getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager"]),
    tx.work_order_assignments.findMany({ where: { work_order_id: workOrderId, technician_id: { not: null } }, select: { technician_id: true } })
  ]);
  const technicianIds = assignments.map((a) => a.technician_id).filter((id): id is string => Boolean(id));
  return dedupeRecipients([creatorId, ...roleIds, ...technicianIds], actorId);
}

// Approval Workflow Unit 4 — Closure Approval Only: Created -> Approved
// directly (was -> Under Review, waiting for a first Manager approval before
// work could start). There is no Manager approval before starting a Job Card
// any more — Data Entry creates and starts it directly; "Approved" is simply
// the landing status, displayed as "Active" (see
// lib/work-orders/simplified-status-display.ts). Manager approval is now
// only required to close (see requestJobCardClosure/approveJobCardClosure
// below). Covers starting a Job Card that was previously saved as Created —
// distinct from starting directly at creation time, which
// app/actions/maintenance.ts handles by inserting straight into "Approved".
export async function submitWorkOrder(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "work_orders.manage");
  const result = await transitionWorkOrder(context, workOrderId, "Approved");

  // Manager is notified (awareness only, not an approval request) so they
  // can see every Job Card and its status per the new business rules — no
  // action is required from them at this step.
  const managerIds = await withBackendTransaction(context.userId, async (tx) =>
    dedupeRecipients(await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager"]), context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.started",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: managerIds,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card", asset_name: result.assetName ?? "" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    // Distinct action string from startTechnicianJob's "work_order.start"
    // (Assigned -> In Progress, a different transition) to keep audit-log
    // filtering unambiguous.
    auditWorkflow(context, "work_order.activated", result, `Started ${result.workOrderNumber ?? "work order"} — now Active`),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_STARTED, result.workOrderId, context.userId)
  ]);

  return result;
}

// New (Unit 4): Under Review -> Under Review only — reviewing a Job Card never
// advances its status (that's approveJobCard's job), so this checks the current
// status explicitly rather than using the generic transition helper (which would
// also allow the valid-but-wrong Created -> Under Review submit transition).
export async function reviewJobCard(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.review");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (existing.status !== "Under Review") {
      throw new AppError(
        `Job Card can only be reviewed while Under Review. Current status: "${existing.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }
    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status
    };
  });

  // Unit 6: notify Maintenance Manager now that Engineer has reviewed.
  const managerIds = await withBackendTransaction(context.userId, async (tx) =>
    dedupeRecipients(await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager"]), context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.reviewed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: managerIds,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(
      context,
      "work_order.review",
      result,
      `Reviewed by ${context.role?.name ?? "reviewer"} and sent to Manager: ${result.workOrderNumber ?? "work order"}`,
      // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 6:
      // sent_to_manager records that this review notified the Manager,
      // without adding a schema column or a new status — Job Card stays
      // "Under Review" and this stays a metadata flag on the audit entry.
      { comments, sent_to_manager: true }
    ),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_REVIEWED, result.workOrderId, context.userId)
  ]);

  return result;
}

export async function approveWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.approve");
  const result = await transitionWorkOrder(context, workOrderId, "Approved");

  // Unified Manager Job Card + Materials Approval Flow Fix Task 8/9: a
  // friendly, explicit error instead of a silent re-notify/re-audit when
  // called again on an already-approved Job Card (double click, two tabs,
  // or approveJobCardAndMaterials racing a plain single approval).
  if (result.wasAlreadyInStatus) {
    throw new AppError("This Job Card is already approved.", { code: "WORKFLOW_ERROR" });
  }

  // Simplified Job Card Approval Workflow Unit Task 11: notify the creator
  // (Data Entry) only — Store has left the active workflow and Engineer is
  // no longer a surfaced reviewer. result.wasAlreadyInStatus is always false
  // here now — the guard above already returned early otherwise — so the
  // approvals row is always created for a real approval.
  const recipients = await withBackendTransaction(context.userId, async (tx) => {
    await tx.approvals.create({
      data: { work_order_id: result.workOrderId, status: "Approved", decided_by: context.userId, comments: comments || null }
    });
    try {
      await advanceMaintenanceManagerReview(tx, result.workOrderId, "approved", context.userId, comments);
    } catch (err) {
      console.error("[workflow] Tracking update failed on work order approve:", err);
    }
    return jobCardRecipients(tx, [], result.createdBy, context.userId);
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.approved",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.approve", result, `Approved ${result.workOrderNumber ?? "work order"}`, { comments }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_APPROVED, result.workOrderId, context.userId)
  ]);

  return result;
}

/**
 * Unified Manager Job Card + Materials Approval Flow Fix Task 3: a single
 * action covering all three cases the Manager popup can be in —
 *   - Job Card Under Review + a Requested Materials Request(s) linked: this
 *     approves the Job Card AND every linked Requested request.
 *   - Job Card Under Review, no Requested Materials Request: approves the
 *     Job Card only (there's nothing else to approve).
 *   - Job Card already Approved, but a Requested Materials Request still
 *     exists: approves only the Materials Request(s) — the Job Card step is
 *     silently skipped rather than erroring, since re-approving is a no-op
 *     from the user's point of view (the popup shouldn't have shown this
 *     button for a still-Under-Review Job Card in the first place, but a
 *     stale page/race should still behave helpfully, not throw).
 *
 * Reuses approveWorkOrder/approvePartsRequest as-is (their own notifications,
 * audit logs, and idempotency guards) rather than reimplementing either —
 * this function only decides WHICH of the two to call, sequentially, each in
 * its own transaction. Not a single atomic transaction across both: if the
 * Materials Request approval fails after the Job Card approval succeeded,
 * the Job Card is left correctly Approved (not a corrupted state), just a
 * partial-success outcome — an acceptable, low-risk tradeoff over
 * reimplementing both functions' logic inline for strict atomicity.
 */
export async function approveJobCardAndMaterials(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.approve");

  const { workOrderNumber, jobCardNeedsApproval, requestedMaterialsRequestIds } = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await findWorkflowWorkOrder(tx, workOrderId);
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    const linkedRequested = await tx.parts_requests.findMany({
      where: { work_order_id: workOrderId, status: "Requested" },
      select: { id: true }
    });
    return {
      workOrderNumber: wo.work_order_number,
      jobCardNeedsApproval: wo.status === "Under Review",
      requestedMaterialsRequestIds: linkedRequested.map((r) => r.id)
    };
  });

  if (!jobCardNeedsApproval && requestedMaterialsRequestIds.length === 0) {
    throw new AppError("This Job Card is already approved.", { code: "WORKFLOW_ERROR" });
  }

  if (jobCardNeedsApproval) {
    await approveWorkOrder(context, workOrderId, comments);
  }

  const approvedMaterialsRequestIds: string[] = [];
  for (const id of requestedMaterialsRequestIds) {
    await approvePartsRequest(context, { partsRequestId: id, comments });
    approvedMaterialsRequestIds.push(id);
  }

  return {
    workOrderId,
    workOrderNumber,
    jobCardApproved: jobCardNeedsApproval,
    approvedMaterialsRequestIds
  };
}

// New (Unit 4), minimal primitive only: Approved -> Waiting Materials. Not wired
// to any Materials Request/Store logic here — Unit 5 owns deciding when this
// fires (e.g. from a materials request being created, or Store finding no
// stock). Exists now so the transition itself is guarded, tested, and callable.
export async function markJobCardWaitingMaterials(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "work_orders.manage");
  const result = await transitionWorkOrder(context, workOrderId, "Waiting Materials");

  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardRecipients(tx, ["maintenance_manager", "maintenance_engineer"], result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.waiting_materials",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.waiting_materials", result, `Marked ${result.workOrderNumber ?? "work order"} as Waiting Materials`)
  ]);

  return result;
}

// Disabled (Unit 4) — "Rejected" no longer exists in the simplified status model.
// Corrections are handled by requestJobCardCorrection, which keeps the Job Card
// at "Under Review" with an audit note instead of moving it to a Rejected status.
// Kept as a named export (rather than deleted) so any existing caller gets a
// clear, safe error instead of a broken/removed-function build failure.
export async function rejectWorkOrder(_context: CurrentUserContext, _workOrderId: string, _comments?: string): Promise<WorkflowResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}

// Renamed from requestWorkOrderClarification (Unit 4): the correction loop keeps
// the Job Card at "Under Review" with an audit note instead of a distinct status
// (no "Returned" status). Valid from "Under Review" only — Engineer and Manager
// both hold work_orders.request_correction per the Unit 3 permission grants.
export async function requestJobCardCorrection(context: CurrentUserContext, workOrderId: string, note: string) {
  assertBackendPermission(context, "work_orders.request_correction");

  if (note.trim().length < 10) {
    throw new AppError("Correction note must be at least 10 characters.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) {
      throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    }
    if (existing.status !== "Under Review") {
      throw new AppError(
        `Correction can only be requested while the Job Card is Under Review. Current status: "${existing.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    await requestMaintenanceManagerClarification(tx, workOrderId, note.trim(), context.userId);

    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status,
      createdBy: existing.created_by
    };
  });

  // Simplified Job Card Approval Workflow Unit Task 4/11: correction requests
  // only flow Supervisor/Manager -> Data Entry now — always notify the Job
  // Card creator.
  const correctionRecipients = dedupeRecipients([result.createdBy], context.userId);

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.correction_requested",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: correctionRecipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card", reason: note.trim() },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(
      context,
      "work_order.correction_requested",
      result,
      `Correction requested by ${context.role?.name ?? "reviewer"}: ${result.workOrderNumber ?? "work order"}`,
      { note: note.trim() }
    ),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CORRECTION_REQUESTED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Renamed from respondToWorkOrderClarification (Unit 4): the Job Card creator (or
// a manage-permission holder) records that a requested correction was addressed.
// No status change — the Job Card stays "Under Review" the whole time, ready for
// re-review, so there is nothing to "resubmit" separately.
export async function respondToJobCardCorrection(context: CurrentUserContext, workOrderId: string, response: string) {
  assertActiveUser(context);

  if (response.trim().length < 10) {
    throw new AppError("Response must be at least 10 characters.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) {
      throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    }

    const canRespond =
      context.role?.slug === "super_admin" ||
      context.permissions.includes("work_orders.manage") ||
      existing.created_by === context.userId;
    if (!canRespond) {
      throw new AppError("You are not authorized to respond to this correction request.", { code: "FORBIDDEN" });
    }

    // Gate on an actual pending clarification rather than the Job Card's raw
    // status: a correction is normally requested and resolved while the Job
    // Card sits "Under Review", but the clarification step can outlive that
    // (e.g. materials already progressed to "Materials Issued" while the
    // maintenance_manager_review step is still clarification_requested) — the
    // response must still go through in that case instead of hard-blocking
    // on a status string that no longer reflects what's actually pending.
    const clarificationId = await respondToMaintenanceManagerClarification(tx, workOrderId, response.trim(), context.userId);
    if (!clarificationId) {
      throw new AppError("This Job Card has no pending correction to respond to.", { code: "WORKFLOW_ERROR" });
    }

    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status,
      createdBy: existing.created_by
    };
  });

  const approverIds = await withBackendTransaction(context.userId, (tx) =>
    getActiveUserIdsByRoleSlugs(tx, ["super_admin", "maintenance_manager"])
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.clarification_responded",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: approverIds,
      metadata: { work_order_number: result.workOrderNumber ?? "Work order", response: response.trim() },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Review correction response"
    }),
    auditWorkflow(context, "work_order.correction_responded", result, `Correction response submitted for ${result.workOrderNumber ?? "work order"}`, { response: response.trim() }),
    // Enterprise-Wide Real-Time Update Verification Task 7: this was the one
    // real gap in the resubmit-to-Manager chain — every other step in that
    // flow already emitted a realtime signal, but resubmission itself only
    // ever fired a notification (bell), leaving an already-open Manager
    // dashboard to wait out the AutoRefresh poll instead of updating instantly.
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CORRECTION_RESPONDED, result.workOrderId, context.userId)
  ]);

  return result;
}

export async function assignTechnicians(context: CurrentUserContext, input: TechnicianAssignmentInput) {
  assertBackendPermission(context, "work_orders.assign");

  const assignmentType = input.assignmentType ?? "INTERNAL_TECHNICIAN";

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, input.workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (!canTransition("work_order", existing.status, "Assigned")) {
      throw new AppError(transitionError("work_order", existing.status, "Assigned"), { code: "WORKFLOW_ERROR" });
    }

    // E4 inventory gate: only on first assignment (Approved → Assigned), not re-assignment.
    // WOs with no required parts rows always pass. partial/unavailable do not block — only "unchecked".
    if (existing.status === "Approved") {
      const sett = await tx.app_settings.findUnique({
        where: { id: SETTINGS_ID },
        select: { inventory_check_enabled: true }
      });
      if (sett?.inventory_check_enabled) {
        const uncheckedCount = await tx.workOrderRequiredPart.count({
          where: { work_order_id: input.workOrderId, availability_status: "unchecked" }
        });
        if (uncheckedCount > 0) {
          throw new AppError(
            "Inventory check is pending — Store Keeper must confirm all required parts before assignment.",
            { code: "WORKFLOW_ERROR" }
          );
        }
      }
    }

    await tx.work_order_assignments.deleteMany({ where: { work_order_id: input.workOrderId } });

    let technicianIds: string[] = [];
    let assigneeName = "";

    if (assignmentType === "INTERNAL_TECHNICIAN") {
      const technicians = await tx.profiles.findMany({
        where: { id: { in: input.technicianIds ?? [] }, is_active: true },
        select: { id: true, full_name: true }
      });
      technicianIds = technicians.map((t) => t.id);
      assigneeName = technicians.map((t) => t.full_name).join(", ");
      if (!technicianIds.length) {
        throw new AppError("Select at least one active technician.", { code: "VALIDATION_ERROR" });
      }
      await tx.work_order_assignments.createMany({
        data: technicianIds.map((technicianId) => ({
          work_order_id: input.workOrderId,
          technician_id: technicianId,
          assigned_by: context.userId,
          assignment_type: "INTERNAL_TECHNICIAN",
          notes: input.notes?.trim() ?? null,
        }))
      });
    } else if (assignmentType === "FREELANCER") {
      if (!input.externalName?.trim()) {
        throw new AppError("Freelancer name is required.", { code: "VALIDATION_ERROR" });
      }
      assigneeName = input.externalName.trim();
      await tx.work_order_assignments.create({
        data: {
          work_order_id: input.workOrderId,
          assigned_by: context.userId,
          assignment_type: "FREELANCER",
          external_name: input.externalName.trim(),
          external_phone: input.externalPhone?.trim() || null,
          external_trade: input.externalTrade?.trim() || null,
          external_expected_visit_date: input.externalExpectedVisitDate ? new Date(input.externalExpectedVisitDate) : null,
          agreed_amount: input.agreedAmount ?? null,
          notes: input.notes?.trim() || null,
        }
      });
    } else if (assignmentType === "EXTERNAL_COMPANY") {
      if (!input.externalCompany?.trim()) {
        throw new AppError("Company name is required.", { code: "VALIDATION_ERROR" });
      }
      assigneeName = input.externalCompany.trim();
      await tx.work_order_assignments.create({
        data: {
          work_order_id: input.workOrderId,
          assigned_by: context.userId,
          assignment_type: "EXTERNAL_COMPANY",
          external_company: input.externalCompany.trim(),
          external_contact_person: input.externalContactPerson?.trim() || null,
          external_phone: input.externalPhone?.trim() || null,
          external_trade: input.externalTrade?.trim() || null,
          external_expected_visit_date: input.externalExpectedVisitDate ? new Date(input.externalExpectedVisitDate) : null,
          agreed_amount: input.agreedAmount ?? null,
          notes: input.notes?.trim() || null,
        }
      });
    } else {
      // OTHER (Unit 4): free-text assignee/company that isn't a clean fit for
      // FREELANCER or EXTERNAL_COMPANY — reuses external_name for the free-text label.
      if (!input.externalName?.trim()) {
        throw new AppError("A name or description is required for this assignment type.", { code: "VALIDATION_ERROR" });
      }
      assigneeName = input.externalName.trim();
      await tx.work_order_assignments.create({
        data: {
          work_order_id: input.workOrderId,
          assigned_by: context.userId,
          assignment_type: "OTHER",
          external_name: input.externalName.trim(),
          external_phone: input.externalPhone?.trim() || null,
          external_trade: input.externalTrade?.trim() || null,
          external_expected_visit_date: input.externalExpectedVisitDate ? new Date(input.externalExpectedVisitDate) : null,
          notes: input.notes?.trim() || null,
        }
      });
    }

    const row = existing.status === "Assigned" ? existing : await updateWorkOrderStatus(tx, input.workOrderId, "Assigned", context.userId);

    return {
      workOrderId: row.id,
      workOrderNumber: row.work_order_number,
      status: row.status,
      assignmentType,
      technicianIds,
      assigneeName,
      createdBy: existing.created_by
    };
  });

  // Unit 6 (Enterprise Real-Time Notifications Unit Task 10 fix): the
  // assigned internal technician(s) and the awareness-only Engineer/Manager/
  // creator audience need DIFFERENT links (technician has no
  // work_orders.view access to the Job Card detail page; Engineer/Manager/
  // Data Entry have no technician.jobs.view access to the Technician job
  // page) — a single shared notifyWorkflowEvent call can only carry one
  // actionUrl for every recipient, so this is now two calls instead of one.
  const otherRecipients = await withBackendTransaction(context.userId, async (tx) =>
    jobCardRecipients(tx, ["maintenance_engineer", "maintenance_manager"], result.createdBy, context.userId)
  );
  const technicianRecipients = dedupeRecipients(result.technicianIds, context.userId);
  const awarenessRecipients = otherRecipients.filter((id) => !technicianRecipients.includes(id));

  await Promise.all([
    technicianRecipients.length
      ? notifyWorkflowEvent({
          eventKey: "job_card.assigned",
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientUserIds: technicianRecipients,
          metadata: { job_card_number: result.workOrderNumber ?? "Job Card", assignee_name: result.assigneeName || "the assignee" },
          actionUrl: `/technician/jobs/${result.workOrderId}`
        })
      : Promise.resolve([]),
    awarenessRecipients.length
      ? notifyWorkflowEvent({
          eventKey: "job_card.assigned",
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientUserIds: awarenessRecipients,
          metadata: { job_card_number: result.workOrderNumber ?? "Job Card", assignee_name: result.assigneeName || "the assignee" },
          actionUrl: `/maintenance/work-orders/${result.workOrderId}`
        })
      : Promise.resolve([]),
    auditWorkflow(
      context,
      "work_order.assign",
      result,
      `Assigned ${
        assignmentType === "INTERNAL_TECHNICIAN"
          ? "technician"
          : assignmentType === "FREELANCER"
            ? "freelancer"
            : assignmentType === "EXTERNAL_COMPANY"
              ? "external company"
              : "assignee"
      } to ${result.workOrderNumber ?? "work order"}`,
      { assignmentType, technicianIds: result.technicianIds }
    ),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_ASSIGNED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Data Entry Job Card Progress Update and Close Action Unit: a generic
// "start work" step (Assigned -> In Progress) for whoever holds
// work_orders.update (Maintenance Data Entry, Engineer, Manager) — separate
// from startTechnicianJob below, which is hard-locked to the specific
// assigned technician's own account (technician.jobs.update + a self-
// assignment check) and drives the Technician's own /technician/jobs flow.
// This covers the case where Data Entry/Engineer/Manager marks progress
// after being told work has started — e.g. by an external freelancer/company
// assignee who has no technician login at all and so could never call
// startTechnicianJob themselves. The optional note is recorded as an audit
// entry (same pattern as reviewJobCard/closeWorkOrder's `comments`) rather
// than a work_order_technician_notes row, so it never gets mislabeled as a
// technician's own field update on the detail page.
export async function startJobCardProgress(context: CurrentUserContext, workOrderId: string, note?: string) {
  assertBackendPermission(context, "work_orders.update");
  const result = await transitionWorkOrder(context, workOrderId, "In Progress");

  const creatorRecipient = dedupeRecipients([result.createdBy], context.userId);

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.in_progress",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: creatorRecipient,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.start_progress", result, `Work started for ${result.workOrderNumber ?? "work order"}`, { note }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_IN_PROGRESS, result.workOrderId, context.userId)
  ]);

  return result;
}

// Unit 4: no "Completed by Technician" status exists anymore — marking external
// (freelancer/company) work as completed now closes the Job Card directly, same
// as the internal-technician completion path. Permission changed from
// work_orders.assign to work_orders.close (Manager/Engineer/Data Entry/Technician
// per the Unit 3 grants), matching who is actually authorized to close a Job Card.
export async function markExternalWorkCompleted(context: CurrentUserContext, workOrderId: string, notes?: string) {
  assertBackendPermission(context, "work_orders.close");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });

    if (!["Assigned", "In Progress"].includes(existing.status)) {
      throw new AppError("Work order must be Assigned or In Progress to mark external work as completed.", { code: "WORKFLOW_ERROR" });
    }

    const assignment = await tx.work_order_assignments.findFirst({
      where: { work_order_id: workOrderId, assignment_type: { in: ["FREELANCER", "EXTERNAL_COMPANY"] } }
    });
    if (!assignment) {
      throw new AppError("This Job Card does not have an external assignment.", { code: "VALIDATION_ERROR" });
    }

    if (notes?.trim()) {
      await tx.work_order_assignments.update({
        where: { id: assignment.id },
        data: { notes: notes.trim() }
      });
    }

    return closeFromInFlightStatus(tx, context, workOrderId);
  });

  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardClosedRecipients(tx, workOrderId, result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.closed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(
      context,
      "work_order.external_completed",
      result,
      `External work closed for ${result.workOrderNumber ?? "work order"}`,
      { notes }
    ),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CLOSED, result.workOrderId, context.userId)
  ]);

  return result;
}

export async function startTechnicianJob(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "technician.jobs.update");
  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    return transitionWorkOrderInTransaction(tx, context, workOrderId, "In Progress");
  });

  // Unit 6: creator only, low priority — starting work is common enough that
  // notifying Manager/Engineer too would be noisy for a routine step.
  const creatorRecipient = dedupeRecipients([result.createdBy], context.userId);

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.in_progress",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: creatorRecipient,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.start", result, `Work started by technician: ${result.workOrderNumber ?? "work order"}`),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_IN_PROGRESS, result.workOrderId, context.userId)
  ]);

  return result;
}

export async function addTechnicianUpdate(context: CurrentUserContext, input: TechnicianUpdateInput) {
  assertBackendPermission(context, "technician.jobs.update");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, input.workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    const existing = await findWorkflowWorkOrder(tx, input.workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (!["Assigned", "In Progress", "Waiting Materials", "Partially Issued", "Materials Issued"].includes(existing.status)) {
      throw new AppError("Technician updates are not allowed in the current work order status.", { code: "WORKFLOW_ERROR" });
    }

    await tx.work_order_technician_notes.create({
      data: {
        work_order_id: input.workOrderId,
        technician_id: context.userId,
        note: input.note,
        labor_hours: input.laborHours,
        photo_file_name: input.photoFileName || null,
        photo_file_path: input.photoFilePath || null
      }
    });

    if (input.laborHours > 0) {
      await tx.work_order_labor.create({
        data: {
          work_order_id: input.workOrderId,
          technician_id: context.userId,
          labor_name: context.profile.full_name,
          employee_number: context.profile.employee_number,
          hours: input.laborHours,
          rate: 0
        }
      });
    }

    if (input.photoFileName && input.photoFilePath) {
      await tx.work_order_attachments.create({
        data: {
          work_order_id: input.workOrderId,
          attachment_type: "Technician Photo",
          file_name: input.photoFileName,
          file_path: input.photoFilePath,
          uploaded_by: context.userId
        }
      });
    }

    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status,
      createdBy: existing.created_by,
      photoUploaded: Boolean(input.photoFileName && input.photoFilePath),
      laborHours: input.laborHours
    };
  });

  // Technician Dashboard and My Jobs Workflow Alignment Unit Task 7: these
  // notifications previously targeted "maintenance_supervisor" — a dormant
  // role with no active users in the current workflow (Engineer/Manager/
  // Data Entry are the active review chain now), so a technician's work
  // update or photo silently notified nobody. Routed to the same
  // creator + Engineer + Manager pattern every other Job Card notification
  // in this file uses.
  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardRecipients(tx, ["maintenance_engineer", "maintenance_manager"], result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: result.laborHours > 0 ? "technician.labor_added" : "technician.note_added",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { labor_hours: result.laborHours, job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    result.photoUploaded
      ? notifyWorkflowEvent({
          eventKey: "technician.photo_uploaded",
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientUserIds: recipients,
          metadata: { work_order_id: result.workOrderId, job_card_number: result.workOrderNumber ?? "Job Card" },
          actionUrl: `/maintenance/work-orders/${result.workOrderId}`
        })
      : Promise.resolve(),
    auditWorkflow(context, "work_order.technician_update", result, "Added technician update to work order", { laborHours: result.laborHours }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.TECHNICIAN_JOB_UPDATED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Unit 4: no "Completed by Technician" status — a technician completing their
// own assigned job now closes it directly (technician holds work_orders.close
// per the Unit 3 grants, on top of the existing assignment check here).
// Technician Dashboard and My Jobs Workflow Alignment Unit Task 9: a
// completion note is now required — this used to close with no record at
// all of what was actually done, unlike every other close path in this file
// (closeWorkOrder/markExternalWorkCompleted both accept comments).
export async function completeTechnicianJob(context: CurrentUserContext, workOrderId: string, comments: string) {
  assertBackendPermission(context, "technician.jobs.update");
  if (!comments || comments.trim().length < 3) {
    throw new AppError("A completion note is required to close this job.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    return closeFromInFlightStatus(tx, context, workOrderId);
  });

  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardClosedRecipients(tx, workOrderId, result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.closed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.complete", result, `Closed by technician: ${result.workOrderNumber ?? "work order"}`, { comments }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CLOSED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Disabled (Unit 4) — "Verified by Supervisor" no longer exists; the simplified
// model has no separate verification stage, and Maintenance Supervisor is not
// part of the new active role set. Closing (closeWorkOrder / markExternalWorkCompleted
// / completeTechnicianJob) is now the only step after work is done.
export async function verifyWorkOrder(_context: CurrentUserContext, _workOrderId: string, _comments?: string): Promise<WorkflowResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}

// ── Approval Workflow Unit 4 — Closure Approval Only ────────────────────────
//
// Business decision: no Manager approval before starting a Job Card any
// more (see submitWorkOrder above). Approval is required only before final
// closing — Data Entry (or Supervisor/Manager/super_admin) requests closure
// with a completion note, and Manager approves it or closes directly. No
// reject/return-closure-request step in this unit (Task 7) — Data Entry can
// fix anything before requesting closure.

function assertCanRequestJobCardClosure(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (["maintenance_data_entry", "maintenance_manager", "maintenance_supervisor"].includes(context.role?.slug ?? "")) return;
  throw new AppError("You do not have permission to request closure for this Job Card.", { code: "FORBIDDEN" });
}

function assertIsManager(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager") return;
  throw new AppError("You do not have permission to close this Job Card.", { code: "FORBIDDEN" });
}

// Task 12: "Pending" == any linked Materials Request not yet Issued
// ("Completed"/"Received" in Materials Requests wording, unchanged). No
// linked requests at all is allowed through (nothing to wait for).
async function assertNoPendingMaterialsRequests(tx: BackendTransaction, workOrderId: string, errorMessage: string) {
  const pendingCount = await tx.parts_requests.count({
    where: { work_order_id: workOrderId, status: { not: "Issued" } }
  });
  if (pendingCount > 0) {
    throw new AppError(errorMessage, { code: "WORKFLOW_ERROR" });
  }
}

// Required Materials Issue and Shortage Tracking Unit 6, Task 8 / business
// rule 5. Distinct from assertNoPendingMaterialsRequests above:  that check
// looks at whether the auto-created Materials Request has finished being
// RECEIVED into store; this one checks whether the Required Materials rows
// have actually been ISSUED to this Job Card via Offline Inventory
// Control's own Issue Material action (movement_type "ISSUED",
// related_work_order_id = this Job Card). A request can be fully "Received"
// while nothing has been handed out yet, so both gates are needed.
async function assertRequiredMaterialsFulfilled(tx: BackendTransaction, workOrderId: string, errorMessage: string) {
  const fulfillment = await getMaterialFulfillmentForWorkOrder(tx, workOrderId);
  if (anyMaterialsIncomplete(fulfillment)) {
    throw new AppError(errorMessage, { code: "WORKFLOW_ERROR" });
  }
}

// Work Session Time Tracking and Labor Cost Calculation Unit 8, Task 10:
// completed/paused historical sessions never block closure — only a
// currently-running ("Active") session does, since it represents work
// physically in progress right now.
async function assertNoActiveWorkSessions(tx: BackendTransaction, workOrderId: string, errorMessage: string) {
  const summary = await getWorkOrderLaborSummary(tx, workOrderId);
  if (summary.has_active_session) {
    throw new AppError(errorMessage, { code: "WORKFLOW_ERROR" });
  }
}

/**
 * Data Entry (or Supervisor/Manager/super_admin) marks work as complete and
 * asks Manager to approve closing the Job Card. Valid from any "Active"-
 * bucket status (Approved/Waiting Materials/Partially Issued/Materials
 * Issued/Assigned/In Progress) — not from Draft, not from an already-closed
 * or already-closure-requested Job Card.
 */
export async function requestJobCardClosure(context: CurrentUserContext, workOrderId: string, note: string) {
  assertCanRequestJobCardClosure(context);

  if (!note || note.trim().length < 10) {
    throw new AppError("A completion note is required to request closure (min 10 characters).", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (existing.status === "Created" || existing.status === "Under Review") {
      throw new AppError("This Job Card must be started before requesting closure.", { code: "WORKFLOW_ERROR" });
    }
    if (existing.status === "Closed") {
      throw new AppError("This Job Card is already closed.", { code: "WORKFLOW_ERROR" });
    }
    if (!canTransition("work_order", existing.status, CLOSURE_REQUESTED_STATUS)) {
      throw new AppError(transitionError("work_order", existing.status, CLOSURE_REQUESTED_STATUS), { code: "WORKFLOW_ERROR" });
    }

    await assertRequiredMaterialsFulfilled(
      tx,
      workOrderId,
      "This Job Card still has pending required materials. Complete materials before requesting closure."
    );

    await assertNoPendingMaterialsRequests(
      tx,
      workOrderId,
      "This Job Card has pending Materials Requests. Complete materials before requesting closure."
    );

    await assertNoActiveWorkSessions(
      tx,
      workOrderId,
      "This Job Card has active work sessions. Stop all work sessions before requesting closure."
    );

    const row = await updateWorkOrderStatus(tx, workOrderId, CLOSURE_REQUESTED_STATUS, context.userId);
    await tx.approvals.create({
      data: { work_order_id: workOrderId, status: CLOSURE_REQUESTED_STATUS, decided_by: context.userId, comments: note.trim() }
    });

    return {
      workOrderId: row.id,
      workOrderNumber: row.work_order_number,
      status: row.status,
      createdBy: existing.created_by
    };
  });

  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardRecipients(tx, ["maintenance_manager"], result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.closure_requested",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card", note: note.trim() },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.closure_requested", result, `Closure requested for ${result.workOrderNumber ?? "work order"}`, { note: note.trim() }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CLOSURE_REQUESTED, result.workOrderId, context.userId)
  ]);

  return result;
}

/**
 * Manager (or super_admin) approves a pending closure request.
 * Closure Requested -> Closed. No reject/return path in this unit (Task 7).
 */
export async function approveJobCardClosure(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertIsManager(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (existing.status !== CLOSURE_REQUESTED_STATUS) {
      throw new AppError(
        `Closure can only be approved while a closure request is pending. Current status: "${existing.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    const row = await updateWorkOrderStatus(tx, workOrderId, "Closed", context.userId);
    await tx.approvals.create({
      data: { work_order_id: workOrderId, status: "Closed", decided_by: context.userId, comments: comments || null }
    });

    return {
      workOrderId: row.id,
      workOrderNumber: row.work_order_number,
      status: row.status,
      createdBy: existing.created_by
    };
  });

  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardClosedRecipients(tx, workOrderId, result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.closed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.closure_approved", result, `Closure approved for ${result.workOrderNumber ?? "work order"}`, { comments }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CLOSED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Approval Workflow Unit 4: direct close is now Manager-only (super_admin
// included) — Data Entry can no longer final-close a Job Card directly
// (business rule 8), only request closure (requestJobCardClosure above).
// This restricts this specific "Close Job Card" action/button only;
// completeTechnicianJob/markExternalWorkCompleted (Technician's own close,
// external-assignment completion) are separate functions with their own
// permission checks, untouched by this unit. Same pending-materials gate as
// requestJobCardClosure (Task 6/12).
export async function closeWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertIsManager(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (existing.status === CLOSURE_REQUESTED_STATUS) {
      throw new AppError("A closure request is already pending for this Job Card — use Approve Closure instead.", { code: "WORKFLOW_ERROR" });
    }

    await assertRequiredMaterialsFulfilled(
      tx,
      workOrderId,
      "This Job Card still has pending required materials. Complete materials before closing."
    );

    await assertNoPendingMaterialsRequests(
      tx,
      workOrderId,
      "This Job Card has pending Materials Requests. Complete materials before closing."
    );

    await assertNoActiveWorkSessions(
      tx,
      workOrderId,
      "This Job Card has active work sessions. Stop all work sessions before closing."
    );

    return transitionWorkOrderInTransaction(tx, context, workOrderId, "Closed");
  });

  if (!result.wasAlreadyInStatus) {
    await withBackendTransaction(context.userId, async (tx) => {
      await tx.approvals.create({
        data: { work_order_id: result.workOrderId, status: "Closed", decided_by: context.userId, comments: comments || null }
      });
    });
  }

  // Unit 6: creator + Engineer + Manager + assigned internal technician (was
  // notifying only the actor themselves, which is rarely useful).
  const recipients = await withBackendTransaction(context.userId, (tx) =>
    jobCardClosedRecipients(tx, workOrderId, result.createdBy, context.userId)
  );

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.closed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: recipients,
      metadata: { job_card_number: result.workOrderNumber ?? "Job Card" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.close", result, `Closed ${result.workOrderNumber ?? "work order"}`, { comments }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_CLOSED, result.workOrderId, context.userId)
  ]);

  return result;
}

// Disabled (Unit 4) — "Cancelled" no longer exists in the simplified status model.
export async function cancelWorkOrder(_context: CurrentUserContext, _workOrderId: string, _comments?: string): Promise<WorkflowResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}

// Disabled (Unit 4) — "Draft" no longer exists; corrections keep a Job Card at
// "Under Review" (see requestJobCardCorrection) instead of returning it anywhere.
export async function returnWorkOrderToDraft(_context: CurrentUserContext, _workOrderId: string): Promise<WorkflowResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}
