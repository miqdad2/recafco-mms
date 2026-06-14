import { prisma } from "@/lib/db/prisma";

export type SystemMapStats = {
  assets: number;
  parts: number;
  workOrders: number;
  openWorkOrders: number;
  pendingApprovals: number;
  waitingForParts: number;
  partsRequests: number;
  purchaseRequests: number;
  financeApprovals: number;
  lowStockItems: number;
  unreadNotifications: number;
  closedWorkOrders: number;
  departments: number;
  profiles: number;
  roles: number;
};

async function safeCount(query: Promise<number>): Promise<number> {
  try {
    return await query;
  } catch {
    return 0;
  }
}

export async function getSystemMapStats(userId: string): Promise<SystemMapStats> {
  const [
    assets,
    parts,
    workOrders,
    openWorkOrders,
    pendingApprovals,
    waitingForParts,
    partsRequests,
    purchaseRequests,
    financeApprovals,
    unreadNotifications,
    closedWorkOrders,
    departments,
    profiles,
    roles
  ] = await Promise.all([
    safeCount(prisma.assets.count({ where: { deleted_at: null } })),
    safeCount(prisma.parts.count({ where: { deleted_at: null } })),
    safeCount(prisma.work_orders.count()),
    safeCount(prisma.work_orders.count({ where: { NOT: { status: { in: ["Closed", "Cancelled", "Rejected"] } } } })),
    safeCount(prisma.work_orders.count({ where: { status: { in: ["Submitted", "Pending Approval"] } } })),
    safeCount(prisma.work_orders.count({ where: { status: { in: ["Waiting for Parts", "Waiting for Purchase"] } } })),
    safeCount(prisma.parts_requests.count()),
    safeCount(prisma.purchase_requests.count()),
    safeCount(prisma.purchase_requests.count({ where: { status: { in: ["Pending Finance Approval", "Pending CEO Approval"] } } })),
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
    safeCount(prisma.work_orders.count({ where: { status: "Closed" } })),
    safeCount(prisma.departments.count({ where: { is_active: true } })),
    safeCount(prisma.profiles.count({ where: { is_active: true } })),
    safeCount(prisma.roles.count())
  ]);

  let lowStockItems = 0;
  try {
    const partsData = await prisma.parts.findMany({
      where: { deleted_at: null },
      select: { current_stock: true, minimum_stock: true }
    });
    lowStockItems = partsData.filter((part) => part.current_stock.toNumber() <= part.minimum_stock.toNumber()).length;
  } catch {
    lowStockItems = 0;
  }

  return {
    assets,
    parts,
    workOrders,
    openWorkOrders,
    pendingApprovals,
    waitingForParts,
    partsRequests,
    purchaseRequests,
    financeApprovals,
    lowStockItems,
    unreadNotifications,
    closedWorkOrders,
    departments,
    profiles,
    roles
  };
}
