import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { assertActiveUser } from "@/lib/backend/security/guards";
import type { prisma } from "@/lib/db/prisma";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { ON_TEAM_ASSIGNMENT_STATUSES } from "@/lib/backend/workers/constants";
import { lockJobCardActivity } from "@/lib/backend/work-orders/repository";
import { AppError } from "@/lib/errors/app-error";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { checkClosureRequirements } from "@/lib/work-orders/closure-readiness";
import { getClosureRequirementFactsFor } from "@/lib/work-orders/closure-requirements-data";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

// "No Workers Required" / "No Materials Required" confirmations
// (job_card_requirement_confirmations). Workers and materials stay optional
// at creation; before closure each must be present or explicitly confirmed
// as not required (lib/work-orders/closure-readiness.ts
// checkClosureRequirements — the one rule every page and the closure guard
// use).
//
// Writes take the same per-Job-Card activity lock as worker assignment,
// material and closure writes, so a confirmation and an added worker /
// material / closure request are always decided one at a time.

export type ClosureRequirement = "workers" | "materials";

export const WORKERS_NOT_REQUIRED_REASON_MIN = 3;
export const WORKERS_NOT_REQUIRED_REASON_MAX = 300;

/** Same roles as requesting closure (service.ts assertCanRequestJobCardClosure). */
export function canConfirmClosureRequirements(context: CurrentUserContext) {
  if (!context.profile.is_active) return false;
  return (
    context.role?.slug === "super_admin" ||
    ["maintenance_data_entry", "maintenance_manager", "maintenance_supervisor"].includes(context.role?.slug ?? "")
  );
}

async function countTeamWorkers(tx: BackendTransaction, workOrderId: string) {
  return tx.workOrderWorkerAssignment.count({
    where: { work_order_id: workOrderId, status: { in: ON_TEAM_ASSIGNMENT_STATUSES } },
  });
}

export type ConfirmRequirementResult = { workOrderId: string; workOrderNumber: string | null; alreadyConfirmed: boolean };

export async function confirmRequirementNotRequired(
  context: CurrentUserContext,
  input: { workOrderId: string; requirement: ClosureRequirement; reason?: string | null }
): Promise<ConfirmRequirementResult> {
  assertActiveUser(context);
  if (!canConfirmClosureRequirements(context)) {
    throw new AppError("You do not have permission to update this Job Card.", { code: "FORBIDDEN" });
  }
  if (input.requirement !== "workers" && input.requirement !== "materials") {
    throw new AppError("Unknown requirement.", { code: "VALIDATION_ERROR" });
  }
  const reason = (input.reason ?? "").trim();
  if (input.requirement === "workers") {
    if (reason.length < WORKERS_NOT_REQUIRED_REASON_MIN) {
      throw new AppError("Please write a short reason why no workers are needed.", { code: "VALIDATION_ERROR" });
    }
    if (reason.length > WORKERS_NOT_REQUIRED_REASON_MAX) {
      throw new AppError(`The reason is too long. Please keep it under ${WORKERS_NOT_REQUIRED_REASON_MAX} letters.`, { code: "VALIDATION_ERROR" });
    }
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    await lockJobCardActivity(tx, input.workOrderId);
    const wo = await tx.work_orders.findFirst({
      where: { AND: [{ id: input.workOrderId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      select: { id: true, work_order_number: true, status: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed" || wo.status === "Closure Requested") {
      throw new AppError("This Job Card can no longer be changed.", { code: "WORKFLOW_ERROR" });
    }

    if (input.requirement === "workers") {
      if ((await countTeamWorkers(tx, wo.id)) > 0) {
        throw new AppError("Workers are already assigned to this Job Card.", { code: "WORKFLOW_ERROR" });
      }
    } else if ((await getClosureRequirementFactsFor(tx, wo.id)).materialsPresent) {
      throw new AppError("This Job Card already has materials.", { code: "WORKFLOW_ERROR" });
    }

    // A repeated click / retry keeps the confirmation already recorded.
    const active = await tx.jobCardRequirementConfirmation.findFirst({
      where: { work_order_id: wo.id, requirement: input.requirement, superseded_at: null },
      select: { id: true },
    });
    if (active) return { workOrderId: wo.id, workOrderNumber: wo.work_order_number, alreadyConfirmed: true };

    await tx.jobCardRequirementConfirmation.create({
      data: {
        work_order_id: wo.id,
        requirement: input.requirement,
        reason: reason || null,
        confirmed_by: context.userId,
      },
    });
    return { workOrderId: wo.id, workOrderNumber: wo.work_order_number, alreadyConfirmed: false };
  });

  if (!result.alreadyConfirmed) {
    const label = input.requirement === "workers" ? "No Workers Required" : "No Materials Required";
    await Promise.all([
      writeAuditLog({
        actorId: context.userId,
        action: input.requirement === "workers" ? "work_order.workers_not_required" : "work_order.materials_not_required",
        entityType: "work_order",
        entityId: result.workOrderId,
        summary: `${label} confirmed for ${result.workOrderNumber ?? "Job Card"}`,
        metadata: { requirement: input.requirement, reason: reason || null },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, result.workOrderId, context.userId),
    ]);
  }
  return result;
}

/**
 * Called inside the transaction that adds workers / materials to a Job Card:
 * the active "not required" confirmation (if any) is superseded — kept, with
 * who/when/why — since the Job Card now has them. A no-op otherwise.
 */
export async function supersedeRequirementConfirmation(
  tx: BackendTransaction | typeof prisma,
  workOrderId: string,
  requirement: ClosureRequirement,
  actorId: string,
  cause: string
) {
  await tx.jobCardRequirementConfirmation.updateMany({
    where: { work_order_id: workOrderId, requirement, superseded_at: null },
    data: { superseded_at: new Date(), superseded_by: actorId, superseded_reason: cause },
  });
}

/**
 * Server-side guard for requestJobCardClosure (call under the activity
 * lock): workers and materials must each be present or confirmed not
 * required. Worker progress and pending materials keep their own guards.
 */
export async function assertClosureRequirementsMet(tx: BackendTransaction, workOrderId: string) {
  const [workerCount, facts] = await Promise.all([countTeamWorkers(tx, workOrderId), getClosureRequirementFactsFor(tx, workOrderId)]);
  const check = checkClosureRequirements({
    workerCount,
    workersNotRequired: facts.workersNotRequired,
    materialsPresent: facts.materialsPresent,
    materialsNotRequired: facts.materialsNotRequired,
  });
  if (!check.ready) {
    throw new AppError(`This Job Card is not ready for closure. ${check.reasons.join(" ")}`, { code: "WORKFLOW_ERROR" });
  }
}
