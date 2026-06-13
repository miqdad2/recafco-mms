import { redirect } from "next/navigation";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/security/permissions";
import type { PermissionKey } from "@/types/database";

export function requireContextPermission(context: CurrentUserContext, permission: PermissionKey | string) {
  if (!hasPermission(context, permission)) {
    redirect("/dashboard?error=permission-denied");
  }
}

export async function requireTechnicianAssignment(context: CurrentUserContext, workOrderId: string) {
  if (hasPermission(context, "work_orders.view")) return true;

  let assignment: { id: string } | null = null;
  try {
    assignment = await prisma.work_order_assignments.findFirst({
      where: { work_order_id: workOrderId, technician_id: context.userId },
      select: { id: true }
    });
  } catch {
    redirect("/technician/jobs?error=not-assigned");
  }

  if (!assignment) {
    redirect("/technician/jobs?error=not-assigned");
  }

  return true;
}
