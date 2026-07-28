import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Gauge,
  Package,
  PlusCircle,
  ShoppingCart,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
  materialsRequestBadgeLabel,
  OPEN_PR_STATUSES,
} from "@/lib/display/parts-request-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getReviewedWorkOrderIds } from "@/lib/work-orders/review-status";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import {
  displaySimplifiedStatus,
  simplifiedStatusTone,
  getPendingCorrectionWorkOrderIds,
  OPEN_JOB_CARD_STATUSES,
  ACTIVE_JOB_CARD_STATUSES,
  NEEDS_UPDATE_LABEL,
  NEEDS_UPDATE_TONE,
} from "@/lib/work-orders/simplified-status";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";
import { JobCardOpenedModal } from "@/components/work-orders/job-card-opened-modal";
import { JobCardSubmittedModal } from "@/components/work-orders/job-card-submitted-modal";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import { getMaterialBalancesForItems } from "@/lib/store/offline-inventory-data";
import { StoreSendMaterialsPopup } from "@/components/store/store-send-materials-popup";

// ── Types ─────────────────────────────────────────────────────────────
type WoRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  updated_at: string;
  asset_name?: string | null;
  // Raw status of the most recently created linked Materials Request, if
  // any — null means no Materials Request exists for this Job Card yet.
  materials_request_status?: string | null;
  has_pending_correction: boolean;
};
// Technician Dashboard and My Jobs Workflow Alignment Unit Task 5: a
// technician-specific row — links to their own /technician/jobs/{id} page
// (never the generic quick-view), shows the problem/asset/plate/materials
// summary Task 5 asks for, and carries assigned_at for the "Assigned Date"
// column.
type TechJobRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  assigned_at: string;
  operator_complaint: string | null;
  asset_name: string | null;
  plate_number: string | null;
  materials_request_status: string | null;
  has_pending_correction: boolean;
};
type NuJobCardRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  created_at: string;
  asset_name: string | null;
  issue_summary: string | null;
  materials_request_status: string | null;
  has_pending_correction: boolean;
};
type MgActionRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  description_of_work: string | null;
  asset_name: string | null;
  materials_request_status?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────
async function safeNum(query: Promise<number>): Promise<number> {
  try { return await query; } catch { return 0; }
}

// Shared by the Engineer/Technician/Super Admin "recent list" rows below —
// each is a small (take: 5) list rendered via WoRow/TechJobRow, which must
// show the secondary "Needs Update" badge the same way every other surface
// on this dashboard does (Task 5/6 — no raw backend status wording).
async function withPendingCorrection<T extends { id: string }>(
  rows: T[]
): Promise<(T & { has_pending_correction: boolean })[]> {
  const ids = await getPendingCorrectionWorkOrderIds(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, has_pending_correction: ids.has(r.id) }));
}


function ageLabel(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
}

