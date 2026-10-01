import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  ACTIVE_JOB_CARD_STATUSES,
  CLOSURE_REQUESTED_STATUS,
  displaySimplifiedStatus,
} from "@/lib/work-orders/simplified-status-display";

// MMS-FMP-INTEGRATION-01: read-only live Maintenance dashboard summary for
// the separate Factory Management Platform (FMP). MMS stays the source of
// truth; this module only ever reads — every query below is a count() or
// findMany()/findFirst(), and the db client is passed in (route handler
// passes the real Prisma client, unit tests pass a fake that throws on any
// write method) so "no write side effects" is verifiable, not just claimed.
//
// Visibility: this is a server-to-server, key-authenticated company-wide
// summary with no MMS user session, so there is no CurrentUserContext to
// feed getWorkOrderVisibilityFilter(). The scope is deliberately the same
// as the full-access roles' scope ({} — Super Admin/IT Admin/Manager), and
// no cost fields are ever selected or returned.

/** Read-only slice of the Prisma client this module is allowed to touch. */
export type FmpDashboardDb = {
  work_orders: Pick<PrismaClient["work_orders"], "count" | "findMany">;
  auth_users: Pick<PrismaClient["auth_users"], "findFirst">;
};

export const FMP_SOURCE = "MMS_LIVE" as const;
export const FMP_RECENT_REQUESTS_LIMIT = 10;
export const FMP_NEEDS_ATTENTION_LIMIT = 10;
// Candidate sample the Needs Attention list is ranked from — most recently
// updated first, same "rank a bounded recent sample" convention the MMS
// dashboard's own Needs Attention widget uses (NU_ACTIVE_SAMPLE_SIZE).
export const FMP_NEEDS_ATTENTION_SAMPLE = 100;
const TITLE_MAX_LENGTH = 140;

// Draft ("Created") and terminal statuses. Cancelled/Rejected/Draft are
// legacy pre-Unit3 values kept defensively, same as lib/reports.
const NOT_OPEN_STATUSES = ["Created", "Draft", "Closed", "Cancelled", "Rejected"];
const NON_DRAFT_EXCLUDED_STATUSES = ["Created", "Draft"];

// "Waiting for parts" in the simplified 9-status model = materials not yet
// fully issued; legacy waiting statuses kept as a defensive fallback.
export const WAITING_FOR_PARTS_STATUSES = [
  "Waiting Materials",
  "Partially Issued",
  "Waiting for Parts",
  "Waiting for Purchase",
];

// Same in-flight bucket MMS reports use for overdue counts
// (lib/reports/data.ts getReportLandingStats): active statuses plus the
// legacy waiting ones.
const OVERDUE_ELIGIBLE_STATUSES = [...new Set([...ACTIVE_JOB_CARD_STATUSES, ...WAITING_FOR_PARTS_STATUSES])];
const UNASSIGNED_ELIGIBLE_STATUSES = ["Under Review", ...ACTIVE_JOB_CARD_STATUSES];
export const HIGH_PRIORITIES = ["High", "Urgent"];

export type AttentionReason =
  | "Overdue"
  | "Urgent priority"
  | "High priority"
  | "Closure request pending"
  | "Waiting for parts"
  | "Unassigned";

const REASON_WEIGHT: Record<AttentionReason, number> = {
  Overdue: 5,
  "Urgent priority": 4,
  "High priority": 3,
  "Closure request pending": 3,
  "Waiting for parts": 2,
  Unassigned: 1,
};

export type FmpDashboardSummary = {
  openRequests: number;
  inProgress: number;
  waitingForParts: number;
  overdue: number;
  assignedToMe: number | null;
  completedThisMonth: number;
};

export type FmpNeedsAttentionItem = {
  id: string;
  ref: string;
  title: string;
  status: string;
  statusLabel: string;
  priority: string | null;
  reasons: AttentionReason[];
  updatedAt: string | null;
  openUrl: string;
};

export type FmpRecentRequestItem = {
  id: string;
  ref: string;
  title: string;
  assetOrLocation: string | null;
  status: string;
  statusLabel: string;
  priority: string | null;
  assignedTo: string | null;
  updatedAt: string | null;
  openUrl: string;
};

export type FmpMaintenanceDashboard = {
  source: typeof FMP_SOURCE;
  online: true;
  generatedAt: string;
  cacheTtlSeconds: number;
  summary: FmpDashboardSummary;
  needsAttention: FmpNeedsAttentionItem[];
  recentRequests: FmpRecentRequestItem[];
};

