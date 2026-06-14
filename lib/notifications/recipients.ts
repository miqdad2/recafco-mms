import { prisma } from "@/lib/db/prisma";
import type { NotificationEventKey, NotificationRecipient } from "@/lib/notifications/types";
import type { RoleSlug } from "@/types/database";

export async function getUsersByRoles(roleSlugs: RoleSlug[] | string[]) {
  if (!roleSlugs.length) return [];
  const profiles = await prisma.profiles.findMany({
    where: {
      is_active: true,
      roles: { slug: { in: roleSlugs } }
    },
    include: { roles: true }
  });

  return profiles.map((profile) => ({
    userId: profile.id,
    roleSlug: profile.roles?.slug,
    departmentId: profile.department_id
  }) satisfies NotificationRecipient);
}

export async function getUsersByIds(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const profiles = await prisma.profiles.findMany({
    where: {
      id: { in: ids },
      is_active: true
    },
    include: { roles: true }
  });

  return profiles.map((profile) => ({
    userId: profile.id,
    roleSlug: profile.roles?.slug,
    departmentId: profile.department_id
  }) satisfies NotificationRecipient);
}

export async function resolveRecipientsForEvent(eventKey: NotificationEventKey | string, options: { recipientUserIds?: string[]; recipientRoles?: RoleSlug[] } = {}) {
  const direct = await getUsersByIds(options.recipientUserIds ?? []);
  const roles = await getUsersByRoles(options.recipientRoles ?? defaultRolesForEvent(eventKey));
  const merged = new Map<string, NotificationRecipient>();
  [...direct, ...roles].forEach((recipient) => merged.set(recipient.userId, recipient));
  return [...merged.values()];
}

function defaultRolesForEvent(eventKey: string): RoleSlug[] {
  if (eventKey === "work_order.submitted") return ["maintenance_manager", "super_admin"];
  if (eventKey === "work_order.approved") return ["maintenance_supervisor", "super_admin"];
  if (eventKey === "work_order.completed") return ["maintenance_supervisor", "maintenance_manager", "super_admin"];
  if (eventKey === "work_order.verified") return ["maintenance_manager", "super_admin"];
  if (eventKey === "work_order.rejected") return ["maintenance_data_entry", "maintenance_manager", "super_admin"];
  if (eventKey === "parts_request.submitted") return ["maintenance_manager", "super_admin"];
  if (eventKey === "parts_request.approved") return ["store_keeper", "super_admin"];
  if (eventKey === "parts_request.unavailable") return ["purchase_officer", "maintenance_manager", "super_admin"];
  if (eventKey === "purchase_request.pending_finance" || eventKey === "finance.approval_required") return ["finance_manager", "super_admin"];
  if (eventKey === "purchase_request.pending_ceo" || eventKey === "ceo.approval_required" || eventKey === "high_cost_request.created") return ["ceo_management", "super_admin"];
  if (eventKey === "inventory.low_stock") return ["store_keeper", "maintenance_manager", "purchase_officer", "super_admin"];
  if (eventKey === "work_order.inventory_check_completed") return ["maintenance_manager", "maintenance_supervisor", "super_admin"];
  return [];
}
