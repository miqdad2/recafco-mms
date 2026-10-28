import "server-only";

import type { prisma } from "@/lib/db/prisma";
import { getWorkTimeSourceSummaries } from "@/lib/backend/work-orders/work-time-corrections";
import { checkClosureRequirements, checkWorkersReadyForClosure } from "@/lib/work-orders/closure-readiness";
import { getClosureRequirementFacts } from "@/lib/work-orders/closure-requirements-data";
import { anyMaterialsIncomplete, getMaterialFulfillmentForWorkOrders } from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummariesBulk } from "@/lib/work-orders/work-session-totals";

type DbClient = typeof prisma;

export type ClosureReadiness = { ready: boolean; reasons: string[] };

/**
 * "Could closure be requested now?" for many Job Cards at once — the same
 * conditions requestJobCardClosure enforces (no pending Materials Request,
 * required materials fully issued, every worker finished, workers /
 * materials present or confirmed not required, no worker time waiting for
 * the Manager), read in bulk. For list pages that don't already load these
 * pieces themselves (Daily Activity / Dashboard / detail compute the same
 * conditions from data they already have). Callers have applied the
 * visibility filter.
 */
export async function getClosureReadinessForWorkOrders(db: DbClient, workOrderIds: string[]): Promise<Map<string, ClosureReadiness>> {
  const result = new Map<string, ClosureReadiness>();
  if (workOrderIds.length === 0) return result;

  const [fulfillmentMap, laborMap, timeMap, factsMap, pendingRequests] = await Promise.all([
    getMaterialFulfillmentForWorkOrders(db, workOrderIds),
    getWorkOrderLaborSummariesBulk(db, workOrderIds),
    getWorkTimeSourceSummaries(db, workOrderIds),
    getClosureRequirementFacts(db, workOrderIds),
    db.parts_requests.groupBy({
      by: ["work_order_id"],
      where: { work_order_id: { in: workOrderIds }, status: { not: "Issued" } },
      _count: { _all: true },
    }),
  ]);
  const pendingByWorkOrder = new Set(pendingRequests.map((g) => g.work_order_id).filter((id): id is string => Boolean(id)));

  for (const id of workOrderIds) {
    const workers = laborMap.get(id)?.workers ?? [];
    const facts = factsMap.get(id);
    const time = timeMap.get(id);
    const workersCheck = checkWorkersReadyForClosure(
      workers.map((w) => ({
        workerAssignmentId: w.worker_assignment_id,
        workerName: w.worker_name,
        assignmentStatus: w.assignment_status,
        sessionStatus: w.status,
        manualMinutes: w.manual_minutes,
      }))
    );
    const requirements = checkClosureRequirements({
      workerCount: workers.length,
      workersNotRequired: facts?.workersNotRequired ?? null,
      materialsPresent: facts?.materialsPresent ?? false,
      materialsNotRequired: facts?.materialsNotRequired ?? null,
    });
    const reasons: string[] = [];
    if (pendingByWorkOrder.has(id)) reasons.push("Materials pending");
    if (anyMaterialsIncomplete(fulfillmentMap.get(id) ?? [])) reasons.push("Required materials not fully issued");
    reasons.push(...workersCheck.reasons, ...requirements.reasons);
    if ((time?.pendingManualEntries ?? 0) + (time?.pendingCorrections ?? 0) > 0) {
      reasons.push("Older worker time entries waiting for the Manager's decision.");
    }
    result.set(id, { ready: reasons.length === 0, reasons });
  }
  return result;
}