// Only the columns the payload needs — no costs, no notes, no auth data.
export const FMP_WORK_ORDER_SELECT = {
  id: true,
  work_order_number: true,
  status: true,
  priority: true,
  operator_complaint: true,
  description_of_work: true,
  maintenance_type: true,
  job_location: true,
  plate_number: true,
  starting_datetime: true,
  updated_at: true,
  assigned_supervisor_id: true,
  assets: { select: { asset_code: true, asset_name: true } },
  profiles: { select: { full_name: true } },
  work_order_assignments: {
    select: {
      assignment_type: true,
      external_name: true,
      external_company: true,
      profiles: { select: { full_name: true } },
    },
    orderBy: { assigned_at: "desc" },
    take: 3,
  },
  work_order_worker_assignments: {
    where: { status: "active" },
    select: { worker_profiles: { select: { name: true } } },
    orderBy: { assigned_at: "asc" },
    take: 3,
  },
} satisfies Prisma.work_ordersSelect;

export type FmpWorkOrderRow = Prisma.work_ordersGetPayload<{ select: typeof FMP_WORK_ORDER_SELECT }>;

// ── Pure mapping helpers ──────────────────────────────────────────────────────

export function buildOpenUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/maintenance/work-orders/${encodeURIComponent(id)}`;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

export function workOrderRef(row: Pick<FmpWorkOrderRow, "id" | "work_order_number">): string {
  return clean(row.work_order_number) ?? `JC-${row.id.slice(0, 8).toUpperCase()}`;
}

export function workOrderTitle(
  row: Pick<FmpWorkOrderRow, "operator_complaint" | "description_of_work" | "maintenance_type">
): string {
  const title = clean(row.operator_complaint) ?? clean(row.description_of_work) ?? clean(row.maintenance_type) ?? "Job Card";
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…` : title;
}

export function assetOrLocation(
  row: Pick<FmpWorkOrderRow, "assets" | "job_location" | "plate_number">
): string | null {
  if (row.assets) {
    const code = clean(row.assets.asset_code);
    const name = clean(row.assets.asset_name);
    if (code && name) return `${code} — ${name}`;
    if (code ?? name) return code ?? name;
  }
  return clean(row.job_location) ?? clean(row.plate_number);
}