function mgActionMeta(status: string): { label: string; style: string } {
  if (status === "Under Review") {
    return {
      label: "Approve",
      style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700",
    };
  }
  if (status === "In Progress") {
    return {
      label: "Close",
      style: "border-[#16A34A] bg-[#16A34A] text-white hover:bg-green-700",
    };
  }
  // Legacy pre-Unit3 statuses — defensive fallback only.
  if (["Submitted", "Pending Approval"].includes(status)) {
    return {
      label: "Approve",
      style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700",
    };
  }
  if (["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) {
    return {
      label: "Close",
      style: "border-[#16A34A] bg-[#16A34A] text-white hover:bg-green-700",
    };
  }
  return {
    label: "View",
    style: "border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]",
  };
}

// ── Shared components ─────────────────────────────────────────────────
function QuickAction({ label, subtitle, href, icon: Icon, iconBg, iconColor }: {
  label: string; subtitle?: string; href: string; icon: LucideIcon; iconBg: string; iconColor: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-[#111827]">{label}</span>
        {subtitle && (
          <span className="block truncate text-[11px] font-medium text-[#9CA3AF]">{subtitle}</span>
        )}
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#D1D5DB] transition group-hover:translate-x-0.5 group-hover:text-[#6B7280]" aria-hidden="true" />
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">{children}</p>;
}

// Data Entry Dashboard and Job Cards UX Simplification: once status badges
// started showing the real status name (Task 5) instead of a vague bucket
// word, a Job Card already at "Materials Issued"/"Waiting Materials"/
// "Partially Issued" would show that exact same text twice — once as the
// main status badge, once as the materials-request badge. Shared by every
// row component below: the materials badge is only additional information
// when the Job Card's own status doesn't already say it.
const JOB_CARD_STATUS_ALREADY_SHOWS_MATERIALS = ["Waiting Materials", "Partially Issued", "Materials Issued"];

function WoRow({ row }: { row: WoRow }) {
  const showMaterialsBadge =
    row.materials_request_status && !JOB_CARD_STATUS_ALREADY_SHOWS_MATERIALS.includes(row.status);
  return (
    <Link
      href={`?preview=${row.id}`}
      className="group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-[#F8FAFC]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#111827] group-hover:text-[#ED1C24]">
          {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
        </p>
        {row.asset_name && <p className="truncate text-xs text-[#6B7280]">{row.asset_name}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {(() => {
          const simplified = displaySimplifiedStatus(row.status);
          return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
        })()}
        {row.has_pending_correction && (
          <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
        )}
        {showMaterialsBadge && (
          <StatusBadge
            label={materialsRequestBadgeLabel(row.materials_request_status!)}
            tone={partsRequestStatusTone(row.materials_request_status!)}
          />
        )}
        <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.updated_at)}</span>
        <span className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition group-hover:border-[#ED1C24] group-hover:text-[#ED1C24]">
          View
        </span>
      </div>
    </Link>
  );
}

// Technician Dashboard and My Jobs Workflow Alignment Unit Task 5: collapses
// the real 5-value Materials Request status down to the 4 plain states a
// technician actually needs — never exposes "Parts" wording, never the raw
// Waiting Stock/Partially Issued/Approved status words.
function technicianMaterialsLabel(status: string | null): string {
  if (!status) return "No Materials Request";
  if (status === "Issued") return "Materials sent";
  if (status === "Waiting Stock" || status === "Partially Issued") return "Store follow-up";
  return "Materials requested"; // Requested or Approved — still pending, not yet in hand
}

function technicianJobAction(status: string): { label: string; href: (id: string) => string } {
  if (status === "Assigned") return { label: "Start Work", href: (id) => `/technician/jobs/${id}` };
  if (status === "In Progress") return { label: "Update / Close", href: (id) => `/technician/jobs/${id}` };
  return { label: "View", href: (id) => `/technician/jobs/${id}` };
}

function TechJobRow({ row }: { row: TechJobRow }) {
  const action = technicianJobAction(row.status);
  return (
    <Link
      href={`/technician/jobs/${row.id}`}
      className="group flex items-start gap-3 px-4 py-2.5 transition hover:bg-[#F8FAFC]"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold text-[#111827] group-hover:text-[#ED1C24]">
          {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
          {row.asset_name && (
            <span className="ml-2 text-xs font-normal text-[#6B7280]">
              · {row.asset_name}{row.plate_number ? ` - Plate ${row.plate_number}` : ""}
            </span>
          )}
        </p>
        {row.operator_complaint && <p className="truncate text-xs text-[#4B5563]">{row.operator_complaint}</p>}
        <p className="text-xs font-semibold text-[#4B5563]">{technicianMaterialsLabel(row.materials_request_status)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {(() => {
          const simplified = displaySimplifiedStatus(row.status);
          return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
        })()}
        {row.has_pending_correction && (
          <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
        )}
        <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.assigned_at)}</span>
        <span className="shrink-0 rounded bg-[#ED1C24] px-2 py-1 text-xs font-bold text-white transition group-hover:bg-[#c8181e]">
          {action.label}
        </span>
      </div>
    </Link>
  );
}

function NuJobCardRow({ row }: { row: NuJobCardRow }) {
  const subtitle = [row.asset_name, row.issue_summary].filter(Boolean).join(" · ");
  const showMaterialsBadge =
    row.materials_request_status && !JOB_CARD_STATUS_ALREADY_SHOWS_MATERIALS.includes(row.status);
  return (
    <Link
      href={`?preview=${row.id}`}
      className="group flex items-center gap-3 px-4 py-3 transition hover:bg-[#F8FAFC]"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold text-[#111827] group-hover:text-[#ED1C24]">
          {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
        </p>
        {subtitle && <p className="truncate text-xs text-[#6B7280]">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
        {(() => {
          const simplified = displaySimplifiedStatus(row.status);
          return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
        })()}
        {row.has_pending_correction && (
          <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
        )}
        {showMaterialsBadge && (
          <StatusBadge
            label={materialsRequestBadgeLabel(row.materials_request_status!)}
            tone={partsRequestStatusTone(row.materials_request_status!)}
          />
        )}
        <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.created_at)}</span>
        <span className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition group-hover:border-[#ED1C24] group-hover:text-[#ED1C24]">
          View
        </span>
      </div>
    </Link>
  );
}

// Manager Dashboard Approval Queue Fix Task 3: Manager's three Needs Your
// Action queues (Waiting Manager Approval / Materials Requests / Ready to
// Assign) each need a specific action label, not whatever mgActionMeta would
// derive from the raw status — an explicit `action` override lets this same
// row component serve all three plus Engineer's existing "Job Cards Needing
// Action" list (which still uses the mgActionMeta default).
function ManagerActionRow({
  row,
  action: actionOverride,
}: {
  row: MgActionRow;
  action?: { label: string; style: string };
}) {
  const action = actionOverride ?? mgActionMeta(row.status);
  // Close requires full work-order page; Approve/Assign/Review/View open the
  // quick-view modal via ?preview param, where the real gated action lives.
  const actionHref =
    action.label === "Close"
      ? `/maintenance/work-orders/${row.id}`
      : `?preview=${row.id}`;
  const showMaterialsBadge =
    row.materials_request_status && !JOB_CARD_STATUS_ALREADY_SHOWS_MATERIALS.includes(row.status);
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link
          href={`?preview=${row.id}`}
          className="block"
        >
          <p className="text-sm font-semibold text-[#111827] hover:text-[#ED1C24]">
            {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
            {row.asset_name && (
              <span className="ml-2 text-xs font-normal text-[#6B7280]">· {row.asset_name}</span>
            )}
          </p>
          {row.description_of_work && (
            <p className="truncate text-xs text-[#4B5563]">{row.description_of_work}</p>
          )}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showMaterialsBadge && (
          <StatusBadge
            label={materialsRequestBadgeLabel(row.materials_request_status!)}
            tone={partsRequestStatusTone(row.materials_request_status!)}
          />
        )}
        {(() => {
          const simplified = displaySimplifiedStatus(row.status);
          return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
        })()}
        <span className="hidden text-xs text-[#9CA3AF] sm:block">{ageLabel(row.created_at)}</span>
        <Link
          href={actionHref}
          className={`shrink-0 rounded border px-2 py-1 text-xs font-bold transition ${action.style}`}
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}


function ActivityList({ title, viewAllHref, empty, emptyState, children }: {
  title: string; viewAllHref: string; empty: boolean; emptyState?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{title}</SectionLabel>
        <Link href={viewAllHref} className="text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">View all</Link>
      </div>
      <div className="divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
        {empty
          ? (emptyState ?? <p className="py-8 text-center text-sm text-[#4B5563]">Nothing here yet.</p>)
          : children
        }
      </div>
    </section>
  );
}

// ── KPI row helper ────────────────────────────────────────────────────
type KpiCard = {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "red" | "amber" | "green" | "blue" | "gray";
  href: string;
  detail?: string;
};

function KpiRow({ cards, cols }: { cards: KpiCard[]; cols: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${cols}`}>
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="block">
          <StatCard label={c.label} value={c.value} icon={c.icon} tone={c.tone} detail={c.detail} compact />
        </Link>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
type PageProps = { searchParams?: Promise<{ preview?: string; sendPreview?: string; success?: string }> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const context = await requireUser();
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const roleSlug = context.role?.slug ?? "";

  const isNormalUser    = roleSlug === "maintenance_data_entry";
  const isManager       = roleSlug === "maintenance_manager";
  const isEngineer      = roleSlug === "maintenance_engineer";
  const isTechnician    = roleSlug === "technician";
  const isStoreKeeper   = roleSlug === "store_keeper";
  const isViewerAuditor = roleSlug === "viewer_auditor";
  const isSuperAdmin    = roleSlug === "super_admin";

  // Simplified Job Card Approval Workflow Unit Task 8: "Closed recently"
  // KPI cards (Data Entry, Manager) and the technician queue below all mean
  // the same 14-day window — computed once, shared everywhere it's used.
  const recentlyClosedSince = new Date();
  recentlyClosedSince.setDate(recentlyClosedSince.getDate() - 14);

  // Shared by Manager's and Store Keeper's "Offline Inventory Control" KPI.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // ── Normal User data ─────────────────────────────────────────────
  const [nuQueue, nuRecentRows] = isNormalUser ? await Promise.all([
    Promise.all([
      prisma.work_orders.findMany({
        where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Under Review" }] },
        select: { id: true },
      }),
      prisma.work_orders.findMany({
        where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: OPEN_JOB_CARD_STATUSES } }] },
        select: { id: true },
      }),
    ]).then(async ([underReviewRows, openRows]) => {
      // Job Card Status Simplification Task: correctionCount is still
      // computed (drives the "needs your correction" alert below and the
      // per-row secondary "Needs Update" badge) but no longer subtracted
      // from Submitted/Approved/Active — those are now plain status counts,
      // same as draft/closed. Both id sets are checked together since a
      // pending correction can outlive "Under Review" once materials
      // already progressed (Task 1/10, prior phase).
      const pendingCorrectionIds = await getPendingCorrectionWorkOrderIds([
        ...underReviewRows.map((r) => r.id),
        ...openRows.map((r) => r.id),
      ]);
      const [draftCount, approvedCount, activeCount, closedRecentCount, materialsAwaitingReceiptCount] = await Promise.all([
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Created" }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Approved" }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Closed", updated_at: { gte: recentlyClosedSince } }] } })),
        // Manager Approval Success Popup and Materials Awaiting Receipt Flow
        // Task 6: same "Materials Awaiting Receipt" definition as Manager's
        // dashboard card and the Materials Requests page — approved, not yet
        // received, and the linked Job Card (mine) is Open.
        safeNum(prisma.parts_requests.count({
          where: {
            status: { in: OPEN_PR_STATUSES },
            work_orders: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: OPEN_JOB_CARD_STATUSES } }] },
          },
        })),
      ]);
      return {
        draftCount,
        submittedCount: underReviewRows.length,
        approvedCount,
        activeCount,
        correctionCount: pendingCorrectionIds.size,
        closedRecentCount,
        materialsAwaitingReceiptCount,
      };
    }),
    prisma.work_orders
      .findMany({
        where: { AND: [{ deleted_at: null }, visibilityFilter] },
        select: {
          id: true,
          work_order_number: true,
          status: true,
          created_at: true,
          operator_complaint: true,
          description_of_work: true,
          assets: { select: { asset_name: true } },
          parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
        },
        orderBy: { updated_at: "desc" },
        take: 5,
      })
      .catch(() => []),
  ]) : [null, []];

  const nuRecent: NuJobCardRow[] = nuRecentRows.length
    ? await (async () => {
        // Checked across every row shown here (not just "Under Review") so a
        // Job Card whose status has already moved into the Open bucket while
        // a correction is still pending doesn't silently lose its Correction
        // Requested badge — only 5 rows, cheap to check unconditionally.
        const pendingCorrectionIds = await getPendingCorrectionWorkOrderIds(nuRecentRows.map((r) => r.id));
        return nuRecentRows.map((r) => ({
          id:                       r.id,
          work_order_number:        r.work_order_number,
          status:                   r.status,
          created_at:               r.created_at.toISOString(),
          asset_name:               r.assets?.asset_name ?? null,
          issue_summary:            r.operator_complaint ?? r.description_of_work ?? null,
          materials_request_status: r.parts_requests[0]?.status ?? null,
          has_pending_correction:   pendingCorrectionIds.has(r.id),
        }));
      })()
    : [];

  // ── Manager data ─────────────────────────────────────────────────
  // Manager Dashboard Approval Queue Fix: Job Card status stays "Under
  // Review" through both the Engineer-review and Manager-approval steps (no
  // new status added), so a single "Under Review" count/queue can't tell
  // Manager which of those Job Cards are actually ready for their decision —
  // that split is derived here from the work_order.review audit entry
  // (lib/work-orders/review-status.ts), the same mechanism the Engineer
  // dashboard and Job Cards list already use.
  const mgBase = { AND: [{ deleted_at: null }, visibilityFilter] };

  // Simplified Job Card Approval Workflow Unit Task 4/8: no more Engineer-
  // review split, no more separate Materials Request approval queue (it's
  // auto-approved alongside the Job Card by approveJobCardAndMaterials) —
  // one queue (Under Review, full detail) plus three plain counts.
  const mgData = isManager
    ? await Promise.all([
        prisma.work_orders.findMany({
          where: { AND: [mgBase, { status: "Under Review" }] },
          select: {
            id: true,
            work_order_number: true,
            status: true,
            updated_at: true,
            created_at: true,
            description_of_work: true,
            assets: { select: { asset_name: true } },
            parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
          },
          orderBy: { updated_at: "asc" },
        }),
        prisma.work_orders.findMany({
          where: { AND: [mgBase, { status: { in: OPEN_JOB_CARD_STATUSES } }] },
          select: { id: true },
        }),
        safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: "Closed", updated_at: { gte: recentlyClosedSince } }] } })),
        // Manager Approval Success Popup and Materials Awaiting Receipt Flow
        // Task 6: "Materials Awaiting Receipt" — not yet received AND its
        // Job Card is actually Open, matching the same materialsReceiptStatus
        // definition the Materials Requests page uses, not just "requested".
        safeNum(prisma.parts_requests.count({
          where: {
            status: { in: OPEN_PR_STATUSES },
            work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } },
          },
        })),
        // Job Card Status Simplification Task 6: "Open" split into
        // "Approved" (nothing has moved yet) and "Active" (materials
        // moving, assigned, or work started).
        safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: "Approved" }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] } })),
      ])
    : null;

  const mgUnderReviewAll = mgData?.[0] ?? [];
  const mgOpenAll = mgData?.[1] ?? [];
  // Broadened the same way as the Job Cards list and Data Entry dashboard
  // (Task 1/8/10): a pending correction can outlive "Under Review" once
  // materials progress, so both id sets are checked together.
  const mgPendingCorrectionIds = isManager
    ? await getPendingCorrectionWorkOrderIds([...mgUnderReviewAll.map((r) => r.id), ...mgOpenAll.map((r) => r.id)])
    : new Set<string>();
  const mgSubmittedRows: MgActionRow[] = mgUnderReviewAll
    .filter((r) => !mgPendingCorrectionIds.has(r.id))
    .map((r) => ({
      id:                        r.id,
      work_order_number:         r.work_order_number,
      status:                    r.status,
      updated_at:                r.updated_at.toISOString(),
      created_at:                r.created_at.toISOString(),
      description_of_work:       r.description_of_work ?? null,
      asset_name:                r.assets?.asset_name ?? null,
      materials_request_status:  r.parts_requests[0]?.status ?? null,
    }));
  const mgCorrectionCount = mgPendingCorrectionIds.size;
  const mgClosedRecentCount = mgData?.[2] ?? 0;
  const mgOpenMaterialsRequestsCount = mgData?.[3] ?? 0;
  const mgApprovedCount = mgData?.[4] ?? 0;
  const mgActiveCount = mgData?.[5] ?? 0;

  // Manager Dashboard Clarity Task 8: "Needs Your Action" also covers Open
  // Job Cards actually ready for the Manager to close (In Progress) — a
  // pending correction on one of these means it's actually waiting on Data
  // Entry, not Manager, so it's excluded here the same way Submitted rows are.
  const mgInProgressAll = isManager
    ? await prisma.work_orders.findMany({
        where: { AND: [mgBase, { status: "In Progress" }] },
        select: {
          id: true,
          work_order_number: true,
          status: true,
          updated_at: true,
          created_at: true,
          description_of_work: true,
          assets: { select: { asset_name: true } },
          parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
        },
        orderBy: { updated_at: "asc" },
      })
    : [];
  const mgInProgressCorrectionIds = isManager ? await getPendingCorrectionWorkOrderIds(mgInProgressAll.map((r) => r.id)) : new Set<string>();
  const mgCloseRows: MgActionRow[] = mgInProgressAll
    .filter((r) => !mgInProgressCorrectionIds.has(r.id))
    .map((r) => ({
      id:                        r.id,
      work_order_number:         r.work_order_number,
      status:                    r.status,
      updated_at:                r.updated_at.toISOString(),
      created_at:                r.created_at.toISOString(),
      description_of_work:       r.description_of_work ?? null,
      asset_name:                r.assets?.asset_name ?? null,
      materials_request_status:  r.parts_requests[0]?.status ?? null,
    }));
  const mgActionRows: MgActionRow[] = [...mgSubmittedRows, ...mgCloseRows];

  // Shared by Manager's and Store Keeper's "Offline Inventory Control" KPI.
  const offlineMovementsToday = (isManager || isStoreKeeper)
    ? await safeNum(prisma.offline_inventory_movements.count({
        where: { deleted_at: null, movement_date: { gte: todayStart } },
      }))
    : 0;

  // ── Maintenance Engineer data ─────────────────────────────────────
  // Simplified Job Card Approval Workflow Unit Task 8: Engineer is not one
  // of the three active operational roles (Data Entry, Supervisor/Manager,
  // Super Admin) any more — no review queue, no action buttons, just a
  // minimal read-only list of visible Job Cards for informational context.
  const engBase = { AND: [{ deleted_at: null }, visibilityFilter] };
  const [engQueue, engRecent] = isEngineer
    ? await Promise.all([
        Promise.all([
          safeNum(prisma.work_orders.count({ where: { AND: [engBase, { status: { notIn: ["Closed"] } }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [engBase, { status: "Closed", updated_at: { gte: recentlyClosedSince } }] } })),
        ]),
        prisma.work_orders
          .findMany({
            where: { AND: [engBase] },
            select: {
              id: true,
              work_order_number: true,
              status: true,
              updated_at: true,
              assets: { select: { asset_name: true } },
              parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
            },
            orderBy: { updated_at: "desc" },
            take: 5,
          })
          .then((rows) => rows.map((r) => ({
            id: r.id,
            work_order_number: r.work_order_number,
            status: r.status,
            updated_at: r.updated_at.toISOString(),
            asset_name: r.assets?.asset_name ?? null,
            materials_request_status: r.parts_requests[0]?.status ?? null,
          })))
          .then(withPendingCorrection)
          .catch((): WoRow[] => []),
      ])
    : [null, [] as WoRow[]];

  // ── Viewer / Auditor data ─────────────────────────────────────────
  // Strictly read-only — no queue/action lists, just summary counts and
  // navigation into the real (permission-gated) read-only pages.
  const vaCount = isViewerAuditor
    ? await Promise.all([
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Closed" }] } })),
        safeNum(prisma.assets.count({ where: { deleted_at: null } })),
      ])
    : null;

  // ── Technician data ──────────────────────────────────────────────
  // Technician Dashboard and My Jobs Workflow Alignment Unit Task 4: "Closed
  // Recently" is now time-bounded (last 14 days) rather than an all-time
  // total — a technician who has closed hundreds of jobs over months
  // shouldn't see that whole history under a card labeled "recently".
  const [techQueue, techJobs] = isTechnician ? await Promise.all([
    Promise.all([
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "Assigned" } } })),
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "In Progress" } } })),
      // Under the simplified model, an assigned Job Card can only ever be
      // Assigned/In Progress/Closed — materials are always resolved BEFORE
      // assignment now, so there is no "assigned but waiting on materials"
      // stage any more (unlike the old model). Closed replaces that slot.
      safeNum(prisma.work_order_assignments.count({
        where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "Closed", updated_at: { gte: recentlyClosedSince } } },
      })),
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId } })),
    ]),
    prisma.work_order_assignments
      .findMany({
        where: { technician_id: context.userId, work_orders: { deleted_at: null } },
        select: {
          work_order_id: true,
          assigned_at: true,
          work_orders: {
            select: {
              work_order_number: true,
              status: true,
              updated_at: true,
              operator_complaint: true,
              assets: { select: { asset_name: true, plate_number: true } },
              parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
            },
          },
        },
        orderBy: { assigned_at: "desc" },
        take: 5,
      })
      .then((rows) => rows.map((r) => ({
        id: r.work_order_id,
        work_order_number: r.work_orders.work_order_number,
        status: r.work_orders.status,
        assigned_at: r.assigned_at.toISOString(),
        operator_complaint: r.work_orders.operator_complaint,
        asset_name: r.work_orders.assets?.asset_name ?? null,
        plate_number: r.work_orders.assets?.plate_number ?? null,
        materials_request_status: r.work_orders.parts_requests[0]?.status ?? null,
      })))
      .then(withPendingCorrection)
      .catch((): TechJobRow[] => []),
  ]) : [null, [] as TechJobRow[]];

  // ── Store Keeper data ────────────────────────────────────────────
  // Simplified Job Card Approval Workflow Unit Task 6/8: Store is retired
  // from the active Job Card workflow — its dashboard shrinks to a plain
  // Offline Inventory Control summary, no Materials Requests/Send Materials
  // KPIs or queues (those routes still exist and stay permission-gated, just
  // unlinked from this dashboard and the sidebar).
  const skSummary = isStoreKeeper
    ? await Promise.all([
        safeNum(prisma.offline_inventory_movements.count({
          where: { deleted_at: null, movement_type: "RECEIVED", movement_date: { gte: todayStart } },
        })),
        safeNum(prisma.offline_inventory_movements.count({
          where: { deleted_at: null, movement_type: "ISSUED", movement_date: { gte: todayStart } },
        })),
        safeNum(prisma.offline_inventory_movements.count({ where: { deleted_at: null } })),
      ])
    : null;

  // ── Super Admin data ─────────────────────────────────────────────
  const [saCount, saRecent] = isSuperAdmin ? await Promise.all([
    Promise.all([
      safeNum(prisma.assets.count({ where: { deleted_at: null } })),
      safeNum(prisma.work_orders.count({ where: { deleted_at: null, status: { notIn: ["Closed", "Rejected", "Cancelled"] } } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } }] } })),
      // Materials Pending Receipt: Materials Requests approved but not yet
      // fully received — Approved, Waiting Stock, and Partially Issued.
      safeNum(prisma.parts_requests.count({ where: { status: { in: ["Approved", "Waiting Stock", "Partially Issued"] } } })),
      safeNum(prisma.profiles.count({ where: { deleted_at: null, is_active: true } })),
    ]),
    prisma.work_orders
      .findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          work_order_number: true,
          status: true,
          updated_at: true,
          assets: { select: { asset_name: true } },
          parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
        },
        orderBy: { updated_at: "desc" },
        take: 5,
      })
      .then((rows) => rows.map((r) => ({
        id: r.id,
        work_order_number: r.work_order_number,
        status: r.status,
        updated_at: r.updated_at.toISOString(),
        asset_name: r.assets?.asset_name ?? null,
        materials_request_status: r.parts_requests[0]?.status ?? null,
      })))
      .then(withPendingCorrection)
      .catch((): WoRow[] => []),
  ]) : [null, [] as WoRow[]];

  // ── Quick-view preview (manager / super-admin only) ─────────────────
  const sp = (await searchParams) ?? {};
  const rawPreview = sp.preview ?? null;
  const previewId =
    rawPreview && /^[0-9a-f-]{36}$/i.test(rawPreview) ? rawPreview : null;

  // Store Guided Send Materials Popup Workflow Unit Task 2: a second,
  // independent preview param (never conflated with the Job Card ?preview)
  // for Store's guided Send Materials popup, opened straight from a
  // Materials Request row on the Store dashboard.
  const rawSendPreview = sp.sendPreview ?? null;
  const sendPreviewId =
    rawSendPreview && /^[0-9a-f-]{36}$/i.test(rawSendPreview) ? rawSendPreview : null;

  // Same permission check the send action itself enforces
  // (assertCanIssueMaterials) — a non-Store role crafting this URL directly
  // should see nothing, matching the popup's own gated action underneath.
  const canSendMaterials =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.issue") ||
    context.permissions.includes("store.issue");

  const sendPreviewRequest = sendPreviewId && canSendMaterials
    ? await prisma.parts_requests.findFirst({
        where: { id: sendPreviewId },
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          work_orders: {
            select: {
              id: true,
              work_order_number: true,
              status: true,
              operator_complaint: true,
              description_of_work: true,
              assets: { select: { asset_name: true, plate_number: true } }
            }
          },
          parts_request_items: {
            select: { id: true, description: true, quantity_requested: true, issued_quantity: true }
          }
        }
      })
    : null;

  const sendPreviewBalances = sendPreviewRequest
    ? await getMaterialBalancesForItems(
        sendPreviewRequest.parts_request_items.map((item) => ({ part_id: null, description: item.description }))
      )
    : null;

  const canAssignModal =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("work_orders.assign") ||
    context.permissions.includes("work_orders.approve");

  const [previewWO, prPreviewData, techsForModal] = previewId
    ? await Promise.all([
        prisma.work_orders.findFirst({
          where: { AND: [{ id: previewId }, { deleted_at: null }, visibilityFilter] },
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
            created_by: true,
            assets: {
              select: {
                id: true,
                asset_code: true,
                asset_name: true,
                category: true,
                brand: true,
                model: true,
                plate_number: true,
                status: true,
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
          select: {
            id: true,
            parts_request_number: true,
            status: true,
            parts_request_items: { select: { id: true, description: true, quantity_requested: true, issued_quantity: true } },
          },
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
    : [
        null,
        [] as Array<{ id: string; parts_request_number: string | null; status: string; parts_request_items: { id: string; description: string; quantity_requested: unknown; issued_quantity: unknown }[] }>,
        [] as Array<{ id: string; full_name: string }>,
      ];

  // Manager Dashboard Real Preview Loader Fix Task 5: dev-only diagnostic —
  // when a previewId was supplied but the scoped lookup above found nothing,
  // work out WHY (doesn't exist / soft-deleted / excluded by visibilityFilter)
  // without exposing any of this in production. Never runs in production and
  // never affects the real query above — read-only, separate diagnostic call.
  let previewDebugReason: string | null = null;
  if (previewId && !previewWO && process.env.NODE_ENV !== "production") {
    const rawRow = await prisma.work_orders.findUnique({
      where: { id: previewId },
      select: { id: true, work_order_number: true, status: true, deleted_at: true, created_by: true },
    });
    if (!rawRow) {
      previewDebugReason = `no work_orders row exists with id "${previewId}"`;
    } else if (rawRow.deleted_at) {
      previewDebugReason = `row ${rawRow.work_order_number} exists but deleted_at is set (soft-deleted)`;
    } else {
      // Isolate exactly which clause is responsible instead of assuming.
      const withoutVisibility = await prisma.work_orders.findFirst({
        where: { AND: [{ id: previewId }, { deleted_at: null }] },
        select: { id: true },
      });
      const withVisibilityOnly = await prisma.work_orders.findFirst({
        where: { AND: [{ id: previewId }, visibilityFilter] },
        select: { id: true },
      });
      previewDebugReason =
        `row ${rawRow.work_order_number} (status ${rawRow.status}) exists, not deleted. ` +
        `id+deleted_at-only query found it: ${Boolean(withoutVisibility)}. ` +
        `id+visibilityFilter-only query found it: ${Boolean(withVisibilityOnly)}. ` +
        `visibilityFilter=${JSON.stringify(visibilityFilter)}. ` +
        `role="${context.role?.slug ?? "none"}", hasApprove=${context.permissions.includes("work_orders.approve")}`;
    }
  }

  const isAdmin = context.role?.slug === "super_admin";
  const previewReviewed =
    previewWO && previewWO.status === "Under Review"
      ? (await getReviewedWorkOrderIds([previewWO.id])).has(previewWO.id)
      : false;
  // Data Entry Correction Note Visibility Cleanup Task 1/6: same single-record
  // query the Job Card detail page's correction banner uses, so the note
  // content shown here never disagrees with the full detail page.
  const previewPendingClarification = previewWO
    ? await getPendingClarificationForWorkOrder(previewWO.id)
    : null;
  const previewHasPendingCorrection = previewPendingClarification !== null;
  const previewCorrectionRequester = previewPendingClarification?.requested_by
    ? await prisma.profiles.findUnique({
        where: { id: previewPendingClarification.requested_by },
        select: { full_name: true },
      })
    : null;
  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displaySimplifiedStatus(previewWO.status),
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
              category: previewWO.assets.category,
              brand: previewWO.assets.brand,
              model: previewWO.assets.model,
              plate_number: previewWO.assets.plate_number,
              status: previewWO.assets.status,
              location: previewWO.assets.location,
              condition: previewWO.assets.condition,
              criticality: previewWO.assets.criticality,
            }
          : null,
        department_name: previewWO.departments?.name ?? null,
        technician_names: previewWO.work_order_assignments
          .filter(
            (a) =>
              a.assignment_type === "INTERNAL_TECHNICIAN" && a.profiles?.full_name,
          )
          .map((a) => a.profiles!.full_name),
        technicians: techsForModal,
        primary_assignment: previewWO.work_order_assignments[0]
          ? {
              assignment_type:
                previewWO.work_order_assignments[0].assignment_type,
              external_name:
                previewWO.work_order_assignments[0].external_name ?? null,
              external_company:
                previewWO.work_order_assignments[0].external_company ?? null,
              external_contact_person:
                previewWO.work_order_assignments[0].external_contact_person ??
                null,
              external_phone:
                previewWO.work_order_assignments[0].external_phone ?? null,
              external_trade:
                previewWO.work_order_assignments[0].external_trade ?? null,
            }
          : null,
        required_parts_count: previewWO._count.work_order_required_parts,
        parts_requests_count: prPreviewData.length,
        open_parts_requests_count: prPreviewData.filter((pr) =>
          OPEN_PR_STATUSES.includes(pr.status),
        ).length,
        last_parts_request_status: prPreviewData[0]
          ? displayPartsRequestStatus(prPreviewData[0].status)
          : null,
        all_parts_requests: prPreviewData.map((pr) => ({
          id: pr.id,
          parts_request_number: pr.parts_request_number,
          status: pr.status,
          items: pr.parts_request_items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity_requested: Number(item.quantity_requested),
            issued_quantity: Number(item.issued_quantity),
          })),
        })),
        attachment_count: previewWO._count.work_order_attachments,
        roleSlug: context.role?.slug ?? "",
        canApprove: isAdmin || context.permissions.includes("work_orders.approve"),
        canAssign: isAdmin || context.permissions.includes("work_orders.assign"),
        canManage: isAdmin || context.permissions.includes("work_orders.manage"),
        canReview: isAdmin || context.permissions.includes("work_orders.review"),
        canRequestCorrection: isAdmin || context.permissions.includes("work_orders.request_correction"),
        canClose: isAdmin || context.permissions.includes("work_orders.close"),
        canUpdateProgress: isAdmin || context.permissions.includes("work_orders.update"),
        canReceiveMaterials: canReceiveIssueMaterials(context),
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        reviewed: previewReviewed,
        hasPendingCorrection: previewHasPendingCorrection,
        pendingCorrectionNote: previewPendingClarification
          ? {
              question: previewPendingClarification.question,
              requestedByName: previewCorrectionRequester?.full_name ?? null,
              requestedAt: previewPendingClarification.requested_at.toISOString(),
            }
          : null,
        isCreator: previewWO.created_by === context.userId,
        closeHref: "/dashboard",
        previewParamName: "preview",
      }
    : null;

  const firstName = context.profile.full_name.split(" ")[0];

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      {/* Enterprise Real-Time Update Foundation Unit Task 6: dashboard
          refreshes fast on any job card, materials request, store send, or
          notification signal — AutoRefresh above stays as the 15s fallback.
          Enterprise-Wide Real-Time Update Verification Task 8: added
          "offline_inventory."/"material_ledger." so Manager's Offline
          Inventory Control KPI ("Movements today") and Store Keeper's
          summary counts also refresh instantly, not just on the 15s poll. */}
      <RealtimeRefresh watch={["job_card.", "work_order.", "materials_request.", "store_materials.", "offline_inventory.", "material_ledger.", "notification."]} />
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Here's what needs your attention today."
      />
      <div className="space-y-4 p-4 pb-8 sm:p-5">

        {/* ── NORMAL USER ─────────────────────────────────────────── */}
        {isNormalUser && nuQueue && (
          <>
            {/* Correction Requested alert */}
            {nuQueue.correctionCount > 0 && (
              <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <p className="flex-1 text-sm font-semibold text-red-800">
                  {nuQueue.correctionCount} Job Card{nuQueue.correctionCount !== 1 ? "s" : ""} need{nuQueue.correctionCount === 1 ? "s" : ""} your correction before approval.
                </p>
                <Link href="/maintenance/work-orders?status=Correction" className="shrink-0 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100">
                  View Corrections
                </Link>
              </div>
            )}

            {/* Quick Actions — Simplified Workflow Correction Unit Task 7:
                Materials Requests restored (requested materials are tracked
                and received there). */}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <QuickAction label="Create New Job Card" href="/maintenance/work-orders/new" icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="View My Job Cards"   href="/maintenance/work-orders"     icon={ClipboardList} iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Materials Requests"  href="/store/parts-requests"        icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Offline Inventory Control" href="/store/offline-inventory" icon={Package}    iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Assets & Equipment"  href="/assets"                      icon={Gauge}        iconBg="bg-blue-50"   iconColor="text-blue-600" />
            </div>

            {/* KPI Queue — five simplified statuses plus Materials Awaiting
                Receipt (Task 8, extended by Manager Approval Success Popup
                and Materials Awaiting Receipt Flow Task 6). */}
            <section className="space-y-2">
              <SectionLabel>My Work Today</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-6" cards={[
                { label: "Drafts",                value: nuQueue.draftCount,      icon: FileText,      tone: "gray",                                          href: "/maintenance/work-orders?status=Draft" },
                { label: "Submitted",             value: nuQueue.submittedCount,  icon: Clock,         tone: nuQueue.submittedCount > 0 ? "amber" : "green",  href: "/maintenance/work-orders?status=Submitted", detail: "Waiting on Supervisor / Manager decision." },
                { label: "Approved",              value: nuQueue.approvedCount,   icon: BadgeCheck,    tone: "blue",                                          href: "/maintenance/work-orders?status=Approved", detail: "Approved by Manager" },
                { label: "Active",                value: nuQueue.activeCount,     icon: Wrench,        tone: "blue",                                          href: "/maintenance/work-orders?status=Active", detail: "Work in progress" },
                { label: "Materials to Receive", value: nuQueue.materialsAwaitingReceiptCount, icon: ShoppingCart, tone: nuQueue.materialsAwaitingReceiptCount > 0 ? "amber" : "green", href: "/store/parts-requests?status=AwaitingReceipt", detail: "Approved materials not received yet" },
                { label: "Closed recently",       value: nuQueue.closedRecentCount, icon: CheckCircle2, tone: "green",                                        href: "/maintenance/work-orders?status=Closed" },
              ]} />
            </section>

            {/* Latest Updates */}
            <ActivityList
              title="Latest Job Cards"
              viewAllHref="/maintenance/work-orders"
              empty={nuRecent.length === 0}
              emptyState={
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-[#111827]">No Job Cards yet.</p>
                  <p className="text-xs text-[#6B7280]">Create your first Job Card to start tracking maintenance work.</p>
                  <Link
                    href="/maintenance/work-orders/new"
                    className="mt-1 rounded-md bg-[#ED1C24] px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700"
                  >
                    Create Job Card
                  </Link>
                </div>
              }
            >
              {nuRecent.map((row) => <NuJobCardRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── SUPERVISOR / MANAGER ─────────────────────────────────── */}
        {isManager && mgData && (
          <>
            {/* Simplified Workflow Correction Unit Task 7: Materials Requests
                restored to Manager's quick actions too. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <QuickAction label="Review Submitted Job Cards" href="/maintenance/work-orders?status=Submitted" icon={ClipboardList} iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Materials Requests"  href="/store/parts-requests"                      icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assign Work"         href="/maintenance/work-orders?status=ReadyToAssign" icon={Users}      iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Offline Inventory Control" href="/store/offline-inventory"             icon={Package}       iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Service Contracts"   href="/assets/service-contracts"                  icon={FileText}      iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Reports"             href="/reports"                                   icon={BarChart3}     iconBg="bg-gray-100"  iconColor="text-[#4B5563]" />
            </div>

            {/* Simplified Workflow Correction Unit Task 7: Materials Requests
                KPI restored alongside the five simplified Job Card statuses. */}
            <section className="space-y-2">
              <SectionLabel>Job Cards</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-6" cards={[
                { label: "Submitted for Review",     value: mgSubmittedRows.length,   icon: ClipboardList, tone: mgSubmittedRows.length > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Submitted" },
                { label: "Approved",                  value: mgApprovedCount,          icon: BadgeCheck,    tone: "blue",                                          href: "/maintenance/work-orders?status=Approved" },
                { label: "Active",                    value: mgActiveCount,            icon: Wrench,        tone: "blue",                                          href: "/maintenance/work-orders?status=Active", detail: "Work in progress" },
                { label: "Materials to Receive", value: mgOpenMaterialsRequestsCount, icon: ShoppingCart, tone: mgOpenMaterialsRequestsCount > 0 ? "amber" : "green", href: "/store/parts-requests?status=AwaitingReceipt", detail: "Approved materials not received yet" },
                { label: "Offline Inventory Control", value: offlineMovementsToday,    icon: Package,       tone: "gray",                                          href: "/store/offline-inventory", detail: "Movements today" },
                { label: "Closed recently",           value: mgClosedRecentCount,      icon: CheckCircle2,  tone: "green",                                         href: "/maintenance/work-orders?status=Closed" },
              ]} />
            </section>

            {/* Needs Your Action — real Manager actions only: Submitted Job
                Cards awaiting a decision (Approve / Request Correction / Ask
                to Add-Update Materials — all available from the Job Card
                popup) and Open Job Cards ready to close.
                Correction Requested is intentionally excluded — those are
                waiting on Data Entry, not Manager (Task 8). Manager Needs
                Your Action Waiting-on-Data-Entry UI Cleanup Task 2: the
                empty state is now a plain, always-the-same message — it no
                longer doubles as the correction-count announcement, which
                previously made this section look weak/empty instead of
                genuinely "nothing to do". */}
            <ActivityList
              title="Needs Your Action"
              viewAllHref="/maintenance/work-orders"
              empty={mgActionRows.length === 0}
              emptyState={
                <p className="px-4 py-8 text-center text-sm text-[#4B5563]">
                  Nothing requiring your action right now.
                </p>
              }
            >
              {mgActionRows.map((row) => <ManagerActionRow key={row.id} row={row} />)}
            </ActivityList>

            {/* Manager Needs Your Action Waiting-on-Data-Entry UI Cleanup
                Task 3: a separate, always-visible-when-relevant reminder —
                shown regardless of whether Needs Your Action itself has
                rows, since correction requests waiting on Data Entry are
                informational for Manager, not folded into the "nothing to
                do" / "something to do" empty-state logic above. Amber, not
                red — this isn't a Manager error state, just a status the
                Manager should stay aware of. */}
            {mgCorrectionCount > 0 && (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-amber-900">Waiting on Data Entry</p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-800">
                      {mgCorrectionCount === 1
                        ? "1 correction request is waiting for Data Entry. It will return to Needs Your Action after resubmission."
                        : `${mgCorrectionCount} correction requests are waiting for Data Entry. They will return to Needs Your Action after resubmission.`}
                    </p>
                    <Link
                      href="/maintenance/work-orders?status=Correction"
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
                    >
                      View Corrections
                    </Link>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* ── MAINTENANCE ENGINEER ─────────────────────────────────── */}
        {/* Simplified Job Card Approval Workflow Unit Task 8: Engineer is
            not one of the three active operational roles — no review queue,
            no action buttons, just a minimal read-only Job Cards list. */}
        {isEngineer && engQueue && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QuickAction label="Job Cards"          href="/maintenance/work-orders" icon={ClipboardList} iconBg="bg-red-50"   iconColor="text-[#ED1C24]" />
              <QuickAction label="Assets & Equipment" href="/assets"                  icon={Gauge}         iconBg="bg-blue-50"  iconColor="text-blue-600" />
              <QuickAction label="Notifications"      href="/notifications"           icon={Bell}         iconBg="bg-green-50" iconColor="text-green-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>Job Cards</SectionLabel>
              <KpiRow cols="sm:grid-cols-2" cards={[
                { label: "Open",             value: engQueue[0], icon: Wrench,       tone: "blue",  href: "/maintenance/work-orders" },
                { label: "Closed recently",  value: engQueue[1], icon: CheckCircle2, tone: "green", href: "/maintenance/work-orders?status=Closed" },
              ]} />
            </section>

            <ActivityList title="Recent Job Cards" viewAllHref="/maintenance/work-orders" empty={engRecent.length === 0}>
              {engRecent.map((row) => <WoRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── TECHNICIAN ──────────────────────────────────────────── */}
        {isTechnician && techQueue && (
          <>
            {/* Technician Dashboard and My Jobs Workflow Alignment Unit
                Task 3: "Request Parts" removed as a standalone quick action —
                it linked to a generic creation page with no Job Card
                context, which Task 3 explicitly flags as wrong. Requesting
                extra materials now only happens from inside an assigned/
                in-progress job (Task 10), where the Job Card is already
                fixed. "Upload Work Photo" still routes to My Jobs first so a
                job is always picked before uploading (Task 8's recommended
                behavior), which this href already did. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QuickAction label="My Jobs"           href="/technician/jobs" icon={Wrench} iconBg="bg-blue-50"  iconColor="text-blue-600" />
              <QuickAction label="Upload Work Photo" href="/technician/jobs" icon={Upload} iconBg="bg-green-50" iconColor="text-green-600" />
              <QuickAction label="Notifications"     href="/notifications"  icon={Bell}   iconBg="bg-amber-50" iconColor="text-amber-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>My Jobs</SectionLabel>
              <KpiRow cols="sm:grid-cols-4" cards={[
                { label: "Assigned",         value: techQueue[0], icon: ClipboardList, tone: techQueue[0] > 0 ? "blue"  : "gray",  href: "/technician/jobs", detail: "Not started yet" },
                { label: "In Progress",      value: techQueue[1], icon: Wrench,        tone: techQueue[1] > 0 ? "blue"  : "gray",  href: "/technician/jobs" },
                { label: "Closed Recently",  value: techQueue[2], icon: CheckCircle2,  tone: techQueue[2] > 0 ? "green" : "gray",  href: "/technician/jobs", detail: "Last 14 days" },
                { label: "Total Jobs",       value: techQueue[3], icon: ClipboardList, tone: "gray",                                href: "/technician/jobs" },
              ]} />
            </section>

            <ActivityList title="My Recent Jobs" viewAllHref="/technician/jobs" empty={techJobs.length === 0}>
              {techJobs.map((row) => <TechJobRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── STORE KEEPER ────────────────────────────────────────── */}
        {/* Simplified Job Card Approval Workflow Unit Task 6/8: Store is
            retired from the active Job Card workflow — dashboard shrinks to
            a plain Offline Inventory Control summary. Materials Requests/
            Send Materials routes still exist and stay permission-gated,
            just no longer surfaced here or in the sidebar. */}
        {isStoreKeeper && skSummary && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QuickAction label="Offline Inventory Control" href="/store/offline-inventory"           icon={Package}  iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Movement History"          href="/store/offline-inventory/movements" icon={Activity} iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Notifications"              href="/notifications"                     icon={Bell}     iconBg="bg-green-50"  iconColor="text-green-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>Offline Inventory Control</SectionLabel>
              <KpiRow cols="sm:grid-cols-3" cards={[
                { label: "Received Today",   value: skSummary[0], icon: CheckCircle2, tone: "green", href: "/store/offline-inventory" },
                { label: "Issued Today",      value: skSummary[1], icon: Activity,     tone: "blue",  href: "/store/offline-inventory" },
                { label: "Total Movements",   value: skSummary[2], icon: Package,      tone: "gray",  href: "/store/offline-inventory/movements" },
              ]} />
            </section>
          </>
        )}

        {/* ── SUPER ADMIN ─────────────────────────────────────────── */}
        {isSuperAdmin && saCount && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <QuickAction label="Create Job Card"     href="/maintenance/work-orders/new" icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Assets & Equipment"  href="/assets"                      icon={Gauge}        iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Materials Requests"  href="/store/parts-requests"        icon={ShoppingCart} iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Offline Inventory Control" href="/store/offline-inventory" icon={Package}   iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Users"               href="/admin/users"                 icon={Users}        iconBg="bg-violet-50" iconColor="text-violet-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>System Overview</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-5" cards={[
                { label: "Total Assets",            value: saCount[0], icon: Gauge,         tone: "blue",                              href: "/assets" },
                { label: "Open Job Cards",           value: saCount[1], icon: ClipboardList, tone: saCount[1] > 0 ? "amber" : "green", href: "/maintenance/work-orders" },
                { label: "Open Materials Requests",  value: saCount[2], icon: AlertTriangle, tone: saCount[2] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Materials", detail: "Materials requested for Job Cards" },
                { label: "Materials Pending Receipt", value: saCount[3], icon: Package,       tone: saCount[3] > 0 ? "amber" : "green", href: "/store/parts-requests", detail: "Approved materials not received yet" },
                { label: "Active Users",             value: saCount[4], icon: Users,         tone: "blue",                              href: "/admin/users" },
              ]} />
            </section>

            <ActivityList title="Latest Job Cards" viewAllHref="/maintenance/work-orders" empty={saRecent.length === 0}>
              {saRecent.map((row) => <WoRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── VIEWER / AUDITOR ──────────────────────────────────────── */}
        {/* Strictly read-only — no create/action quick actions, no queue
            lists, just summary counts and links into permission-gated
            read-only pages (work_orders.view, assets.view, reports.view). */}
        {isViewerAuditor && vaCount && (
          <section className="space-y-2">
            <SectionLabel>Read-Only Summary</SectionLabel>
            <KpiRow cols="sm:grid-cols-3" cards={[
              { label: "Total Job Cards",  value: vaCount[0], icon: ClipboardList, tone: "blue",  href: "/maintenance/work-orders" },
              { label: "Closed Job Cards", value: vaCount[1], icon: CheckCircle2,  tone: "green", href: "/maintenance/work-orders?status=Closed" },
              { label: "Total Assets",     value: vaCount[2], icon: Gauge,         tone: "blue",  href: "/assets" },
            ]} />
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Job Cards"          href="/maintenance/work-orders" icon={ClipboardList} iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Materials Requests" href="/store/parts-requests"    icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assets & Equipment" href="/assets"                  icon={Gauge}         iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Reports"            href="/reports"                 icon={BarChart3}     iconBg="bg-amber-50"  iconColor="text-amber-600" />
            </div>
          </section>
        )}

        {/* ── FALLBACK (other non-operational roles) ───────────────── */}
        {!isNormalUser && !isManager && !isEngineer && !isTechnician && !isStoreKeeper && !isViewerAuditor && !isSuperAdmin && (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <QuickAction label="Job Cards"          href="/maintenance/work-orders" icon={ClipboardList} iconBg="bg-blue-50"   iconColor="text-blue-600" />
            <QuickAction label="Reports"           href="/reports"                 icon={BarChart3}     iconBg="bg-green-50"  iconColor="text-green-600" />
            <QuickAction label="Assets & Equipment"href="/assets"                  icon={Gauge}         iconBg="bg-violet-50" iconColor="text-violet-600" />
            <QuickAction label="Notifications"     href="/notifications"           icon={Bell}          iconBg="bg-amber-50"  iconColor="text-amber-600" />
          </div>
        )}

      </div>

      {previewId && (
        drawerData ? (
          sp.success === "job-card-opened" ? (
            <JobCardOpenedModal data={drawerData} dismissHref="/dashboard" />
          ) : sp.success === "job-card-submitted" ? (
            <JobCardSubmittedModal data={drawerData} dismissHref="/dashboard" />
          ) : (
            <RepairOrderQuickView data={drawerData} />
          )
        ) : (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            {/* Not-found / no-access card */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Job Card not found or no longer available.</p>
                {previewDebugReason && (
                  <p className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
                    Debug (dev only): {previewDebugReason}
                  </p>
                )}
                <div className="mt-4">
                  <Link
                    href="/dashboard"
                    className="inline-block rounded-md border border-[#E5E7EB] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Close
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* Store Guided Send Materials Popup Workflow Unit Task 2: opened via
          ?sendPreview instead of navigating straight to the full Materials
          Request page. Falls back to a plain not-found card for a stale/
          invalid id or missing permission, same convention as the Job Card
          preview above. */}
      {sendPreviewId && (
        sendPreviewRequest ? (
          <StoreSendMaterialsPopup
            data={{
              id: sendPreviewRequest.id,
              parts_request_number: sendPreviewRequest.parts_request_number,
              status: sendPreviewRequest.status,
              work_order_id: sendPreviewRequest.work_orders?.id ?? null,
              work_order_number: sendPreviewRequest.work_orders?.work_order_number ?? null,
              work_order_status: sendPreviewRequest.work_orders?.status ?? null,
              problem_summary: sendPreviewRequest.work_orders?.operator_complaint || sendPreviewRequest.work_orders?.description_of_work || null,
              asset_name: sendPreviewRequest.work_orders?.assets?.asset_name ?? null,
              plate_number: sendPreviewRequest.work_orders?.assets?.plate_number ?? null,
              items: sendPreviewRequest.parts_request_items.map((item) => ({
                id: item.id,
                description: item.description,
                quantity_requested: Number(item.quantity_requested),
                issued_quantity: Number(item.issued_quantity),
                balance: sendPreviewBalances?.get(item.description),
              })),
            }}
          />
        ) : (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Materials Request not found or no longer available.</p>
                <div className="mt-4">
                  <Link
                    href="/dashboard"
                    className="inline-block rounded-md border border-[#E5E7EB] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Close
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
      )}
    </>
  );
}
