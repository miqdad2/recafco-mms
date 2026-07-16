import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DollarSign,
  Eye,
  Package,
  Plus,
  Printer,
  ShieldAlert,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Prisma } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts } from "@/lib/reports/data";
import { displayStatus } from "@/lib/display/work-order-labels";
import { OPEN_PR_STATUSES, displayPartsRequestStatus } from "@/lib/display/parts-request-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";
import { QuickViewRow } from "@/components/work-orders/quick-view-row";
import { JobCardCreatedModal } from "@/components/work-orders/job-card-created-modal";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const TERMINAL_STATUSES = [
  "Closed", "Cancelled",
  "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester",
];

const OVERDUE_DAYS = 7;

type Tab = { label: string; status: string };

// One shared tab set for every role — Task 3 (JobCards-UX-SimplifyFilters-01).
// "My Job Cards" replaces the old "All"/"My Job Cards" split: the label is the
// same for everyone, but what it shows still depends on that role's own
// visibility scope (a Data Entry user's "My Job Cards" is only what they
// created; a Manager's is everything they're allowed to see) — Task 7.
const JOB_CARD_TABS: Tab[] = [
  { label: "My Job Cards",      status: "" },
  { label: "Awaiting Review",   status: "Awaiting Review" },
  { label: "In Progress",       status: "In Progress" },
  { label: "Waiting Materials", status: "Waiting for Parts" },
  { label: "Closed",            status: "Closed" },
];

// Single, role-independent mapping from tab status keys → the DB status
// strings each bucket covers — Task 7's employee-friendly grouping:
//   Awaiting Review   — not yet reviewed by a manager (includes Draft, since
//                        a draft is also "not yet moving" from the employee's
//                        point of view and has nowhere else sensible to go)
//   In Progress       — approved through post-completion, pending closure
//                        ("Ready to Close" is intentionally folded in here,
//                        not shown as its own tab, per Task 7)
//   Waiting Materials — blocked on parts/purchase
//   Closed            — fully resolved (Cancelled and Rejected/"Returned for
//                        Fix" fold in here too — Task 7 says Returned for Fix
//                        should not be its own tab; it still shows as its own
//                        status badge in the table)
// Any status not listed here (there are none left unmapped) falls back to a
// single-value filter, so old bookmarked/dashboard links (?status=Draft,
// ?status=Rejected, etc.) keep working unchanged.
// Task 9 — wording for a status tab that has zero matching Job Cards, used
// only when no other filter (search/date/etc.) is also in play.
const TAB_EMPTY_STATE: Record<string, { title: string; message: string }> = {
  "Awaiting Review": {
    title: "No Job Cards awaiting review.",
    message: "New submitted Job Cards will appear here.",
  },
  "In Progress": {
    title: "No Job Cards in progress.",
    message: "Job Cards being worked on will appear here.",
  },
  "Waiting for Parts": {
    title: "No Job Cards waiting for materials.",
    message: "Job Cards blocked by materials will appear here.",
  },
  Closed: {
    title: "No closed Job Cards yet.",
    message: "Closed Job Cards will appear here.",
  },
};

function getStatusMap(): Record<string, string[]> {
  return {
    "Awaiting Review":   ["Draft", "Submitted", "Pending Approval"],
    "In Progress":       ["Approved", "Assigned", "In Progress", "Parts Issued",
                           "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester",
                           "Reopened"],
    "Waiting for Parts": ["Waiting for Parts", "Waiting for Purchase"],
    "Closed":            ["Closed", "Cancelled", "Rejected"],
  };
}

function expandStatuses(tabStatus: string, combined: Record<string, string[]>): string[] {
  return combined[tabStatus] ?? [tabStatus];
}

function tabCount(summaries: StatusSummary[], tabStatus: string, combined: Record<string, string[]>): number {
  return countFor(summaries, expandStatuses(tabStatus, combined));
}