function assigneeNames(row: Pick<FmpWorkOrderRow, "work_order_assignments" | "work_order_worker_assignments">): string[] {
  const names: string[] = [];
  for (const w of row.work_order_worker_assignments) {
    const name = clean(w.worker_profiles?.name);
    if (name) names.push(name);
  }
  for (const a of row.work_order_assignments) {
    const name = clean(a.profiles?.full_name) ?? clean(a.external_name) ?? clean(a.external_company);
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

export function assignedTo(
  row: Pick<FmpWorkOrderRow, "work_order_assignments" | "work_order_worker_assignments" | "profiles">
): string | null {
  const names = assigneeNames(row);
  if (names.length > 0) return names.slice(0, 3).join(", ");
  return clean(row.profiles?.full_name);
}

export function isUnassigned(
  row: Pick<FmpWorkOrderRow, "work_order_assignments" | "work_order_worker_assignments" | "assigned_supervisor_id">
): boolean {
  return (
    row.work_order_assignments.length === 0 &&
    row.work_order_worker_assignments.length === 0 &&
    !row.assigned_supervisor_id
  );
}

/** MMS overdue rule (lib/reports): in-flight and its start date/time has passed. */
export function isOverdue(row: Pick<FmpWorkOrderRow, "status" | "starting_datetime">, now: Date): boolean {
  return (
    !!row.starting_datetime &&
    row.starting_datetime.getTime() < now.getTime() &&
    OVERDUE_ELIGIBLE_STATUSES.includes(row.status)
  );
}

export function attentionReasons(row: FmpWorkOrderRow, now: Date): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (isOverdue(row, now)) reasons.push("Overdue");
  if (row.priority === "Urgent") reasons.push("Urgent priority");
  else if (row.priority === "High") reasons.push("High priority");
  if (row.status === CLOSURE_REQUESTED_STATUS) reasons.push("Closure request pending");
  if (WAITING_FOR_PARTS_STATUSES.includes(row.status)) reasons.push("Waiting for parts");
  if (UNASSIGNED_ELIGIBLE_STATUSES.includes(row.status) && isUnassigned(row)) reasons.push("Unassigned");
  return reasons;
}

function attentionScore(reasons: AttentionReason[]): number {
  return reasons.reduce((sum, r) => sum + REASON_WEIGHT[r], 0);
}

export function mapRecentRequest(row: FmpWorkOrderRow, baseUrl: string): FmpRecentRequestItem {
  return {
    id: row.id,
    ref: workOrderRef(row),
    title: workOrderTitle(row),
    assetOrLocation: assetOrLocation(row),
    status: row.status,
    statusLabel: displaySimplifiedStatus(row.status),
    priority: clean(row.priority),
    assignedTo: assignedTo(row),
    updatedAt: row.updated_at?.toISOString() ?? null,
    openUrl: buildOpenUrl(baseUrl, row.id),
  };
}

/** Ranks candidates by reason weight, then most recently updated; drops rows with no reason. */
export function mapNeedsAttention(
  rows: FmpWorkOrderRow[],
  now: Date,
  baseUrl: string,
  limit = FMP_NEEDS_ATTENTION_LIMIT
): FmpNeedsAttentionItem[] {
  return rows
    .map((row) => ({ row, reasons: attentionReasons(row, now) }))
    .filter((c) => c.reasons.length > 0)
    .sort(
      (a, b) =>
        attentionScore(b.reasons) - attentionScore(a.reasons) ||
        (b.row.updated_at?.getTime() ?? 0) - (a.row.updated_at?.getTime() ?? 0)
    )
    .slice(0, limit)
    .map(({ row, reasons }) => ({
      id: row.id,
      ref: workOrderRef(row),
      title: workOrderTitle(row),
      status: row.status,
      statusLabel: displaySimplifiedStatus(row.status),
      priority: clean(row.priority),
      reasons,
      updatedAt: row.updated_at?.toISOString() ?? null,
      openUrl: buildOpenUrl(baseUrl, row.id),
    }));
}

/** Start of the current month in server-local time — same boundary as the MMS Manager dashboard. */
export function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ── Live query ────────────────────────────────────────────────────────────────

export type BuildFmpDashboardOptions = {
  baseUrl: string;
  cacheTtlSeconds: number;
  /** Optional FMP user email for the "Assigned To Me" card; null → card is null. */
  userEmail: string | null;
  now?: Date;
};

async function countAssignedToEmail(db: FmpDashboardDb, email: string, openWhere: Prisma.work_ordersWhereInput) {
  const user = await db.auth_users.findFirst({
    where: { email: email.toLowerCase(), is_active: true, deleted_at: null },
    select: { profile_id: true },
  });
  // Unknown email → 0, not null, so the endpoint can't be used to probe which emails exist.
  if (!user) return 0;
  return db.work_orders.count({
    where: {
      AND: [
        openWhere,
        {
          OR: [
            { work_order_assignments: { some: { technician_id: user.profile_id } } },
            { assigned_supervisor_id: user.profile_id },
          ],
        },
      ],
    },
  });
}

export async function buildFmpMaintenanceDashboard(
  db: FmpDashboardDb,
  options: BuildFmpDashboardOptions
): Promise<FmpMaintenanceDashboard> {
  const now = options.now ?? new Date();
  const openWhere: Prisma.work_ordersWhereInput = { deleted_at: null, status: { notIn: NOT_OPEN_STATUSES } };
  const overdueWhere: Prisma.work_ordersWhereInput = {
    deleted_at: null,
    status: { in: OVERDUE_ELIGIBLE_STATUSES },
    starting_datetime: { lt: now },
  };

  const [
    openRequests,
    inProgress,
    waitingForParts,
    overdue,
    completedThisMonth,
    assignedToMe,
    attentionCandidates,
    recentRows,
  ] = await Promise.all([
    db.work_orders.count({ where: openWhere }),
    db.work_orders.count({ where: { deleted_at: null, status: "In Progress" } }),
    db.work_orders.count({ where: { deleted_at: null, status: { in: WAITING_FOR_PARTS_STATUSES } } }),
    db.work_orders.count({ where: overdueWhere }),
    db.work_orders.count({ where: { deleted_at: null, status: "Closed", updated_at: { gte: startOfMonth(now) } } }),
    options.userEmail ? countAssignedToEmail(db, options.userEmail, openWhere) : Promise.resolve(null),
    db.work_orders.findMany({
      where: {
        AND: [
          openWhere,
          {
            OR: [
              overdueWhere,
              { priority: { in: HIGH_PRIORITIES } },
              { status: CLOSURE_REQUESTED_STATUS },
              { status: { in: WAITING_FOR_PARTS_STATUSES } },
              {
                status: { in: UNASSIGNED_ELIGIBLE_STATUSES },
                assigned_supervisor_id: null,
                work_order_assignments: { none: {} },
                work_order_worker_assignments: { none: { status: "active" } },
              },
            ],
          },
        ],
      },
      select: FMP_WORK_ORDER_SELECT,
      orderBy: { updated_at: "desc" },
      take: FMP_NEEDS_ATTENTION_SAMPLE,
    }),
    db.work_orders.findMany({
      where: { deleted_at: null, status: { notIn: NON_DRAFT_EXCLUDED_STATUSES } },
      select: FMP_WORK_ORDER_SELECT,
      orderBy: { created_at: "desc" },
      take: FMP_RECENT_REQUESTS_LIMIT,
    }),
  ]);

  return {
    source: FMP_SOURCE,
    online: true,
    generatedAt: now.toISOString(),
    cacheTtlSeconds: options.cacheTtlSeconds,
    summary: { openRequests, inProgress, waitingForParts, overdue, assignedToMe, completedThisMonth },
    needsAttention: mapNeedsAttention(attentionCandidates, now, options.baseUrl),
    recentRequests: recentRows.map((row) => mapRecentRequest(row, options.baseUrl)),
  };
}
