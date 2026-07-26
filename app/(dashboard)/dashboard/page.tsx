import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
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
import { displayStatus } from "@/lib/display/work-order-labels";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
  materialsRequestStoreFollowUpHint,
  materialsRequestBadgeLabel,
  OPEN_PR_STATUSES,
} from "@/lib/display/parts-request-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getReviewedWorkOrderIds } from "@/lib/work-orders/review-status";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";
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
};
type NuJobCardRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  created_at: string;
  asset_name: string | null;
  issue_summary: string | null;
  materials_request_status: string | null;
};
type PrRow = { id: string; parts_request_number: string | null; status: string; created_at: string };
// Store Dashboard + Store Issue + Material Ledger Alignment Task 4: every
// Store dashboard row must show the linked Job Card, asset/vehicle, and a
// material summary — the old PrRow (number/status/date only) forced Store to
// open each request just to see what it was for.
type StoreRequestRow = {
  id: string;
  parts_request_number: string | null;
  status: string;
  created_at: string;
  work_order_number: string | null;
  work_order_status: string | null;
  asset_name: string | null;
  plate_number: string | null;
  item_summary: string | null;
};
type MgActionRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  description_of_work: string | null;
  asset_name: string | null;
  // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 3/5:
  // materials_request_status backs the "Materials status" column the
  // Engineer's Job Cards Needing Action list is required to show; reviewed
  // flags an Under Review row that already has a work_order.review audit
  // entry, so Manager's own action list can tell "Engineer Reviewed" apart
  // from "not reviewed yet" without a new status/column.
  materials_request_status?: string | null;
  reviewed?: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────
async function safeNum(query: Promise<number>): Promise<number> {
  try { return await query; } catch { return 0; }
}

