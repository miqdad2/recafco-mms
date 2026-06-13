import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  DollarSign,
  Eye,
  FileText,
  Package,
  Plus,
  Printer,
  ShieldAlert,
  ShoppingCart,
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
import { getWorkOrderVisibilityFilter, getRoleDescription } from "@/lib/work-orders/visibility";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const WORKER_TYPES = [
  "Auto", "Mechanical", "Electrical", "Civil", "AC",
  "Plumbing", "Welding/Fabrication", "Other",
];

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

const TERMINAL_STATUSES = [
  "Closed", "Cancelled",
  "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester",
];

const OVERDUE_DAYS = 7;

const TAB_LIST = [
  { label: "All",              status: "" },
  { label: "Draft",            status: "Draft" },
  { label: "Submitted",        status: "Submitted" },
  { label: "Pending Approval", status: "Pending Approval" },
  { label: "Approved",         status: "Approved" },
  { label: "Assigned",         status: "Assigned" },
  { label: "In Progress",      status: "In Progress" },
  { label: "Waiting Parts",    status: "Waiting for Parts" },
  { label: "Waiting Purchase", status: "Waiting for Purchase" },
  { label: "Completed",        status: "Completed by Technician" },
  { label: "Verified",         status: "Verified by Supervisor" },
  { label: "Closed",           status: "Closed" },
  { label: "Rejected",         status: "Rejected" },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type SP = {
  page?: string;
  search?: string;
  status?: string;
  priority?: string;
  dept?: string;
  worker_type?: string;
  date_from?: string;
  date_to?: string;
  needs_action?: string;
  ceo_tab?: string;
  cost_min?: string;
};

type PageProps = {
  searchParams?: Promise<SP>;
};

type StatusSummary = { status: string; _count: { _all: number } };
type PrioritySummary = { priority: string; _count: { _all: number } };
type Department = { id: string; name: string };

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

// ── Status pipeline helpers ───────────────────────────────────────────────────

function getStageIndex(status: string): number {
  const map: Record<string, number> = {
    Draft: 0, Submitted: 1, Reopened: 1,
    "Pending Approval": 2,
    Approved: 3,
    Assigned: 4,
    "In Progress": 5, "Waiting for Parts": 5, "Waiting for Purchase": 5, "Parts Issued": 5,
    "Completed by Technician": 6, "Verified by Supervisor": 6, "Confirmed by Requester": 6,
    Closed: 7,
  };
  return map[status] ?? 0;
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

// ── Per-row "needs my action" ─────────────────────────────────────────────────

function rowNeedsAction(status: string, createdBy: string | null, context: CurrentUserContext): boolean {
  const p = context.permissions;
  const isAdmin = context.role?.slug === "super_admin";
  if ((isAdmin || p.includes("work_orders.approve")) &&
    ["Submitted", "Pending Approval", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return true;
  if ((isAdmin || p.includes("work_orders.assign")) &&
    ["Approved", "Completed by Technician"].includes(status)) return true;
  if (p.includes("store.issue") && status === "Waiting for Parts") return true;
  if (p.includes("purchase_requests.manage") && status === "Waiting for Purchase") return true;
  if (p.includes("work_orders.manage") && ["Draft", "Rejected"].includes(status) && createdBy === context.userId) return true;
  return false;
}

// ── Next action label ─────────────────────────────────────────────────────────

function getNextAction(status: string, context: CurrentUserContext): { label: string; mine: boolean } {
  const p = context.permissions;
  const isAdmin = context.role?.slug === "super_admin";
  const canApprove = isAdmin || p.includes("work_orders.approve");
  const canAssign = isAdmin || p.includes("work_orders.assign");

  switch (status) {
    case "Draft":                    return { label: "Submit for approval",        mine: p.includes("work_orders.manage") };
    case "Submitted":
    case "Pending Approval":         return { label: canApprove ? "Approve / Reject" : "Awaiting approval",     mine: canApprove };
    case "Rejected":                 return { label: "Needs correction",            mine: p.includes("work_orders.manage") };
    case "Approved":                 return { label: canAssign ? "Assign technician" : "Awaiting assignment",   mine: canAssign };
    case "Assigned":                 return { label: "Technician to start",         mine: false };
    case "In Progress":              return { label: "Job in progress",             mine: false };
    case "Waiting for Parts":        return { label: p.includes("store.issue") ? "Issue parts" : "Awaiting parts",     mine: p.includes("store.issue") };
    case "Waiting for Purchase":     return { label: p.includes("purchase_requests.manage") ? "Process purchase" : "Awaiting purchase", mine: p.includes("purchase_requests.manage") };
    case "Parts Issued":             return { label: "Resume work",                 mine: false };
    case "Completed by Technician":  return { label: canAssign ? "Verify completion" : "Awaiting verification", mine: canAssign };
    case "Verified by Supervisor":
    case "Confirmed by Requester":   return { label: canApprove ? "Close work order" : "Awaiting closure",      mine: canApprove };
    case "Closed":                   return { label: "Closed",                      mine: false };
    case "Cancelled":                return { label: "Cancelled",                   mine: false };
    default:                         return { label: status,                        mine: false };
  }
}

// ── Tone helpers ──────────────────────────────────────────────────────────────

function priorityTone(p: string): "red" | "amber" | "blue" | "gray" {
  if (p === "Urgent") return "red";
  if (p === "High")   return "amber";
  if (p === "Normal") return "blue";
  return "gray";
}

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

function countPriority(summaries: PrioritySummary[], priorities: string[]): number {
  return summaries.filter((s) => priorities.includes(s.priority)).reduce((n, s) => n + s._count._all, 0);
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
  const priority   = (sp.priority ?? "").trim();
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
    if (priority) tabConditions.push({ priority });
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
    const ceoHasFilters  = !!(search || priority || deptId || dateFrom || dateTo || costMin || ceoTab);

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
            <KpiCard title="Blocked Operations"        value={blockedCount}    href="?ceo_tab=blocked"   tone={blockedCount    > 0 ? "amber" : "gray"} icon={Package}       detail="Waiting for parts or purchase" />
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
  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  // Combines deleted_at guard + role visibility — used for KPI/summary queries
  const visibilityOnlyWhere: Prisma.work_ordersWhereInput = {
    AND: [{ deleted_at: null }, visibilityFilter],
  };

  // Full WHERE for the list: visibility + user-applied filters stacked as AND
  // to prevent key conflicts when the visibility filter itself uses `status`.
  const listConditions: Prisma.work_ordersWhereInput[] = [
    { deleted_at: null },
    visibilityFilter,
  ];
  if (status)     listConditions.push({ status });
  if (priority)   listConditions.push({ priority });
  if (deptId)     listConditions.push({ requested_by_department_id: deptId });
  if (workerType) listConditions.push({ worker_type: workerType });
  if (dateFilter) listConditions.push({ date_of_order: dateFilter });
  if (search)     listConditions.push({
    OR: [
      { work_order_number: { contains: search, mode: "insensitive" } },
      { ordered_by:         { contains: search, mode: "insensitive" } },
      { job_location:       { contains: search, mode: "insensitive" } },
      { operator_complaint: { contains: search, mode: "insensitive" } },
      { assets: { asset_name:   { contains: search, mode: "insensitive" } } },
      { assets: { plate_number: { contains: search, mode: "insensitive" } } },
    ],
  });
  if (needsAction) listConditions.push(getNeedsActionFilter(context));
  const where: Prisma.work_ordersWhereInput = { AND: listConditions };

  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - OVERDUE_DAYS);

  // Department filter dropdown: Data Entry users only see their own department.
  const slug = context.role?.slug ?? "";
  const departmentFilterWhere =
    slug === "maintenance_data_entry" && context.department?.id
      ? { id: context.department.id, is_active: true }
      : { is_active: true };

  const [workOrders, count, statusSummaries, departments, prioritySummaries, overdueCount] =
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
          priority: true,
          status: true,
          job_location: true,
          created_by: true,
          assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
          departments: { select: { name: true } },
          work_order_assignments: {
            select: { profiles: { select: { full_name: true } } },
          },
        },
      }),
      prisma.work_orders.count({ where }),
      prisma.work_orders.groupBy({
        by: ["status"],
        where: visibilityOnlyWhere,
        _count: { _all: true },
      }),
      prisma.departments.findMany({
        where: departmentFilterWhere,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.work_orders.groupBy({
        by: ["priority"],
        where: {
          AND: [
            visibilityOnlyWhere,
            { status: { notIn: TERMINAL_STATUSES } },
          ],
        },
        _count: { _all: true },
      }),
      prisma.work_orders.count({
        where: {
          AND: [
            visibilityOnlyWhere,
            { date_of_order: { lt: overdueDate } },
            { status: { notIn: TERMINAL_STATUSES } },
          ],
        },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const totalWOs       = statusSummaries.reduce((n, s) => n + s._count._all, 0);
  const pendingApproval = countFor(statusSummaries, ["Submitted", "Pending Approval"]);
  const urgentHigh     = countPriority(prioritySummaries, ["Urgent", "High"]);
  const activeJobs     = countFor(statusSummaries, ["Approved", "Assigned", "In Progress"]);
  const waitingParts   = countFor(statusSummaries, ["Waiting for Parts", "Parts Issued"]);
  const waitingPurchase = countFor(statusSummaries, ["Waiting for Purchase"]);
  const completedPending = countFor(statusSummaries, ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"]);
  const closed         = countFor(statusSummaries, ["Closed"]);

  const hasFilters = search || status || priority || deptId || workerType || dateFrom || dateTo || needsAction;

  return (
    <>
      <PageHeader
        title="Work Orders"
        description={getRoleDescription(context)}
        actions={<TemplatePickerButton />}
      />

      <div className="space-y-4 p-4 lg:p-6">

        {/* ── Operational KPI cards ─────────────────────────────────────────── */}
        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
          <KpiCard
            title="Total Work Orders"
            value={totalWOs}
            href="/maintenance/work-orders"
            tone="blue"
            icon={ClipboardList}
            detail="All maintenance work orders"
          />
          <KpiCard
            title="Pending Approval"
            value={pendingApproval}
            href={buildHref({ status: "Pending Approval" })}
            tone={pendingApproval > 0 ? "amber" : "gray"}
            icon={Clock3}
            detail="Submitted · awaiting manager"
            urgent={pendingApproval > 0}
          />
          <KpiCard
            title="High / Urgent"
            value={urgentHigh}
            href={buildHref({ priority: "Urgent" })}
            tone={urgentHigh > 0 ? "red" : "gray"}
            icon={Zap}
            detail="High priority or urgent — active"
            urgent={urgentHigh > 0}
          />
          <KpiCard
            title="Active Jobs"
            value={activeJobs}
            href={buildHref({ status: "In Progress" })}
            tone="blue"
            icon={Wrench}
            detail="Approved · assigned · in progress"
          />
          <KpiCard
            title="Waiting for Parts"
            value={waitingParts}
            href={buildHref({ status: "Waiting for Parts" })}
            tone={waitingParts > 0 ? "amber" : "gray"}
            icon={Package}
            detail="Parts or store issue needed"
          />
          <KpiCard
            title="Waiting for Purchase"
            value={waitingPurchase}
            href={buildHref({ status: "Waiting for Purchase" })}
            tone={waitingPurchase > 0 ? "amber" : "gray"}
            icon={ShoppingCart}
            detail="Purchase request in progress"
          />
          <KpiCard
            title="Overdue"
            value={overdueCount}
            href={buildHref({})}
            tone={overdueCount > 0 ? "red" : "gray"}
            icon={AlertTriangle}
            detail={`Open for more than ${OVERDUE_DAYS} days`}
            urgent={overdueCount > 0}
          />
          <KpiCard
            title="Closed"
            value={closed}
            href={buildHref({ status: "Closed" })}
            tone="green"
            icon={CheckCircle2}
            detail={`${completedPending} completed · awaiting closure`}
          />
        </section>

        {/* ── Role-based quick actions ──────────────────────────────────────── */}
        <QuickActions context={context} />

        {/* ── Filters ───────────────────────────────────────────────────────── */}
        <FilterSection sp={sp} departments={departments} />

        {/* ── Workflow tabs ─────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded-t-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex min-w-max">
            {TAB_LIST.map((tab) => {
              const isActive = status === tab.status || (!status && tab.status === "");
              const tabCount = tab.status
                ? (statusSummaries.find((s) => s.status === tab.status)?._count._all ?? 0)
                : totalWOs;
              return (
                <Link
                  key={tab.status || "all"}
                  href={tabHref(sp, tab.status)}
                  className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-bold transition ${
                    isActive
                      ? "border-b-2 border-[#ED1C24] text-[#ED1C24]"
                      : "border-b-2 border-transparent text-[#4B5563] hover:text-[#111827]"
                  }`}
                >
                  {tab.label}
                  {tabCount > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs ${isActive ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"}`}>
                      {tabCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Work orders table ─────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-b-md border border-t-0 border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Work order records</p>
              <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                {count.toLocaleString()} {hasFilters ? "matching" : "total"} work orders
                {hasFilters && (
                  <Link href="/maintenance/work-orders" className="ml-2 text-xs font-bold text-[#ED1C24] underline">
                    Clear filters
                  </Link>
                )}
              </p>
            </div>
            {pendingApproval > 0 && !status && (
              <StatusBadge label={`${pendingApproval} need approval`} tone="amber" />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Work Order</th>
                  <th className="px-4 py-3">Asset / Vehicle</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status &amp; Next Action</th>
                  <th className="px-4 py-3">Technician</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {workOrders.length > 0 ? (
                  workOrders.map((wo) => {
                    const isUrgent   = wo.priority === "Urgent";
                    const needsAct   = rowNeedsAction(wo.status, wo.created_by, context);
                    const nextAct    = getNextAction(wo.status, context);
                    const stageIdx   = getStageIndex(wo.status);
                    const isTerminal = TERMINAL_STATUSES.includes(wo.status);
                    const age        = ageInDays(wo.created_at);
                    const isOverdue  = age > OVERDUE_DAYS && !isTerminal;
                    const assignedNames = wo.work_order_assignments
                      .filter((a) => a.profiles != null)
                      .map((a) => a.profiles!.full_name)
                      .join(", ");

                    return (
                      <tr
                        key={wo.id}
                        className={`transition hover:bg-gray-50 ${isUrgent ? "border-l-4 border-l-[#ED1C24]" : ""}`}
                      >
                        {/* Work order + mini pipeline */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-start gap-2">
                            {needsAct && (
                              <span
                                className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500"
                                title="Needs your action"
                              />
                            )}
                            <div className="min-w-0">
                              <Link
                                href={`/maintenance/work-orders/${wo.id}`}
                                className="block truncate font-bold text-[#111827] hover:text-[#ED1C24]"
                              >
                                {wo.work_order_number ?? "Unnumbered"}
                              </Link>
                              <p className="truncate text-xs text-[#4B5563]">{wo.ordered_by}</p>
                              <p className="text-xs text-[#9CA3AF]">{formatDate(wo.date_of_order)}</p>
                              <MiniPipeline stage={stageIdx} total={8} failed={wo.status === "Rejected" || wo.status === "Cancelled"} />
                            </div>
                          </div>
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

                        {/* Department */}
                        <td className="px-4 py-3.5">
                          <span className="text-[#4B5563]">{wo.departments?.name ?? "—"}</span>
                        </td>

                        {/* Type */}
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-[#111827]">{wo.maintenance_type}</p>
                          <p className="text-xs text-[#4B5563]">{wo.worker_type}</p>
                        </td>

                        {/* Priority */}
                        <td className="px-4 py-3.5">
                          <StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />
                        </td>

                        {/* Status + next action */}
                        <td className="px-4 py-3.5">
                          <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                          <p className={`mt-1 text-xs ${nextAct.mine ? "font-bold text-[#ED1C24]" : "text-[#4B5563]"}`}>
                            {nextAct.label}
                          </p>
                        </td>

                        {/* Assigned technician */}
                        <td className="px-4 py-3.5">
                          {assignedNames ? (
                            <span className="text-[#111827]">{assignedNames}</span>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>

                        {/* Age */}
                        <td className="px-4 py-3.5">
                          <span className={`text-xs font-semibold ${isOverdue ? "text-[#DC2626]" : "text-[#4B5563]"}`}>
                            {age === 0 ? "Today" : age === 1 ? "1 day" : `${age} days`}
                          </span>
                          {isOverdue && <p className="text-xs text-[#DC2626]">Overdue</p>}
                        </td>

                        {/* Action */}
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className={`inline-block w-[72px] rounded-md py-2 text-center text-xs font-bold transition ${
                                needsAct
                                  ? "bg-[#ED1C24] text-white hover:bg-[#c8181e]"
                                  : "border border-[#E5E7EB] text-[#111827] hover:bg-gray-50"
                              }`}
                            >
                              {needsAct ? "Act" : "View"}
                            </Link>
                            {context.permissions.includes("work_orders.print") && (
                              <Link
                                href={`/maintenance/work-orders/${wo.id}/print`}
                                className="flex items-center justify-center rounded-md border border-[#E5E7EB] p-2 hover:bg-gray-50"
                                title="Print work order"
                              >
                                <Printer className="h-4 w-4" aria-hidden="true" />
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-10">
                      <EmptyState
                        title={hasFilters ? "No work orders match these filters" : "No work orders yet"}
                        message={
                          hasFilters
                            ? "Try adjusting the search or filter criteria. Use the Clear filters link to reset."
                            : "Create the first work order to get started. All maintenance work orders will appear here."
                        }
                        action={
                          hasFilters ? (
                            <Link href="/maintenance/work-orders">
                              <Button variant="secondary">Clear filters</Button>
                            </Link>
                          ) : undefined
                        }
                      />
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
            Page {page} of {totalPages} &nbsp;·&nbsp; {count.toLocaleString()} work orders
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

function QuickActions({ context }: { context: CurrentUserContext }) {
  const slug = context.role?.slug;
  const p = context.permissions;

  type QA = { label: string; href: string; primary?: boolean };

  let actions: QA[] = [];

  if (slug === "super_admin" || slug === "it_admin") {
    actions = [
      { label: "Pending Approval",  href: buildHref({ status: "Pending Approval" }),  primary: true },
      { label: "In Progress",       href: buildHref({ status: "In Progress" }) },
      { label: "Needs My Action",   href: buildHref({ needs_action: "1" }) },
      { label: "High Priority",     href: buildHref({ priority: "High" }) },
      { label: "All Work Orders",   href: "/maintenance/work-orders" },
    ];
  } else if (slug === "ceo_management") {
    actions = [
      { label: "CEO Approvals",     href: "/ceo/approvals",                           primary: true },
      { label: "High / Urgent",     href: buildHref({ priority: "Urgent" }) },
      { label: "Overdue Items",     href: buildHref({ needs_action: "1" }) },
      { label: "Pending Approval",  href: buildHref({ status: "Pending Approval" }) },
    ];
  } else if (slug === "maintenance_manager" || p.includes("work_orders.approve")) {
    actions = [
      { label: "Needs Approval",    href: buildHref({ status: "Pending Approval" }),  primary: true },
      { label: "Urgent",            href: buildHref({ priority: "Urgent" }) },
      { label: "High Priority",     href: buildHref({ priority: "High" }) },
      { label: "Waiting Purchase",  href: buildHref({ status: "Waiting for Purchase" }) },
      { label: "Ready to Close",    href: buildHref({ status: "Verified by Supervisor" }) },
    ];
  } else if (slug === "maintenance_supervisor" || p.includes("work_orders.assign")) {
    actions = [
      { label: "Ready to Assign",   href: buildHref({ status: "Approved" }),           primary: true },
      { label: "Assigned Jobs",     href: buildHref({ status: "Assigned" }) },
      { label: "In Progress",       href: buildHref({ status: "In Progress" }) },
      { label: "Need Verification", href: buildHref({ status: "Completed by Technician" }) },
    ];
  } else if (slug === "maintenance_data_entry" || (p.includes("work_orders.manage") && !p.includes("work_orders.approve"))) {
    actions = [
      { label: "Create Request",    href: "/maintenance/work-orders/new",              primary: true },
      { label: "My Requests",       href: buildHref({}) },
      { label: "My Drafts",         href: buildHref({ status: "Draft" }) },
      { label: "My Submitted",      href: buildHref({ status: "Submitted" }) },
      { label: "Rejected / Fix",    href: buildHref({ status: "Rejected" }) },
    ];
  } else if (slug === "technician") {
    actions = [
      { label: "My Jobs",           href: "/technician/jobs",                          primary: true },
      { label: "New Assignments",   href: buildHref({ status: "Assigned" }) },
      { label: "In Progress",       href: buildHref({ status: "In Progress" }) },
      { label: "Waiting for Parts", href: buildHref({ status: "Waiting for Parts" }) },
    ];
  } else if (slug === "store_keeper") {
    actions = [
      { label: "Waiting for Parts", href: buildHref({ status: "Waiting for Parts" }), primary: true },
      { label: "Parts Issued",      href: buildHref({ status: "Parts Issued" }) },
    ];
  } else if (slug === "purchase_officer") {
    actions = [
      { label: "Waiting Purchase",  href: buildHref({ status: "Waiting for Purchase" }), primary: true },
      { label: "Active Jobs",       href: buildHref({ status: "In Progress" }) },
    ];
  } else if (slug === "finance_manager") {
    actions = [
      { label: "Finance Approvals", href: "/finance/approvals",                        primary: true },
    ];
  }

  if (actions.length === 0) return null;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
      <p className="mb-2.5 text-xs font-black uppercase text-[#4B5563]">
        Quick actions — {context.role?.name ?? "your role"}
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Link
            key={a.href + a.label}
            href={a.href}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
              a.primary
                ? "bg-[#ED1C24] text-white hover:bg-[#c8181e]"
                : "border border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:bg-red-50 hover:text-[#ED1C24]"
            }`}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function FilterSection({ sp, departments }: { sp: SP; departments: Department[] }) {
  return (
    <form method="GET" action="/maintenance/work-orders" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Search — 2 cols */}
        <div className="sm:col-span-2 xl:col-span-2">
          <input
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Work order no., asset, requester, location…"
            className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
          />
        </div>

        <select
          name="priority"
          defaultValue={sp.priority ?? ""}
          className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
        </select>

        <select
          name="dept"
          defaultValue={sp.dept ?? ""}
          className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <select
          name="worker_type"
          defaultValue={sp.worker_type ?? ""}
          className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
        >
          <option value="">All worker types</option>
          {WORKER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

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

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#E5E7EB] px-3 py-2 text-sm hover:bg-gray-50">
          <input
            type="checkbox"
            name="needs_action"
            value="1"
            defaultChecked={sp.needs_action === "1"}
            className="h-4 w-4 rounded border-gray-300 accent-[#ED1C24]"
          />
          <span className="font-medium text-[#111827]">Needs my action</span>
        </label>

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
  if (wo.status === "Waiting for Parts")    return "Blocked by parts";
  const age = ageInDays(wo.created_at);
  if (!TERMINAL_STATUSES.includes(wo.status) && wo.created_at < overdueThreshold)
    return `Overdue ${age} days`;
  if (wo.priority === "Urgent") return "Urgent — high-risk open work";
  if (wo.priority === "High")   return "High priority open work";
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

        {/* Priority / Risk */}
        <select name="priority" defaultValue={sp.priority ?? ""} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

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
            <th className="px-4 py-3">Risk / Priority</th>
            <th className="px-4 py-3">Current Stage</th>
            <th className="px-4 py-3">Age</th>
            {canSeeCosts && <th className="px-4 py-3">Cost</th>}
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {workOrders.map((wo) => {
            const isUrgent     = wo.priority === "Urgent";
            const isTerminal   = TERMINAL_STATUSES.includes(wo.status);
            const age          = ageInDays(wo.created_at);
            const isOverdue    = !isTerminal && wo.created_at < overdueThreshold;
            const reason       = getCeoReason(wo, overdueThreshold);
            const hasCeoApproval = wo.purchase_requests.some((pr) => pr.status === "Pending CEO Approval");
            const costNum      = canSeeCosts ? Number(wo.total_work_order_cost ?? 0) : 0;

            return (
              <tr
                key={wo.id}
                className={`transition hover:bg-gray-50 ${isUrgent ? "border-l-4 border-l-[#ED1C24]" : ""}`}
              >
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

                {/* Priority */}
                <td className="px-4 py-3.5">
                  <StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />
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

function MiniPipeline({ stage, total, failed }: { stage: number; total: number; failed: boolean }) {
  return (
    <div className="mt-1.5 flex h-1 gap-px" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-full flex-1 rounded-sm ${
            failed
              ? i <= stage ? "bg-red-400" : "bg-gray-200"
              : i < stage  ? "bg-[#ED1C24]"
              : i === stage ? "bg-[#ED1C24] opacity-60"
              : "bg-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

function TemplatePickerButton() {
  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
        aria-label="Create request — select form type"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create Request
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-lg">
        <p className="border-b border-[#E5E7EB] bg-gray-50 px-3 py-2 text-xs font-black uppercase text-[#4B5563]">
          Select Form Type
        </p>
        <Link
          href="/maintenance/work-orders/new"
          className="flex items-start gap-3 px-3 py-3 text-sm text-[#111827] hover:bg-red-50"
        >
          <Wrench className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#ED1C24]" aria-hidden="true" />
          <div>
            <p className="font-bold">Maintenance Work Order</p>
            <p className="text-xs text-[#4B5563]">Maintenance work order form used by the maintenance department.</p>
            <p className="mt-1 text-xs font-bold text-[#ED1C24]">Start Work Order →</p>
          </div>
        </Link>
        <Link
          href="/store/parts-requests/new"
          className="flex items-start gap-3 border-t border-[#E5E7EB] px-3 py-3 text-sm text-[#111827] hover:bg-red-50"
        >
          <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#ED1C24]" aria-hidden="true" />
          <div>
            <p className="font-bold">Parts Request</p>
            <p className="text-xs text-[#4B5563]">Request spare parts or materials for a work order.</p>
            <p className="mt-1 text-xs font-bold text-[#ED1C24]">Start Parts Request →</p>
          </div>
        </Link>
        <div className="flex cursor-not-allowed items-start gap-3 border-t border-[#E5E7EB] px-3 py-3 text-sm opacity-40">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold">Vehicle Requisition</p>
            <p className="text-xs">Coming soon</p>
          </div>
        </div>
        <div className="flex cursor-not-allowed items-start gap-3 border-t border-[#E5E7EB] px-3 py-3 text-sm opacity-40">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold">Daily Inspection Checklist</p>
            <p className="text-xs">Coming soon</p>
          </div>
        </div>
      </div>
    </details>
  );
}
