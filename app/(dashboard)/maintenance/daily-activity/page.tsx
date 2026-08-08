import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Activity, Briefcase, CheckCircle2, PauseCircle, PlayCircle, Search } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { DailyActivityBoard } from "@/components/work-orders/daily-activity-board";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { WORKERS_SECTION_ID, type DailyActivityCardData, type DailyActivityChip } from "@/components/work-orders/daily-activity-card";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts as canViewCostsForContext, hasPermission } from "@/lib/security/permissions";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import { ACTIVE_JOB_CARD_STATUSES, displaySimplifiedStatus, simplifiedStatusTone } from "@/lib/work-orders/simplified-status";
import {
  getMaterialFulfillmentForWorkOrders,
  anyMaterialsIncomplete,
  summarizeMaterialAvailability,
  type MaterialFulfillment,
} from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummariesBulk, type DailyActivityLaborSummary } from "@/lib/work-orders/work-session-totals";

// Daily Activity / Active Job Cards Work Tracking Unit 9.
//
// A dedicated, lightweight monitoring page — everything a Data Entry/Manager
// needs to answer "what's happening right now across every open Job Card"
// from one screen: who's working, who's paused, what materials are blocking
// what, and what's ready to close. Deliberately NOT a replacement for the
// full Job Card detail page (Task 15) — no attachments, no audit trail, no
// print/QR here; every card links out to the real detail page for that.
//
// Task 11 — performance: this page never loops a per-Job-Card query. The
// three read paths are (1) one lean work_orders query (no attachments/audit/
// full parts-request-item history), (2) one bulk material-fulfillment read
// across every Job Card on the page, (3) one bulk work-session read across
// every Job Card on the page — see getMaterialFulfillmentForWorkOrders() and
// getWorkOrderLaborSummariesBulk() (both new, additive, in the existing
// lib/work-orders/* modules), capped at PAGE_SIZE Job Cards.

const PAGE_SIZE = 50;

type SearchParamsShape = {
  q?: string;
  status?: string;
  team?: string;
  materials?: string;
};

