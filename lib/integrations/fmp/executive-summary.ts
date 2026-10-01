import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { VEHICLE_CATEGORIES } from "@/lib/assets/categories";
import { getMovementBadge } from "@/lib/assets/movement-status";
import { getExpiryStatus } from "@/lib/assets/vehicle-status";
import { OPEN_PR_STATUSES } from "@/lib/display/parts-request-labels";
import {
  buildFmpMaintenanceDashboard,
  type BuildFmpDashboardOptions,
  type FmpDashboardDb,
  type FmpMaintenanceDashboard,
  type FmpNeedsAttentionItem,
} from "@/lib/integrations/fmp/maintenance-dashboard";
import { ACTIVE_JOB_CARD_STATUSES, CLOSURE_REQUESTED_STATUS } from "@/lib/work-orders/simplified-status-display";

// FMP-MAINT-04: full MMS executive summary for FMP — job cards, materials
// requests, inventory, assets, vehicle expiry, labor, and manager attention
// — added to the existing live payload as new, optional top-level sections
// (every MMS-FMP-INTEGRATION-01 field is unchanged, so an older FMP parser
// keeps working). Each section reuses the rule its own MMS page already
// applies (cited per section below) and is isolated: if one section's
// query fails it is returned as null instead of failing the whole payload.
//
// Still read-only: count/findMany/groupBy only, on an injected client.
// Cost figures (labor cost, stock/received/issued value) are returned only
// when `includeCosts` is true — this is a key-authenticated company-wide
// feed with no MMS user, so canViewCosts(context) cannot apply; the
// FMP_INTEGRATION_INCLUDE_COSTS setting is the equivalent switch.

export type FmpExecutiveDb = FmpDashboardDb & {
  work_orders: Pick<PrismaClient["work_orders"], "count" | "findMany">;
  parts_requests: Pick<PrismaClient["parts_requests"], "count">;
  general_inventory_requests: Pick<PrismaClient["general_inventory_requests"], "count">;
  assets: Pick<PrismaClient["assets"], "count" | "findMany" | "groupBy">;
  asset_movements: Pick<PrismaClient["asset_movements"], "findMany">;
  offline_inventory_movements: Pick<PrismaClient["offline_inventory_movements"], "findMany">;
  workOrderWorkSession: Pick<PrismaClient["workOrderWorkSession"], "findMany">;
};

/** The slice of lib/store/offline-inventory-data.ts's getOfflineInventoryBalance() this module reads. */
export type FmpInventoryBalanceInput = {
  balanceItems: { display_name: string; unit: string; balance: number; stock_status: string }[];
  balance: number;
  totalStockValue: number;
  lowStockCount: number;
};

export const FMP_VEHICLE_ALERT_LIMIT = 5;
export const FMP_MANAGER_ATTENTION_LIMIT = 6;
export const FMP_ASSET_TYPE_LIMIT = 12;
// Same window the MMS Manager dashboard's Vehicle Expiry snapshot uses
// (MG_VEHICLE_EXPIRY_WINDOW_DAYS in app/(dashboard)/dashboard/page.tsx).
export const FMP_VEHICLE_EXPIRY_WINDOW_DAYS = 15;

const MMS_PATHS = {
  dashboard: "/dashboard",
  jobCards: "/maintenance/work-orders",
  materialsRequests: "/store/parts-requests",
  inventory: "/store/offline-inventory",
  assets: "/assets",
  vehicles: "/assets/vehicles",
  workerActivity: "/maintenance/assignments",
  dailyActivity: "/maintenance/daily-activity",
} as const;

export type FmpMmsLinks = Record<keyof typeof MMS_PATHS, string>;

export type FmpJobCardsSection = {
  totalJobCards: number;
  activeJobs: number;
  inProgress: number;
  closureRequests: number;
  completedThisMonth: number;
  paused: number;
  workingNow: number;
  openUrl: string;
};

export type FmpMaterialsRequestsSection = {
  totalMaterialsRequests: number;
  pendingMaterialsRequests: number;
  completedMaterialsRequests: number;
  jobCardMaterialsRequests: number;
  generalInventoryRequests: number;
  materialsPending: number;
  openUrl: string;
};

