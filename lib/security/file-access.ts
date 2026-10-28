import type { CurrentUserContext } from "@/lib/auth/context";
import type { PrivateFileBucket } from "@/lib/files/validation";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/security/permissions";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

export async function canViewEntityFile(context: CurrentUserContext, bucket: PrivateFileBucket, entityId: string) {
  if (!hasPermission(context, "files.view")) return false;
  if (context.role?.slug === "super_admin") return true;

  if (bucket === "work-order-files") {
    try {
      // Same Job Card visibility as the Job Card pages and the file route.
      if (hasPermission(context, "work_orders.view")) {
        const visible = await prisma.work_orders.findFirst({
          where: { AND: [{ id: entityId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
          select: { id: true },
        });
        if (visible) return true;
      }
      const assignment = await prisma.work_order_assignments.findFirst({
        where: { work_order_id: entityId, technician_id: context.userId, work_orders: { deleted_at: null } },
        select: { id: true }
      });
      return Boolean(assignment);
    } catch {
      return false;
    }
  }

  if (bucket === "asset-files") return hasPermission(context, "assets.view");
  if (bucket === "purchase-files") return hasPermission(context, "purchase_requests.view") || hasPermission(context, "finance.approve") || hasPermission(context, "ceo.approve");
  return false;
}
