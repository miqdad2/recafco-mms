import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { dedupeRecipients } from "@/lib/backend/notifications/safe-notifications";
import { getActiveUserIdsByRoleSlugs } from "@/lib/backend/work-orders/repository";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import type { InternalTeamRosterInput } from "@/lib/backend/workers/validators";

// Work Assignment and Worker Profiles Foundation Unit 7, Task 4/5/6/8.
//
// A separate, additive save path alongside the existing assignTechnicians()
// (lib/backend/work-orders/service.ts) — that one still owns technician
// self-service login linkage + Freelancer/External Company, untouched by
// this unit. This one owns the Internal Team labor roster: Supervisor +
// Technicians + Helpers/Labor sourced from worker_profiles (no-login labor
// records), each row snapshotting worker_profiles.hourly_rate at assignment
// time.
function assertCanManageRoster(context: CurrentUserContext) {
  assertActiveUser(context);
  assertBackendPermission(context, "work_orders.assign");
}

export type WorkerRosterRow = {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_role: string;
  hourly_rate_snapshot: number;
  assigned_by: string | null;
  assigned_at: string;
  notes: string | null;
};

export async function getInternalTeamRoster(workOrderId: string): Promise<WorkerRosterRow[]> {
  const rows = await prisma.workOrderWorkerAssignment.findMany({
    where: { work_order_id: workOrderId, status: "active" },
    include: { worker_profiles: { select: { name: true } } },
    orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    worker_id: r.worker_id,
    worker_name: r.worker_profiles.name,
    worker_role: r.worker_role,
    hourly_rate_snapshot: Number(r.hourly_rate_snapshot),
    assigned_by: r.assigned_by,
    assigned_at: r.assigned_at.toISOString(),
    notes: r.notes,
  }));
}

// Replace-all (soft): any previously "active" row not present in the new
// selection is marked "removed", never hard-deleted — a future work-session/
// timer unit needs this table's id to stay valid history even after a
// roster correction. Blocked once the Job Card is Closed, for everyone —
// Unit 4 removed every post-closure correction path and this unit does not
// reopen one (Task 6).
export async function assignInternalTeamRoster(context: CurrentUserContext, input: InternalTeamRosterInput) {
  assertCanManageRoster(context);

  const picks = [
    ...(input.supervisorId ? [{ id: input.supervisorId, role: "Supervisor" }] : []),
    ...input.technicianIds.map((id) => ({ id, role: "Technician" })),
    ...input.helperIds.map((id) => ({ id, role: "Helper/Labor" })),
  ];

  if (picks.length === 0) {
    throw new AppError("Select at least one worker for the Internal Team roster.", { code: "VALIDATION_ERROR" });
  }
  const uniqueIds = [...new Set(picks.map((w) => w.id))];
  if (uniqueIds.length !== picks.length) {
    throw new AppError("The same worker cannot be assigned twice on the same Job Card.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await tx.work_orders.findUnique({
      where: { id: input.workOrderId },
      select: { id: true, work_order_number: true, status: true, created_by: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") {
      throw new AppError("This Job Card is closed. Assignment can no longer be changed.", { code: "WORKFLOW_ERROR" });
    }

    const workers = await tx.workerProfile.findMany({
      where: { id: { in: uniqueIds }, is_active: true },
      select: { id: true, name: true, hourly_rate: true },
    });
    if (workers.length !== uniqueIds.length) {
      throw new AppError("One or more selected workers are inactive or no longer exist.", { code: "VALIDATION_ERROR" });
    }
    const workerById = new Map(workers.map((w) => [w.id, w]));

    await tx.workOrderWorkerAssignment.updateMany({
      where: { work_order_id: input.workOrderId, status: "active" },
      data: { status: "removed", updated_at: new Date() },
    });

    await tx.workOrderWorkerAssignment.createMany({
      data: picks.map(({ id, role }) => ({
        work_order_id: input.workOrderId,
        worker_id: id,
        worker_role: role,
        hourly_rate_snapshot: workerById.get(id)!.hourly_rate,
        assigned_by: context.userId,
        notes: input.notes?.trim() || null,
      })),
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      assigneeNames: picks.map(({ id, role }) => `${workerById.get(id)!.name} (${role})`).join(", "),
    };
  });

  const recipients = await withBackendTransaction(context.userId, async (tx) => {
    const roleIds = await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager"]);
    return dedupeRecipients([result.createdBy, ...roleIds], context.userId);
  });

  await Promise.all([
    recipients.length
      ? notifyWorkflowEvent({
          eventKey: "job_card.assignment_updated",
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientUserIds: recipients,
          category: "Work Orders",
          title: "Internal Team assignment updated",
          message: `${result.workOrderNumber ?? "A Job Card"}'s Internal Team was updated: ${result.assigneeNames}.`,
          metadata: { job_card_number: result.workOrderNumber ?? "Job Card", assignee_name: result.assigneeNames },
          actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
        })
      : Promise.resolve([]),
    writeAuditLog({
      actorId: context.userId,
      action: "work_order.assignment_updated",
      entityType: "work_order",
      entityId: result.workOrderId,
      summary: `Internal Team roster updated for ${result.workOrderNumber ?? "work order"}`,
      metadata: { assignees: result.assigneeNames },
    }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_ASSIGNMENT_UPDATED, result.workOrderId, context.userId),
  ]);

  return result;
}
