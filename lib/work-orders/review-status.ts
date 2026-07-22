import "server-only";

import { prisma } from "@/lib/db/prisma";

// Maintenance Engineer Dashboard + Review-to-Manager UX Fix: Job Card status
// intentionally stays "Under Review" through both the Engineer-review and
// Manager-approval steps (locked decision — no new status/schema added), so
// whether the Engineer has already reviewed a given Job Card is derived from
// its work_order.review audit log entry rather than a new column.
export async function getReviewedWorkOrderIds(workOrderIds: string[]): Promise<Set<string>> {
  if (workOrderIds.length === 0) return new Set();
  const rows = await prisma.audit_logs.findMany({
    where: { entity_type: "work_order", action: "work_order.review", entity_id: { in: workOrderIds } },
    select: { entity_id: true },
    distinct: ["entity_id"],
  });
  return new Set(rows.map((r) => r.entity_id).filter((id): id is string => Boolean(id)));
}
