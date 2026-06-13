import type { CurrentUserContext } from "@/lib/auth/context";
import type { PrivateFileBucket } from "@/lib/files/validation";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/security/permissions";

export async function canViewEntityFile(context: CurrentUserContext, bucket: PrivateFileBucket, entityId: string) {
  if (!hasPermission(context, "files.view")) return false;
  if (context.role?.slug === "super_admin") return true;

  if (bucket === "work-order-files") {
    if (hasPermission(context, "work_orders.view")) return true;
    try {
      const assignment = await prisma.work_order_assignments.findFirst({
        where: { work_order_id: entityId, technician_id: context.userId },
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
