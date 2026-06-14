import { prisma } from "@/lib/db/prisma";

export type ArchitectureStats = {
  users: number;
  roles: number;
  permissions: number;
  departments: number;
  assets: number;
  workOrders: number;
  notifications: number;
  unreadNotifications: number;
  auditLogs: number;
};

async function safeCount(query: Promise<number>): Promise<number> {
  try {
    return await query;
  } catch {
    return 0;
  }
}

export async function getArchitectureStats(userId: string): Promise<ArchitectureStats> {
  const [users, roles, permissions, departments, assets, workOrders, notifications, unreadNotifications, auditLogs] = await Promise.all([
    safeCount(prisma.profiles.count()),
    safeCount(prisma.roles.count()),
    safeCount(prisma.permissions.count()),
    safeCount(prisma.departments.count({ where: { is_active: true } })),
    safeCount(prisma.assets.count({ where: { deleted_at: null } })),
    safeCount(prisma.work_orders.count()),
    safeCount(prisma.notifications.count()),
    safeCount(
      prisma.notifications.count({
        where: {
          OR: [{ recipient_user_id: userId }, { recipient_id: userId }],
          archived_at: null,
          read_at: null,
          is_read: false
        }
      })
    ),
    safeCount(prisma.audit_logs.count())
  ]);

  return { users, roles, permissions, departments, assets, workOrders, notifications, unreadNotifications, auditLogs };
}
