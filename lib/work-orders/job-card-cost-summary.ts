import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts } from "@/lib/security/permissions";
import { buildBalanceKey, getLastUnitCostsForIdentities } from "@/lib/store/offline-inventory-data";
import { getJobCardIndirectCostSetting } from "@/lib/work-orders/job-card-indirect-cost";
import type { MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummariesBulk } from "@/lib/work-orders/work-session-totals";

// Job Card Print Cost Summary Unit.
//
// The Job Card print page's cost figures, built from the exact same sources
// and the exact same arithmetic as getClosureReviewDetailAction
// (app/actions/closure-requests.ts, Units 10G.72/10G.72B) so the two can
// never disagree: labor from getWorkOrderLaborSummariesBulk (stored
// calculated_amount per session), material unit cost from
// getLastUnitCostsForIdentities (Offline Inventory's "last unit cost"),
// Total Cost = issued qty × unit cost rounded to 3 decimals, Indirect Cost
// from the ONE Job-Card-wide app_settings value (never worker-level), and
// Grand Total = Direct Labor + Material + Indirect. That action itself is
// deliberately left untouched (it is Manager-role-gated and also builds
// attachments/signed URLs the print page has no use for).
//
// Returns null — running none of the cost queries — for a viewer without
// cost permission, so a cost figure can never reach the print page's JSX
// for them at all.

export type JobCardCostWorker = {
  workerAssignmentId: string;
  name: string;
  estimatedHours: number | null;
  actualHours: number;
  hourlyRate: number;
  directLaborCost: number;
  assignmentStatus: string;
  sessionStatus: string;
};

export type JobCardCostMaterialLine = {
  unitCost: number | null;
  totalCost: number | null;
  isUnpriced: boolean;
  status: "Fully Issued" | "Partially Issued" | "Not Issued";
};

export type JobCardCostSummary = {
  workers: JobCardCostWorker[];
  totalActualHours: number;
  directLaborCostTotal: number;
  // Keyed by MaterialFulfillment.id (the work_order_required_parts row).
  materialLineById: Map<string, JobCardCostMaterialLine>;
  materialCostTotal: number;
  hasUnpricedMaterial: boolean;
  jobCardIndirectCost: number;
  grandTotalJobCost: number;
};

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export async function getJobCardCostSummary(
  context: CurrentUserContext,
  workOrderId: string,
  fulfillment: MaterialFulfillment[]
): Promise<JobCardCostSummary | null> {
  if (!canViewCosts(context)) return null;

  const [laborMap, indirectCostSetting, unitCostByKey] = await Promise.all([
    getWorkOrderLaborSummariesBulk(prisma, [workOrderId]),
    getJobCardIndirectCostSetting(),
    fulfillment.length > 0
      ? getLastUnitCostsForIdentities(
          fulfillment.map((f) => ({ part_id: f.part_id, manual_material_name: f.part_id ? null : f.description, unit: f.unit }))
        )
      : Promise.resolve(new Map<string, number | null>()),
  ]);
  const laborSummary = laborMap.get(workOrderId);

  const materialLineById = new Map<string, JobCardCostMaterialLine>();
  let materialCostSum = 0;
  let hasUnpricedMaterial = false;
  for (const f of fulfillment) {
    const key = buildBalanceKey({ part_id: f.part_id, manual_material_name: f.part_id ? null : f.description, unit: f.unit });
    const unitCost = unitCostByKey.get(key) ?? null;
    // null (never 0) for an unpriced line, so it is excluded from the total
    // rather than silently counted as free.
    const totalCost = unitCost !== null ? round3(f.issued_qty * unitCost) : null;
    if (totalCost !== null) materialCostSum += totalCost;
    else hasUnpricedMaterial = true;
    materialLineById.set(f.id, {
      unitCost,
      totalCost,
      isUnpriced: unitCost === null,
      status: f.remaining_qty <= 1e-9 ? "Fully Issued" : f.issued_qty > 1e-9 ? "Partially Issued" : "Not Issued",
    });
  }

  const directLaborCostTotal = laborSummary?.total_amount ?? 0;
  const materialCostTotal = round3(materialCostSum);
  const jobCardIndirectCost = indirectCostSetting.amount;

  return {
    workers: (laborSummary?.workers ?? []).map((w) => ({
      workerAssignmentId: w.worker_assignment_id,
      name: w.worker_name,
      estimatedHours: w.estimated_hours,
      actualHours: w.total_hours,
      hourlyRate: w.hourly_rate_snapshot,
      directLaborCost: w.total_amount,
      assignmentStatus: w.assignment_status,
      sessionStatus: w.status,
    })),
    // Summed from the per-worker (already 2-decimal) hours, the same way
    // Closure Review's own worker table footer does.
    totalActualHours: (laborSummary?.workers ?? []).reduce((sum, w) => sum + w.total_hours, 0),
    directLaborCostTotal,
    materialLineById,
    materialCostTotal,
    hasUnpricedMaterial,
    jobCardIndirectCost,
    grandTotalJobCost: round3(directLaborCostTotal + materialCostTotal + jobCardIndirectCost),
  };
}
