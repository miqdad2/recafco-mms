import Link from "next/link";
import { Activity, CheckCircle2, PauseCircle, PlayCircle, Search, Users } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts as canViewCostsForContext, isManagerRole } from "@/lib/security/permissions";
import { listWorkerProfiles } from "@/lib/backend/workers/service";
import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import { getWorkerActivitySummaries, type WorkerActivityStatus } from "@/lib/work-orders/work-session-totals";
import { WorkerCard } from "@/components/workers/worker-card";

// Convert Technician Page to Worker Activity Dashboard Unit 9F.
//
// This route used to be an assignment-first "Technician" queue: Needs
// Assignment Job Cards with an inline AssignmentForm per card (Task 1). That
// layout predates Daily Activity (Unit 9) and the worker_profiles-based
// Internal Team model (Unit 7) — assigning workers now happens during Job
// Card creation and on the Job Card detail page, and controlling active work
// happens on Daily Activity. This page is now a read-only worker activity
// and workload monitor: every worker_profiles row, their current status
// (Working Now / Paused / Assigned / Available / Inactive), which Job Card
// they're on if any, and today/month-to-date hours.
//
// AssignmentForm itself, assignment-form-modal.tsx, and the assign server
// action are NOT touched — they're still used by the Job Card quick-view
// assign modal (repair-order-quick-view.tsx / workflow-actions.tsx) and the
// Job Card detail page. This page simply stops importing/rendering them.

type WorkerTypeFilter = "all" | (typeof WORKER_TYPES)[number];
type SkillFilter = "all" | (typeof SKILL_CATEGORIES)[number];
type StatusFilter = "all" | "working" | "paused" | "assigned" | "available";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "working", label: "Working Now" },
  { value: "paused", label: "Paused" },
  { value: "assigned", label: "Assigned" },
  { value: "available", label: "Available" },
];

function statusToFilterValue(status: WorkerActivityStatus | "Inactive"): StatusFilter | "inactive" {
  if (status === "Working Now") return "working";
  if (status === "Paused") return "paused";
  if (status === "Assigned") return "assigned";
  if (status === "Inactive") return "inactive";
  return "available";
}

// Worker Activity Manager Hours and Payment Detail Unit 10C, Task 10: a
// default priority sort — Working Now first, then Paused, then Assigned/Not
// Started, then Available, then Inactive last. Stable sort, so ties keep
// listWorkerProfiles()'s existing is_active-desc/name-asc order.
const STATUS_SORT_RANK: Record<WorkerActivityStatus | "Inactive", number> = {
  "Working Now": 0,
  Paused: 1,
  Assigned: 2,
  Available: 3,
  Inactive: 4,
};