export type FmpInventorySection = {
  totalMaterials: number;
  currentBalance: number;
  lowStockCount: number;
  outOfStockCount: number;
  currentStockValueKwd: number | null;
  receivedThisMonthKwd: number | null;
  issuedThisMonthKwd: number | null;
  openUrl: string;
};

export type FmpAssetsSection = {
  totalAssets: number;
  assetsAtSite: number;
  activeMaintenance: number;
  overdueReturn: number;
  assetTypeBreakdown: { type: string; count: number }[];
  openUrl: string;
};

export type FmpVehicleExpiryAlert = {
  assetRef: string;
  title: string;
  expiryType: "Insurance" | "Registration";
  expiryDate: string;
  daysRemaining: number;
  overdueDays: number;
  openUrl: string;
};

export type FmpVehicleComplianceSection = {
  vehicleExpiryAlerts: number;
  expiringSoon: number;
  expiredCount: number;
  windowDays: number;
  topVehicleExpiryAlerts: FmpVehicleExpiryAlert[];
  openUrl: string;
};

export type FmpLaborSection = {
  workingNow: number;
  pausedWorkers: number;
  laborHoursToday: number;
  laborCostTodayKwd: number | null;
  laborHoursThisWeek: number;
  laborCostThisWeekKwd: number | null;
  openUrl: string;
};

export type FmpAttentionType =
  | "closure_request"
  | "vehicle_expiry"
  | "overdue_job"
  | "waiting_materials"
  | "low_stock"
  | "unassigned_job"
  | "priority_job";

export type FmpManagerAttentionItem = {
  type: FmpAttentionType;
  ref: string;
  title: string;
  reason: string;
  status: string | null;
  priority: string | null;
  openUrl: string;
};

export type FmpManagerAttentionSection = {
  needsManagerAttention: number;
  counts: {
    closureRequests: number;
    vehicleExpiryAlerts: number;
    overdueJobs: number;
    waitingMaterials: number;
    lowStock: number;
    unassignedJobs: number;
  };
  attentionItems: FmpManagerAttentionItem[];
};

export type FmpExecutiveSections = {
  links: FmpMmsLinks;
  jobCards: FmpJobCardsSection | null;
  materialsRequests: FmpMaterialsRequestsSection | null;
  inventory: FmpInventorySection | null;
  assets: FmpAssetsSection | null;
  vehicleCompliance: FmpVehicleComplianceSection | null;
  labor: FmpLaborSection | null;
  managerAttention: FmpManagerAttentionSection | null;
};

export type FmpLiveDashboard = FmpMaintenanceDashboard & FmpExecutiveSections;