// Maintenance Workflow Redesign Unit 9 — re-derived for the simplified
// 9-status Job Card model. Legacy pre-Unit3 statuses are kept as a
// defensive fallback only, see lib/display/work-order-labels.ts.
function woTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["Closed", "Approved", "Materials Issued"].includes(status)) return "green";
  if (status.includes("Waiting") || status === "Partially Issued" || status === "Under Review") return "amber";
  if (["Assigned", "In Progress"].includes(status)) return "blue";
  if (status === "Created") return "gray";
  // Legacy pre-Unit3 statuses — defensive fallback only.
  if (["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "green";
  if (["Rejected", "Cancelled"].includes(status)) return "red";
  if (status === "Draft") return "gray";
  return "blue";
}

// Simplified, employee-facing status wording for the normal-user "Latest Job Cards" list only.
// Internal status strings and the shared displayStatus() mapping used elsewhere are unchanged.
// Any old pre-Unit3 status (which can no longer be written to a live record)
// falls back to a neutral "Legacy" label rather than a forbidden old word.
function employeeStatusLabel(status: string): string {
  if (status === "Created") return "New";
  if (status === "Under Review") return "Waiting Review";
  if (status === "Approved") return "Approved";
  // Data Entry Dashboard and Job Cards UX Simplification Task 5: these three
  // used to collapse into one bare, ambiguous "Materials" badge — showing
  // the real status name is clearer and matches displayStatus() elsewhere.
  if (status === "Waiting Materials") return "Waiting Materials";
  if (status === "Partially Issued") return "Partially Issued";
  if (status === "Materials Issued") return "Materials Issued";
  if (status === "Assigned") return "Assigned";
  if (status === "In Progress") return "In Progress";
  if (status === "Closed") return "Closed";
  // Legacy pre-Unit3 statuses — defensive fallback only.
  if (["Draft", "Submitted", "Pending Approval"].includes(status)) return "Waiting Review";
  if (["Waiting for Parts", "Waiting for Purchase"].includes(status)) return "Waiting Materials";
  if (status === "Parts Issued") return "Materials Issued";
  if (["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "In Progress";
  return "Legacy";
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
      label: "Review",
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
      label: "Review",
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
        <StatusBadge label={displayStatus(row.status)} tone={woTone(row.status)} />
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
        <StatusBadge label={displayStatus(row.status)} tone={woTone(row.status)} />
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
        <StatusBadge label={employeeStatusLabel(row.status)} tone={woTone(row.status)} />
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
          {/* Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 5:
              Job Card status stays "Under Review" through both the Engineer
              review and Manager approval steps, so this text (derived from
              the work_order.review audit entry, not a new status) is the
              only visible signal distinguishing the two. */}
          {row.status === "Under Review" && row.reviewed && (
            <p className="text-xs font-semibold text-[#2563EB]">Engineer Reviewed — Waiting Manager Approval</p>
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
        <StatusBadge label={displayStatus(row.status)} tone={woTone(row.status)} />
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

// Manager Dashboard Approval Queue Fix Task 3: a Materials Request row for
// the "Needs Your Action" list specifically — richer than the plain PrRow
// used in the separate "Open Materials Requests" section below, since Task 3
// asks for the linked Job Card's asset and a material summary, not just the
// request number. Links straight to the request detail page, where the real
// parts_requests.approve-gated Approve action lives (same convention as
// ManagerActionRow's "Close" — no new inline approval form here).
type MaterialsApprovalRowData = {
  id: string;
  parts_request_number: string | null;
  status: string;
  created_at: string;
  work_order_id: string | null;
  work_order_number: string | null;
  job_card_approved: boolean;
  asset_name: string | null;
  item_summary: string | null;
};

// Unified Manager Job Card + Materials Approval Flow Fix Task 2/3/4: this
// row now only ever renders Case C — a Materials Request whose Job Card is
// ALREADY approved (mgMaterialsNeedingApproval is pre-filtered to
// job_card_approved && work_order_id). Routes into the Job Card popup
// (?preview=<work_order_id>), where the "Approve Materials Request" button
// lives — keeping Manager inside the Job Card flow instead of dropping them
// on the standalone Materials Request page, per the "handled inside the Job
// Card flow/popup" business decision. Falls back to the Materials Request's
// own page only in the (should-not-happen, defensive) case of a missing link.
function MaterialsApprovalRow({ row }: { row: MaterialsApprovalRowData }) {
  const missingJobCard = !row.work_order_id;
  const href = missingJobCard ? `/store/parts-requests/${row.id}` : `?preview=${row.work_order_id}`;

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link href={href} className="block">
          <p className="text-sm font-semibold text-[#111827] hover:text-[#ED1C24]">
            {row.work_order_number ?? "Job Card"}
            <span className="ml-2 text-xs font-normal text-[#6B7280]">· {row.parts_request_number ?? "Materials Request"}</span>
          </p>
          {row.asset_name && <p className="truncate text-xs text-[#4B5563]">{row.asset_name}</p>}
          {row.item_summary && <p className="truncate text-xs text-[#4B5563]">{row.item_summary}</p>}
          {missingJobCard && (
            <p className="text-xs font-semibold text-red-700">Linked Job Card is missing. Contact IT.</p>
          )}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={displayPartsRequestStatus(row.status)} tone={partsRequestStatusTone(row.status)} />
        <span className="hidden text-xs text-[#9CA3AF] sm:block">{ageLabel(row.created_at)}</span>
        <Link
          href={href}
          className="shrink-0 rounded border border-[#ED1C24] bg-[#ED1C24] px-2 py-1 text-xs font-bold text-white transition hover:bg-red-700"
        >
          {missingJobCard ? "View" : "Approve Materials Request"}
        </Link>
      </div>
    </div>
  );
}

function PrRow({ row }: { row: PrRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#111827]">
        {row.parts_request_number ?? "—"}
      </span>
      <StatusBadge label={displayPartsRequestStatus(row.status)} tone={partsRequestStatusTone(row.status)} />
      <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.created_at)}</span>
      <Link href={`/store/parts-requests/${row.id}`} className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]">
        View
      </Link>
    </div>
  );
}

// Store Dashboard + Store Issue + Material Ledger Alignment Task 4/5: Store's
// own "Needs Store Action" list — every row shows the linked Job Card, asset/
// vehicle (with plate number), and a material summary so Store never has to
// open a request just to see what it's for. The action itself follows Task 5
// exactly: Requested -> View only ("Waiting Manager Approval"), Approved ->
// Issue Materials, Waiting Stock/Partially Issued -> Continue Issue, Issued ->
// View only. Store never gets an Approve button here (parts_requests.approve/
// work_orders.approve stay Manager-only, unchanged).
// Store Send Materials Approval Gate Unit Task 4: an Approved Materials
// Request whose linked Job Card is still Created/Under Review is NOT ready
// for Store to act on yet, even though the Materials Request itself says
// "Approved" — the Job Card needs Manager approval first (see the same gate
// enforced server-side in issueMaterials).
function isBlockedByJobCardApproval(jobCardStatus: string | null): boolean {
  return jobCardStatus === "Created" || jobCardStatus === "Under Review";
}

// Store Guided Send Materials Popup Workflow Unit Task 7: "Issue Materials"
// renamed "Send Materials" everywhere in Store's dashboard row — Store's
// user-facing flow says Send/Sent, never "Issue" (that word only lives in
// the underlying Material Ledger internals now).
function storeRequestAction(status: string, jobCardStatus: string | null): { label: string; style: string; opensPopup: boolean } {
  if (status === "Approved" && isBlockedByJobCardApproval(jobCardStatus)) {
    return { label: "View", style: "border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]", opensPopup: false };
  }
  if (status === "Approved") {
    return { label: "Send Materials", style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700", opensPopup: true };
  }
  if (status === "Waiting Stock" || status === "Partially Issued") {
    return { label: "Continue Sending", style: "border-[#F59E0B] bg-[#F59E0B] text-white hover:bg-amber-600", opensPopup: true };
  }
  return { label: "View", style: "border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]", opensPopup: false };
}

function StoreRequestRow({ row }: { row: StoreRequestRow }) {
  const action = storeRequestAction(row.status, row.work_order_status);
  const waitingJobCardApproval = row.status === "Approved" && isBlockedByJobCardApproval(row.work_order_status);
  const assetLine = row.asset_name
    ? `${row.asset_name}${row.plate_number ? ` - Plate ${row.plate_number}` : ""}`
    : null;
  // Task 2/7: actionable rows (Send Materials / Continue Sending) open the
  // guided popup; non-actionable rows (View only — waiting on Manager
  // approval either at the Materials Request or Job Card level) still route
  // to the full page, matching existing behavior — there's nothing to send yet.
  const href = action.opensPopup ? `?sendPreview=${row.id}` : `/store/parts-requests/${row.id}`;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link href={href} className="block">
          <p className="text-sm font-semibold text-[#111827] hover:text-[#ED1C24]">
            {row.parts_request_number ?? "Materials Request"}
            {row.work_order_number && (
              <span className="ml-2 text-xs font-normal text-[#6B7280]">· {row.work_order_number}</span>
            )}
          </p>
          {assetLine && <p className="truncate text-xs text-[#4B5563]">{assetLine}</p>}
          {row.item_summary && <p className="truncate text-xs text-[#4B5563]">{row.item_summary}</p>}
          {row.status === "Requested" && (
            <p className="text-xs font-semibold text-amber-700">Waiting Manager Approval</p>
          )}
          {waitingJobCardApproval && (
            <p className="text-xs font-semibold text-amber-700">
              Waiting Manager Approval — Store can send materials after the Job Card is approved.
            </p>
          )}
          {materialsRequestStoreFollowUpHint(row.status) && (
            <p className="text-xs font-semibold text-amber-700">{materialsRequestStoreFollowUpHint(row.status)}</p>
          )}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={displayPartsRequestStatus(row.status)} tone={partsRequestStatusTone(row.status)} />
        <span className="hidden text-xs text-[#9CA3AF] sm:block">{ageLabel(row.created_at)}</span>
        <Link
          href={href}
          className={`shrink-0 rounded border px-2 py-1 text-xs font-bold transition ${action.style}`}
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}

// Manager Dashboard Job Card/Materials Ordering Fix: a plain, non-interactive
// sub-heading row inside an ActivityList's divided list — distinguishes
// groups of different action types without needing a separate section/card.
function ActivityGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#F9FAFB] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-[#6B7280]">
      {children}
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
type PageProps = { searchParams?: Promise<{ preview?: string; sendPreview?: string }> };

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

  // ── Normal User data ─────────────────────────────────────────────
  const [nuQueue, nuRecent] = isNormalUser ? await Promise.all([
    Promise.all([
      // My Open Job Cards — every Job Card this user can see that isn't Closed yet.
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { notIn: ["Closed", "Rejected", "Cancelled"] } }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Under Review" }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "In Progress" }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Approved" }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Created" }] } })),
      // Data Entry Dashboard and Job Cards UX Simplification Task 2: "Ready
      // for My Update" — Job Cards where Data Entry's own next action is
      // actually available (mark work started), replacing the old "Approved
      // / Ready" card which counted Approved Job Cards Data Entry has no
      // action on (assignment/materials are Manager/Store's turn, not theirs).
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Assigned" }] } })),
    ]),
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
      .then((rows): NuJobCardRow[] =>
        rows.map((r) => ({
          id:                       r.id,
          work_order_number:        r.work_order_number,
          status:                   r.status,
          created_at:               r.created_at.toISOString(),
          asset_name:               r.assets?.asset_name ?? null,
          issue_summary:            r.operator_complaint ?? r.description_of_work ?? null,
          materials_request_status: r.parts_requests[0]?.status ?? null,
        }))
      )
      .catch((): NuJobCardRow[] => []),
  ]) : [null, [] as NuJobCardRow[]];

  // ── Manager data ─────────────────────────────────────────────────
  // Manager Dashboard Approval Queue Fix: Job Card status stays "Under
  // Review" through both the Engineer-review and Manager-approval steps (no
  // new status added), so a single "Under Review" count/queue can't tell
  // Manager which of those Job Cards are actually ready for their decision —
  // that split is derived here from the work_order.review audit entry
  // (lib/work-orders/review-status.ts), the same mechanism the Engineer
  // dashboard and Job Cards list already use.
  const mgBase = { AND: [{ deleted_at: null }, visibilityFilter] };

  const mgData = isManager
    ? await Promise.all([
        // All Under Review Job Cards, full row detail — Task 10: one query,
        // no take cap (an accurate Waiting Manager Approval / Waiting
        // Engineer Review split needs every visible Under Review row, not a
        // sample), followed by exactly one batched audit_logs query (no
        // N+1) to classify them.
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
        // Remaining KPI counts (Approved/Active, Open Materials Requests,
        // Ready to Assign — Approved/Materials Issued with no assignment yet,
        // replacing the old proxy that just counted Materials Issued).
        Promise.all([
          safeNum(prisma.work_orders.count({
            where: { AND: [mgBase, { status: { in: ["Approved", "Materials Issued", "Assigned", "In Progress", "Waiting Materials", "Partially Issued"] } }] },
          })),
          // Unified Manager Job Card + Materials Approval Flow Fix Task 6:
          // excludes "Under Review" Job Cards — those are already counted in
          // Waiting Manager Approval / Waiting Engineer Review above, so
          // counting them again here would double-count the same Job Card
          // under two different KPI cards.
          safeNum(prisma.work_orders.count({
            where: { AND: [mgBase, { status: { not: "Under Review" } }, { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } }] },
          })),
          // Task 6: "truly assignable" now also requires no blocking
          // (still-open) Materials Request — a Job Card sitting Approved
          // with materials still Requested is not actually ready to assign.
          safeNum(prisma.work_orders.count({
            where: {
              AND: [
                mgBase,
                { status: { in: ["Approved", "Materials Issued"] } },
                { work_order_assignments: { none: {} } },
                { NOT: { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } } },
              ],
            },
          })),
        ]),
        // Materials Requests needing Manager approval (status "Requested"
        // specifically — not the broader Open Materials Requests set below).
        prisma.parts_requests
          .findMany({
            where: { status: "Requested" },
            select: {
              id: true,
              parts_request_number: true,
              status: true,
              created_at: true,
              work_orders: { select: { id: true, work_order_number: true, status: true } },
              assets: { select: { asset_name: true } },
              parts_request_items: { select: { description: true }, take: 1 },
            },
            orderBy: { created_at: "asc" },
            take: 5,
          })
          .then((rows): MaterialsApprovalRowData[] =>
            rows.map((r) => ({
              id:                   r.id,
              parts_request_number: r.parts_request_number,
              status:               r.status,
              created_at:           r.created_at.toISOString(),
              work_order_id:        r.work_orders?.id ?? null,
              work_order_number:    r.work_orders?.work_order_number ?? null,
              // Manager Dashboard Job Card/Materials Ordering Fix: approving a
              // Materials Request before its own Job Card is approved is
              // premature — the Job Card needs Manager approval first (same
              // reasoning as the Store Send Approval Gate). Job Card status
              // rides along so the row can defer to the Job Card popup instead
              // of jumping straight to the Materials Request page.
              job_card_approved:    Boolean(r.work_orders && !["Created", "Under Review"].includes(r.work_orders.status)),
              asset_name:           r.assets?.asset_name ?? null,
              item_summary:         r.parts_request_items[0]?.description ?? null,
            }))
          )
          .catch((): MaterialsApprovalRowData[] => []),
        // Ready to Assign rows — same filter as the KPI count above (Task 6:
        // excludes Job Cards with any still-open Materials Request), capped
        // for display.
        prisma.work_orders.findMany({
          where: {
            AND: [
              mgBase,
              { status: { in: ["Approved", "Materials Issued"] } },
              { work_order_assignments: { none: {} } },
              { NOT: { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } } },
            ],
          },
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
          orderBy: { created_at: "asc" },
          take: 5,
        }),
        // Open Materials Requests — the separate, broader "for visibility" list further down the page (unchanged).
        prisma.parts_requests
          .findMany({
            where: { status: { in: OPEN_PR_STATUSES } },
            select: { id: true, parts_request_number: true, status: true, created_at: true },
            orderBy: { created_at: "asc" },
            take: 5,
          })
          .then((rows): PrRow[] =>
            rows.map((r) => ({
              id:                   r.id,
              parts_request_number: r.parts_request_number,
              status:               r.status,
              created_at:           r.created_at.toISOString(),
            }))
          )
          .catch((): PrRow[] => []),
      ])
    : null;

  const mgUnderReviewAll = mgData?.[0] ?? [];
  const mgReviewedIds = isManager ? await getReviewedWorkOrderIds(mgUnderReviewAll.map((r) => r.id)) : new Set<string>();
  const mgWaitingApprovalAll: MgActionRow[] = mgUnderReviewAll
    .filter((r) => mgReviewedIds.has(r.id))
    .map((r) => ({
      id:                        r.id,
      work_order_number:         r.work_order_number,
      status:                    r.status,
      updated_at:                r.updated_at.toISOString(),
      created_at:                r.created_at.toISOString(),
      description_of_work:       r.description_of_work ?? null,
      asset_name:                r.assets?.asset_name ?? null,
      materials_request_status:  r.parts_requests[0]?.status ?? null,
      reviewed:                  true,
    }));
  const mgWaitingEngineerReviewCount = mgUnderReviewAll.length - mgWaitingApprovalAll.length;

  const mgRestCounts   = mgData?.[1] ?? [0, 0, 0];
  const mgQueue = [mgWaitingApprovalAll.length, mgWaitingEngineerReviewCount, mgRestCounts[0], mgRestCounts[1], mgRestCounts[2]];
  const mgMaterialsNeedingApprovalAll = (mgData?.[2] ?? []) as MaterialsApprovalRowData[];
  // Unified Manager Job Card + Materials Approval Flow Fix Task 1/2: a
  // Materials Request whose Job Card isn't approved yet (or has no linked
  // Job Card at all) is no longer shown as a row of its own at all — that
  // Job Card is either already listed above (reviewed, with its materials
  // status inline) or not yet reviewed by Engineer (not Manager's turn yet).
  // Only requests whose Job Card is ALREADY approved are genuinely
  // independent Manager actions (Case C — see the Job Card popup).
  const mgMaterialsNeedingApproval = mgMaterialsNeedingApprovalAll.filter((r) => r.work_order_id && r.job_card_approved);
  const mgReadyToAssignRows: MgActionRow[] = ((mgData?.[3] ?? []) as typeof mgUnderReviewAll).map((r) => ({
    id:                        r.id,
    work_order_number:         r.work_order_number,
    status:                    r.status,
    updated_at:                r.updated_at.toISOString(),
    created_at:                r.created_at.toISOString(),
    description_of_work:       r.description_of_work ?? null,
    asset_name:                r.assets?.asset_name ?? null,
    materials_request_status:  r.parts_requests[0]?.status ?? null,
  }));
  const mgMaterials = (mgData?.[4] ?? []) as PrRow[];

  // ── Maintenance Engineer data ─────────────────────────────────────
  // Engineer reviews Job Cards (work_orders.review) and can request
  // corrections, but does not approve (no work_orders.approve) — so
  // "Approved / Active" here is informational context, not a queue they
  // action. Reuses ManagerActionRow for the needs-attention list: its
  // Review/Close buttons are re-gated by real permissions deeper down (the
  // quick-view and detail page), so reuse here never grants Engineer an
  // action they don't actually have.
  const engBase = { AND: [{ deleted_at: null }, visibilityFilter] };
  const engData = isEngineer
    ? await Promise.all([
        Promise.all([
          safeNum(prisma.work_orders.count({ where: { AND: [engBase, { status: "Under Review" }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [engBase, { status: { in: ["Approved", "Assigned", "In Progress", "Materials Issued"] } }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [engBase, { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } }] } })),
          // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 3:
          // "Reviewed / Sent to Manager" — Under Review Job Cards that already
          // have a work_order.review audit entry (status itself never
          // changes, so this is the only way to count "my review is done,
          // waiting on Manager" vs. "still needs my review").
          prisma.work_orders
            .findMany({ where: { AND: [engBase, { status: "Under Review" }] }, select: { id: true } })
            .then((rows) => getReviewedWorkOrderIds(rows.map((r) => r.id)))
            .then((reviewedIds) => reviewedIds.size)
            .catch(() => 0),
        ]),
        prisma.work_orders
          .findMany({
            where: { AND: [engBase, { status: { in: ["Under Review", "In Progress"] } }] },
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
            take: 5,
          })
          .then(async (rows): Promise<MgActionRow[]> => {
            const reviewedIds = await getReviewedWorkOrderIds(
              rows.filter((r) => r.status === "Under Review").map((r) => r.id)
            );
            return rows.map((r) => ({
              id:                        r.id,
              work_order_number:         r.work_order_number,
              status:                    r.status,
              updated_at:                r.updated_at.toISOString(),
              created_at:                r.created_at.toISOString(),
              description_of_work:       r.description_of_work ?? null,
              asset_name:                r.assets?.asset_name ?? null,
              materials_request_status:  r.parts_requests[0]?.status ?? null,
              reviewed:                  reviewedIds.has(r.id),
            }));
          })
          .catch((): MgActionRow[] => []),
      ])
    : null;

  const engQueue  = engData?.[0] ?? null;
  const engAction = (engData?.[1] ?? []) as MgActionRow[];

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
  const recentlyClosedSince = new Date();
  recentlyClosedSince.setDate(recentlyClosedSince.getDate() - 14);

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
      .then((rows): TechJobRow[] => rows.map((r) => ({
        id: r.work_order_id,
        work_order_number: r.work_orders.work_order_number,
        status: r.work_orders.status,
        assigned_at: r.assigned_at.toISOString(),
        operator_complaint: r.work_orders.operator_complaint,
        asset_name: r.work_orders.assets?.asset_name ?? null,
        plate_number: r.work_orders.assets?.plate_number ?? null,
        materials_request_status: r.work_orders.parts_requests[0]?.status ?? null,
      })))
      .catch((): TechJobRow[] => []),
  ]) : [null, [] as TechJobRow[]];

  // ── Store Keeper data ────────────────────────────────────────────
  // Store Dashboard + Store Issue + Material Ledger Alignment Task 3: Low
  // Stock Materials (parts.status) is dropped — it named a raw part
  // shortage, not anything Store could act on from this dashboard, and
  // wasn't a Materials Request/Job Card queue like the other cards. Replaced
  // with "Ready for Issue" (Approved requests Store can issue right now) and
  // "Issued Today" (visibility into today's completed issues). "Store
  // Follow-up" now covers only Waiting Stock/Partially Issued — Approved is
  // no longer folded into it now that it has its own card.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Store Send Materials Approval Gate Unit Task 4: an "Approved" Materials
  // Request whose linked Job Card is still Created/Under Review isn't
  // actually ready for Store — it's folded into "Waiting Manager Approval"
  // (skQueue[4]) instead of "Ready for Issue" (skQueue[1]).
  const [skQueue, skRecent] = isStoreKeeper ? await Promise.all([
    Promise.all([
      safeNum(prisma.parts_requests.count({ where: { status: "Requested" } })),
      safeNum(prisma.parts_requests.count({ where: { status: "Approved", work_orders: { status: { notIn: ["Created", "Under Review"] } } } })),
      safeNum(prisma.parts_requests.count({ where: { status: { in: ["Waiting Stock", "Partially Issued"] } } })),
      safeNum(prisma.offline_inventory_movements.count({
        where: { deleted_at: null, movement_type: "ISSUED", movement_date: { gte: todayStart } },
      })),
      safeNum(prisma.parts_requests.count({ where: { status: "Approved", work_orders: { status: { in: ["Created", "Under Review"] } } } })),
    ]),
    prisma.parts_requests
      .findMany({
        where: { status: { in: OPEN_PR_STATUSES } },
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          created_at: true,
          work_orders: { select: { work_order_number: true, status: true, assets: { select: { asset_name: true, plate_number: true } } } },
          parts_request_items: { select: { description: true, quantity_requested: true }, take: 3 },
        },
        orderBy: { created_at: "asc" },
        take: 5,
      })
      .then((rows): StoreRequestRow[] =>
        rows.map((r) => ({
          id:                   r.id,
          parts_request_number: r.parts_request_number,
          status:               r.status,
          created_at:           r.created_at.toISOString(),
          work_order_number:    r.work_orders?.work_order_number ?? null,
          work_order_status:    r.work_orders?.status ?? null,
          asset_name:           r.work_orders?.assets?.asset_name ?? null,
          plate_number:         r.work_orders?.assets?.plate_number ?? null,
          item_summary:         r.parts_request_items.length
            ? r.parts_request_items.map((i) => `${i.description} x${Number(i.quantity_requested)}`).join(", ")
            : null,
        }))
      )
      .catch((): StoreRequestRow[] => []),
  ]) : [null, [] as StoreRequestRow[]];

  // ── Super Admin data ─────────────────────────────────────────────
  const [saCount, saRecent] = isSuperAdmin ? await Promise.all([
    Promise.all([
      safeNum(prisma.assets.count({ where: { deleted_at: null } })),
      safeNum(prisma.work_orders.count({ where: { deleted_at: null, status: { notIn: ["Closed", "Rejected", "Cancelled"] } } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, { parts_requests: { some: { status: { in: OPEN_PR_STATUSES } } } }] } })),
      // Store Follow-up: Materials Requests that need Store to arrange or
      // update materials — Approved (ready for Store), Waiting Stock, and
      // Partially Issued. Dashboard framing intentionally includes Approved
      // (unlike the Materials Requests list page's own "Store Follow-up"
      // tab, which covers only Waiting Stock/Partially Issued) since here it
      // means "needs Store attention" broadly.
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
      .then((rows): WoRow[] => rows.map((r) => ({
        id: r.id,
        work_order_number: r.work_order_number,
        status: r.status,
        updated_at: r.updated_at.toISOString(),
        asset_name: r.assets?.asset_name ?? null,
        materials_request_status: r.parts_requests[0]?.status ?? null,
      })))
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
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        reviewed: previewReviewed,
        closeHref: "/dashboard",
      }
    : null;

  const firstName = context.profile.full_name.split(" ")[0];

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      {/* Enterprise Real-Time Update Foundation Unit Task 6: dashboard
          refreshes fast on any job card, materials request, store send, or
          notification signal — AutoRefresh above stays as the 15s fallback. */}
      <RealtimeRefresh watch={["job_card.", "work_order.", "materials_request.", "store_materials.", "notification."]} />
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Here's what needs your attention today."
      />
      <div className="space-y-4 p-4 pb-8 sm:p-5">

        {/* ── NORMAL USER ─────────────────────────────────────────── */}
        {isNormalUser && nuQueue && (
          <>
            {/* New (not yet submitted) alert */}
            {nuQueue[5] > 0 && (
              <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <p className="flex-1 text-sm font-semibold text-amber-800">
                  {nuQueue[5]} Job Card{nuQueue[5] !== 1 ? "s" : ""} not yet submitted for review.
                </p>
                <Link href="/maintenance/work-orders?status=New" className="shrink-0 rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-100">
                  View
                </Link>
              </div>
            )}

            {/* Quick Actions — Task 7: "View My Job Cards" reads as a link
                into the same Job Cards register, not a separate module. */}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Create New Job Card" href="/maintenance/work-orders/new" icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="View My Job Cards"   href="/maintenance/work-orders"     icon={ClipboardList} iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Open Materials Requests" href="/store/parts-requests"    icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assets & Equipment"  href="/assets"                      icon={Gauge}        iconBg="bg-blue-50"   iconColor="text-blue-600" />
            </div>

            {/* KPI Queue */}
            <section className="space-y-2">
              <SectionLabel>My Work Today</SectionLabel>
              <KpiRow cols="sm:grid-cols-5" cards={[
                { label: "My Open Job Cards",  value: nuQueue[0], icon: ClipboardList, tone: "blue",                             href: "/maintenance/work-orders" },
                { label: "Waiting Review",     value: nuQueue[1], icon: Clock,         tone: nuQueue[1] > 0 ? "blue"  : "gray",  href: "/maintenance/work-orders?status=Review" },
                { label: "Waiting Materials",  value: nuQueue[3], icon: AlertTriangle, tone: nuQueue[3] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Materials" },
                // "Ready for My Update" replaces the old "Approved / Ready"
                // card (Task 2) — Approved Job Cards aren't Data Entry's turn
                // to act on; Assigned ones are (mark work started).
                { label: "Ready for My Update", value: nuQueue[6], icon: CheckCircle2,  tone: nuQueue[6] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Assigned" },
                { label: "In Progress",         value: nuQueue[2], icon: Wrench,        tone: nuQueue[2] > 0 ? "blue"  : "gray",  href: "/maintenance/work-orders?status=In+Progress" },
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

        {/* ── MAINTENANCE MANAGER ──────────────────────────────────── */}
        {isManager && mgQueue && (
          <>
            {/* Quick Actions — 6 items in 2-column / 3-column layout */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QuickAction label="Review Job Cards"   href="/maintenance/work-orders?status=Review"   icon={ClipboardList} iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Materials Requests" href="/store/parts-requests"                    icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assign Work"        href="/maintenance/work-orders?status=Approved" icon={Users}         iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Offline Inventory"  href="/store/offline-inventory"                 icon={Package}       iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Service Contracts"  href="/assets/service-contracts"                icon={FileText}      iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Reports"            href="/reports"                                 icon={BarChart3}     iconBg="bg-gray-100"  iconColor="text-[#4B5563]" />
            </div>

            {/* Manager Queue KPI — Manager Dashboard Approval Queue Fix Task 2:
                "Waiting Manager Approval" and "Waiting Engineer Review" split
                a single "Under Review" count that used to hide which of
                those Job Cards were actually the Manager's turn to act on. */}
            <section className="space-y-2">
              <SectionLabel>Manager Queue</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-5" cards={[
                { label: "Waiting Manager Approval",  value: mgQueue[0], icon: CheckCircle2,   tone: mgQueue[0] > 0 ? "red"   : "green", href: "/maintenance/work-orders?status=Review", detail: "Reviewed by Engineer" },
                { label: "Waiting Engineer Review",   value: mgQueue[1], icon: Clock,          tone: mgQueue[1] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Review" },
                { label: "Approved / Active",         value: mgQueue[2], icon: Wrench,         tone: "blue",                              href: "/maintenance/work-orders" },
                { label: "Open Materials Requests",   value: mgQueue[3], icon: AlertTriangle,  tone: mgQueue[3] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Materials" },
                { label: "Ready to Assign",           value: mgQueue[4], icon: Users,          tone: mgQueue[4] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=ReadyToAssign" },
              ]} />
            </section>

            {/* Needs Your Action — three ordered groups. Manager Dashboard
                Preview Routing Fix Task 4: a Materials Request blocked on
                its own Job Card's approval (or with no linked Job Card at
                all) is grouped under "Job Card Approvals", not "Materials
                Request Approvals" — it isn't an independent Materials
                Request action until the Job Card is approved. */}
            <ActivityList
              title="Needs Your Action"
              viewAllHref="/maintenance/work-orders"
              empty={
                mgWaitingApprovalAll.length === 0 &&
                mgMaterialsNeedingApproval.length === 0 &&
                mgReadyToAssignRows.length === 0
              }
            >
              {/* Unified Manager Job Card + Materials Approval Flow Fix Task
                  1/2: a Materials Request blocked by its own Job Card's
                  approval is NEVER rendered as its own row anymore — that Job
                  Card is either already shown here (reviewed, with its
                  materials status inline via ManagerActionRow's "Materials:"
                  badge) or not yet reviewed by Engineer (correctly not shown
                  to Manager at all yet). Rendering mgMaterialsBlockedOnJobCard
                  as a second row for the same Job Card was exactly the
                  reported duplicate ("REC/MD/MECH/JOB/0027 appears twice"). */}
              {mgWaitingApprovalAll.length > 0 && (
                <>
                  <ActivityGroupLabel>Job Card Approvals</ActivityGroupLabel>
                  {mgWaitingApprovalAll.map((row) => (
                    <ManagerActionRow
                      key={row.id}
                      row={row}
                      action={{ label: "Review & Approve", style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700" }}
                    />
                  ))}
                </>
              )}
              {mgMaterialsNeedingApproval.length > 0 && (
                <>
                  <ActivityGroupLabel>Materials Request Approvals</ActivityGroupLabel>
                  {mgMaterialsNeedingApproval.map((row) => <MaterialsApprovalRow key={row.id} row={row} />)}
                </>
              )}
              {mgReadyToAssignRows.length > 0 && (
                <>
                  <ActivityGroupLabel>Ready to Assign</ActivityGroupLabel>
                  {mgReadyToAssignRows.map((row) => (
                    <ManagerActionRow
                      key={row.id}
                      row={row}
                      action={{ label: "Assign", style: "border-[#2563EB] bg-[#2563EB] text-white hover:bg-blue-700" }}
                    />
                  ))}
                </>
              )}
            </ActivityList>

            {/* Open Materials Requests — only shown when open requests exist.
                Renamed from "Materials Waiting": Store arranges materials, so
                this reads as a follow-up queue, not a blocked/stuck state. */}
            {mgMaterials.length > 0 && (
              <ActivityList title="Open Materials Requests" viewAllHref="/store/parts-requests" empty={false}>
                {mgMaterials.map((row) => <PrRow key={row.id} row={row} />)}
              </ActivityList>
            )}
          </>
        )}

        {/* ── MAINTENANCE ENGINEER ─────────────────────────────────── */}
        {isEngineer && engQueue && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Job Cards"          href="/maintenance/work-orders?status=Review" icon={ClipboardList} iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Materials Requests" href="/store/parts-requests"                   icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assets & Equipment" href="/assets"                                  icon={Gauge}         iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Notifications"      href="/notifications"                           icon={Bell}          iconBg="bg-green-50"  iconColor="text-green-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>Engineer Queue</SectionLabel>
              <KpiRow cols="sm:grid-cols-2 xl:grid-cols-4" cards={[
                { label: "Under Review",              value: engQueue[0], icon: Clock,         tone: engQueue[0] > 0 ? "red" : "green", href: "/maintenance/work-orders?status=Review" },
                { label: "Reviewed / Sent to Manager", value: engQueue[3], icon: CheckCircle2,  tone: engQueue[3] > 0 ? "blue" : "gray", href: "/maintenance/work-orders?status=Review", detail: "Waiting on Manager approval" },
                { label: "Approved / Active",          value: engQueue[1], icon: Wrench,        tone: "blue",                             href: "/maintenance/work-orders" },
                { label: "Open Materials Requests",    value: engQueue[2], icon: AlertTriangle, tone: engQueue[2] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Materials" },
              ]} />
            </section>

            <ActivityList title="Job Cards Needing Action" viewAllHref="/maintenance/work-orders" empty={engAction.length === 0}>
              {engAction.map((row) => <ManagerActionRow key={row.id} row={row} />)}
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
        {isStoreKeeper && skQueue && (
          <>
            {/* Store Issue Materials + Offline Inventory Separation Unit
                Task 10: Materials Requests, Issue Materials, Sent Materials,
                Notifications — Offline Inventory Control is no longer a
                Store quick action; Issue Materials and Sent Materials
                (the relabeled movement history) replace it. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <QuickAction label="Materials Requests" href="/store/parts-requests"              icon={ShoppingCart} iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Send Materials"     href="/store/issue-materials"              icon={Upload}       iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Sent Materials"     href="/store/offline-inventory/movements"  icon={Activity}     iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Notifications"      href="/notifications"                      icon={Bell}         iconBg="bg-green-50"  iconColor="text-green-600" />
            </div>

            {/* Task 3: Low Stock Materials removed (named a raw part
                shortage, not anything actionable from here) — replaced with
                "Ready for Issue" (Approved requests) and "Issued Today".
                Store Follow-up now covers only Waiting Stock/Partially
                Issued, matching the list page's own simplified grouping. */}
            <section className="space-y-2">
              <SectionLabel>Materials Queue</SectionLabel>
              <KpiRow cols="sm:grid-cols-2 xl:grid-cols-4" cards={[
                { label: "Waiting Manager Approval", value: skQueue[0] + skQueue[4], icon: ClipboardList, tone: (skQueue[0] + skQueue[4]) > 0 ? "red" : "green", href: "/store/issue-materials" },
                { label: "Ready for Issue",           value: skQueue[1], icon: CheckCircle2,  tone: skQueue[1] > 0 ? "amber" : "green", href: "/store/issue-materials", detail: "Approved — Store can issue now" },
                { label: "Store Follow-up",           value: skQueue[2], icon: Package,       tone: skQueue[2] > 0 ? "amber" : "green", href: "/store/issue-materials", detail: "Waiting stock / partially issued" },
                { label: "Issued Today",              value: skQueue[3], icon: Activity,      tone: "blue",                              href: "/store/offline-inventory/movements" },
              ]} />
            </section>

            <ActivityList title="Needs Store Action" viewAllHref="/store/issue-materials" empty={skRecent.length === 0}>
              {skRecent.map((row) => <StoreRequestRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── SUPER ADMIN ─────────────────────────────────────────── */}
        {isSuperAdmin && saCount && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <QuickAction label="Create Job Card"     href="/maintenance/work-orders/new" icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Assets & Equipment"  href="/assets"                      icon={Gauge}        iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Materials Requests"  href="/store/parts-requests"        icon={ShoppingCart} iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Offline Inventory"   href="/store/offline-inventory"     icon={Package}      iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Users"               href="/admin/users"                 icon={Users}        iconBg="bg-violet-50" iconColor="text-violet-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>System Overview</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-5" cards={[
                { label: "Total Assets",            value: saCount[0], icon: Gauge,         tone: "blue",                              href: "/assets" },
                { label: "Open Job Cards",           value: saCount[1], icon: ClipboardList, tone: saCount[1] > 0 ? "amber" : "green", href: "/maintenance/work-orders" },
                { label: "Open Materials Requests",  value: saCount[2], icon: AlertTriangle, tone: saCount[2] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Materials", detail: "Materials requested for Job Cards" },
                { label: "Store Follow-up",          value: saCount[3], icon: Package,       tone: saCount[3] > 0 ? "amber" : "green", href: "/store/parts-requests", detail: "Materials for Store action" },
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
          <RepairOrderQuickView data={drawerData} />
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