type SearchParamsShape = {
  q?: string;
  type?: string;
  status?: string;
  skill?: string;
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const context = await requirePermission("work_orders.assign");
  const sp = (await searchParams) ?? {};
  const search = (sp.q ?? "").trim().slice(0, 80);
  const typeFilter: WorkerTypeFilter = WORKER_TYPES.includes((sp.type ?? "all") as (typeof WORKER_TYPES)[number])
    ? (sp.type as WorkerTypeFilter)
    : "all";
  const skillFilter: SkillFilter = SKILL_CATEGORIES.includes((sp.skill ?? "all") as (typeof SKILL_CATEGORIES)[number])
    ? (sp.skill as SkillFilter)
    : "all";
  const statusFilter: StatusFilter = STATUS_FILTERS.some((s) => s.value === sp.status)
    ? (sp.status as StatusFilter)
    : "all";

  // Task 9/10 — only Manager/Super Admin get a link into Worker Profiles
  // (view/edit master data) from this page. Data Entry (which also holds
  // work_orders.assign, the permission gating this whole page) never sees
  // it here. Worker Rate Visibility and Data Entry Lockdown Unit 10F.4: the
  // destination page (/admin/worker-profiles) now enforces this same
  // restriction itself (both display and server-side), so this is no
  // longer just a link-hiding convenience — reused from
  // lib/security/permissions.ts instead of a locally-duplicated check.
  const canManageWorkerProfiles = isManagerRole(context);
  const canViewCosts = canViewCostsForContext(context);
  // Worker Activity Manager Hours and Payment Detail Unit 10C, Task 2/7:
  // gates the Worker Activity Detail modal's "Correct Session" action —
  // same manager-role check the Job Card detail page's own Work Time
  // Tracking section already uses for WorkerSessionRow/SessionHistoryModal.
  // Data Entry can still open the detail modal (read-only); this only
  // controls whether the correction button renders inside it.
  const isManager = isManagerRole(context);

  const workers = await listWorkerProfiles();
  const activityMap = await getWorkerActivitySummaries(prisma, workers.map((w) => w.id));

  const emptySummary = {
    status: "Available" as WorkerActivityStatus,
    current_job_card: null,
    active_session_started_at: null,
    today_minutes: 0,
    today_hours: 0,
    today_amount: 0,
    month_minutes: 0,
    month_hours: 0,
    month_amount: 0,
    active_assignment_count: 0,
  };

  // Task 5/7 — combine profile + activity into one view model. Inactive
  // overrides whatever activity status would otherwise apply (Task 7's own
  // rule: "If worker profile inactive: Inactive").
  const combined = workers.map((w) => {
    const activity = activityMap.get(w.id) ?? emptySummary;
    const status: WorkerActivityStatus | "Inactive" = !w.is_active ? "Inactive" : activity.status;
    return { ...w, ...activity, status };
  });

  // Task 4 — filters applied in memory after the bulk fetch above, the same
  // "quick filters over an already-loaded batch" convention the Daily
  // Activity page uses for its own derived (non-DB-column) signals. Search
  // spans both worker_profiles fields (name/phone) and the computed current
  // Job Card (number/asset), which live in two different data sources, so
  // it can't be a single Prisma WHERE clause.
  const searchLower = search.toLowerCase();
  const filtered = combined.filter((w) => {
    if (typeFilter !== "all" && w.worker_type !== typeFilter) return false;
    if (skillFilter !== "all" && w.skill_category !== skillFilter) return false;
    if (statusFilter !== "all" && statusToFilterValue(w.status) !== statusFilter) return false;
    if (searchLower) {
      const haystack = [
        w.name,
        w.phone ?? "",
        w.current_job_card?.work_order_number ?? "",
        w.current_job_card?.asset_label ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  });

  // Task 10 — Working Now first, then Paused, then Assigned/Not Started,
  // then Available, then Inactive. Array#sort is stable, so ties keep the
  // filtered order above.
  filtered.sort((a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status]);

  // Task 3 — summary cards, computed over every active worker (Inactive
  // workers never contribute to Working Now/Paused/Available/hours).
  const activeWorkers = combined.filter((w) => w.is_active);
  const totalWorkers = activeWorkers.length;
  const workingNowCount = activeWorkers.filter((w) => w.status === "Working Now").length;
  const pausedCount = activeWorkers.filter((w) => w.status === "Paused").length;
  const availableCount = activeWorkers.filter((w) => w.status === "Available").length;
  const totalHoursTodaySum = Math.round(activeWorkers.reduce((n, w) => n + w.today_minutes, 0) / 60 * 100) / 100;
  const totalCostTodaySum = Math.round(activeWorkers.reduce((n, w) => n + w.today_amount, 0) * 1000) / 1000;

  const hasAnyFilter = Boolean(search || typeFilter !== "all" || skillFilter !== "all" || statusFilter !== "all");

  function buildHref(next: Partial<{ q: string; type: string; status: string; skill: string }>): string {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const type = next.type ?? typeFilter;
    const status = next.status ?? statusFilter;
    const skill = next.skill ?? skillFilter;
    if (q) params.set("q", q);
    if (type !== "all") params.set("type", type);
    if (status !== "all") params.set("status", status);
    if (skill !== "all") params.set("skill", skill);
    const qs = params.toString();
    return qs ? `/maintenance/assignments?${qs}` : "/maintenance/assignments";
  }

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      {/* Task 13 — worker profile edits, Job Card/assignment changes, and
          work session start/pause/stop/manual-entry all refresh this page.
          Materials events are irrelevant here, so not watched. */}
      <RealtimeRefresh watch={["worker_profile.", "job_card.", "work_order."]} />

      <div className="border-b border-[#DDE2EA] bg-white px-4 py-2.5 sm:px-6">
        <PageBreadcrumb items={[{ label: "Worker Activity" }]} />
        <div className="mt-0.5 flex flex-wrap items-start justify-between gap-2 border-l-4 border-[#ED1C24] pl-3">
          <div>
            <h1 className="text-lg font-black leading-tight text-[#111827] sm:text-xl">Worker Activity</h1>
            <p className="mt-0.5 text-xs leading-snug text-[#6B7280] sm:text-sm">
              Monitor maintenance worker status, current Job Cards, and hours. Assign workers from a Job Card.
            </p>
          </div>
          <PageNavigationActions />
        </div>
      </div>

      <div className="space-y-3 p-3 lg:p-4">
        {/* Task 3 — summary cards; Working Now/Paused/Available double as
            quick filter shortcuts into the same filter row below (same
            "click a summary card to filter" convention Daily Activity and
            the Data Entry dashboard already use). */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryCardLink href={buildHref({ status: "all" })} label="Total Workers" value={totalWorkers} icon={Users} tone="gray" active={statusFilter === "all"} />
          <SummaryCardLink href={buildHref({ status: "working" })} label="Working Now" value={workingNowCount} icon={PlayCircle} tone="green" active={statusFilter === "working"} />
          <SummaryCardLink href={buildHref({ status: "paused" })} label="Paused" value={pausedCount} icon={PauseCircle} tone="amber" active={statusFilter === "paused"} />
          <SummaryCardLink href={buildHref({ status: "available" })} label="Available" value={availableCount} icon={CheckCircle2} tone="blue" active={statusFilter === "available"} />
          <SummaryCard label="Total Hours Today" value={totalHoursTodaySum} icon={Activity} tone="blue" />
          {canViewCosts ? <SummaryCard label="Labor Cost Today" value={`${totalCostTodaySum.toFixed(3)} KWD`} icon={Activity} tone="gray" /> : null}
        </div>

        {/* Task 4 — filters */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[#DDE2EA] bg-white p-2 shadow-sm">
          <form className="flex flex-1 flex-wrap items-center gap-1.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
              <input
                type="text"
                name="q"
                defaultValue={search}
                placeholder="Search worker, phone, Job Card #, asset…"
                className="focus-ring w-full rounded-md border border-[#E5E7EB] py-1 pl-7 pr-2 text-xs"
              />
            </div>
            <select name="type" defaultValue={typeFilter} className="focus-ring rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">
              <option value="all">All Worker Types</option>
              {WORKER_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select name="skill" defaultValue={skillFilter} className="focus-ring rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">
              <option value="all">All Divisions</option>
              {SKILL_CATEGORIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select name="status" defaultValue={statusFilter} className="focus-ring rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
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
              href="/maintenance/assignments"
              className={`inline-flex min-h-7 items-center justify-center rounded-md border px-2 text-xs font-bold transition ${
                hasAnyFilter ? "border-[#E5E7EB] text-[#4B5563] hover:bg-gray-50" : "cursor-default border-transparent text-[#D1D5DB]"
              }`}
              aria-disabled={!hasAnyFilter}
            >
              Reset
            </Link>
          </form>
        </div>

        {/* Task 5/6 — worker cards */}
        {filtered.length === 0 ? (
          <EmptyState
            title="No workers to show."
            message={workers.length === 0 ? "No worker profiles exist yet." : "No workers match the current filters. Try clearing them."}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((w) => (
              <WorkerCard key={w.id} worker={w} canViewCosts={canViewCosts} canManageWorkerProfiles={canManageWorkerProfiles} isManager={isManager} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, tone }: {
  label: string; value: number | string; icon: typeof Users; tone: "green" | "amber" | "blue" | "gray";
}) {
  const toneClass = { green: "bg-[#16A34A]", amber: "bg-[#F59E0B]", blue: "bg-[#2563EB]", gray: "bg-[#6B7280]" }[tone];
  return (
    <div className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-2">
      <span className={`inline-flex shrink-0 rounded-md p-1.5 text-white ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[9px] font-black uppercase leading-tight text-[#6B7280]">{label}</span>
        <span className="block text-base font-black leading-tight text-[#111827]">{value}</span>
      </span>
    </div>
  );
}

function SummaryCardLink({ href, label, value, icon: Icon, tone, active }: {
  href: string; label: string; value: number | string; icon: typeof Users; tone: "green" | "amber" | "blue" | "gray"; active: boolean;
}) {
  const toneClass = { green: "bg-[#16A34A]", amber: "bg-[#F59E0B]", blue: "bg-[#2563EB]", gray: "bg-[#6B7280]" }[tone];
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md border bg-white px-2.5 py-2 transition hover:border-[#2563EB] hover:shadow-md ${active ? "border-[#2563EB] ring-1 ring-[#93C5FD]" : "border-[#E5E7EB]"}`}
    >
      <span className={`inline-flex shrink-0 rounded-md p-1.5 text-white ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[9px] font-black uppercase leading-tight text-[#6B7280]">{label}</span>
        <span className="block text-base font-black leading-tight text-[#111827]">{value}</span>
      </span>
    </Link>
  );
}

// MiniChip, CombinedWorker, and WorkerCard itself moved to
// components/workers/worker-card.tsx (Unit 10C) — a plain server component
// can't hold the client state "View Details" needs.
