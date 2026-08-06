import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Car,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  Package,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  ShieldAlert,
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
import {
  getMaterialFulfillmentForWorkOrder,
  getMaterialFulfillmentForWorkOrders,
  anyMaterialsIncomplete,
  summarizeMaterialAvailability,
} from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummariesBulk } from "@/lib/work-orders/work-session-totals";
import { getMaterialBalancesForItems } from "@/lib/store/offline-inventory-data";
import { hasPermission, canViewCosts as canViewCostsForContext } from "@/lib/security/permissions";
import { VEHICLE_CATEGORIES } from "@/lib/assets/categories";
import { getExpiryStatus } from "@/lib/assets/vehicle-status";
import { StoreSendMaterialsPopup } from "@/components/store/store-send-materials-popup";
import { VehicleExpiryModal, type VehicleExpiryAlertRow } from "@/components/dashboard/vehicle-expiry-modal";
import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { getAssetPickerOptions } from "@/lib/assets/picker-options";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";
import { getTechnicianPickerOptions } from "@/lib/technicians/picker-options";

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
  // Approval Workflow Unit 4: the primary Manager decision point now.
  if (status === "Closure Requested") {
    return {
      label: "Approve Closure",
      style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700",
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
// One-Screen Data Entry Dashboard Unit 9E, Task 3: added an optional
// `primary` visual variant (filled brand-red card, white text) so "Open
// Daily Activity" can be the visually important first quick action without
// duplicating this component — every other existing call site (Manager/
// Engineer/etc. sections below) omits `primary` and renders exactly as
// before.
// Final One-Screen Dashboard UI Polish Unit 9E.3, Task 4: added an optional
// `compact` size — smaller padding/icon/arrow, used only by the Data Entry
// Quick Actions panel now that it sits in a narrow side column beside Needs
// Attention. Every other existing call site (Manager/Engineer/etc.) omits
// it and renders exactly as before.
function QuickAction({ label, subtitle, href, icon: Icon, iconBg, iconColor, primary = false, compact = false }: {
  label: string; subtitle?: string; href: string; icon: LucideIcon; iconBg?: string; iconColor?: string; primary?: boolean; compact?: boolean;
}) {
  const pad = compact ? "px-3 py-2" : "px-4 py-3";
  const iconBox = compact ? "h-7 w-7" : "h-8 w-8";
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const arrowSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  if (primary) {
    return (
      <Link
        href={href}
        className={`group flex items-center gap-2.5 rounded-md border border-[#ED1C24] bg-[#ED1C24] ${pad} shadow-sm transition hover:-translate-y-0.5 hover:bg-[#c8181e] hover:shadow-md`}
      >
        <span className={`flex ${iconBox} shrink-0 items-center justify-center rounded-lg bg-white/15`}>
          <Icon className={`${iconSize} text-white`} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-white">{label}</span>
          {subtitle && (
            <span className="block truncate text-[11px] font-medium text-white/80">{subtitle}</span>
          )}
        </span>
        <ArrowRight className={`ml-auto ${arrowSize} shrink-0 text-white/80 transition group-hover:translate-x-0.5`} aria-hidden="true" />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-md border border-[#DDE2EA] bg-white ${pad} shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md`}
    >
      <span className={`flex ${iconBox} shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`${iconSize} ${iconColor}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-[#111827]">{label}</span>
        {subtitle && (
          <span className="block truncate text-[11px] font-medium text-[#9CA3AF]">{subtitle}</span>
        )}
      </span>
      <ArrowRight className={`ml-auto ${arrowSize} shrink-0 text-[#D1D5DB] transition group-hover:translate-x-0.5 group-hover:text-[#6B7280]`} aria-hidden="true" />
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">{children}</p>;
}

// Dashboard Card Sizing and Section Alignment Polish Unit 9E.5, Task 1: sized
// up moderately from Unit 9E.4's very compact version — card height now
// lands around 60-64px (px-3 py-2.5 + a text stack of roughly that height),
// icon box around 32px (p-2 wrapper + h-4 w-4 glyph), value bumped to
// text-lg for a visually stronger number — while staying a compact
// horizontal card (icon + label + value in one row), nowhere near the
// original tall vertical `StatCard`.
function TodaySummaryCard({ href, label, value, icon: Icon, tone }: {
  href: string; label: string; value: number | string; icon: LucideIcon; tone: "red" | "amber" | "green" | "blue" | "gray";
}) {
  const toneClass = {
    red: "bg-[#ED1C24]",
    amber: "bg-[#F59E0B]",
    green: "bg-[#16A34A]",
    blue: "bg-[#2563EB]",
    gray: "bg-[#6B7280]",
  }[tone];
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5 transition hover:border-[#2563EB] hover:shadow-sm"
    >
      <span className={`inline-flex shrink-0 rounded-md p-2 text-white ${toneClass}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-black uppercase leading-tight text-[#6B7280]">{label}</span>
        <span className="block text-lg font-black leading-tight text-[#111827]">{value}</span>
      </span>
    </Link>
  );
}

// Dashboard Card Sizing and Section Alignment Polish Unit 9E.5, Task 2: sized
// up to match `TodaySummaryCard`'s new footprint exactly (same padding, same
// icon box, same arrow size) — Quick Actions and Today Summary now share one
// visibly consistent card system. `accent` still means a red left bar + red
// icon tint + red hover ring, never a filled red tile — red stays a small
// accent, not a dominant surface, even at this slightly larger size.
function QuickActionTile({ href, title, helper, icon: Icon, iconBg, iconColor, accent = false }: {
  href: string; title: string; helper: string; icon: LucideIcon; iconBg: string; iconColor: string; accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2 rounded-md border-l-4 bg-white px-3 py-2.5 ring-1 transition hover:shadow-sm ${
        accent ? "border-l-[#ED1C24] ring-[#E5E7EB] hover:ring-[#ED1C24]" : "border-l-transparent ring-[#E5E7EB] hover:ring-[#2563EB]"
      }`}
    >
      <span className={`inline-flex shrink-0 rounded-md p-2 ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black leading-tight text-[#111827]">{title}</span>
        <span className="block truncate text-[11px] leading-tight text-[#9CA3AF]">{helper}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[#D1D5DB] transition group-hover:translate-x-0.5 group-hover:text-[#6B7280]" aria-hidden="true" />
    </Link>
  );
}

// One-Screen Data Entry Dashboard Unit 9E, Task 5/6/7 — a compact row for
// the Needs Attention list: number/asset/issue on the left, one colored
// stage badge + one recommended action on the right. The whole row is a
// single <Link> to that one action (same "whole row is the click target,
// action text is just a label" convention WoRow/NuJobCardRow already use
// elsewhere on this dashboard) — never more than one clickable action.
type NeedsAttentionBadgeTone = "red" | "amber" | "green" | "blue" | "gray";
type NeedsAttentionItem = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  badgeLabel: string;
  badgeTone: NeedsAttentionBadgeTone;
  actionLabel: string;
  actionHref: string;
};

function NeedsAttentionRow({ item }: { item: NeedsAttentionItem }) {
  return (
    <Link
      href={item.actionHref}
      className="group flex items-center gap-2.5 px-3.5 py-2.5 transition hover:bg-[#F8FAFC]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#111827] group-hover:text-[#ED1C24]">
          {item.workOrderNumber ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
          {item.assetLabel && <span className="ml-2 text-xs font-normal text-[#6B7280]">· {item.assetLabel}</span>}
        </p>
        <p className="truncate text-xs text-[#6B7280]">{item.issue}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusBadge label={item.badgeLabel} tone={item.badgeTone} />
        <span className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition group-hover:border-[#ED1C24] group-hover:text-[#ED1C24]">
          {item.actionLabel}
        </span>
      </div>
    </Link>
  );
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

// One-Screen Dashboard No-Scroll Unit 9E.2, Task 5: `compact` strips this
// down to exactly the preview row shape the task specifies — Job Card #,
// asset, one status badge, View — for the Recent Job Cards preview (max 3
// rows). Non-compact (default) is unchanged, byte-identical to before, in
// case another surface ever needs the fuller row again.
function NuJobCardRow({ row, compact = false }: { row: NuJobCardRow; compact?: boolean }) {
  const subtitle = [row.asset_name, row.issue_summary].filter(Boolean).join(" · ");
  const showMaterialsBadge =
    row.materials_request_status && !JOB_CARD_STATUS_ALREADY_SHOWS_MATERIALS.includes(row.status);
  return (
    <Link
      href={`?preview=${row.id}`}
      className={`group flex items-center gap-3 transition hover:bg-[#F8FAFC] ${compact ? "px-3.5 py-2" : "px-4 py-3"}`}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold text-[#111827] group-hover:text-[#ED1C24]">
          {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
        </p>
        {!compact && subtitle && <p className="truncate text-xs text-[#6B7280]">{subtitle}</p>}
        {compact && row.asset_name && <p className="truncate text-xs text-[#6B7280]">{row.asset_name}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
        {(() => {
          const simplified = displaySimplifiedStatus(row.status);
          return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
        })()}
        {!compact && row.has_pending_correction && (
          <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
        )}
        {!compact && showMaterialsBadge && (
          <StatusBadge
            label={materialsRequestBadgeLabel(row.materials_request_status!)}
            tone={partsRequestStatusTone(row.materials_request_status!)}
          />
        )}
        {!compact && (
          <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.created_at)}</span>
        )}
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
  // Close/Approve Closure require the full Job Card page (the closure note
  // form lives there, not in the quick-view — see workflow-actions.tsx);
  // Approve/Assign/Review/View open the quick-view modal via ?preview.
  const actionHref =
    action.label === "Close" || action.label === "Approve Closure"
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
type PageProps = {
  searchParams?: Promise<{
    preview?: string;
    sendPreview?: string;
    success?: string;
    new_job_card?: string;
    asset_id?: string;
    vehicleExpiry?: string;
  }>;
};

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
  // One-Screen Data Entry Dashboard Unit 9E, Task 12: the sample size used
  // for both the Needs Attention list and the derived Materials Pending/
  // Working Now/Paused/Ready for Closure counts below — same "compute over
  // the most-recently-updated N active Job Cards" convention the Daily
  // Activity page (Unit 9/9C) already established for its own summary
  // cards, not an exhaustive company-wide scan. Kept smaller than Daily
  // Activity's own 50-row page cap since this is a dashboard widget loaded
  // far more often, not the dedicated control board.
  const NU_ACTIVE_SAMPLE_SIZE = 30;
  const NU_DRAFT_SAMPLE_SIZE = 5;
  // One-Screen Dashboard No-Scroll Unit 9E.2, Task 3/10: 4, not 5 — the
  // smaller cap that actually fits the "Needs Attention visible without
  // scrolling, beside Quick Actions" layout this unit introduces.
  const NU_NEEDS_ATTENTION_LIMIT = 4;
  // Dashboard Quick Actions Compact Tile UI Polish Unit 9E.4, Task 5: 2, not
  // 3 — Recent Job Cards now lives in the narrower column beside Needs
  // Attention Today (Option A layout), so it shrinks once more to stay a
  // small secondary preview rather than competing for height.
  const NU_RECENT_LIMIT = 2;

  const [nuQueue, nuActiveSample, nuDraftSample, nuRecentRows] = isNormalUser ? await Promise.all([
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
      // Approval Workflow Unit 4: correctionCount is still computed (drives
      // the "needs your correction" alert below and the per-row secondary
      // "Needs Update" badge). closureRequestedCount replaces the old
      // separate approvedCount — "Approved" is folded into Active now (no
      // Manager approval before starting a Job Card any more), and "Closure
      // Requested" is the new bucket that actually needs Data Entry's
      // attention (Manager is deciding on their closure request). Both id
      // sets are checked together since a pending correction can outlive
      // "Under Review" once materials already progressed (Task 1/10, prior
      // phase).
      const pendingCorrectionIds = await getPendingCorrectionWorkOrderIds([
        ...underReviewRows.map((r) => r.id),
        ...openRows.map((r) => r.id),
      ]);
      const [draftCount, activeCount, closureRequestedCount, closedRecentCount] = await Promise.all([
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Created" }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Closure Requested" }] } })),
        safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Closed", updated_at: { gte: recentlyClosedSince } }] } })),
      ]);
      return {
        draftCount,
        submittedCount: underReviewRows.length,
        activeCount,
        closureRequestedCount,
        correctionCount: pendingCorrectionIds.size,
        closedRecentCount,
      };
    }),
    // Task 5/12 — lean sample of active Job Cards (same select shape as the
    // Daily Activity page's own list query: no attachments, no audit logs,
    // no full session/material-movement history) used for the Needs
    // Attention list and the Materials Pending/Working Now/Paused/Ready for
    // Closure summary counts below.
    prisma.work_orders.findMany({
      where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] },
      orderBy: { updated_at: "desc" },
      take: NU_ACTIVE_SAMPLE_SIZE,
      select: {
        id: true,
        work_order_number: true,
        status: true,
        updated_at: true,
        operator_complaint: true,
        description_of_work: true,
        assets: { select: { asset_name: true, plate_number: true } },
        work_order_assignments: { select: { id: true } },
        parts_requests: { select: { id: true, status: true } },
      },
    }).catch(() => []),
    // Task 5 — small separate sample just for the "Draft Not Started"
    // bucket (a draft is never in ACTIVE_JOB_CARD_STATUSES, so it can't come
    // from the query above).
    prisma.work_orders.findMany({
      where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Created" }] },
      orderBy: { updated_at: "desc" },
      take: NU_DRAFT_SAMPLE_SIZE,
      select: {
        id: true,
        work_order_number: true,
        updated_at: true,
        operator_complaint: true,
        description_of_work: true,
        assets: { select: { asset_name: true, plate_number: true } },
      },
    }).catch(() => []),
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
        take: NU_RECENT_LIMIT,
      })
      .catch(() => []),
  ]) : [null, [], [], []];

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

  // Task 5/6/7/12 — Needs Attention: bulk-compute materials fulfillment and
  // labor summaries across the active sample (2 groupBy queries + 2 session
  // queries total, not per-card — the same bulk helpers the Daily Activity
  // page uses), derive one priority bucket per Job Card in this unit's own
  // order (Materials Pending > Worker Paused > Working Now > Needs
  // Assignment > Ready for Closure > Draft), then take the top 4 (Unit 9E.2,
  // Task 3/10 — tightened down from Unit 9E's original top 5).
  let nuNeedsAttention: NeedsAttentionItem[] = [];
  let nuMaterialsPendingCount = 0;
  let nuWorkingNowCount = 0;
  let nuPausedCount = 0;
  let nuReadyForClosureCount = 0;
  if (isNormalUser && nuActiveSample.length) {
    const activeIds = nuActiveSample.map((w) => w.id);
    const [fulfillmentMap, laborMap] = await Promise.all([
      getMaterialFulfillmentForWorkOrders(prisma, activeIds),
      getWorkOrderLaborSummariesBulk(prisma, activeIds),
    ]);
    // Data Entry already holds work_orders.assign (Unit 7) in every seeded
    // role configuration — computed via the real permission check anyway
    // (not hardcoded true) so this degrades safely if that ever changes.
    const canAssignWorkers = hasPermission(context, "work_orders.assign") || context.role?.slug === "super_admin";

    type Bucketed = NeedsAttentionItem & { rank: number; updatedAt: string };
    const candidates: Bucketed[] = [];

    for (const wo of nuActiveSample) {
      const detailHref = `/maintenance/work-orders/${wo.id}`;
      const fulfillment = fulfillmentMap.get(wo.id) ?? [];
      const laborSummary = laborMap.get(wo.id);
      const materialsIncomplete = anyMaterialsIncomplete(fulfillment);
      const pendingMaterialsRequestsCount = wo.parts_requests.filter((r) => r.status !== "Issued").length;
      const activeMaterialsRequest = wo.parts_requests.find((r) =>
        ["Requested", "Approved", "Waiting Stock", "Partially Issued"].includes(r.status)
      );
      const hasAssignment = Boolean(laborSummary?.workers.length) || wo.work_order_assignments.length > 0;
      const hasActiveSession = laborSummary?.has_active_session ?? false;
      const anyWorkerPaused = laborSummary?.workers.some((w) => w.status === "Paused") ?? false;
      const materialsBlocking = pendingMaterialsRequestsCount > 0 || materialsIncomplete;
      const closureReady = pendingMaterialsRequestsCount === 0 && !materialsIncomplete && !hasActiveSession;

      if (materialsBlocking) nuMaterialsPendingCount += 1;
      if (hasActiveSession) nuWorkingNowCount += 1;
      if (anyWorkerPaused && !hasActiveSession) nuPausedCount += 1;
      if (closureReady) nuReadyForClosureCount += 1;

      const assetLabel = wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null;
      const issue = wo.operator_complaint || wo.description_of_work || "No issue description";

      // Task 5 — one bucket per Job Card, its own priority order (not Daily
      // Activity's): Materials Pending is checked first here because on
      // this dashboard a materials block is the single most urgent thing
      // Data Entry can act on, ahead of worker/timer state.
      if (materialsBlocking) {
        candidates.push({
          id: wo.id, rank: 0, updatedAt: wo.updated_at.toISOString(),
          workOrderNumber: wo.work_order_number, assetLabel, issue,
          badgeLabel: "Materials Pending", badgeTone: "red",
          // Task 7 — "View Materials" is the safe default (Data Entry does
          // not necessarily hold the store-issue permission that a
          // "Receive Materials" action would imply); routes straight to the
          // real Materials Request when one exists.
          actionLabel: "View Materials",
          actionHref: activeMaterialsRequest ? `/store/parts-requests/${activeMaterialsRequest.id}` : `${detailHref}#parts`,
        });
      } else if (anyWorkerPaused && !hasActiveSession) {
        candidates.push({
          id: wo.id, rank: 1, updatedAt: wo.updated_at.toISOString(),
          workOrderNumber: wo.work_order_number, assetLabel, issue,
          badgeLabel: "Worker Paused", badgeTone: "amber",
          actionLabel: "Open Daily Activity",
          actionHref: "/maintenance/daily-activity?status=paused",
        });
      } else if (hasActiveSession) {
        candidates.push({
          id: wo.id, rank: 2, updatedAt: wo.updated_at.toISOString(),
          workOrderNumber: wo.work_order_number, assetLabel, issue,
          badgeLabel: "Working Now", badgeTone: "green",
          actionLabel: "Open Daily Activity",
          actionHref: "/maintenance/daily-activity?status=working",
        });
      } else if (!hasAssignment) {
        candidates.push({
          id: wo.id, rank: 3, updatedAt: wo.updated_at.toISOString(),
          workOrderNumber: wo.work_order_number, assetLabel, issue,
          badgeLabel: "Needs Assignment", badgeTone: "blue",
          actionLabel: canAssignWorkers ? "Assign Workers" : "Open Job Card",
          actionHref: canAssignWorkers ? `${detailHref}?editAssignment=1#assignment` : detailHref,
        });
      } else if (closureReady) {
        candidates.push({
          id: wo.id, rank: 4, updatedAt: wo.updated_at.toISOString(),
          workOrderNumber: wo.work_order_number, assetLabel, issue,
          badgeLabel: "Ready for Closure", badgeTone: "blue",
          // One-Screen Dashboard No-Scroll Unit 9E.2, Task 8: "Ready for
          // Closure -> Open Job Card" (not a direct "Request Closure" click
          // from this compact row) — Request Closure still happens on the
          // full Job Card detail page, scrolled straight to the closure
          // panel, so Data Entry sees the full context (materials/worker
          // state) before requesting.
          actionLabel: "Open Job Card",
          actionHref: `${detailHref}#closure-panel`,
        });
      }
      // Anything else (assigned, has recorded sessions, not closure-ready
      // yet, nothing blocking) needs no attention right now — not added.
    }

    for (const wo of nuDraftSample) {
      const assetLabel = wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null;
      const issue = wo.operator_complaint || wo.description_of_work || "No issue description";
      candidates.push({
        id: wo.id, rank: 5, updatedAt: wo.updated_at.toISOString(),
        workOrderNumber: wo.work_order_number, assetLabel, issue,
        badgeLabel: "Draft", badgeTone: "gray",
        // Opens the existing quick-view preview modal, the same "View"
        // pattern every other row on this dashboard already uses — no new
        // navigation surface introduced.
        actionLabel: "Open Job Card",
        actionHref: `?preview=${wo.id}`,
      });
    }

    nuNeedsAttention = candidates
      .sort((a, b) => a.rank - b.rank || (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, NU_NEEDS_ATTENTION_LIMIT);
  }

  // ── Manager data ─────────────────────────────────────────────────
  // Manager Dashboard Approval Queue Fix: Job Card status stays "Under
  // Review" through both the Engineer-review and Manager-approval steps (no
  // new status added), so a single "Under Review" count/queue can't tell
  // Manager which of those Job Cards are actually ready for their decision —
  // that split is derived here from the work_order.review audit entry
  // (lib/work-orders/review-status.ts), the same mechanism the Engineer
  // dashboard and Job Cards list already use.
  const mgBase = { AND: [{ deleted_at: null }, visibilityFilter] };

  // One-Screen Manager Dashboard Unit 10, Task 12: sample size for the
  // active Job Cards used for the KPI row / attention board / labor
  // snapshots below — same "compute over the most-recently-updated N active
  // Job Cards" convention Daily Activity and the Data Entry dashboard
  // already established, not an exhaustive company-wide scan.
  const MG_ACTIVE_SAMPLE_SIZE = 30;
  // Task 4 — a Job Card's total hours today at/above this counts as "High
  // Labor Hours" for the attention board (one full single-shift day).
  const MG_HIGH_LABOR_HOURS_THRESHOLD = 8;
  // Task 8 — vehicle documents expiring within this many days (or already
  // expired) surface in the Vehicle Expiry snapshot/KPI.
  const MG_VEHICLE_EXPIRY_WINDOW_DAYS = 15;

  // Simplified Job Card Approval Workflow Unit Task 4/8: no more Engineer-
  // review split, no more separate Materials Request approval queue (it's
  // auto-approved alongside the Job Card by approveJobCardAndMaterials) —
  // one queue (Under Review, full detail, kept only for the small Legacy
  // section — Task 10/11) plus plain counts. One-Screen Manager Dashboard
  // Unit 10: the old "In Progress ready to directly close" query/section is
  // removed — closure approval is now the one Manager approval path this
  // dashboard features (Task 1/10); the direct-close action itself is
  // untouched and still reachable from the Job Card detail page.
  const [mgData, mgClosureRequestedAll, offlineMovementsToday, mgActiveSample, mgVehicleSource] = await Promise.all([
    isManager
      ? Promise.all([
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
          // Approval Workflow Unit 4: "Approved" is folded into "Active" now
          // (no Manager approval before starting a Job Card any more) —
          // Closure Requested is the new Manager-facing decision count.
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: "Closure Requested" }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] } })),
        ])
      : Promise.resolve(null),
    // Approval Workflow Unit 4, Task 9: Job Cards waiting for Manager to
    // approve a pending closure request — the primary Manager decision now.
    // Task 9 (Unit 10): "requested by" needs the requester's name, resolved
    // in bulk below via created_by.
    isManager
      ? prisma.work_orders.findMany({
          where: { AND: [mgBase, { status: "Closure Requested" }] },
          select: {
            id: true,
            work_order_number: true,
            status: true,
            updated_at: true,
            created_at: true,
            description_of_work: true,
            created_by: true,
            assets: { select: { asset_name: true } },
            parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
          },
          orderBy: { updated_at: "asc" },
        })
      : Promise.resolve([] as Array<{
          id: string;
          work_order_number: string | null;
          status: string;
          updated_at: Date;
          created_at: Date;
          description_of_work: string | null;
          created_by: string | null;
          assets: { asset_name: string } | null;
          parts_requests: { status: string }[];
        }>),
    // Shared by Manager's and Store Keeper's "Offline Inventory Control" KPI.
    (isManager || isStoreKeeper)
      ? safeNum(prisma.offline_inventory_movements.count({
          where: { deleted_at: null, movement_date: { gte: todayStart } },
        }))
      : Promise.resolve(0),
    // Task 3/4/5/6/12 — lean sample of active Job Cards (same select shape
    // as the Daily Activity page's own list query) feeding the KPI row,
    // attention board, and labor/Job-Card-cost snapshots below.
    isManager
      ? prisma.work_orders.findMany({
          where: { AND: [mgBase, { status: { in: ACTIVE_JOB_CARD_STATUSES } }] },
          orderBy: { updated_at: "desc" },
          take: MG_ACTIVE_SAMPLE_SIZE,
          select: {
            id: true,
            work_order_number: true,
            status: true,
            updated_at: true,
            operator_complaint: true,
            description_of_work: true,
            assets: { select: { asset_name: true, plate_number: true } },
            work_order_assignments: { select: { id: true } },
            parts_requests: { select: { id: true, status: true } },
          },
        })
      : Promise.resolve([]),
    // Task 8/12 — lean vehicle-category asset read (5 columns only, no
    // attachments/audit/service-contract joins) for the Vehicle Expiry
    // snapshot; same "read every vehicle, filter expiry in memory"
    // convention the /assets/vehicles page's own Renewals & Expiry Tracking
    // section already uses, scoped to isManager only.
    isManager
      ? prisma.assets.findMany({
          where: { deleted_at: null, category: { in: [...VEHICLE_CATEGORIES] } },
          select: {
            id: true, asset_code: true, asset_name: true, plate_number: true,
            insurance_expiry_date: true, registration_expiry_date: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const mgUnderReviewAll = mgData?.[0] ?? [];
  const mgOpenAll = mgData?.[1] ?? [];
  // Broadened the same way as the Job Cards list and Data Entry dashboard
  // (Task 1/8/10): a pending correction can outlive "Under Review" once
  // materials progress, so both id sets are checked together.
  const mgPendingCorrectionIds = isManager
    ? await getPendingCorrectionWorkOrderIds([...mgUnderReviewAll.map((r) => r.id), ...mgOpenAll.map((r) => r.id)])
    : new Set<string>();
  // Task 10/11 — kept only for the small, clearly-labeled "Legacy submitted
  // rows only" section; no longer blended into the main attention board.
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
  const mgClosureRequestedCount = mgData?.[3] ?? 0;
  const mgActiveCount = mgData?.[4] ?? 0;
  const mgCanViewCosts = canViewCostsForContext(context);

  // Task 9 — resolve closure-requester names in one bulk read.
  const mgClosureRequesterIds = [...new Set(mgClosureRequestedAll.map((r) => r.created_by).filter((id): id is string => Boolean(id)))];
  const mgClosureRequesters = mgClosureRequesterIds.length
    ? await prisma.profiles.findMany({ where: { id: { in: mgClosureRequesterIds } }, select: { id: true, full_name: true } })
    : [];
  const mgClosureRequesterNameById = new Map(mgClosureRequesters.map((p) => [p.id, p.full_name]));

  // ── Task 3/4/5/6/12 — bulk materials + labor read across the active
  // sample (2 groupBy queries + 2 session queries total, not per-card). ────
  const mgActiveIds = mgActiveSample.map((w) => w.id);
  const [mgFulfillmentMap, mgLaborMap] = isManager
    ? await Promise.all([
        getMaterialFulfillmentForWorkOrders(prisma, mgActiveIds),
        getWorkOrderLaborSummariesBulk(prisma, mgActiveIds),
      ])
    : ([new Map(), new Map()] as [
        Awaited<ReturnType<typeof getMaterialFulfillmentForWorkOrders>>,
        Awaited<ReturnType<typeof getWorkOrderLaborSummariesBulk>>,
      ]);

  let mgMaterialsPendingCount = 0;
  let mgWorkingNowCount = 0;
  let mgPausedCount = 0;
  let mgHoursTodaySum = 0;
  let mgAmountTodaySum = 0;

  type MgAttentionCandidate = NeedsAttentionItem & { rank: number; sortKey: string };
  const mgAttentionCandidates: MgAttentionCandidate[] = [];

  // Task 9 — Closure Requests, rank 0 (highest priority).
  for (const r of mgClosureRequestedAll) {
    const requesterName = r.created_by ? mgClosureRequesterNameById.get(r.created_by) ?? null : null;
    mgAttentionCandidates.push({
      id: r.id, rank: 0, sortKey: r.updated_at.toISOString(),
      workOrderNumber: r.work_order_number, assetLabel: r.assets?.asset_name ?? null,
      issue: requesterName ? `Requested by ${requesterName} · ${ageLabel(r.created_at.toISOString())}` : `Requested ${ageLabel(r.created_at.toISOString())}`,
      badgeLabel: "Closure Request", badgeTone: "amber",
      actionLabel: "Review", actionHref: `?preview=${r.id}`,
    });
  }

  // Task 6/12 — top 3 active Job Cards by labor hours (Job Card Labor Cost
  // snapshot), derived from the same bulk labor read, no extra query.
  type MgJobCardLabor = { id: string; workOrderNumber: string | null; assetLabel: string | null; status: string; totalHours: number; totalAmount: number };
  const mgJobCardLaborRows: MgJobCardLabor[] = [];
  // Task 5 — per-worker "today" totals across every active Job Card, summed
  // by worker (a worker can appear on more than one active assignment).
  const mgWorkerTodayTotals = new Map<string, { name: string; role: string; minutes: number; amount: number }>();

  for (const wo of mgActiveSample) {
    const detailHref = `/maintenance/work-orders/${wo.id}`;
    const fulfillment = mgFulfillmentMap.get(wo.id) ?? [];
    const laborSummary = mgLaborMap.get(wo.id);
    const materialsIncomplete = anyMaterialsIncomplete(fulfillment);
    const pendingMaterialsRequestsCount = wo.parts_requests.filter((r) => r.status !== "Issued").length;
    const activeMaterialsRequest = wo.parts_requests.find((r) => ["Requested", "Approved", "Waiting Stock", "Partially Issued"].includes(r.status));
    const hasAssignment = Boolean(laborSummary?.workers.length) || wo.work_order_assignments.length > 0;
    const hasActiveSession = laborSummary?.has_active_session ?? false;
    const anyWorkerPaused = laborSummary?.workers.some((w) => w.status === "Paused") ?? false;
    const materialsBlocking = pendingMaterialsRequestsCount > 0 || materialsIncomplete;

    if (materialsBlocking) mgMaterialsPendingCount += 1;
    if (hasActiveSession) mgWorkingNowCount += 1;
    if (anyWorkerPaused && !hasActiveSession) mgPausedCount += 1;

    if (laborSummary) {
      mgHoursTodaySum += laborSummary.today_minutes / 60;
      mgAmountTodaySum += laborSummary.today_amount;
      if (laborSummary.total_hours > 0) {
        mgJobCardLaborRows.push({
          id: wo.id, workOrderNumber: wo.work_order_number,
          assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
          status: wo.status, totalHours: laborSummary.total_hours, totalAmount: laborSummary.total_amount,
        });
      }
      for (const w of laborSummary.workers) {
        const entry = mgWorkerTodayTotals.get(w.worker_id) ?? { name: w.worker_name, role: w.worker_role, minutes: 0, amount: 0 };
        entry.minutes += w.today_minutes ?? 0;
        entry.amount += w.today_amount ?? 0;
        mgWorkerTodayTotals.set(w.worker_id, entry);
      }
    }

    const assetLabel = wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null;

    // Task 4 — one bucket per active Job Card, in the task's own priority
    // order (materials(2) > paused(3) > high labor(4) > no workers(5)).
    if (materialsBlocking) {
      mgAttentionCandidates.push({
        id: wo.id, rank: 2, sortKey: wo.updated_at.toISOString(),
        workOrderNumber: wo.work_order_number, assetLabel, issue: "Materials are pending.",
        badgeLabel: "Materials Pending", badgeTone: "red",
        actionLabel: "View Materials",
        actionHref: activeMaterialsRequest ? `/store/parts-requests/${activeMaterialsRequest.id}` : `${detailHref}#parts`,
      });
    } else if (anyWorkerPaused && !hasActiveSession) {
      mgAttentionCandidates.push({
        id: wo.id, rank: 3, sortKey: wo.updated_at.toISOString(),
        workOrderNumber: wo.work_order_number, assetLabel, issue: "A worker is paused on this Job Card.",
        badgeLabel: "Worker Paused", badgeTone: "amber",
        actionLabel: "Open Daily Activity", actionHref: "/maintenance/daily-activity?status=paused",
      });
    } else if (laborSummary && laborSummary.total_hours >= MG_HIGH_LABOR_HOURS_THRESHOLD) {
      mgAttentionCandidates.push({
        id: wo.id, rank: 4, sortKey: wo.updated_at.toISOString(),
        workOrderNumber: wo.work_order_number, assetLabel, issue: `${laborSummary.total_hours}h labor logged.`,
        badgeLabel: "High Labor Hours", badgeTone: "blue",
        actionLabel: "Open Job Card", actionHref: detailHref,
      });
    } else if (!hasAssignment) {
      mgAttentionCandidates.push({
        id: wo.id, rank: 5, sortKey: wo.updated_at.toISOString(),
        workOrderNumber: wo.work_order_number, assetLabel, issue: "No workers assigned yet.",
        badgeLabel: "No Workers Assigned", badgeTone: "blue",
        actionLabel: "Assign Workers", actionHref: `${detailHref}?editAssignment=1#assignment`,
      });
    }
  }

  const mgTopWorkersToday = [...mgWorkerTodayTotals.entries()]
    .map(([workerId, v]) => ({
      workerId, name: v.name, role: v.role,
      hours: Math.round((v.minutes / 60) * 100) / 100,
      amount: Math.round(v.amount * 1000) / 1000,
    }))
    .sort((a, b) => b.hours - a.hours);
  const mgTopWorkers = mgTopWorkersToday.slice(0, 3);
  // Task 7 — least active ASSIGNED worker today (must have logged at least
  // some time — a worker with zero minutes just hasn't started, which is
  // "Not Started", not "least active").
  const mgLeastActiveWorker = [...mgTopWorkersToday].reverse().find((w) => w.hours > 0) ?? null;

  const mgTopJobCardsByLabor = [...mgJobCardLaborRows].sort((a, b) => b.totalHours - a.totalHours).slice(0, 3);

  // ── Task 8 — vehicle expiry alerts within MG_VEHICLE_EXPIRY_WINDOW_DAYS
  // (expired included), reusing the same getExpiryStatus() helper the
  // /assets/vehicles page's own Renewals & Expiry Tracking section uses, so
  // the two surfaces never disagree on what counts as expiring. ───────────
  type MgVehicleAlert = {
    assetId: string; assetCode: string; assetName: string; plateNumber: string | null;
    document: "Insurance" | "Registration"; expiryDate: Date; daysRemaining: number; expired: boolean;
  };
  const mgVehicleAlerts: MgVehicleAlert[] = [];
  for (const v of mgVehicleSource) {
    const ins = getExpiryStatus(v.insurance_expiry_date);
    if (ins.daysRemaining !== null && ins.daysRemaining <= MG_VEHICLE_EXPIRY_WINDOW_DAYS) {
      mgVehicleAlerts.push({
        assetId: v.id, assetCode: v.asset_code, assetName: v.asset_name, plateNumber: v.plate_number,
        document: "Insurance", expiryDate: v.insurance_expiry_date!, daysRemaining: ins.daysRemaining, expired: ins.status === "Expired",
      });
    }
    const reg = getExpiryStatus(v.registration_expiry_date);
    if (reg.daysRemaining !== null && reg.daysRemaining <= MG_VEHICLE_EXPIRY_WINDOW_DAYS) {
      mgVehicleAlerts.push({
        assetId: v.id, assetCode: v.asset_code, assetName: v.asset_name, plateNumber: v.plate_number,
        document: "Registration", expiryDate: v.registration_expiry_date!, daysRemaining: reg.daysRemaining, expired: reg.status === "Expired",
      });
    }
  }
  mgVehicleAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  const mgVehicleAlertCount = mgVehicleAlerts.length;
  const mgTopVehicleAlerts = mgVehicleAlerts.slice(0, 3);

  // Task 4 — vehicle alerts feed the attention board at rank 1, using the
  // task's own 0-7-days-red / 8-15-days-amber split.
  for (const v of mgTopVehicleAlerts) {
    mgAttentionCandidates.push({
      id: `${v.assetId}-${v.document}`, rank: 1, sortKey: v.expiryDate.toISOString(),
      workOrderNumber: v.assetCode, assetLabel: `${v.assetName}${v.plateNumber ? ` (${v.plateNumber})` : ""}`,
      issue: v.expired
        ? `${v.document} expired ${Math.abs(v.daysRemaining)}d ago.`
        : `${v.document} expires in ${v.daysRemaining}d.`,
      badgeLabel: "Expiring Soon", badgeTone: v.expired || v.daysRemaining <= 7 ? "red" : "amber",
      actionLabel: "View Vehicle", actionHref: `/assets/${v.assetId}`,
    });
  }

  // Task 4/12 — top 5 overall, sorted by rank then most-recent/soonest first.
  const mgAttentionBoard = mgAttentionCandidates
    .sort((a, b) => a.rank - b.rank || (a.sortKey < b.sortKey ? 1 : -1))
    .slice(0, 5);

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

  // Vehicle Expiry Alerts Modal Unit 10B.1: opened via ?vehicleExpiry=1, same
  // ?new_job_card=1-style overlay convention as every other dashboard modal.
  // No new query — mgVehicleAlerts (Unit 10) already holds the complete,
  // unsliced list; this just serializes it (Date -> a pre-formatted label)
  // for the client modal component. Gated to Manager since that's the only
  // role this data is ever computed for.
  const showVehicleExpiryModal = isManager && sp.vehicleExpiry === "1";
  const mgVehicleAlertsForModal: VehicleExpiryAlertRow[] = showVehicleExpiryModal
    ? mgVehicleAlerts.map((v) => ({
        assetId: v.assetId,
        assetCode: v.assetCode,
        assetName: v.assetName,
        plateNumber: v.plateNumber,
        document: v.document,
        expiryDateLabel: v.expiryDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        daysRemaining: v.daysRemaining,
        expired: v.expired,
      }))
    : [];

  // New Job Card Modal Wizard Refactor: opened via ?new_job_card=1 as an
  // overlay on top of the dashboard, same convention as ?sendPreview below —
  // the asset picker list is only fetched when the modal is actually open,
  // and only for users who actually hold work_orders.manage (same gate the
  // standalone /maintenance/work-orders/new route enforces).
  const canCreateJobCard =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.manage");
  const showNewJobCardModal = sp.new_job_card === "1" && canCreateJobCard;
  const newJobCardAssets = showNewJobCardModal ? await getAssetPickerOptions() : [];
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10.
  const canAssignAtCreation =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign");
  const newJobCardActiveWorkers =
    showNewJobCardModal && canAssignAtCreation ? await getActiveWorkerProfilesForAssignment() : [];

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

  const [previewWO, prPreviewData, techsForModal, previewMaterialFulfillment] = previewId
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
            // Job Card Work Tracking Entry Points and Assignment Visibility
            // Unit 8B, Task 3/4/8 — same additive fields as the Job Cards
            // list's own preview query.
            _count: {
              select: {
                work_order_required_parts: true,
                work_order_attachments: true,
                work_order_worker_assignments: { where: { status: "active" } },
                work_order_work_sessions: { where: { status: "Active" } },
              },
            },
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
          ? getTechnicianPickerOptions()
          : Promise.resolve([] as Array<{ id: string; full_name: string }>),
        // Job Card Action Clarity Fix Task 3: same single-Job-Card fulfillment
        // read as the Job Cards list's own preview query — gated behind
        // previewId, so this is never run per dashboard row.
        getMaterialFulfillmentForWorkOrder(prisma, previewId),
      ])
    : [
        null,
        [] as Array<{ id: string; parts_request_number: string | null; status: string; parts_request_items: { id: string; description: string; quantity_requested: unknown; issued_quantity: unknown }[] }>,
        [] as Array<{ id: string; full_name: string }>,
        [] as Awaited<ReturnType<typeof getMaterialFulfillmentForWorkOrder>>,
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
  // Performance Optimization Unit 3, Task 7: these two only depend on
  // previewWO, not on each other — Promise.all instead of two sequential
  // awaits. previewCorrectionRequester below still has a genuine dependency
  // on previewPendingClarification's result, so it stays sequential after.
  const [previewReviewedIds, previewPendingClarification] = await Promise.all([
    previewWO && previewWO.status === "Under Review"
      ? getReviewedWorkOrderIds([previewWO.id])
      : Promise.resolve(null),
    // Data Entry Correction Note Visibility Cleanup Task 1/6: same single-record
    // query the Job Card detail page's correction banner uses, so the note
    // content shown here never disagrees with the full detail page.
    previewWO ? getPendingClarificationForWorkOrder(previewWO.id) : Promise.resolve(null),
  ]);
  const previewReviewed = previewReviewedIds ? previewReviewedIds.has(previewWO!.id) : false;
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
        // Job Card Work Tracking Entry Points and Assignment Visibility
        // Unit 8B, Task 3/4/8.
        internalTeamCount: previewWO._count.work_order_worker_assignments,
        hasActiveWorkSession: previewWO._count.work_order_work_sessions > 0,
        // Job Card Action Clarity Fix Task 3.
        materialsAvailability: summarizeMaterialAvailability(previewMaterialFulfillment),
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
        // Approval Workflow Unit 4: direct "Close Job Card" is now
        // Manager-only (matches closeWorkOrder()'s own role check) — Data
        // Entry uses Request Closure instead (full detail page).
        canClose: isAdmin || context.role?.slug === "maintenance_manager",
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
      {/* One-Screen Manager Dashboard Unit 10, Task 13: added "asset." so
          vehicle expiry-date edits refresh the Manager dashboard's Vehicle
          Expiry snapshot without waiting for the 15s poll. Manager Dashboard
          UI Polish and Realtime Verification Unit 10B, Task 8: added
          "worker_profile." too, so a worker profile change (which also
          covers Internal Team roster edits alongside the existing
          "job_card." prefix) refreshes the Labor Snapshot without a manual
          reload — every other prefix already existed and is shared by every
          role's section on this page. */}
      <RealtimeRefresh watch={["job_card.", "work_order.", "materials_request.", "store_materials.", "offline_inventory.", "material_ledger.", "notification.", "asset.", "worker_profile."]} />
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Here's what needs your attention today."
      />
      <div className="space-y-4 p-4 pb-8 sm:p-5">

        {/* ── NORMAL USER (Data Entry) ────────────────────────────────
            Dashboard Card Sizing and Section Alignment Polish Unit 9E.5: on
            top of Unit 9E.4's layout (Header → Today Summary → Quick Actions
            → Needs Attention Today + Recent Job Cards), every card grew
            moderately (Task 1/2) and both side-by-side sections now use an
            identical header structure — title + one-line subtitle + a
            right-aligned "View all" link, same font sizes/line-heights on
            both sides — so their card containers start at the same Y
            (Task 4). Needs Attention Today keeps the dark/bold text; Recent
            Job Cards uses the exact same structure in a muted gray, so
            hierarchy comes from color, not from one side sitting lower than
            the other. */}
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

            {/* Task 1/3 — Today Summary: 6 clickable cards, sized up
                moderately, one row on desktop. Materials Pending/Working
                Now/Paused/Ready for Closure are derived from the active
                sample computed above; Closure Requested and Closed Recently
                stay as small secondary text links rather than full cards. */}
            <section className="space-y-1.5">
              <SectionLabel>Today Summary</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                <TodaySummaryCard href="/maintenance/daily-activity" label="Active Job Cards" value={nuQueue.activeCount} icon={ClipboardList} tone="blue" />
                <TodaySummaryCard href="/maintenance/daily-activity?status=materials-pending" label="Materials Pending" value={nuMaterialsPendingCount} icon={ShoppingCart} tone={nuMaterialsPendingCount > 0 ? "red" : "green"} />
                <TodaySummaryCard href="/maintenance/daily-activity?status=working" label="Working Now" value={nuWorkingNowCount} icon={PlayCircle} tone="green" />
                <TodaySummaryCard href="/maintenance/daily-activity?status=paused" label="Paused Workers" value={nuPausedCount} icon={PauseCircle} tone="amber" />
                <TodaySummaryCard href="/maintenance/daily-activity?status=ready-closure" label="Ready for Closure" value={nuReadyForClosureCount} icon={CheckCircle2} tone="blue" />
                <TodaySummaryCard href="/maintenance/work-orders?status=New" label="Drafts Not Started" value={nuQueue.draftCount} icon={FileText} tone="gray" />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-0.5 text-[11px] font-semibold text-[#9CA3AF]">
                <Link href="/maintenance/work-orders?status=ClosureRequested" className="hover:text-[#111827]">
                  {nuQueue.closureRequestedCount} awaiting Manager closure approval →
                </Link>
                <Link href="/maintenance/work-orders?status=Closed" className="hover:text-[#111827]">
                  {nuQueue.closedRecentCount} closed in the last 14 days →
                </Link>
              </div>
            </section>

            {/* Task 2/3 — Quick Actions: same card system as Today Summary,
                same grid density. Daily Activity is first and carries the
                only accent (red left bar + red-tinted icon + red hover
                border) — never a solid-red tile. */}
            <section className="space-y-1.5">
              <SectionLabel>Quick Actions</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
                <QuickActionTile
                  accent
                  title="Daily Activity"
                  helper="Monitor active work"
                  href="/maintenance/daily-activity"
                  icon={Activity}
                  iconBg="bg-red-50"
                  iconColor="text-[#ED1C24]"
                />
                <QuickActionTile title="New Job Card" helper="Create request" href="?new_job_card=1" icon={PlusCircle} iconBg="bg-red-50" iconColor="text-[#ED1C24]" />
                <QuickActionTile title="Materials Requests" helper="Material requests" href="/store/parts-requests" icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" />
                <QuickActionTile title="Inventory Control" helper="Receive / issue" href="/store/offline-inventory" icon={Package} iconBg="bg-amber-50" iconColor="text-amber-600" />
                <QuickActionTile title="Assets & Equipment" helper="Browse assets" href="/assets" icon={Gauge} iconBg="bg-blue-50" iconColor="text-blue-600" />
              </div>
            </section>

            {/* Task 4 — Needs Attention Today (left, ~65%) and Recent Job
                Cards (right, ~35%) share one header structure so both
                columns' card containers start at the same vertical level;
                stacked below lg:. Needs Attention stays the dashboard's one
                clear focus (dark/bold heading); Recent Job Cards uses the
                identical structure in muted gray, so it's still visibly
                secondary despite lining up with Needs Attention. */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,65%)_minmax(0,35%)]">
              <section className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-black leading-tight text-[#111827]">Needs Attention Today</h2>
                    <p className="text-[11px] leading-tight text-[#6B7280]">Handle these first.</p>
                  </div>
                  <Link href="/maintenance/daily-activity" className="shrink-0 text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                    View all →
                  </Link>
                </div>
                <div className="divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
                  {nuNeedsAttention.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-[#4B5563]">Nothing needs your attention right now.</p>
                  ) : (
                    nuNeedsAttention.map((item) => <NeedsAttentionRow key={item.id} item={item} />)
                  )}
                </div>
              </section>

              {/* Task 5 — Recent Job Cards: same header structure as Needs
                  Attention Today (so both columns align), muted gray to
                  stay visibly secondary; a 2-row compact preview. */}
              <section className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-black leading-tight text-[#9CA3AF]">Recent Job Cards</h2>
                    <p className="text-[11px] leading-tight text-[#B0B7C3]">Quick preview.</p>
                  </div>
                  <Link href="/maintenance/work-orders" className="shrink-0 text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                    View all →
                  </Link>
                </div>
                <div className="divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#E5E7EB] bg-white">
                  {nuRecent.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                      <p className="text-sm font-semibold text-[#111827]">No Job Cards yet.</p>
                      <Link
                        href="?new_job_card=1"
                        className="mt-1 rounded-md bg-[#ED1C24] px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700"
                      >
                        Create Job Card
                      </Link>
                    </div>
                  ) : (
                    nuRecent.map((row) => <NuJobCardRow key={row.id} row={row} compact />)
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {/* ── SUPERVISOR / MANAGER ─────────────────────────────────── */}
        {/* One-Screen Manager Dashboard Unit 10, polished in Manager
            Dashboard UI Polish and Realtime Verification Unit 10B: a
            command center in the task's own priority order — 1) KPI row,
            2) Needs Manager Attention (the main section, left column),
            3) Labor Snapshot Today, 4) Vehicle Expiry Alerts (both stacked
            in the right column, secondary to Attention), 5) Legacy
            Submitted Rows — now collapsed behind a native <details> panel
            (Task 4) so the pre-workflow "Under Review" records it holds
            never visually compete with the sections above. Quick Action
            tiles sit between the KPI row and the two-column layout, styled
            no more prominently than Today Summary (Task 7's "should not
            overpower the attention board"). */}
        {isManager && mgData && (
          <>
            {/* Task 3 — KPI row, one row on desktop. */}
            <section className="space-y-1.5">
              <SectionLabel>Today Summary</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
                <TodaySummaryCard href="/maintenance/daily-activity" label="Active Job Cards" value={mgActiveCount} icon={Wrench} tone="blue" />
                <TodaySummaryCard href="/maintenance/work-orders?status=ClosureRequested" label="Closure Requests" value={mgClosureRequestedCount} icon={ClipboardList} tone={mgClosureRequestedCount > 0 ? "amber" : "green"} />
                <TodaySummaryCard href="/maintenance/daily-activity?status=working" label="Working Now" value={mgWorkingNowCount} icon={PlayCircle} tone="green" />
                <TodaySummaryCard href="/maintenance/daily-activity?status=paused" label="Paused Workers" value={mgPausedCount} icon={PauseCircle} tone="amber" />
                <TodaySummaryCard href="/maintenance/daily-activity?status=materials-pending" label="Materials Pending" value={mgMaterialsPendingCount} icon={ShoppingCart} tone={mgMaterialsPendingCount > 0 ? "red" : "green"} />
                <TodaySummaryCard
                  href="/assets/vehicles?insurance=expiring_15&registration=expiring_15"
                  label="Vehicle Expiry Alerts"
                  value={mgVehicleAlertCount}
                  icon={ShieldAlert}
                  tone={mgVehicleAlertCount === 0 ? "green" : mgTopVehicleAlerts.some((v) => v.expired || v.daysRemaining <= 7) ? "red" : "amber"}
                />
                <TodaySummaryCard href="/maintenance/daily-activity" label="Labor Hours Today" value={Math.round(mgHoursTodaySum * 100) / 100} icon={Activity} tone="blue" />
                {mgCanViewCosts ? (
                  <TodaySummaryCard href="/maintenance/daily-activity" label="Labor Cost Today" value={`${mgAmountTodaySum.toFixed(3)} KWD`} icon={Activity} tone="gray" />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-0.5 text-[11px] font-semibold text-[#9CA3AF]">
                <Link href="/store/offline-inventory" className="hover:text-[#111827]">{offlineMovementsToday} inventory movements today →</Link>
                <Link href="/maintenance/work-orders?status=Closed" className="hover:text-[#111827]">{mgClosedRecentCount} closed in the last 14 days →</Link>
              </div>
            </section>

            {/* Task 1/11 — Quick Actions: compact tiles, same card system as
                Today Summary (reuses the same QuickActionTile the Data Entry
                dashboard uses). No "Create Job Card" — this dashboard is
                monitoring/control, not creation. */}
            <section className="space-y-1.5">
              <SectionLabel>Quick Actions</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                <QuickActionTile accent title="Daily Activity" helper="Monitor active work" href="/maintenance/daily-activity" icon={Activity} iconBg="bg-red-50" iconColor="text-[#ED1C24]" />
                <QuickActionTile title="Closure Requests" helper="Review & approve" href="/maintenance/work-orders?status=ClosureRequested" icon={ClipboardList} iconBg="bg-amber-50" iconColor="text-amber-600" />
                <QuickActionTile title="Worker Activity" helper="Hours & status" href="/maintenance/assignments" icon={Users} iconBg="bg-blue-50" iconColor="text-blue-600" />
                <QuickActionTile title="Materials Pending" helper="View requests" href="/store/parts-requests" icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" />
                <QuickActionTile title="Vehicle Expiry" helper="Renewals due" href="/assets/vehicles?insurance=expiring_15&registration=expiring_15" icon={Car} iconBg="bg-amber-50" iconColor="text-amber-600" />
                <QuickActionTile title="Reports" helper="Full reports" href="/reports" icon={BarChart3} iconBg="bg-gray-100" iconColor="text-[#4B5563]" />
              </div>
            </section>

            {/* Task 4/15 — Needs Manager Attention (left, ~65%) is the main
                section, beside a stacked Labor/Vehicle snapshot column
                (right, ~35%); stacked below lg:. */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,65%)_minmax(0,35%)]">
              <section className="space-y-1.5">
                <div>
                  <h2 className="text-sm font-black leading-tight text-[#111827]">Needs Manager Attention</h2>
                  <p className="text-[11px] leading-tight text-[#6B7280]">Closure requests and blocking items first.</p>
                </div>
                <div className="divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
                  {mgAttentionBoard.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-[#4B5563]">Nothing needs your attention right now.</p>
                  ) : (
                    mgAttentionBoard.map((item) => <NeedsAttentionRow key={item.id} item={item} />)
                  )}
                </div>
                <Link href="/maintenance/daily-activity" className="block text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                  Open Daily Activity for the full list →
                </Link>
              </section>

              <section className="space-y-3">
                {/* Task 5/6/7 — Labor Snapshot (worker + Job Card labor cost). */}
                <div className="space-y-2 rounded-md border border-[#DDE2EA] bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black leading-tight text-[#111827]">Labor Snapshot Today</h3>
                    <Link href="/maintenance/assignments" className="shrink-0 text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                      View Worker Activity
                    </Link>
                  </div>
                  {/* Task 5 — compact stat row: Hours/Pay stay as plain
                      labeled numbers, Working/Paused use small pill badges
                      so the two "who's active right now" counts are the
                      first thing a glance lands on. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#4B5563]">
                    <span>Hours: <strong className="text-[#111827]">{Math.round(mgHoursTodaySum * 100) / 100}h</strong></span>
                    {mgCanViewCosts ? <span>Pay: <strong className="text-[#111827]">{mgAmountTodaySum.toFixed(3)} KWD</strong></span> : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-[#16A34A]">
                      Working {mgWorkingNowCount}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-[#B45309]">
                      Paused {mgPausedCount}
                    </span>
                  </div>

                  {mgTopWorkers.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Top Workers Today</p>
                      <div className="mt-1 space-y-1">
                        {mgTopWorkers.map((w) => (
                          <div key={w.workerId} className="flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 truncate font-semibold text-[#111827]">
                              {w.name} <span className="font-normal text-[#9CA3AF]">· {w.role}</span>
                            </span>
                            <span className="shrink-0 text-[#4B5563]">
                              {w.hours}h{mgCanViewCosts ? ` · ${w.amount.toFixed(3)} KWD` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                      {mgLeastActiveWorker ? (
                        <p className="mt-1 text-[11px] text-[#9CA3AF]">Least active: {mgLeastActiveWorker.name} ({mgLeastActiveWorker.hours}h)</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-[#9CA3AF]">No worker hours logged today.</p>
                  )}

                  {mgTopJobCardsByLabor.length > 0 ? (
                    <div className="border-t border-[#EEF2F6] pt-2">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Job Card Labor Cost</p>
                      <div className="mt-1 space-y-1">
                        {mgTopJobCardsByLabor.map((jc) => (
                          <Link
                            key={jc.id}
                            href={`/maintenance/work-orders/${jc.id}`}
                            className="flex items-center justify-between gap-2 text-xs transition hover:text-[#ED1C24]"
                          >
                            <span className="min-w-0 truncate font-semibold text-[#111827]">
                              {jc.workOrderNumber} <span className="font-normal text-[#9CA3AF]">· {jc.assetLabel ?? "No asset"}</span>
                            </span>
                            <span className="shrink-0 text-[#4B5563]">
                              {jc.totalHours}h{mgCanViewCosts ? ` · ${jc.totalAmount.toFixed(3)} KWD` : ""}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Task 8 — Vehicle Expiry Alerts. */}
                <div className="space-y-2 rounded-md border border-[#DDE2EA] bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black leading-tight text-[#111827]">Vehicle Expiry Alerts</h3>
                    {/* Vehicle Expiry Alerts Modal Unit 10B.1, Task 1/6: this
                        specific button now opens the in-page modal (full
                        list) instead of navigating away — the KPI card above
                        and the "Vehicle Expiry" quick-action tile are
                        untouched and still link straight to the filtered
                        /assets/vehicles page. */}
                    <Link href="/dashboard?vehicleExpiry=1" scroll={false} className="shrink-0 text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                      View Expiring Vehicles
                    </Link>
                  </div>
                  {mgTopVehicleAlerts.length === 0 ? (
                    <p className="text-xs text-[#9CA3AF]">No vehicle documents expiring within {MG_VEHICLE_EXPIRY_WINDOW_DAYS} days.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {mgTopVehicleAlerts.map((v) => {
                        const urgent = v.expired || v.daysRemaining <= 7;
                        // Task 6 — the row's 4 required fields: vehicle/plate,
                        // expiry type, expiry date, days remaining.
                        return (
                          <Link
                            key={`${v.assetId}-${v.document}`}
                            href={`/assets/${v.assetId}`}
                            className={`flex items-center justify-between gap-2 rounded-md border-l-4 px-2.5 py-1.5 text-xs transition hover:bg-gray-50 ${urgent ? "border-l-[#ED1C24]" : "border-l-[#F59E0B]"}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-[#111827]">
                                {v.assetCode}{v.plateNumber ? ` · ${v.plateNumber}` : ""}
                              </span>
                              <span className="block truncate text-[#9CA3AF]">
                                {v.document} · {v.expiryDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                            </span>
                            <span className={`shrink-0 font-bold ${urgent ? "text-[#ED1C24]" : "text-[#B45309]"}`}>
                              {v.expired ? `${Math.abs(v.daysRemaining)}d overdue` : `${v.daysRemaining}d left`}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Manager Dashboard UI Polish and Realtime Verification Unit
                10B, Task 1/4: Legacy submitted rows only — pre-existing
                "Under Review" Job Cards from before this workflow moved to
                closure-only approval. Collapsed by default (native
                <details>, no JS/client component needed) so it never
                competes with the Attention Board/Labor/Vehicle sections
                above for visual weight; shown at all only when a legacy row
                actually exists. */}
            {mgSubmittedRows.length > 0 && (
              <details className="group overflow-hidden rounded-md border border-[#E5E7EB] bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#B0B7C3]">Legacy submitted rows only</p>
                    <p className="mt-0.5 truncate text-xs text-[#9CA3AF]">These are pre-workflow records kept for compatibility.</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge label={`${mgSubmittedRows.length} legacy row${mgSubmittedRows.length !== 1 ? "s" : ""}`} tone="gray" />
                    <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50 group-open:hidden">
                      View Legacy Rows
                    </span>
                    <span className="hidden rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50 group-open:inline-block">
                      Hide
                    </span>
                  </div>
                </summary>
                <div className="divide-y divide-[#EEF2F6] border-t border-[#EEF2F6]">
                  {mgSubmittedRows.map((row) => <ManagerActionRow key={row.id} row={row} />)}
                </div>
              </details>
            )}

            {/* Manager Needs Your Action Waiting-on-Data-Entry UI Cleanup
                Task 3: a separate, always-visible-when-relevant reminder —
                correction requests waiting on Data Entry are informational
                for Manager. Amber, not red — this isn't a Manager error
                state, just a status the Manager should stay aware of. */}
            {mgCorrectionCount > 0 && (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-amber-900">Waiting on Data Entry</p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-800">
                      {mgCorrectionCount === 1
                        ? "1 correction request is waiting for Data Entry. It will return here after resubmission."
                        : `${mgCorrectionCount} correction requests are waiting for Data Entry. They will return here after resubmission.`}
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
              <QuickAction label="Create Job Card"     href="?new_job_card=1" icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
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

      {/* New Job Card Modal Wizard Refactor: opened via ?new_job_card=1,
          overlaid on top of the dashboard exactly like the preview/send
          popups above — closing strips the param and returns to /dashboard. */}
      {showNewJobCardModal && (
        <WorkOrderWizard
          assets={newJobCardAssets}
          preselectedAssetId={sp.asset_id ?? null}
          dismissHref="/dashboard"
          activeWorkers={newJobCardActiveWorkers}
          canAssignAtCreation={canAssignAtCreation}
        />
      )}

      {/* Vehicle Expiry Alerts Modal Unit 10B.1: opened via ?vehicleExpiry=1,
          same overlay convention as the modals above — closing strips the
          param and returns to /dashboard. */}
      {showVehicleExpiryModal && (
        <VehicleExpiryModal alerts={mgVehicleAlertsForModal} closeHref="/dashboard" />
      )}
    </>
  );
}
