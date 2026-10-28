import "server-only";

import type { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import type { RequirementConfirmation } from "@/lib/work-orders/closure-readiness";

type DbClient = typeof prisma | BackendTransaction;

export type ClosureRequirementFacts = {
  // Any materials on this Job Card: a required-materials row, a "material
  // used" line, a linked Materials Request, or stock issued to it.
  materialsPresent: boolean;
  // Active (not superseded) confirmations.
  workersNotRequired: RequirementConfirmation | null;
  materialsNotRequired: RequirementConfirmation | null;
};

const EMPTY_FACTS: ClosureRequirementFacts = { materialsPresent: false, workersNotRequired: null, materialsNotRequired: null };

/**
 * The facts checkClosureRequirements() needs besides the worker rows every
 * caller already has, for many Job Cards at once (five indexed queries, not
 * per card). Read-only; callers have already applied the visibility filter.
 */
export async function getClosureRequirementFacts(db: DbClient, workOrderIds: string[]): Promise<Map<string, ClosureRequirementFacts>> {
  const result = new Map<string, ClosureRequirementFacts>();
  if (workOrderIds.length === 0) return result;

  const [confirmations, requiredParts, usedMaterials, materialsRequests, issued] = await Promise.all([
    db.jobCardRequirementConfirmation.findMany({
      where: { work_order_id: { in: workOrderIds }, superseded_at: null },
      select: {
        work_order_id: true,
        requirement: true,
        reason: true,
        confirmed_at: true,
        profiles_confirmed_by: { select: { full_name: true } },
      },
    }),
    db.workOrderRequiredPart.groupBy({ by: ["work_order_id"], where: { work_order_id: { in: workOrderIds } }, _count: { _all: true } }),
    db.work_order_materials.groupBy({ by: ["work_order_id"], where: { work_order_id: { in: workOrderIds } }, _count: { _all: true } }),
    db.parts_requests.groupBy({ by: ["work_order_id"], where: { work_order_id: { in: workOrderIds } }, _count: { _all: true } }),
    db.offline_inventory_movements.groupBy({
      by: ["related_work_order_id"],
      where: { related_work_order_id: { in: workOrderIds }, movement_type: "ISSUED", deleted_at: null },
      _count: { _all: true },
    }),
  ]);

  const withMaterials = new Set<string>();
  for (const g of requiredParts) withMaterials.add(g.work_order_id);
  for (const g of usedMaterials) withMaterials.add(g.work_order_id);
  for (const g of materialsRequests) if (g.work_order_id) withMaterials.add(g.work_order_id);
  for (const g of issued) if (g.related_work_order_id) withMaterials.add(g.related_work_order_id);

  for (const id of workOrderIds) result.set(id, { ...EMPTY_FACTS, materialsPresent: withMaterials.has(id) });
  for (const c of confirmations) {
    const facts = result.get(c.work_order_id);
    if (!facts) continue;
    const confirmation: RequirementConfirmation = {
      confirmedByName: c.profiles_confirmed_by?.full_name ?? null,
      confirmedAt: c.confirmed_at.toISOString(),
      reason: c.reason,
    };
    if (c.requirement === "workers") facts.workersNotRequired = confirmation;
    else if (c.requirement === "materials") facts.materialsNotRequired = confirmation;
  }
  return result;
}

export async function getClosureRequirementFactsFor(db: DbClient, workOrderId: string): Promise<ClosureRequirementFacts> {
  return (await getClosureRequirementFacts(db, [workOrderId])).get(workOrderId) ?? EMPTY_FACTS;
}