const STATUS_FILTERS = ["all", "working", "paused", "not-started", "materials-pending", "ready-closure"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const TEAM_FILTERS = ["Auto", "Mechanical", "Electrical", "Other"] as const;

// Daily Activity UI/UX Simplification Unit 9B, Task 9: this page now uses
// its own 5-state Materials wording (adding a distinct "Partially Available"
// state), scoped to this page only — the Job Card detail page keeps its
// existing 4-state chip (Unit 8C.2) unchanged, so this is a deliberate,
// task-directed divergence for Daily Activity's own quick-scan card, not a
// drift/bug.
const MATERIALS_FILTERS = ["all", "Materials Pending", "Ready to Issue", "Partially Available", "Materials Completed", "No Materials"] as const;

function formatDate(v: Date | null | undefined): string {
  if (!v) return "-";
  return v.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Task 9 — five plain states instead of Unit 9's four, so "some available,
// some short" no longer hides under the same "Ready to Issue" label as
// "everything's available right now."
function materialsChipFor(
  hasAnyRequiredPartsTracking: boolean,
  hasAnyPartsRequests: boolean,
  materialsAvailability: ReturnType<typeof summarizeMaterialAvailability>,
  openPartsRequests: number,
  materialsIncomplete: boolean
): DailyActivityChip {
  if (!hasAnyPartsRequests && !hasAnyRequiredPartsTracking) return { label: "No Materials", tone: "gray" };
  if (materialsAvailability === "issuable") return { label: "Ready to Issue", tone: "blue" };
  if (materialsAvailability === "partial") return { label: "Partially Available", tone: "amber" };
  if (openPartsRequests > 0 || materialsIncomplete) return { label: "Materials Pending", tone: "red" };
  return { label: "Materials Completed", tone: "green" };
}

// Task 10 — Closure chip: matches the Job Card detail page's own 4 states
// (Not Ready/Ready/Requested/Closed); this page only ever loads non-Closed
// Job Cards, but Closure Requested can appear via the Task 1 "active
// session" exception, so it's handled for real, not just defensively.
function closureChipFor(status: string, closureReady: boolean): DailyActivityChip {
  if (status === "Closed") return { label: "Closed", tone: "green" };
  if (status === "Closure Requested") return { label: "Requested", tone: "amber" };
  return closureReady ? { label: "Ready", tone: "blue" } : { label: "Not Ready", tone: "gray" };
}

// Task 3 — one priority bucket per card, used both to sort the list (most
// important first) and to print a single small priority label on the card.
// Order matches the task's own numbered list exactly.
type PriorityBucket = "working" | "paused" | "materials" | "closure" | "assigned-idle" | "unassigned";
const PRIORITY_RANK: Record<PriorityBucket, number> = {
  working: 0,
  paused: 1,
  materials: 2,
  closure: 3,
  "assigned-idle": 4,
  unassigned: 5,
};
const PRIORITY_LABEL: Record<PriorityBucket, string> = {
  working: "Working Now",
  paused: "Paused",
  materials: "Materials Pending",
  closure: "Ready for Closure",
  "assigned-idle": "Not Started",
  unassigned: "Needs Assignment",
};

export default async function DailyActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const context = await requirePermission("work_orders.view");
  const sp = (await searchParams) ?? {};
  const search = (sp.q ?? "").trim().slice(0, 80);
  const statusFilter: StatusFilter = STATUS_FILTERS.includes((sp.status ?? "all") as StatusFilter) ? ((sp.status ?? "all") as StatusFilter) : "all";
  const teamFilter = TEAM_FILTERS.includes((sp.team ?? "") as (typeof TEAM_FILTERS)[number]) ? sp.team! : "";
  const materialsFilter = MATERIALS_FILTERS.includes((sp.materials ?? "all") as (typeof MATERIALS_FILTERS)[number]) ? (sp.materials ?? "all") : "all";

  const canViewCosts = canViewCostsForContext(context);
  const isManagerRole = context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  const canManageSessions = (hasPermission(context, "work_orders.assign") || isManagerRole) ;
  const canEditAssignment = hasPermission(context, "work_orders.assign") || hasPermission(context, "work_orders.approve") || isManagerRole;
  const canRequestClosureRole =
    context.role?.slug === "super_admin" ||
    ["maintenance_data_entry", "maintenance_manager", "maintenance_supervisor"].includes(context.role?.slug ?? "");
  // Same gate the Job Card detail page's Materials section uses for its own
  // "Issue Material" row action (lib/store/offline-inventory-data.ts).
  const canIssueMaterials = canManageOfflineInventory(context);
  // Daily Activity Inline Materials Receive/Issue Modal Unit 10D, Task 11:
  // same gate storeIssueModalAction/issueMaterials already enforce
  // server-side for Receive Materials — kept separate from canIssueMaterials
  // above even though the two currently resolve to the same role set, since
  // they gate two different backend actions.
  const canReceiveMaterials = canReceiveIssueMaterials(context);
  // Compact Control Board Unit 9C, Task 6: same gate the Job Card detail
  // page's own Print button uses.
  const canPrint = hasPermission(context, "work_orders.print");

  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  // Task 1 exception: a non-Closed Job Card outside the normal Active bucket
  // (e.g. a legacy/edge-case status) still shows, with a warning badge, if
  // it has a currently-running work session — active work is never hidden.
  const activeSessionWorkOrders = await prisma.workOrderWorkSession.findMany({
    where: { status: "Active" },
    select: { work_order_id: true },
    distinct: ["work_order_id"],
  });
  const activeSessionWorkOrderIds = activeSessionWorkOrders.map((s) => s.work_order_id);

  const searchConditions: Prisma.work_ordersWhereInput[] = search
    ? [
        {
          OR: [
            { work_order_number: { contains: search, mode: "insensitive" } },
            { operator_complaint: { contains: search, mode: "insensitive" } },
            { description_of_work: { contains: search, mode: "insensitive" } },
            { assets: { asset_name: { contains: search, mode: "insensitive" } } },
            { assets: { asset_code: { contains: search, mode: "insensitive" } } },
            { assets: { plate_number: { contains: search, mode: "insensitive" } } },
            {
              work_order_worker_assignments: {
                some: { status: "active", worker_profiles: { name: { contains: search, mode: "insensitive" } } },
              },
            },
          ],
        },
      ]
    : [];
  const teamConditions: Prisma.work_ordersWhereInput[] = teamFilter ? [{ worker_type: teamFilter }] : [];

  const where: Prisma.work_ordersWhereInput = {
    AND: [
      visibilityFilter,
      { deleted_at: null },
      { status: { not: "Closed" } },
      {
        OR: [
          { status: { in: ACTIVE_JOB_CARD_STATUSES } },
          ...(activeSessionWorkOrderIds.length ? [{ id: { in: activeSessionWorkOrderIds } }] : []),
        ],
      },
      ...searchConditions,
      ...teamConditions,
    ],
  };

  const [totalActiveCount, jobCardRows] = await Promise.all([
    prisma.work_orders.count({ where }),
    prisma.work_orders.findMany({
      where,
      orderBy: { updated_at: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        work_order_number: true,
        status: true,
        operator_complaint: true,
        description_of_work: true,
        worker_type: true,
        created_at: true,
        ordered_by: true,
        assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
        departments: { select: { name: true } },
        work_order_assignments: { select: { id: true } },
        parts_requests: { select: { id: true, status: true } },
      },
    }),
  ]);

  const jobCardIds = jobCardRows.map((w) => w.id);
  const [fulfillmentMap, laborMap] = await Promise.all([
    getMaterialFulfillmentForWorkOrders(prisma, jobCardIds),
    getWorkOrderLaborSummariesBulk(prisma, jobCardIds),
  ]);

  const emptyLaborSummary: DailyActivityLaborSummary = {
    workers: [],
    total_minutes: 0,
    total_hours: 0,
    total_amount: 0,
    has_active_session: false,
    today_minutes: 0,
    today_amount: 0,
  };
  const emptyFulfillment: MaterialFulfillment[] = [];

  // ── Per-Job-Card derived fields (Task 3/6/8/9/10) ───────────────────────
  const computed = jobCardRows.map((wo) => {
    const detailHref = `/maintenance/work-orders/${wo.id}`;
    const fulfillment = fulfillmentMap.get(wo.id) ?? emptyFulfillment;
    const laborSummary = laborMap.get(wo.id) ?? emptyLaborSummary;
    const materialsAvailability = summarizeMaterialAvailability(fulfillment);
    const materialsIncomplete = anyMaterialsIncomplete(fulfillment);
    // Compact Control Board Unit 9C, Task 6: materials mini-section's plain
    // required/issued/remaining summary — a sum of the same per-row
    // fulfillment numbers already computed by getMaterialFulfillmentForWorkOrders,
    // nothing new calculated here.
    const materialsTotals = fulfillment.reduce(
      (acc, f) => ({
        required: acc.required + f.required_qty,
        issued: acc.issued + f.issued_qty,
        remaining: acc.remaining + f.remaining_qty,
      }),
      { required: 0, issued: 0, remaining: 0 }
    );
    const openPartsRequests = wo.parts_requests.filter((r) => !["Closed", "Cancelled", "Issued"].includes(r.status)).length;
    const pendingMaterialsRequestsCount = wo.parts_requests.filter((r) => r.status !== "Issued").length;
    const activeMaterialsRequest = wo.parts_requests.find((r) => ["Requested", "Approved", "Waiting Stock", "Partially Issued"].includes(r.status)) ?? null;

    const hasInternalTeam = laborSummary.workers.length > 0;
    const hasAssignment = hasInternalTeam || wo.work_order_assignments.length > 0;
    const anyWorkerPaused = laborSummary.workers.some((w) => w.status === "Paused");

    const materialsChip = materialsChipFor(
      fulfillment.length > 0,
      wo.parts_requests.length > 0,
      materialsAvailability,
      openPartsRequests,
      materialsIncomplete
    );
    const workTimeChip: DailyActivityChip = !hasInternalTeam
      ? { label: "Not Started", tone: "gray" }
      : laborSummary.has_active_session
        ? { label: "Working", tone: "blue" }
        : anyWorkerPaused
          ? { label: "Paused", tone: "amber" }
          : laborSummary.total_minutes > 0
            ? { label: "Sessions Recorded", tone: "green" }
            : { label: "Not Started", tone: "gray" };
    const assignmentChip: DailyActivityChip = hasAssignment ? { label: "Assigned", tone: "green" } : { label: "Not assigned", tone: "gray" };

    // Task 10 — mirrors (read-only, never calls) the same three backend
    // closure guards the Job Card detail page's Closure panel already
    // mirrors: no pending Materials Request, required materials fully
    // issued, no active work session. Completion-note requirement is
    // handled at request time on the Job Card itself (Task 9's own note,
    // Unit 9). Brief reasons (not full sentences) for the card's small
    // "why not ready" line.
    const closureReady = pendingMaterialsRequestsCount === 0 && !materialsIncomplete && !laborSummary.has_active_session;
    const closureChip = closureChipFor(wo.status, closureReady);
    const closureReasons: string[] = [];
    if (pendingMaterialsRequestsCount > 0) closureReasons.push("Materials pending");
    if (materialsIncomplete) closureReasons.push("Required materials not fully issued");
    if (laborSummary.has_active_session) closureReasons.push("Active work session running");

    // Task 9 — one materials action per card. "Issue Material" (the one red
    // call-to-action) only offered to whoever can actually issue stock (same
    // gate the Job Card detail page's Materials section uses); never offers
    // "Receive Materials" once stock is already available to issue.
    const materialsActionHref =
      materialsChip.label === "Ready to Issue" || materialsChip.label === "Partially Available"
        ? `${detailHref}#parts`
        : activeMaterialsRequest
          ? `/store/parts-requests/${activeMaterialsRequest.id}`
          : `${detailHref}#parts`;
    // Unit 10D, Task 1/2/3/4 — the primary materials action now opens a
    // modal instead of navigating, for exactly the same two cases the old
    // href-based logic already recognized ("Issue Material"/"Receive
    // Materials"); "View Materials"/"Materials Completed" are unchanged,
    // plain navigation (nothing to action there — Task 7's "no open
    // Materials Request"/"already complete" guards). Partially Available's
    // primary is "Issue Available" (Task 4) rather than a plain "Issue
    // Material", since only part of what's required can be issued right now.
    const materialsModalAction: "issue" | "receive" | null =
      materialsChip.label === "Ready to Issue" && canIssueMaterials
        ? "issue"
        : materialsChip.label === "Partially Available" && canIssueMaterials
          ? "issue"
          : materialsChip.label === "Materials Pending" && activeMaterialsRequest && canReceiveMaterials
            ? "receive"
            : null;
    const materialsActionLabel =
      materialsChip.label === "Partially Available" && materialsModalAction === "issue"
        ? "Issue Available"
        : materialsModalAction === "issue"
          ? "Issue Material"
          : materialsModalAction === "receive"
            ? "Receive Materials"
            : materialsChip.label === "Materials Completed"
              ? "Materials Completed"
              : "View Materials";
    // Task 4 — Partially Available's second action, always offered
    // alongside "Issue Available" when there's an open Materials Request to
    // receive the shortage against (Task 7 — never otherwise).
    const materialsSecondaryAction: { label: string; mode: "receive" } | null =
      materialsChip.label === "Partially Available" && activeMaterialsRequest && canReceiveMaterials
        ? { label: "Receive Shortage", mode: "receive" }
        : null;

    // Task 9 — the one-line material alert shown only when materials need
    // attention (never for "No Materials"/"Materials Completed").
    const materialAlert =
      materialsChip.label === "Materials Pending"
        ? "Materials are pending."
        : materialsChip.label === "Ready to Issue"
          ? "Material is available to issue."
          : materialsChip.label === "Partially Available"
            ? "Some materials are available; shortage remains."
            : null;

    const isUnusualActiveSession = !ACTIVE_JOB_CARD_STATUSES.includes(wo.status) && laborSummary.has_active_session;

    const issue = wo.operator_complaint || wo.description_of_work || "No issue description";
    const assetLabel = wo.assets ? `${wo.assets.asset_code} — ${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null;
    const workTeam = wo.departments?.name ?? wo.worker_type ?? null;

    // Task 3 — one priority bucket, doubling as the sort key and the card's
    // small priority label. Order matches the task's numbered list exactly.
    const priorityBucket: PriorityBucket =
      workTimeChip.label === "Working"
        ? "working"
        : workTimeChip.label === "Paused"
          ? "paused"
          : materialsChip.label === "Materials Pending"
            ? "materials"
            : closureReady
              ? "closure"
              : hasAssignment
                ? "assigned-idle"
                : "unassigned";

    // Compact Control Board Final UI Polish Unit 9D, Task 7 — exactly one
    // Next Action per card, in the same priority order as Unit 9B, with
    // wording matched to the task's own examples. Paused/Not-Started now
    // scroll to the Workers section right below in the SAME panel (a plain
    // in-page anchor, gated by nothing — it's just a scroll, and the real
    // Start/Resume button inside is still gated by canManageSessions) rather
    // than navigating away to the full Job Card detail page. Working still
    // gets no button — with several workers a card-level button can't say
    // which one to pause, and that control is one scroll away regardless.
    const assignHref = `${detailHref}?editAssignment=1#assignment`;
    const closureHref = `${detailHref}#closure-panel`;
    const workersAnchorHref = `#${WORKERS_SECTION_ID}`;
    const nextAction: { message: string; buttonLabel: string | null; href: string | null } =
      wo.status === "Closure Requested"
        ? { message: "Waiting for Manager approval to close this Job Card.", buttonLabel: null, href: null }
        : materialsChip.label === "Materials Pending"
          ? {
              message:
                materialsActionLabel === "Receive Materials"
                  ? "Materials are pending. Receive materials when they arrive."
                  : "Materials are pending. Review the request to resolve it.",
              buttonLabel: materialsActionLabel,
              href: materialsActionHref,
            }
          : materialsChip.label === "Ready to Issue" || materialsChip.label === "Partially Available"
            ? { message: `${materialAlert ?? "Materials need action."} Issue material to the assigned workers.`, buttonLabel: materialsActionLabel, href: materialsActionHref }
            : !hasAssignment
              ? { message: "No workers assigned yet.", buttonLabel: canEditAssignment ? "Assign Workers" : null, href: canEditAssignment ? assignHref : null }
              : workTimeChip.label === "Not Started"
                ? { message: "Workers are assigned. Start tracking work below.", buttonLabel: "Track Work", href: workersAnchorHref }
                : workTimeChip.label === "Working"
                  ? { message: "Work is in progress.", buttonLabel: null, href: null }
                  : workTimeChip.label === "Paused"
                    ? { message: "Worker is paused. Resume work when ready.", buttonLabel: "Resume Work", href: workersAnchorHref }
                    : closureReady
                      ? { message: "Job Card is ready for closure request.", buttonLabel: canRequestClosureRole ? "Request Closure" : null, href: canRequestClosureRole ? closureHref : null }
                      : { message: "No action needed right now.", buttonLabel: null, href: null };

    return {
      wo,
      fulfillment,
      materialsTotals,
      laborSummary,
      materialsChip,
      workTimeChip,
      assignmentChip,
      closureChip,
      closureReady,
      closureReasons,
      hasAssignment,
      materialsActionHref,
      materialsActionLabel,
      materialsModalAction,
      materialsSecondaryAction,
      materialAlert,
      isUnusualActiveSession,
      issue,
      assetLabel,
      workTeam,
      priorityBucket,
      nextAction,
      detailHref,
    };
  });

  // ── Task 4 — quick filters (status-derived/materials-derived signals
  // aren't stored columns, so these apply after the bulk compute above;
  // search/team filters above are already real DB WHERE clauses). ─────────
  const filtered = computed.filter((c) => {
    if (statusFilter === "working" && c.workTimeChip.label !== "Working") return false;
    if (statusFilter === "paused" && c.workTimeChip.label !== "Paused") return false;
    if (statusFilter === "not-started" && c.workTimeChip.label !== "Not Started") return false;
    if (statusFilter === "materials-pending" && c.materialsChip.label !== "Materials Pending") return false;
    if (statusFilter === "ready-closure" && !c.closureReady) return false;
    if (materialsFilter !== "all" && c.materialsChip.label !== materialsFilter) return false;
    return true;
  });

  // Task 3 — most important first: sort by priority bucket, then fall back
  // to the existing updated_at-desc order (already the fetch order) for
  // ties within the same bucket — a stable sort, so this only ever
  // re-groups, never shuffles, cards that share a priority.
  const sorted = [...filtered].sort((a, b) => PRIORITY_RANK[a.priorityBucket] - PRIORITY_RANK[b.priorityBucket]);

  // ── Task 2 — summary cards. Computed from the loaded (capped) batch, not
  // an exhaustive company-wide scan — "Active Job Cards" uses the real
  // count() so that one number stays accurate even beyond the page cap;
  // everything else is a fast in-memory reduce over what's already loaded. ─
  const workersWorkingNow = computed.reduce((n, c) => n + c.laborSummary.workers.filter((w) => w.status === "Active").length, 0);
  const pausedWorkers = computed.reduce((n, c) => n + c.laborSummary.workers.filter((w) => w.status === "Paused").length, 0);
  const totalLaborMinutesToday = computed.reduce((n, c) => n + c.laborSummary.today_minutes, 0);
  const totalLaborAmountToday = computed.reduce((n, c) => n + c.laborSummary.today_amount, 0);
  const readyForClosureCount = computed.filter((c) => c.closureReady).length;
  const hasAnyFilter = Boolean(search || statusFilter !== "all" || teamFilter || materialsFilter !== "all");

  // Task 2 — summary cards double as filter shortcuts. Preserves the
  // search/team/materials filters already in effect, only ever changes
  // `status` — clicking "Paused Workers" while a search is active narrows
  // that same search to paused workers, it doesn't clear it.
  function statusHref(next: StatusFilter | "all"): string {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next !== "all") params.set("status", next);
    if (teamFilter) params.set("team", teamFilter);
    if (materialsFilter !== "all") params.set("materials", materialsFilter);
    const qs = params.toString();
    return qs ? `/maintenance/daily-activity?${qs}` : "/maintenance/daily-activity";
  }

  // ── Task 7/13 — serializable per-card data bag handed to the client
  // DailyActivityBoard for the split-screen list + selected-card panel. All
  // values here are plain strings/numbers/booleans/arrays (already true of
  // every field above), nothing new is computed in this step besides
  // resolving the display-status label/tone that the old per-card JSX used
  // to compute inline.
  const boardCards: DailyActivityCardData[] = sorted.map((c) => {
    const displayStatus = displaySimplifiedStatus(c.wo.status);
    return {
      id: c.wo.id,
      workOrderNumber: c.wo.work_order_number,
      status: c.wo.status,
      displayStatus,
      displayStatusTone: simplifiedStatusTone(displayStatus),
      isUnusualActiveSession: c.isUnusualActiveSession,
      assetLabel: c.assetLabel,
      issue: c.issue,
      createdLabel: formatDate(c.wo.created_at),
      workTeam: c.workTeam,
      assignmentChip: c.assignmentChip,
      materialsChip: c.materialsChip,
      workTimeChip: c.workTimeChip,
      closureChip: c.closureChip,
      closureReasons: c.closureReasons,
      materialAlert: c.materialAlert,
      materialsActionLabel: c.materialsActionLabel,
      materialsActionHref: c.materialsActionHref,
      materialsModalAction: c.materialsModalAction,
      materialsSecondaryAction: c.materialsSecondaryAction,
      materialsTotals: c.materialsTotals,
      priorityBucket: c.priorityBucket,
      priorityLabel: PRIORITY_LABEL[c.priorityBucket],
      nextAction: c.nextAction,
      showAssignWorkers: !c.hasAssignment && canEditAssignment,
      showRequestClosure: c.closureReady && canRequestClosureRole,
      laborSummary: c.laborSummary,
      canManageSessions: canManageSessions && c.wo.status !== "Closed",
      isManager: isManagerRole,
      canViewCosts,
      detailHref: c.detailHref,
    };
  });

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <RealtimeRefresh watch={["job_card.", "work_order.", "materials_request.", "offline_inventory.", "material_ledger."]} />

      {/* Compact Control Board Unit 9C, Task 1: a slim, page-local header
          instead of the shared <PageHeader/> — that component's fixed
          py-4/py-6 + text-2xl/3xl sizing is deliberately roomy for normal
          pages, but this page's whole point is fitting more on one screen.
          Left untouched so every other page keeps its existing header. */}
      <div className="border-b border-[#DDE2EA] bg-white px-4 py-2.5 sm:px-6">
        <PageBreadcrumb items={[{ label: "Daily Activity" }]} />
        <div className="mt-0.5 flex flex-wrap items-start justify-between gap-2 border-l-4 border-[#ED1C24] pl-3">
          <div>
            <h1 className="text-lg font-black leading-tight text-[#111827] sm:text-xl">Daily Activity</h1>
            <p className="mt-0.5 text-xs leading-snug text-[#6B7280] sm:text-sm">
              Monitor active Job Cards, workers, materials, and closure readiness. Open a Job Card for full details.
            </p>
          </div>
          {/* Manager Closed Job Cards Summary and Global Navigation
              Improvements Unit 10E, Task 8/9: already ON Daily Activity, so
              that button is suppressed here — Back/Dashboard/Job Cards only. */}
          <PageNavigationActions showDailyActivity={false} secondaryLinks={[{ label: "Materials Requests", href: "/store/parts-requests" }]} />
        </div>
      </div>

      <div className="space-y-2 p-3 lg:p-4">
        {/* Summary cards (Task 4) — compact horizontal cards, still clickable
            shortcuts into the filters below. */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCardLink href={statusHref("all")} label="Active Job Cards" value={totalActiveCount} icon={Briefcase} tone="blue" active={statusFilter === "all"} />
          <SummaryCardLink href={statusHref("working")} label="Working Now" value={workersWorkingNow} icon={PlayCircle} tone="green" active={statusFilter === "working"} />
          <SummaryCardLink href={statusHref("paused")} label="Paused" value={pausedWorkers} icon={PauseCircle} tone="amber" active={statusFilter === "paused"} />
          <SummaryCard label="Labor Hours Today" value={Math.round((totalLaborMinutesToday / 60) * 100) / 100} icon={Activity} tone="blue" />
          {canViewCosts ? (
            <SummaryCard label="Labor Cost Today" value={`${totalLaborAmountToday.toFixed(3)} KWD`} icon={Activity} tone="gray" />
          ) : null}
          <SummaryCardLink href={statusHref("ready-closure")} label="Ready for Closure" value={readyForClosureCount} icon={CheckCircle2} tone="green" active={statusFilter === "ready-closure"} />
        </div>

        {/* Filters (Task 5) — one tight row: quick status chips, search,
            Work Team/Materials dropdowns, Reset. Wraps on narrow screens
            rather than stacking into separate rows. */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[#DDE2EA] bg-white p-2 shadow-sm">
          <FilterChip href={statusHref("all")} label="All Active" active={statusFilter === "all"} />
          <FilterChip href={statusHref("working")} label="Working Now" active={statusFilter === "working"} />
          <FilterChip href={statusHref("paused")} label="Paused" active={statusFilter === "paused"} />
          <FilterChip href={statusHref("materials-pending")} label="Materials Pending" active={statusFilter === "materials-pending"} urgent />
          <FilterChip href={statusHref("ready-closure")} label="Ready for Closure" active={statusFilter === "ready-closure"} />
          <FilterChip href={statusHref("not-started")} label="Not Started" active={statusFilter === "not-started"} />

          <form className="flex flex-1 flex-wrap items-center gap-1.5">
            <input type="hidden" name="status" value={statusFilter} />
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
              <input
                type="text"
                name="q"
                defaultValue={search}
                placeholder="Search Job Card #, asset, plate, worker, issue…"
                className="focus-ring w-full rounded-md border border-[#E5E7EB] py-1 pl-7 pr-2 text-xs"
              />
            </div>
            <select name="team" defaultValue={teamFilter} className="focus-ring rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">
              <option value="">All Work Teams</option>
              {TEAM_FILTERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select name="materials" defaultValue={materialsFilter} className="focus-ring rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">
              <option value="all">All Materials</option>
              {MATERIALS_FILTERS.filter((m) => m !== "all").map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              type="submit"
              aria-label="Search"
              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md bg-[#ED1C24] px-2 text-white transition hover:bg-[#c8181e]"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <Link
              href="/maintenance/daily-activity"
              className={`inline-flex min-h-7 items-center justify-center rounded-md border px-2 text-xs font-bold transition ${
                hasAnyFilter ? "border-[#E5E7EB] text-[#4B5563] hover:bg-gray-50" : "cursor-default border-transparent text-[#D1D5DB]"
              }`}
              aria-disabled={!hasAnyFilter}
            >
              Reset
            </Link>
          </form>
        </div>

        {/* Task 4/7 — split control board: compact left list, full-detail
            right panel for only the ONE selected Job Card. Client component
            (selection is local UI state, not URL/DB state). */}
        {boardCards.length === 0 ? (
          <EmptyState
            title="No active Job Cards to track."
            message={
              jobCardRows.length === 0
                ? "There are no active Job Cards right now."
                : "No Job Cards match the current filters. Try clearing them."
            }
          />
        ) : (
          <DailyActivityBoard cards={boardCards} canPrint={canPrint} />
        )}

        {totalActiveCount > jobCardRows.length ? (
          <p className="text-center text-xs text-[#9CA3AF]">
            Showing the latest {jobCardRows.length} of {totalActiveCount} active Job Cards. Narrow with search or filters to find others.
          </p>
        ) : null}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
  tone: "green" | "amber" | "red" | "blue" | "gray";
}) {
  const toneClass = {
    green: "bg-[#16A34A]",
    amber: "bg-[#F59E0B]",
    red: "bg-[#ED1C24]",
    blue: "bg-[#2563EB]",
    gray: "bg-[#111827]",
  }[tone];

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5">
      <div className={`inline-flex shrink-0 rounded-md p-1 text-white ${toneClass}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-black uppercase leading-tight text-[#6B7280]">{label}</p>
        <p className="truncate text-sm font-black leading-tight text-[#111827]">{value}</p>
      </div>
    </div>
  );
}

// Task 4 — same compact horizontal visual as SummaryCard, but a real link
// into the matching quick filter, with a highlighted ring when that filter
// is the one active. Uses a blue (not red) ring for "active filter" — Unit
// 9D's "fewer red highlights unless action/attention is needed" — red on
// this page is reserved for materials-pending/blocked states, not for "this
// is the filter you picked."
function SummaryCardLink({
  href,
  label,
  value,
  icon: Icon,
  tone,
  active,
}: {
  href: string;
  label: string;
  value: number | string;
  icon: typeof Activity;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  active: boolean;
}) {
  const toneClass = {
    green: "bg-[#16A34A]",
    amber: "bg-[#F59E0B]",
    red: "bg-[#ED1C24]",
    blue: "bg-[#2563EB]",
    gray: "bg-[#111827]",
  }[tone];

  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 rounded-md border bg-white px-2 py-1.5 transition hover:border-[#2563EB] hover:shadow-sm ${active ? "border-[#2563EB] ring-1 ring-[#93C5FD]" : "border-[#E5E7EB]"}`}
    >
      <div className={`inline-flex shrink-0 rounded-md p-1 text-white ${toneClass}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-black uppercase leading-tight text-[#6B7280]">{label}</p>
        <p className="truncate text-sm font-black leading-tight text-[#111827]">{value}</p>
      </div>
    </Link>
  );
}

// Task 5 — quick filter chip (pill link), highlighted when active. Only the
// "Materials Pending" chip (the one genuinely urgent filter) turns red when
// active — every other chip uses blue, per Unit 9D's "fewer red highlights
// unless action/attention is needed."
function FilterChip({ href, label, active, urgent = false }: { href: string; label: string; active: boolean; urgent?: boolean }) {
  const activeClass = urgent ? "border-[#ED1C24] bg-[#ED1C24] text-white" : "border-[#2563EB] bg-[#2563EB] text-white";
  return (
    <Link
      href={href}
      className={`inline-flex min-h-7 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-bold transition ${
        active ? activeClass : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#2563EB] hover:text-[#2563EB]"
      }`}
    >
      {label}
    </Link>
  );
}