function tabIsActive(currentStatus: string, tabStatus: string, combined: Record<string, string[]>): boolean {
  return currentStatus === tabStatus || expandStatuses(tabStatus, combined).includes(currentStatus);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SP = {
  page?: string;
  search?: string;
  status?: string;
  dept?: string;
  worker_type?: string;
  date_from?: string;
  date_to?: string;
  needs_action?: string;
  ceo_tab?: string;
  cost_min?: string;
  preview?: string;
  success?: string;
  warning?: string;
  jc?: string;
  scope?: string;
  created?: string;
};

type PageProps = {
  searchParams?: Promise<SP>;
};

type StatusSummary = { status: string; _count: { _all: number } };

// ── URL helpers ───────────────────────────────────────────────────────────────

function buildHref(params: Partial<SP>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
  const q = p.toString();
  return q ? `/maintenance/work-orders?${q}` : "/maintenance/work-orders";
}

function tabHref(sp: SP, status: string): string {
  const merged: SP = { ...sp, status, page: "" };
  return buildHref(merged);
}

function pageHref(sp: SP, page: number): string {
  return buildHref({ ...sp, page: String(page) });
}

// ── Role-based needs-action filter ────────────────────────────────────────────

function getNeedsActionFilter(context: CurrentUserContext) {
  const p = context.permissions;
  const isAdmin = context.role?.slug === "super_admin";

  if (isAdmin || p.includes("work_orders.approve")) {
    return { status: { in: ["Submitted", "Pending Approval", "Verified by Supervisor", "Confirmed by Requester"] } };
  }
  if (p.includes("work_orders.assign")) {
    return { status: { in: ["Approved", "Completed by Technician"] } };
  }
  if (p.includes("store.issue")) {
    return { status: "Waiting for Parts" as const };
  }
  if (p.includes("purchase_requests.manage")) {
    return { status: "Waiting for Purchase" as const };
  }
  if (p.includes("work_orders.manage")) {
    return { status: { in: ["Draft", "Rejected"] }, created_by: context.userId };
  }
  return { status: { in: [] as string[] } };
}

// ── Per-row specific action button label ─────────────────────────────────────

function getRowActLabel(status: string, context: CurrentUserContext): string | null {
  const p = context.permissions;
  const isAdmin = context.role?.slug === "super_admin";
  const canApprove = isAdmin || p.includes("work_orders.approve");
  const canAssign = isAdmin || p.includes("work_orders.assign");
  if (canApprove && ["Submitted", "Pending Approval"].includes(status)) return "Assign";
  if (canAssign && status === "Approved") return "Assign";
  if (p.includes("store.issue") && ["Waiting for Parts", "Waiting for Purchase"].includes(status)) return "Parts";
  if ((canApprove || canAssign) &&
    ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "Close";
  return null;
}

// ── Next action label ─────────────────────────────────────────────────────────

function getNextAction(status: string, context: CurrentUserContext): { label: string; mine: boolean } {
  const p = context.permissions;
  const isAdmin = context.role?.slug === "super_admin";
  const canApprove = isAdmin || p.includes("work_orders.approve");
  const canAssign = isAdmin || p.includes("work_orders.assign");

  switch (status) {
    case "Draft":                    return { label: "Submit job card",      mine: p.includes("work_orders.manage") };
    case "Submitted":
    case "Pending Approval":         return { label: "Assign technician",   mine: canApprove };
    case "Approved":                 return { label: "Assign technician",   mine: canAssign };
    case "Assigned":                 return { label: "Technician to start", mine: false };
    case "In Progress":
    case "Parts Issued":             return { label: "Work in progress",         mine: false };
    case "Waiting for Parts":
    case "Waiting for Purchase":     return { label: "Waiting for materials",    mine: false };
    case "Completed by Technician":
    case "Verified by Supervisor":
    case "Confirmed by Requester":   return { label: "Awaiting manager closure", mine: canApprove || canAssign };
    case "Closed":                   return { label: "Job card closed",          mine: false };
    case "Rejected":                 return { label: "Rejected",            mine: false };
    case "Cancelled":                return { label: "Cancelled",           mine: false };
    default:                         return { label: status,                mine: false };
  }
}

// ── Tone helpers ──────────────────────────────────────────────────────────────

function statusTone(s: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["Closed", "Verified by Supervisor", "Confirmed by Requester"].includes(s)) return "green";
  if (["Completed by Technician"].includes(s)) return "green";
  if (s.includes("Waiting") || ["Submitted", "Pending Approval"].includes(s)) return "amber";
  if (["Rejected", "Cancelled"].includes(s)) return "red";
  if (["Assigned", "In Progress", "Parts Issued", "Approved"].includes(s)) return "blue";
  return "gray";
}

function formatDate(v: Date | string | null | undefined): string {
  if (!v) return "-";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ageInDays(createdAt: Date): number {
  return Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
}

function countFor(summaries: StatusSummary[], statuses: string[]): number {
  return summaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
}

// ── Dev-only debug panel — Task 8 (JobCard-Creation-Visibility-HardFix-01) ────
// Shown only when NODE_ENV !== "production" and the list rendered empty, to
// help diagnose "created but not visible" reports without a debugger attached.
function DebugPanel({
  userId,
  roleSlug,
  scope,
  totalInDb,
  createdByUser,
  resultCount,
}: {
  userId: string;
  roleSlug: string;
  scope: string;
  totalInDb: number | null;
  createdByUser: number | null;
  resultCount: number;
}) {
  return (
    <div className="mx-auto mt-8 max-w-md rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-900">
      <p className="mb-1.5 font-black uppercase tracking-wide">Debug (dev only)</p>
      <dl className="space-y-0.5 font-mono">
        <div className="flex justify-between gap-3"><dt>userId</dt><dd className="truncate">{userId}</dd></div>
        <div className="flex justify-between gap-3"><dt>role</dt><dd>{roleSlug || "(none)"}</dd></div>
        <div className="flex justify-between gap-3"><dt>scope</dt><dd>{scope}</dd></div>
        <div className="flex justify-between gap-3"><dt>total in DB</dt><dd>{totalInDb ?? "—"}</dd></div>
        <div className="flex justify-between gap-3"><dt>created by user</dt><dd>{createdByUser ?? "—"}</dd></div>
        <div className="flex justify-between gap-3"><dt>query result count</dt><dd>{resultCount}</dd></div>
      </dl>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default async function WorkOrdersPage({ searchParams }: PageProps) {
  const context = await requirePermission("work_orders.view");
  const sp = (await searchParams) ?? {};

  const page       = Math.max(1, Number(sp.page ?? 1) || 1);
  const search     = (sp.search ?? "").replace(/[%,()]/g, " ").trim().slice(0, 80);
  const status     = (sp.status ?? "").trim();
  const deptId     = /^[0-9a-f-]{36}$/i.test(sp.dept ?? "") ? sp.dept! : "";
  const workerType = (sp.worker_type ?? "").trim();
  const dateFrom   = (sp.date_from ?? "").trim();
  const dateTo     = (sp.date_to ?? "").trim();
  const needsAction = sp.needs_action === "1";
  const ceoTab  = (sp.ceo_tab  ?? "").trim();
  const costMin = (sp.cost_min ?? "").trim();

  // ── CEO / Management: executive-focused early return ──────────────────────
  if (context.role?.slug === "ceo_management") {
    const canSeeCosts = canViewCosts(context);
    const visibilityFilter = getWorkOrderVisibilityFilter(context);
    const ceoBase: Prisma.work_ordersWhereInput[] = [{ deleted_at: null }, visibilityFilter];

    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - OVERDUE_DAYS);

    // Tab-specific conditions stacked on top of visibility + user filters
    const tabConditions: Prisma.work_ordersWhereInput[] = [...ceoBase];
    if (ceoTab === "decisions") {
      tabConditions.push({ purchase_requests: { some: { status: "Pending CEO Approval" } } });
    } else if (ceoTab === "high_risk") {
      tabConditions.push({ priority: { in: ["High", "Urgent"] }, status: { notIn: TERMINAL_STATUSES } });
    } else if (ceoTab === "blocked") {
      tabConditions.push({ status: { in: ["Waiting for Parts", "Waiting for Purchase"] } });
    } else if (ceoTab === "overdue") {
      tabConditions.push({ created_at: { lt: overdueThreshold }, status: { notIn: TERMINAL_STATUSES } });
    } else if (ceoTab === "high_cost" && canSeeCosts) {
      tabConditions.push({ total_work_order_cost: { gte: 500 } });
    }
    // User-applied filters
    if (search) tabConditions.push({ OR: [
      { work_order_number: { contains: search, mode: "insensitive" } },
      { ordered_by:         { contains: search, mode: "insensitive" } },
      { operator_complaint: { contains: search, mode: "insensitive" } },
      { assets: { asset_name: { contains: search, mode: "insensitive" } } },
    ] });
    if (deptId)   tabConditions.push({ requested_by_department_id: deptId });
    if (dateFrom || dateTo) tabConditions.push({
      created_at: {
        ...(dateFrom ? { gte: new Date(dateFrom) }                    : {}),
        ...(dateTo   ? { lte: new Date(dateTo + "T23:59:59.999Z") }   : {}),
      },
    });
    if (canSeeCosts && costMin) {
      const costMinNum = parseFloat(costMin);
      if (!Number.isNaN(costMinNum)) tabConditions.push({ total_work_order_cost: { gte: costMinNum } });
    }

    const ceoWhere: Prisma.work_ordersWhereInput = { AND: tabConditions };

    const [
      ceoWorkOrders, ceoCount,
      decisionsCount, highRiskCount, blockedCount, overdueCount, ceoFinanceCount,
      ceoDepts,
    ] = await Promise.all([
      prisma.work_orders.findMany({
        where: ceoWhere,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          work_order_number: true,
          date_of_order: true,
          created_at: true,
          ordered_by: true,
          maintenance_type: true,
          priority: true,
          status: true,
          job_location: true,
          total_work_order_cost: true,
          assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
          departments: { select: { name: true } },
          purchase_requests: { select: { id: true, status: true, estimated_total: true } },
        },
      }),
      prisma.work_orders.count({ where: ceoWhere }),
      prisma.work_orders.count({ where: { AND: [...ceoBase, { purchase_requests: { some: { status: "Pending CEO Approval" } } }] } }),
      prisma.work_orders.count({ where: { AND: [...ceoBase, { priority: { in: ["High", "Urgent"] }, status: { notIn: TERMINAL_STATUSES } }] } }),
      prisma.work_orders.count({ where: { AND: [...ceoBase, { status: { in: ["Waiting for Parts", "Waiting for Purchase"] } }] } }),
      prisma.work_orders.count({ where: { AND: [...ceoBase, { created_at: { lt: overdueThreshold }, status: { notIn: TERMINAL_STATUSES } }] } }),
      prisma.work_orders.count({ where: { AND: [...ceoBase, { purchase_requests: { some: { status: { in: ["Pending Finance Approval", "Pending CEO Approval"] } } } }] } }),
      prisma.departments.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const ceoTotalPages  = Math.max(1, Math.ceil(ceoCount / PAGE_SIZE));
    const ceoHasFilters  = !!(search || deptId || dateFrom || dateTo || costMin || ceoTab);

    return (
      <>
        <PageHeader
          title="Executive Work Orders"
          description="High-risk work orders, blocked operations, and items needing executive attention."
        />
        <div className="space-y-4 p-4 lg:p-6">

          {/* Executive KPI cards */}
          <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard title="Needs CEO Decision"        value={decisionsCount}  href="?ceo_tab=decisions" tone={decisionsCount  > 0 ? "red"   : "gray"} icon={ShieldAlert}   detail="CEO approval required"             urgent={decisionsCount > 0} />
            <KpiCard title="High Risk Work"            value={highRiskCount}   href="?ceo_tab=high_risk" tone={highRiskCount   > 0 ? "amber" : "gray"} icon={Zap}           detail="High/urgent open work orders"      urgent={highRiskCount > 0} />
            <KpiCard title="Blocked Operations"        value={blockedCount}    href="?ceo_tab=blocked"   tone={blockedCount    > 0 ? "amber" : "gray"} icon={Package}       detail="Waiting for materials or purchase" />
            <KpiCard title="Overdue Critical"          value={overdueCount}    href="?ceo_tab=overdue"   tone={overdueCount    > 0 ? "red"   : "gray"} icon={AlertTriangle} detail={`Open ${OVERDUE_DAYS}+ days`}      urgent={overdueCount > 0} />
            <KpiCard title="Cost Exposure"             value={0}               href={canSeeCosts ? "?ceo_tab=high_cost" : "/reports/work-orders?report=cost-exposure"} tone="blue"  icon={canSeeCosts ? DollarSign : Eye} detail={canSeeCosts ? "High-cost active work orders" : "View cost report"} />
            <KpiCard title="Waiting Finance/Purchase"  value={ceoFinanceCount} href="?ceo_tab=decisions" tone={ceoFinanceCount > 0 ? "amber" : "gray"} icon={TrendingUp}    detail="Finance or CEO approval pending" />
          </section>

          {/* Executive quick filters */}
          <section className="rounded-md border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
            <p className="mb-2.5 text-xs font-black uppercase text-[#4B5563]">
              Executive Filters — CEO / Management
            </p>
            <div className="flex flex-wrap gap-2">
              {([
                { label: "CEO Decisions", tab: "decisions" },
                { label: "High Risk",     tab: "high_risk" },
                { label: "Blocked",       tab: "blocked"   },
                { label: "Overdue",       tab: "overdue"   },
                ...(canSeeCosts ? [{ label: "High Cost", tab: "high_cost" }] : []),
              ] as { label: string; tab: string }[]).map((f) => (
                <Link
                  key={f.tab}
                  href={`/maintenance/work-orders?ceo_tab=${f.tab}`}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                    ceoTab === f.tab
                      ? "bg-[#ED1C24] text-white"
                      : "border border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:bg-red-50 hover:text-[#ED1C24]"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
              {ceoTab && (
                <Link href="/maintenance/work-orders" className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#4B5563] hover:bg-gray-50">
                  Clear tab
                </Link>
              )}
            </div>
          </section>

          {/* CEO filter form */}
          <CeoFilterSection sp={sp} departments={ceoDepts} canSeeCosts={canSeeCosts} />

          {/* CEO tabs */}
          <CeoTabBar ceoTab={ceoTab} sp={sp} decisionsCount={decisionsCount} highRiskCount={highRiskCount} blockedCount={blockedCount} overdueCount={overdueCount} totalCount={ceoCount} />

          {/* Executive work orders table */}
          <section className="overflow-hidden rounded-b-md border border-t-0 border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase text-[#4B5563]">Executive work order items</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                  {ceoCount.toLocaleString()} {ceoHasFilters ? "matching" : "executive"} items
                  {ceoHasFilters && (
                    <Link href="/maintenance/work-orders" className="ml-2 text-xs font-bold text-[#ED1C24] underline">Clear filters</Link>
                  )}
                </p>
              </div>
              {decisionsCount > 0 && !ceoTab && (
                <StatusBadge label={`${decisionsCount} need CEO decision`} tone="red" />
              )}
            </div>
            {ceoWorkOrders.length > 0 ? (
              <CeoWorkOrderTable workOrders={ceoWorkOrders} canSeeCosts={canSeeCosts} overdueThreshold={overdueThreshold} />
            ) : (
              <div className="px-4 py-10">
                <EmptyState
                  title="No executive work order items need attention right now."
                  message={ceoHasFilters ? "Try adjusting or clearing the filters." : "All executive-relevant work orders are up to date."}
                  action={
                    ceoHasFilters
                      ? <Link href="/maintenance/work-orders"><Button variant="secondary">Clear filters</Button></Link>
                      : undefined
                  }
                />
              </div>
            )}
          </section>

          {/* Pagination */}
          <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
            <span>Page {page} of {ceoTotalPages} &nbsp;·&nbsp; {ceoCount.toLocaleString()} items</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={buildHref({ ...sp, page: String(page - 1) })} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50">Previous</Link>
              )}
              {page < ceoTotalPages && (
                <Link href={buildHref({ ...sp, page: String(page + 1) })} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50">Next</Link>
              )}
            </div>
          </div>

        </div>
      </>
    );
  }
  // ── End CEO early-return ──────────────────────────────────────────────────

  const dateFilter =
    dateFrom || dateTo
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) }               : {}),
          ...(dateTo   ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}),
        }
      : undefined;

  // ── Visibility filter: scope every query to what this role may see ────────
  // getWorkOrderVisibilityFilter() itself now guarantees "OR I created it" for
  // every role (JobCard-Creation-Visibility-HardFix-01 Task 3) — no per-page
  // widening needed any more. scope=created (set on the post-create redirect,
  // see upsertWorkOrderAction) is kept only as a marker for the debug log and
  // for a "My Job Cards" default, not as a visibility mechanism.
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const scopeCreated = sp.scope === "created";

  // Combines deleted_at guard + role visibility — used for KPI/summary queries
  const visibilityOnlyWhere: Prisma.work_ordersWhereInput = {
    AND: [{ deleted_at: null }, visibilityFilter],
  };

  const roleSlug = context.role?.slug ?? "";
  const isNormalUser = ["maintenance_data_entry", "department_requester"].includes(roleSlug);
  const statusMap = getStatusMap();

  // Full WHERE for the list: visibility + user-applied filters stacked as AND
  // to prevent key conflicts when the visibility filter itself uses `status`.
  const listConditions: Prisma.work_ordersWhereInput[] = [
    { deleted_at: null },
    visibilityFilter,
  ];
  if (status === "Waiting for Parts") {
    // Show job cards that have at least one open materials request (not just those with WO status "Waiting for Parts")
    listConditions.push({ parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } });
  } else if (status) {
    const statusList = expandStatuses(status, statusMap);
    listConditions.push(statusList.length === 1 ? { status } : { status: { in: statusList } });
  }
  if (deptId)     listConditions.push({ requested_by_department_id: deptId });
  if (workerType) listConditions.push({ worker_type: workerType });
  if (dateFilter) listConditions.push({ date_of_order: dateFilter });
  if (search)     listConditions.push({
    OR: [
      { work_order_number: { contains: search, mode: "insensitive" } },
      { ordered_by:         { contains: search, mode: "insensitive" } },
      { job_location:       { contains: search, mode: "insensitive" } },
      { operator_complaint: { contains: search, mode: "insensitive" } },
      { assets: { asset_code:   { contains: search, mode: "insensitive" } } },
      { assets: { asset_name:   { contains: search, mode: "insensitive" } } },
      { assets: { plate_number: { contains: search, mode: "insensitive" } } },
    ],
  });
  if (needsAction) listConditions.push(getNeedsActionFilter(context));
  const where: Prisma.work_ordersWhereInput = { AND: listConditions };

  const [workOrders, count, statusSummaries, waitingMaterialsCount] =
    await Promise.all([
      prisma.work_orders.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          work_order_number: true,
          date_of_order: true,
          created_at: true,
          ordered_by: true,
          maintenance_type: true,
          worker_type: true,
          status: true,
          job_location: true,
          created_by: true,
          operator_complaint: true,
          assets: { select: { id: true, asset_code: true, asset_name: true, plate_number: true } },
          work_order_assignments: {
            select: {
              assignment_type: true,
              external_name: true,
              external_company: true,
              profiles: { select: { full_name: true } },
            },
          },
        },
      }),
      prisma.work_orders.count({ where }),
      prisma.work_orders.groupBy({
        by: ["status"],
        where: visibilityOnlyWhere,
        _count: { _all: true },
      }),
      // Count job cards with at least one open materials request (independent of WO status field)
      prisma.work_orders.count({
        where: {
          AND: [
            { deleted_at: null },
            visibilityFilter,
            { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } },
          ],
        },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  // ── Quick-view preview data ───────────────────────────────────────────────
  // `created` (set on the post-create redirect) is a fallback source for the
  // id in case `preview` is ever missing — Task 6/7 (JobCard-Creation-
  // Visibility-HardFix-01): the success modal must never depend on a single
  // query param surviving the round trip.
  const rawPreviewParam = sp.preview || sp.created;
  const previewId =
    rawPreviewParam && /^[0-9a-f-]{36}$/i.test(rawPreviewParam) ? rawPreviewParam : null;

  const canAssignModal =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("work_orders.assign") ||
    context.permissions.includes("work_orders.approve");

  const [previewWO, prData, techsForModal] = previewId
    ? await Promise.all([
        prisma.work_orders.findFirst({
          where: {
            AND: [{ id: previewId }, { deleted_at: null }, visibilityFilter],
          },
          select: {
            id: true,
            work_order_number: true,
            status: true,
            maintenance_type: true,
            worker_type: true,
            operator_complaint: true,
            description_of_work: true,
            ordered_by: true,
            date_of_order: true,
            created_at: true,
            job_location: true,
            assets: {
              select: {
                id: true,
                asset_code: true,
                asset_name: true,
                location: true,
                condition: true,
                criticality: true,
              },
            },
            departments: { select: { name: true } },
            work_order_assignments: {
              select: {
                assignment_type: true,
                external_name: true,
                external_company: true,
                external_contact_person: true,
                external_phone: true,
                external_trade: true,
                profiles: { select: { full_name: true } },
              },
            },
            _count: { select: { work_order_required_parts: true, work_order_attachments: true } },
          },
        }),
        prisma.parts_requests.findMany({
          where: { work_order_id: previewId },
          select: { status: true },
          orderBy: { created_at: "desc" },
          take: 20,
        }),
        canAssignModal
          ? prisma.profiles.findMany({
              where: { is_active: true, deleted_at: null },
              select: { id: true, full_name: true },
              orderBy: { full_name: "asc" },
            })
          : Promise.resolve([] as Array<{ id: string; full_name: string }>),
      ])
    : [null, [] as Array<{ status: string }>, [] as Array<{ id: string; full_name: string }>];

  const isAdmin = context.role?.slug === "super_admin";
  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displayStatus(previewWO.status),
        maintenance_type: previewWO.maintenance_type,
        worker_type: previewWO.worker_type,
        operator_complaint: previewWO.operator_complaint,
        description_of_work: previewWO.description_of_work,
        ordered_by: previewWO.ordered_by,
        date_of_order: previewWO.date_of_order?.toISOString() ?? null,
        created_at: previewWO.created_at.toISOString(),
        job_location: previewWO.job_location,
        assets: previewWO.assets
          ? {
              id: previewWO.assets.id,
              asset_code: previewWO.assets.asset_code,
              asset_name: previewWO.assets.asset_name,
              location: previewWO.assets.location,
              condition: previewWO.assets.condition,
              criticality: previewWO.assets.criticality,
            }
          : null,
        department_name: previewWO.departments?.name ?? null,
        technician_names: previewWO.work_order_assignments
          .filter((a) => a.assignment_type === "INTERNAL_TECHNICIAN" && a.profiles?.full_name)
          .map((a) => a.profiles!.full_name),
        technicians: techsForModal,
        primary_assignment: previewWO.work_order_assignments[0]
          ? {
              assignment_type: previewWO.work_order_assignments[0].assignment_type,
              external_name: previewWO.work_order_assignments[0].external_name ?? null,
              external_company: previewWO.work_order_assignments[0].external_company ?? null,
              external_contact_person: previewWO.work_order_assignments[0].external_contact_person ?? null,
              external_phone: previewWO.work_order_assignments[0].external_phone ?? null,
              external_trade: previewWO.work_order_assignments[0].external_trade ?? null,
            }
          : null,
        required_parts_count: previewWO._count.work_order_required_parts,
        parts_requests_count: prData.length,
        open_parts_requests_count: prData.filter((pr) =>
          OPEN_PR_STATUSES.includes(pr.status)
        ).length,
        last_parts_request_status: prData[0]
          ? displayPartsRequestStatus(prData[0].status)
          : null,
        attachment_count: previewWO._count.work_order_attachments,
        roleSlug: context.role?.slug ?? "",
        canApprove:
          isAdmin || context.permissions.includes("work_orders.approve"),
        canAssign:
          isAdmin || context.permissions.includes("work_orders.assign"),
        canManage:
          isAdmin || context.permissions.includes("work_orders.manage"),
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        closeHref: buildHref({ ...sp, preview: undefined }),
      }
    : null;

  // ── Job Card creation success modal ───────────────────────────────────────
  // A newly created Job Card redirects here with ?success=job-card-created — the
  // modal must render purely off that param, independent of whether the preview
  // fetch (drawerData) actually found the record, so a visibility/timing edge
  // case never hides the confirmation (Job Cards-CreateSuccess-UX-02 Task 2).
  const showCreatedModal = sp.success === "job-card-created";
  const createdDismissHref = buildHref({
    ...sp,
    preview: undefined,
    success: undefined,
    warning: undefined,
    jc: undefined,
    scope: undefined,
    created: undefined,
  });

  const totalWOs       = statusSummaries.reduce((n, s) => n + s._count._all, 0);
  const submittedCount = tabCount(statusSummaries, "Awaiting Review", statusMap);
  const activeJobs     = tabCount(statusSummaries, "In Progress",     statusMap);
  // Waiting Materials KPI counts job cards with open materials requests, not just WO status field
  const waitingParts   = waitingMaterialsCount;
  const closed         = countFor(statusSummaries, ["Closed"]);

  const hasFilters = search || status || deptId || workerType || dateFrom || dateTo || needsAction;
  // Non-tab filters — used to decide whether a zero-result table gets the
  // tab-specific empty state (Task 9) or the generic "adjust your filters" one.
  const hasNonTabFilters = Boolean(search || deptId || workerType || dateFrom || dateTo || needsAction);

  const activeTabs: Tab[] = JOB_CARD_TABS;
  // The specific status tab currently selected, if any — used to word the
  // list header simply, e.g. "9 awaiting review job cards" (Task 8). Stays
  // null for "My Job Cards" (status === "") and for raw/unmapped status
  // values reached via an old bookmark or dashboard link.
  const activeTab = status ? JOB_CARD_TABS.find((t) => t.status === status) ?? null : null;

  // ── Debug log — visibility scope, search params, and record counts ──────
  // Task 8 (JobCard-CreateSuccess-UX-02): kept lightweight and dev-only so it
  // never becomes noisy in production, but always covers the fields needed to
  // diagnose a "created but not visible" report — role/department, the exact
  // where-clause scope, searchParams, result counts, and the preview fetch.
  if (process.env.NODE_ENV === "development") {
    console.log("[WO-VISIBILITY]", {
      userId: context.userId,
      roleSlug,
      departmentId: context.department?.id ?? "(none)",
      searchParams: sp,
      scopeCreated,
      scope: Object.keys(visibilityFilter).length === 0 ? "ALL" : JSON.stringify(visibilityFilter),
      totalVisible: totalWOs,
      statusSummaries: statusSummaries.map((s) => `${s.status}:${s._count._all}`).join(", "),
      previewId,
      previewFound: !!drawerData,
    });
  }

  // ── Onboarding empty state — no job cards in scope ───────────────────────
  if (totalWOs === 0) {
    const isManagerRole = roleSlug === "maintenance_manager";

    // Dev-only debug counts for the panel below — Task 8. Only queried when
    // actually needed (empty state, non-production) so this never adds cost
    // to the normal path.
    let debugTotalInDb: number | null = null;
    let debugCreatedByUser: number | null = null;
    if (process.env.NODE_ENV !== "production") {
      [debugTotalInDb, debugCreatedByUser] = await Promise.all([
        prisma.work_orders.count({ where: { deleted_at: null } }),
        prisma.work_orders.count({ where: { deleted_at: null, created_by: context.userId } }),
      ]);
    }

    // Three distinct personas — Task 9 (JobCard-Creation-Visibility-HardFix-01).
    // Never shows the old "awaiting your team" framing right after a create
    // redirect; the success modal (rendered below, independent of this branch)
    // is the actual confirmation the user needs at that moment.
    let emptyTitle: string;
    let emptyMessage: string;
    if (isNormalUser) {
      emptyTitle = "No Job Cards created yet.";
      emptyMessage = "Your submitted Job Cards will appear here.";
    } else if (isManagerRole) {
      emptyTitle = "No Job Cards awaiting review.";
      emptyMessage = "New submitted Job Cards will appear here.";
    } else {
      emptyTitle = "No Job Cards found.";
      emptyMessage = "Create a Job Card to start tracking maintenance work.";
    }
    const showCreateButtons = !isManagerRole;

    return (
      <>
        {showCreatedModal && (
          <JobCardCreatedModal
            jobCardId={previewId}
            jobCardNumber={drawerData?.work_order_number ?? sp.jc ?? null}
            isDraft={drawerData?.status === "Draft"}
            assetName={drawerData?.assets?.asset_name ?? null}
            issue={drawerData?.operator_complaint ?? null}
            attachmentWarning={sp.warning === "attachments-failed"}
            dismissHref={createdDismissHref}
          />
        )}
        <PageHeader
          title="Job Cards"
          description="Track job cards, technician work, waiting materials, and repair history."
          actions={
            <Link
              href="/maintenance/work-orders/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Job Card
            </Link>
          }
        />
        <div className="p-4 lg:p-6">
          <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F5F6F8]">
              <ClipboardList className="h-8 w-8 text-[#9CA3AF]" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#111827]">{emptyTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{emptyMessage}</p>
            </div>
            {showCreateButtons && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/maintenance/work-orders/new"
                  className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create Job Card
                </Link>
                <Link
                  href="/assets"
                  className="inline-flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
                >
                  View Assets
                </Link>
              </div>
            )}
          </div>
          {process.env.NODE_ENV !== "production" && (
            <DebugPanel
              userId={context.userId}
              roleSlug={roleSlug}
              scope={scopeCreated ? "created" : "normal"}
              totalInDb={debugTotalInDb}
              createdByUser={debugCreatedByUser}
              resultCount={totalWOs}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <AutoRefresh intervalMs={30000} />
      {showCreatedModal ? (
        <JobCardCreatedModal
          jobCardId={previewId}
          jobCardNumber={drawerData?.work_order_number ?? sp.jc ?? null}
          isDraft={drawerData?.status === "Draft"}
          assetName={drawerData?.assets?.asset_name ?? null}
          issue={drawerData?.operator_complaint ?? null}
          attachmentWarning={sp.warning === "attachments-failed"}
          dismissHref={createdDismissHref}
        />
      ) : (
        drawerData && <RepairOrderQuickView data={drawerData} />
      )}
      <PageHeader
        title="Job Cards"
        description="Track job cards, technician work, waiting materials, and repair history."
        actions={
          <Link
            href="/maintenance/work-orders/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Job Card
          </Link>
        }
      />

      <div className="space-y-3 p-4 lg:p-6">
        {/* ── Operational KPI cards ─────────────────────────────────────────── */}
        {isNormalUser ? (
          <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <KpiCard
              title="Total Job Cards"
              value={totalWOs}
              href="/maintenance/work-orders"
              tone="blue"
              icon={ClipboardList}
              detail="All my job cards"
            />
            <KpiCard
              title="Awaiting Review"
              value={submittedCount}
              href={buildHref({ status: "Awaiting Review" })}
              tone={submittedCount > 0 ? "amber" : "gray"}
              icon={Clock3}
              detail="Submitted and waiting for manager review"
              urgent={submittedCount > 0}
            />
            <KpiCard
              title="In Progress"
              value={activeJobs}
              href={buildHref({ status: "In Progress" })}
              tone="blue"
              icon={Wrench}
              detail="Assigned · in progress"
            />
            <KpiCard
              title="Waiting Materials"
              value={waitingParts}
              href={buildHref({ status: "Waiting for Parts" })}
              tone={waitingParts > 0 ? "amber" : "gray"}
              icon={Package}
              detail="Materials needed or store issue pending"
            />
          </section>
        ) : (
          <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              title="Total Job Cards"
              value={totalWOs}
              href="/maintenance/work-orders"
              tone="blue"
              icon={ClipboardList}
              detail="All maintenance job cards"
            />
            <KpiCard
              title="Awaiting Review"
              value={submittedCount}
              href={buildHref({ status: "Awaiting Review" })}
              tone={submittedCount > 0 ? "amber" : "gray"}
              icon={Clock3}
              detail="Submitted and pending manager review"
              urgent={submittedCount > 0}
            />
            <KpiCard
              title="In Progress"
              value={activeJobs}
              href={buildHref({ status: "In Progress" })}
              tone="blue"
              icon={Wrench}
              detail="Approved · assigned · in progress · ready to close"
            />
            <KpiCard
              title="Waiting Materials"
              value={waitingParts}
              href={buildHref({ status: "Waiting for Parts" })}
              tone={waitingParts > 0 ? "amber" : "gray"}
              icon={Package}
              detail="Materials needed or store issue pending"
            />
            <KpiCard
              title="Closed"
              value={closed}
              href={buildHref({ status: "Closed" })}
              tone="green"
              icon={CheckCircle2}
              detail="Closed job cards"
            />
          </section>
        )}

        {/* ── Filters ───────────────────────────────────────────────────────── */}
        <FilterSection sp={sp} />

        {/* ── Status tabs ──────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded-t-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex min-w-max">
            {activeTabs.map((tab) => {
              const isActive = tab.status === "" ? !status : tabIsActive(status, tab.status, statusMap);
              const itemCount =
                tab.status === "Waiting for Parts"
                  ? waitingMaterialsCount
                  : tab.status
                    ? tabCount(statusSummaries, tab.status, statusMap)
                    : totalWOs;
              return (
                <Link
                  key={tab.status || "all"}
                  href={tabHref(sp, tab.status)}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-bold transition ${
                    isActive
                      ? "border-[#ED1C24] bg-red-50/60 text-[#ED1C24]"
                      : "border-transparent text-[#111827] hover:bg-gray-50"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      isActive ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"
                    }`}
                  >
                    {itemCount}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Work orders table ─────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-b-md border border-t-0 border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Job Card Records</p>
              <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                {count.toLocaleString()} {activeTab ? `${activeTab.label.toLowerCase()} ` : hasFilters ? "matching " : "total "}job cards
                {hasFilters && (
                  <Link href="/maintenance/work-orders" className="ml-2 text-xs font-bold text-[#ED1C24] underline">
                    Clear filters
                  </Link>
                )}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Job Card</th>
                  <th className="px-4 py-3">Asset / Machine</th>
                  <th className="px-4 py-3">Issue / Problem</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Technician / Assignment</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {workOrders.length > 0 ? (
                  workOrders.map((wo) => {
                    const actLabel   = getRowActLabel(wo.status, context);
                    const nextAct    = getNextAction(wo.status, context);
                    const isTerminal = TERMINAL_STATUSES.includes(wo.status);
                    const age        = ageInDays(wo.created_at);
                    const isOverdue  = age > OVERDUE_DAYS && !isTerminal;
                    const assignedDisplay = (() => {
                      if (!wo.work_order_assignments.length) return null;
                      const a = wo.work_order_assignments[0];
                      if (a.assignment_type === "FREELANCER") return `Freelancer: ${a.external_name ?? ""}`;
                      if (a.assignment_type === "EXTERNAL_COMPANY") return `Company: ${a.external_company ?? ""}`;
                      const names = wo.work_order_assignments
                        .filter((x) => x.profiles != null)
                        .map((x) => x.profiles!.full_name);
                      return names.join(", ") || null;
                    })();

                    const rowBg = (() => {
                      if (wo.status === "Rejected" || wo.status === "Cancelled") return "bg-red-50/50 hover:bg-red-50";
                      if (isOverdue) return "bg-red-50/30 hover:bg-red-50";
                      if (["Waiting for Parts", "Waiting for Purchase"].includes(wo.status)) return "bg-amber-50/40 hover:bg-amber-50";
                      if (["Assigned", "In Progress", "Parts Issued", "Approved"].includes(wo.status)) return "bg-blue-50/30 hover:bg-blue-50";
                      if (["Closed", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(wo.status)) return "bg-green-50/30 hover:bg-green-50";
                      return "hover:bg-gray-50";
                    })();

                    const previewHref = buildHref({ ...sp, preview: wo.id });

                    return (
                      <QuickViewRow key={wo.id} previewHref={previewHref} className={rowBg}>
                        {/* Repair order */}
                        <td className="px-4 py-3">
                          <Link
                            href={previewHref}
                            scroll={false}
                            className="block truncate font-bold text-[#111827] hover:text-[#ED1C24]"
                          >
                            {wo.work_order_number ?? "Unnumbered"}
                          </Link>
                          <p className="truncate text-xs text-[#4B5563]">{wo.ordered_by}</p>
                          <p className="text-xs text-[#9CA3AF]">{formatDate(wo.date_of_order)}</p>
                        </td>

                        {/* Asset / Machine */}
                        <td className="px-4 py-3">
                          {wo.assets ? (
                            <Link href={`/assets/${wo.assets.id}`} className="group/asset block">
                              <p className="font-semibold text-[#111827] transition group-hover/asset:text-[#ED1C24]">
                                {wo.assets.asset_name}
                              </p>
                              <p className="text-xs text-[#4B5563]">
                                {wo.assets.asset_code}
                                {wo.assets.plate_number ? ` · ${wo.assets.plate_number}` : ""}
                              </p>
                            </Link>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">No asset linked</span>
                          )}
                        </td>

                        {/* Issue / Problem */}
                        <td className="max-w-[180px] px-4 py-3">
                          {wo.operator_complaint ? (
                            <p className="line-clamp-2 text-xs text-[#111827]">{wo.operator_complaint}</p>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge label={displayStatus(wo.status)} tone={statusTone(wo.status)} />
                          {!isTerminal && (
                            <p className={`mt-1 text-xs ${nextAct.mine ? "font-bold text-[#ED1C24]" : "text-[#9CA3AF]"}`}>
                              {nextAct.label}
                            </p>
                          )}
                        </td>

                        {/* Technician / Assignment */}
                        <td className="px-4 py-3">
                          {assignedDisplay ? (
                            <span className="text-sm text-[#111827]">{assignedDisplay}</span>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">Not assigned</span>
                          )}
                        </td>

                        {/* Age */}
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold ${isOverdue ? "text-[#DC2626]" : "text-[#4B5563]"}`}>
                            {age === 0 ? "Today" : age === 1 ? "1 day open" : `${age} days open`}
                          </span>
                          {isOverdue && <p className="text-xs font-bold text-[#DC2626]">Overdue</p>}
                        </td>

                        {/* Action */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="inline-block rounded-md border border-[#E5E7EB] px-3 py-2 text-center text-xs font-bold text-[#111827] transition hover:bg-gray-50"
                            >
                              Full Details
                            </Link>
                            {actLabel && (
                              <Link
                                href={`/maintenance/work-orders/${wo.id}`}
                                className="inline-block rounded-md bg-[#ED1C24] px-3 py-2 text-center text-xs font-bold text-white transition hover:bg-[#c8181e]"
                              >
                                {actLabel}
                              </Link>
                            )}
                            {!isNormalUser && context.permissions.includes("work_orders.print") && (
                              <Link
                                href={`/maintenance/work-orders/${wo.id}/print`}
                                className="flex items-center justify-center rounded-md border border-[#E5E7EB] p-2 hover:bg-gray-50"
                                title="Print job card"
                              >
                                <Printer className="h-4 w-4" aria-hidden="true" />
                              </Link>
                            )}
                          </div>
                        </td>
                      </QuickViewRow>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-10">
                      {/* Tab-specific empty state when a status tab alone yields
                          nothing (Task 9); falls back to the generic filters
                          message once search/date/other filters are also involved. */}
                      {!hasNonTabFilters && activeTab && TAB_EMPTY_STATE[activeTab.status] ? (
                        <EmptyState
                          title={TAB_EMPTY_STATE[activeTab.status].title}
                          message={TAB_EMPTY_STATE[activeTab.status].message}
                        />
                      ) : (
                        <EmptyState
                          title="No job cards match your filters"
                          message="Clear the filters or adjust your search to see job cards. You can also create a new job card."
                          action={
                            <div className="flex gap-3">
                              <Link href="/maintenance/work-orders">
                                <Button variant="secondary">Clear filters</Button>
                              </Link>
                              <Link
                                href="/maintenance/work-orders/new"
                                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                              >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                New Job Card
                              </Link>
                            </div>
                          }
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Pagination ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
          <span>
            Page {page} of {totalPages} &nbsp;·&nbsp; {count.toLocaleString()} job cards
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(sp, page - 1)} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(sp, page + 1)} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50">
                Next
              </Link>
            )}
          </div>
        </div>

      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section components
// ─────────────────────────────────────────────────────────────────────────────

function FilterSection({ sp }: { sp: SP }) {
  return (
    <form method="GET" action="/maintenance/work-orders" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_auto]">
        <input
          name="search"
          defaultValue={sp.search ?? ""}
          placeholder="Job card no., asset name, requester, location…"
          className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
        />

        <input
          name="date_from"
          type="date"
          defaultValue={sp.date_from ?? ""}
          className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#4B5563]"
          title="Date from"
        />

        <input
          name="date_to"
          type="date"
          defaultValue={sp.date_to ?? ""}
          className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#4B5563]"
          title="Date to"
        />

        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
          <Link href="/maintenance/work-orders" className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold text-[#4B5563] hover:bg-gray-50">
            Reset
          </Link>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive components
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, href, tone, icon: Icon, detail, urgent,
}: {
  title: string;
  value: number;
  href: string;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  icon: LucideIcon;
  detail: string;
  urgent?: boolean;
}) {
  const iconBg = {
    green: "bg-[#16A34A]",
    amber: "bg-[#F59E0B]",
    red:   "bg-[#ED1C24]",
    blue:  "bg-[#2563EB]",
    gray:  "bg-[#111827]",
  }[tone];

  return (
    <Link
      href={href}
      className={`rounded-md border bg-white p-4 shadow-sm transition hover:border-[#ED1C24] hover:shadow-md ${urgent && value > 0 ? "border-amber-300" : "border-[#E5E7EB]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${iconBg}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`text-2xl font-black ${urgent && value > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>
          {value.toLocaleString("en-US")}
        </span>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-[#4B5563]">{detail}</p>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CEO sub-components
// ─────────────────────────────────────────────────────────────────────────────

type CeoWO = {
  id: string;
  work_order_number: string | null;
  date_of_order: Date | null;
  created_at: Date;
  ordered_by: string | null;
  maintenance_type: string;
  priority: string;
  status: string;
  job_location: string | null;
  total_work_order_cost: Prisma.Decimal | null;
  assets: { asset_code: string; asset_name: string; plate_number: string | null } | null;
  departments: { name: string } | null;
  purchase_requests: { id: string; status: string; estimated_total: Prisma.Decimal | null }[];
};

function getCeoReason(wo: CeoWO, overdueThreshold: Date): string {
  if (wo.purchase_requests.some((pr) => pr.status === "Pending CEO Approval"))
    return "Waiting CEO approval";
  if (wo.status === "Waiting for Purchase") return "Blocked by purchase";
  if (wo.status === "Waiting for Parts")    return "Blocked by materials";
  const age = ageInDays(wo.created_at);
  if (!TERMINAL_STATUSES.includes(wo.status) && wo.created_at < overdueThreshold)
    return `Overdue ${age} days`;
  if (wo.priority === "Urgent" || wo.priority === "High") return "High-risk open work";
  return "Executive visibility";
}

function CeoTabBar({
  ceoTab, sp, decisionsCount, highRiskCount, blockedCount, overdueCount, totalCount,
}: {
  ceoTab: string;
  sp: SP;
  decisionsCount: number;
  highRiskCount: number;
  blockedCount: number;
  overdueCount: number;
  totalCount: number;
}) {
  const tabs = [
    { label: "All Executive Items",  tab: "",           count: totalCount },
    { label: "Needs CEO Decision",   tab: "decisions",  count: decisionsCount },
    { label: "High Risk",            tab: "high_risk",  count: highRiskCount },
    { label: "Blocked",              tab: "blocked",    count: blockedCount },
    { label: "Overdue",              tab: "overdue",    count: overdueCount },
  ];
  return (
    <div className="overflow-x-auto rounded-t-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex min-w-max">
        {tabs.map((t) => {
          const isActive = ceoTab === t.tab;
          const href = buildHref({ ...sp, ceo_tab: t.tab, page: "" });
          return (
            <Link
              key={t.tab || "all"}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-bold transition ${
                isActive
                  ? "border-b-2 border-[#ED1C24] text-[#ED1C24]"
                  : "border-b-2 border-transparent text-[#4B5563] hover:text-[#111827]"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${isActive ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"}`}>
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CeoFilterSection({
  sp, departments, canSeeCosts,
}: {
  sp: SP;
  departments: { id: string; name: string }[];
  canSeeCosts: boolean;
}) {
  return (
    <form method="GET" action="/maintenance/work-orders" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      {sp.ceo_tab && <input type="hidden" name="ceo_tab" value={sp.ceo_tab} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Search */}
        <div className="sm:col-span-2">
          <input
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Work order no., asset, requester…"
            className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
          />
        </div>

        {/* Department */}
        <select name="dept" defaultValue={sp.dept ?? ""} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        {/* Executive Stage */}
        <select name="ceo_tab" defaultValue={sp.ceo_tab ?? ""} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
          <option value="">All executive items</option>
          <option value="decisions">Needs CEO Decision</option>
          <option value="high_risk">High Risk</option>
          <option value="blocked">Blocked Operations</option>
          <option value="overdue">Overdue</option>
          {canSeeCosts && <option value="high_cost">High Cost</option>}
        </select>

        {/* Date range */}
        <input name="date_from" type="date" defaultValue={sp.date_from ?? ""} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#4B5563]" title="Date from" />
        <input name="date_to"   type="date" defaultValue={sp.date_to   ?? ""} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#4B5563]" title="Date to" />

        {/* Cost min — only if cost visibility */}
        {canSeeCosts && (
          <input
            name="cost_min"
            type="number"
            min={0}
            step={50}
            defaultValue={sp.cost_min ?? ""}
            placeholder="Min cost (KWD)"
            className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
          />
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
          <Link href="/maintenance/work-orders" className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold text-[#4B5563] hover:bg-gray-50">
            Reset
          </Link>
        </div>
      </div>
    </form>
  );
}

function CeoWorkOrderTable({
  workOrders, canSeeCosts, overdueThreshold,
}: {
  workOrders: CeoWO[];
  canSeeCosts: boolean;
  overdueThreshold: Date;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
          <tr>
            <th className="px-4 py-3">Reference No.</th>
            <th className="px-4 py-3">Department</th>
            <th className="px-4 py-3">Asset / Vehicle</th>
            <th className="px-4 py-3">Reason / Description</th>
            <th className="px-4 py-3">Why CEO Sees This</th>
            <th className="px-4 py-3">Current Stage</th>
            <th className="px-4 py-3">Age</th>
            {canSeeCosts && <th className="px-4 py-3">Cost</th>}
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {workOrders.map((wo) => {
            const isTerminal   = TERMINAL_STATUSES.includes(wo.status);
            const age          = ageInDays(wo.created_at);
            const isOverdue    = !isTerminal && wo.created_at < overdueThreshold;
            const reason       = getCeoReason(wo, overdueThreshold);
            const hasCeoApproval = wo.purchase_requests.some((pr) => pr.status === "Pending CEO Approval");
            const costNum      = canSeeCosts ? Number(wo.total_work_order_cost ?? 0) : 0;

            return (
              <tr key={wo.id} className="transition hover:bg-gray-50">
                {/* Reference */}
                <td className="px-4 py-3.5">
                  <Link
                    href={`/maintenance/work-orders/${wo.id}`}
                    className="block font-bold text-[#111827] hover:text-[#ED1C24]"
                  >
                    {wo.work_order_number ?? "Unnumbered"}
                  </Link>
                  <p className="text-xs text-[#9CA3AF]">{formatDate(wo.date_of_order)}</p>
                </td>

                {/* Department */}
                <td className="px-4 py-3.5">
                  <span className="text-[#4B5563]">{wo.departments?.name ?? "—"}</span>
                </td>

                {/* Asset */}
                <td className="px-4 py-3.5">
                  {wo.assets ? (
                    <div>
                      <p className="font-semibold text-[#111827]">{wo.assets.asset_name}</p>
                      <p className="text-xs text-[#4B5563]">
                        {wo.assets.asset_code}
                        {wo.assets.plate_number ? ` · ${wo.assets.plate_number}` : ""}
                      </p>
                    </div>
                  ) : (
                    <span className="text-[#9CA3AF]">No asset</span>
                  )}
                </td>

                {/* Reason / Description */}
                <td className="max-w-[200px] px-4 py-3.5">
                  <p className="truncate text-[#111827]">{wo.maintenance_type}</p>
                  <p className="truncate text-xs text-[#4B5563]">{wo.job_location ?? "—"}</p>
                </td>

                {/* Why CEO sees this */}
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                    hasCeoApproval      ? "bg-red-100 text-[#DC2626]"
                    : reason.startsWith("Blocked")  ? "bg-amber-100 text-amber-800"
                    : reason.startsWith("Overdue")  ? "bg-red-100 text-[#DC2626]"
                    : reason.startsWith("Urgent")   ? "bg-red-100 text-[#DC2626]"
                    : reason.startsWith("High")     ? "bg-amber-100 text-amber-800"
                    : "bg-gray-100 text-[#4B5563]"
                  }`}>
                    {reason}
                  </span>
                </td>

                {/* Stage */}
                <td className="px-4 py-3.5">
                  <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                </td>

                {/* Age */}
                <td className="px-4 py-3.5">
                  <span className={`text-xs font-semibold ${isOverdue ? "text-[#DC2626]" : "text-[#4B5563]"}`}>
                    {age === 0 ? "Today" : age === 1 ? "1 day" : `${age} days`}
                  </span>
                  {isOverdue && <p className="text-xs text-[#DC2626]">Overdue</p>}
                </td>

                {/* Cost */}
                {canSeeCosts && (
                  <td className="px-4 py-3.5">
                    {costNum > 0 ? (
                      <span className="text-xs font-semibold text-[#111827]">
                        {costNum.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} KWD
                      </span>
                    ) : (
                      <span className="text-xs text-[#9CA3AF]">—</span>
                    )}
                  </td>
                )}

                {/* Action */}
                <td className="whitespace-nowrap px-4 py-3.5 text-right">
                  {hasCeoApproval ? (
                    <Link
                      href="/ceo/approvals"
                      className="inline-block rounded-md bg-[#ED1C24] px-3 py-2 text-xs font-bold text-white hover:bg-[#c8181e]"
                    >
                      Approve / Reject
                    </Link>
                  ) : (
                    <Link
                      href={`/maintenance/work-orders/${wo.id}`}
                      className="inline-block rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Review
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