export type BuildFmpLiveDashboardOptions = BuildFmpDashboardOptions & {
  includeCosts: boolean;
  loadInventoryBalance: () => Promise<FmpInventoryBalanceInput>;
  logError?: (message: string, error: unknown) => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function buildMmsLinks(baseUrl: string): FmpMmsLinks {
  return Object.fromEntries(Object.entries(MMS_PATHS).map(([key, path]) => [key, url(baseUrl, path)])) as FmpMmsLinks;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sunday-start work week — the Kuwait convention MMS's Worker Activity/Manager dashboard use. */
export function startOfWeek(now: Date): Date {
  const d = startOfDay(now);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// ── Open work sessions (shared by Job Cards + Labor) ─────────────────────────

type OpenSession = { work_order_id: string; worker_id: string; status: string };

export function summarizeOpenSessions(sessions: OpenSession[]) {
  const activeJobs = new Set<string>();
  const pausedJobs = new Set<string>();
  const activeWorkers = new Set<string>();
  const pausedWorkers = new Set<string>();
  for (const s of sessions) {
    if (s.status === "Active") {
      activeJobs.add(s.work_order_id);
      activeWorkers.add(s.worker_id);
    } else if (s.status === "Paused") {
      pausedJobs.add(s.work_order_id);
      pausedWorkers.add(s.worker_id);
    }
  }
  // "Paused" = paused and nobody currently working — same rule as the MMS
  // Manager dashboard (anyWorkerPaused && !hasActiveSession).
  return {
    jobsWorkingNow: activeJobs.size,
    jobsPaused: [...pausedJobs].filter((id) => !activeJobs.has(id)).length,
    workersWorkingNow: activeWorkers.size,
    workersPaused: [...pausedWorkers].filter((id) => !activeWorkers.has(id)).length,
  };
}

// ── Vehicle expiry ───────────────────────────────────────────────────────────

type VehicleRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  plate_number: string | null;
  insurance_expiry_date: Date | null;
  registration_expiry_date: Date | null;
};

/** Same rule as the MMS Manager dashboard: insurance/registration expired or expiring within the window. */
export function buildVehicleAlerts(vehicles: VehicleRow[], baseUrl: string): FmpVehicleExpiryAlert[] {
  const alerts: FmpVehicleExpiryAlert[] = [];
  for (const v of vehicles) {
    const documents = [
      ["Insurance", v.insurance_expiry_date],
      ["Registration", v.registration_expiry_date],
    ] as const;
    for (const [expiryType, date] of documents) {
      const { daysRemaining } = getExpiryStatus(date);
      if (!date || daysRemaining === null || daysRemaining > FMP_VEHICLE_EXPIRY_WINDOW_DAYS) continue;
      alerts.push({
        assetRef: v.asset_code,
        title: v.plate_number ? `${v.asset_name} (${v.plate_number})` : v.asset_name,
        expiryType,
        expiryDate: date.toISOString().slice(0, 10),
        daysRemaining,
        overdueDays: Math.max(0, -daysRemaining),
        openUrl: url(baseUrl, `/assets/${encodeURIComponent(v.id)}`),
      });
    }
  }
  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ── Manager attention ────────────────────────────────────────────────────────

function jobAttentionType(item: FmpNeedsAttentionItem): FmpAttentionType {
  if (item.reasons.includes("Closure request pending")) return "closure_request";
  if (item.reasons.includes("Overdue")) return "overdue_job";
  if (item.reasons.includes("Waiting for parts")) return "waiting_materials";
  if (item.reasons.includes("Unassigned")) return "unassigned_job";
  return "priority_job";
}

const ATTENTION_TYPE_ORDER: FmpAttentionType[] = [
  "closure_request",
  "vehicle_expiry",
  "overdue_job",
  "waiting_materials",
  "low_stock",
  "unassigned_job",
  "priority_job",
];

/** Round-robin across attention types (in priority order) so one busy type can't crowd out the others. */
export function pickAttentionItems(items: FmpManagerAttentionItem[], limit = FMP_MANAGER_ATTENTION_LIMIT) {
  const queues = ATTENTION_TYPE_ORDER.map((type) => items.filter((i) => i.type === type));
  const picked: FmpManagerAttentionItem[] = [];
  while (picked.length < limit && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) picked.push(next);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}

const LOW_STOCK_REASON: Record<string, string> = {
  negative: "Negative stock",
  out_of_stock: "Out of stock",
  low_stock: "Low stock",
  review_required: "Review required",
};

// ── Live query ───────────────────────────────────────────────────────────────

async function section<T>(
  name: string,
  load: () => Promise<T>,
  logError: BuildFmpLiveDashboardOptions["logError"]
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logError?.(`[fmp-integration] section "${name}" failed`, error);
    return null;
  }
}

export async function buildFmpLiveDashboard(
  db: FmpExecutiveDb,
  options: BuildFmpLiveDashboardOptions
): Promise<FmpLiveDashboard> {
  const now = options.now ?? new Date();
  const { baseUrl, includeCosts, logError } = options;
  const links = buildMmsLinks(baseUrl);
  const liveJobCard: Prisma.work_ordersWhereInput = { deleted_at: null };

  // The original MMS-FMP-INTEGRATION-01 payload — a failure here still fails
  // the request (500), exactly as before.
  const basePromise = buildFmpMaintenanceDashboard(db, { ...options, now });

  const openSessionsPromise = section(
    "openSessions",
    () =>
      db.workOrderWorkSession.findMany({
        // Active Job Cards only — the MMS dashboard derives Working Now/
        // Paused from its active Job Card list, so a leftover paused
        // session on a Closure Requested/Closed card is not counted.
        where: {
          status: { in: ["Active", "Paused"] },
          work_orders: { is: { deleted_at: null, status: { in: ACTIVE_JOB_CARD_STATUSES } } },
        },
        select: { work_order_id: true, worker_id: true, status: true },
      }),
    logError
  );

  const vehiclesPromise = section(
    "vehicles",
    () =>
      db.assets.findMany({
        where: { deleted_at: null, category: { in: [...VEHICLE_CATEGORIES] } },
        select: {
          id: true,
          asset_code: true,
          asset_name: true,
          plate_number: true,
          insurance_expiry_date: true,
          registration_expiry_date: true,
        },
      }),
    logError
  );

  const inventoryBalancePromise = section("inventoryBalance", options.loadInventoryBalance, logError);

  const [base, openSessions, vehicles, inventoryBalance] = await Promise.all([
    basePromise,
    openSessionsPromise,
    vehiclesPromise,
    inventoryBalancePromise,
  ]);
  const sessionSummary = openSessions ? summarizeOpenSessions(openSessions) : null;
  const vehicleAlerts = vehicles ? buildVehicleAlerts(vehicles, baseUrl) : null;

  const [jobCards, materialsRequests, inventory, assets, labor, unassignedJobs] = await Promise.all([
    // Job Cards — same buckets as the MMS Manager dashboard KPI row.
    section(
      "jobCards",
      async (): Promise<FmpJobCardsSection> => {
        if (!sessionSummary) throw new Error("open sessions unavailable");
        const [totalJobCards, activeJobs, closureRequests] = await Promise.all([
          db.work_orders.count({ where: liveJobCard }),
          db.work_orders.count({ where: { deleted_at: null, status: { in: ACTIVE_JOB_CARD_STATUSES } } }),
          db.work_orders.count({ where: { deleted_at: null, status: CLOSURE_REQUESTED_STATUS } }),
        ]);
        return {
          totalJobCards,
          activeJobs,
          inProgress: base.summary.inProgress,
          closureRequests,
          completedThisMonth: base.summary.completedThisMonth,
          paused: sessionSummary.jobsPaused,
          workingNow: sessionSummary.jobsWorkingNow,
          openUrl: links.jobCards,
        };
      },
      logError
    ),

    // Materials Requests — Job Card requests (parts_requests) + General
    // Inventory Requests; "pending" = OPEN_PR_STATUSES / Pending,
    // "completed" = Issued / Completed (MMS's own terminal statuses).
    section(
      "materialsRequests",
      async (): Promise<FmpMaterialsRequestsSection> => {
        const onLiveJobCard = { work_orders: { is: liveJobCard } };
        const [jobCardTotal, jobCardPending, jobCardCompleted, generalTotal, generalPending, generalCompleted, materialsPending] =
          await Promise.all([
            db.parts_requests.count({ where: onLiveJobCard }),
            db.parts_requests.count({ where: { ...onLiveJobCard, status: { in: OPEN_PR_STATUSES } } }),
            db.parts_requests.count({ where: { ...onLiveJobCard, status: "Issued" } }),
            db.general_inventory_requests.count(),
            db.general_inventory_requests.count({ where: { status: "Pending" } }),
            db.general_inventory_requests.count({ where: { status: "Completed" } }),
            // Job Cards still waiting on materials (same as the MMS dashboard KPI).
            db.work_orders.count({
              where: { deleted_at: null, parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } },
            }),
          ]);
        return {
          totalMaterialsRequests: jobCardTotal + generalTotal,
          pendingMaterialsRequests: jobCardPending + generalPending,
          completedMaterialsRequests: jobCardCompleted + generalCompleted,
          jobCardMaterialsRequests: jobCardTotal,
          generalInventoryRequests: generalTotal,
          materialsPending,
          openUrl: links.materialsRequests,
        };
      },
      logError
    ),

    // Inventory — balances/low-stock straight from MMS's Inventory Control
    // calculation; month values use its spending-summary cost rule
    // (total_cost, else quantity × unit_cost, else excluded).
    section(
      "inventory",
      async (): Promise<FmpInventorySection> => {
        if (!inventoryBalance) throw new Error("inventory balance unavailable");
        let receivedThisMonth: number | null = null;
        let issuedThisMonth: number | null = null;
        if (includeCosts) {
          const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const movements = await db.offline_inventory_movements.findMany({
            where: { deleted_at: null, movement_type: { in: ["ISSUED", "RECEIVED"] }, movement_date: { gte: monthStartUtc } },
            select: { movement_type: true, quantity: true, unit_cost: true, total_cost: true },
          });
          receivedThisMonth = 0;
          issuedThisMonth = 0;
          for (const m of movements) {
            const cost =
              m.total_cost !== null ? Number(m.total_cost) : m.unit_cost !== null ? Number(m.quantity) * Number(m.unit_cost) : 0;
            if (m.movement_type === "RECEIVED") receivedThisMonth += cost;
            else issuedThisMonth += cost;
          }
        }
        return {
          totalMaterials: inventoryBalance.balanceItems.length,
          currentBalance: round3(inventoryBalance.balance),
          lowStockCount: inventoryBalance.lowStockCount,
          outOfStockCount: inventoryBalance.balanceItems.filter((i) => i.stock_status === "out_of_stock").length,
          currentStockValueKwd: includeCosts ? round3(inventoryBalance.totalStockValue) : null,
          receivedThisMonthKwd: receivedThisMonth === null ? null : round3(receivedThisMonth),
          issuedThisMonthKwd: issuedThisMonth === null ? null : round3(issuedThisMonth),
          openUrl: links.inventory,
        };
      },
      logError
    ),

    // Assets & Equipment — same four KPIs as the MMS Assets page.
    section(
      "assets",
      async (): Promise<FmpAssetsSection> => {
        const [byCategory, activeMaintenance, activeMovements] = await Promise.all([
          db.assets.groupBy({ by: ["category"], where: { deleted_at: null }, _count: { _all: true } }),
          db.assets.count({
            where: {
              deleted_at: null,
              work_orders: { some: { deleted_at: null, status: { in: ACTIVE_JOB_CARD_STATUSES } } },
            },
          }),
          db.asset_movements.findMany({
            where: { status: "ACTIVE" },
            select: { asset_id: true, to_location: true, sent_date: true, expected_return_date: true },
          }),
        ]);
        const breakdown = byCategory
          .map((row) => ({ type: row.category, count: row._count._all }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
        const movementByAsset = new Map(activeMovements.map((m) => [m.asset_id, m]));
        return {
          totalAssets: breakdown.reduce((sum, row) => sum + row.count, 0),
          assetsAtSite: movementByAsset.size,
          activeMaintenance,
          overdueReturn: [...movementByAsset.values()].filter((m) => getMovementBadge(m, now)?.label === "Overdue").length,
          assetTypeBreakdown: breakdown.slice(0, FMP_ASSET_TYPE_LIMIT),
          openUrl: links.assets,
        };
      },
      logError
    ),

    // Labor — same session rule as getLaborPeriodTotals(): non-cancelled
    // sessions bucketed by started_at, stored duration/amount summed as-is.
    section(
      "labor",
      async (): Promise<FmpLaborSection> => {
        if (!sessionSummary) throw new Error("open sessions unavailable");
        const todayStart = startOfDay(now);
        const weekStart = startOfWeek(now);
        const sessions = await db.workOrderWorkSession.findMany({
          where: { status: { not: "Cancelled" }, started_at: { gte: weekStart }, work_orders: { is: liveJobCard } },
          select: { started_at: true, duration_minutes: true, calculated_amount: true },
        });
        let todayMinutes = 0;
        let todayAmount = 0;
        let weekMinutes = 0;
        let weekAmount = 0;
        for (const s of sessions) {
          const amount = Number(s.calculated_amount);
          weekMinutes += s.duration_minutes;
          weekAmount += amount;
          if (s.started_at >= todayStart) {
            todayMinutes += s.duration_minutes;
            todayAmount += amount;
          }
        }
        return {
          workingNow: sessionSummary.workersWorkingNow,
          pausedWorkers: sessionSummary.workersPaused,
          laborHoursToday: round2(todayMinutes / 60),
          laborCostTodayKwd: includeCosts ? round3(todayAmount) : null,
          laborHoursThisWeek: round2(weekMinutes / 60),
          laborCostThisWeekKwd: includeCosts ? round3(weekAmount) : null,
          openUrl: links.workerActivity,
        };
      },
      logError
    ),

    section(
      "unassignedJobs",
      () =>
        db.work_orders.count({
          where: {
            deleted_at: null,
            status: { in: ["Under Review", ...ACTIVE_JOB_CARD_STATUSES] },
            assigned_supervisor_id: null,
            work_order_assignments: { none: {} },
            work_order_worker_assignments: { none: { status: "active" } },
          },
        }),
      logError
    ),
  ]);

  const vehicleCompliance: FmpVehicleComplianceSection | null = vehicleAlerts
    ? {
        vehicleExpiryAlerts: vehicleAlerts.length,
        expiringSoon: vehicleAlerts.filter((a) => a.daysRemaining >= 0).length,
        expiredCount: vehicleAlerts.filter((a) => a.daysRemaining < 0).length,
        windowDays: FMP_VEHICLE_EXPIRY_WINDOW_DAYS,
        topVehicleExpiryAlerts: vehicleAlerts.slice(0, FMP_VEHICLE_ALERT_LIMIT),
        openUrl: links.vehicles,
      }
    : null;

  // Manager Attention — needs every count below; if any source section is
  // unavailable the whole section is null rather than a misleading partial.
  let managerAttention: FmpManagerAttentionSection | null = null;
  if (jobCards && vehicleAlerts && inventoryBalance && unassignedJobs !== null) {
    const counts = {
      closureRequests: jobCards.closureRequests,
      vehicleExpiryAlerts: vehicleAlerts.length,
      overdueJobs: base.summary.overdue,
      waitingMaterials: base.summary.waitingForParts,
      lowStock: inventoryBalance.lowStockCount,
      unassignedJobs,
    };
    const candidates: FmpManagerAttentionItem[] = [
      ...base.needsAttention.map((item) => ({
        type: jobAttentionType(item),
        ref: item.ref,
        title: item.title,
        reason: item.reasons.join(", "),
        status: item.statusLabel,
        priority: item.priority,
        openUrl: item.openUrl,
      })),
      ...vehicleAlerts.map((a) => ({
        type: "vehicle_expiry" as const,
        ref: a.assetRef,
        title: a.title,
        reason:
          a.daysRemaining < 0
            ? `${a.expiryType} expired ${a.overdueDays} day${a.overdueDays === 1 ? "" : "s"} ago`
            : a.daysRemaining === 0
              ? `${a.expiryType} expires today`
              : `${a.expiryType} expires in ${a.daysRemaining} day${a.daysRemaining === 1 ? "" : "s"}`,
        status: a.daysRemaining < 0 ? "Expired" : "Expiring Soon",
        priority: null,
        openUrl: a.openUrl,
      })),
      ...inventoryBalance.balanceItems
        .filter((i) => i.stock_status in LOW_STOCK_REASON)
        .sort((a, b) => a.balance - b.balance)
        .map((i) => ({
          type: "low_stock" as const,
          ref: "Inventory",
          title: i.display_name,
          reason: `${LOW_STOCK_REASON[i.stock_status]} — balance ${round3(i.balance)} ${i.unit}`,
          status: LOW_STOCK_REASON[i.stock_status],
          priority: null,
          openUrl: links.inventory,
        })),
    ];
    managerAttention = {
      needsManagerAttention: Object.values(counts).reduce((sum, n) => sum + n, 0),
      counts,
      attentionItems: pickAttentionItems(candidates),
    };
  }

  return { ...base, links, jobCards, materialsRequests, inventory, assets, vehicleCompliance, labor, managerAttention };
}
