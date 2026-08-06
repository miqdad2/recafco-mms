"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Package,
  Paperclip,
  ExternalLink,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { AssignmentFormModal } from "@/components/work-orders/assignment-form-modal";
import {
  approveJobCardAndMaterialsAction,
  closeWorkOrderAction,
  requestClarificationAction,
  startJobCardProgressAction,
  submitWorkOrderAction,
} from "@/app/actions/workflow";
import { approvePartsRequestAction } from "@/app/actions/phase4";
import {
  displaySimplifiedStatus,
  simplifiedStatusTone,
  OPEN_JOB_CARD_STATUSES,
  NEEDS_UPDATE_LABEL,
  NEEDS_UPDATE_TONE,
} from "@/lib/work-orders/simplified-status-display";
import { materialsReceiptStatus, materialsReceiptStatusTone } from "@/lib/display/parts-request-labels-display";
import { formatDateTime } from "@/lib/utils";

// ── Data contract ─────────────────────────────────────────────────────────────

export type QuickViewData = {
  id: string;
  work_order_number: string | null;
  status: string;
  displayStatus: string;
  maintenance_type: string;
  worker_type: string;
  operator_complaint: string | null;
  description_of_work: string | null;
  ordered_by: string | null;
  date_of_order: string | null;
  created_at: string;
  job_location: string | null;
  assets: {
    id: string;
    asset_code: string;
    asset_name: string;
    category: string | null;
    brand: string | null;
    model: string | null;
    plate_number: string | null;
    status: string | null;
    location: string | null;
    condition: string | null;
    criticality: string | null;
  } | null;
  department_name: string | null;
  technician_names: string[];
  technicians: { id: string; full_name: string }[];
  primary_assignment: {
    assignment_type: string;
    external_name: string | null;
    external_company: string | null;
    external_contact_person: string | null;
    external_phone: string | null;
    external_trade: string | null;
  } | null;
  required_parts_count: number;
  parts_requests_count: number;
  open_parts_requests_count: number;
  // Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
  // Task 1/3/4: the Unit 7 Internal Team roster and Unit 8 active work
  // sessions — both optional so the Materials Requests list's quick-view
  // (which doesn't compute them) can keep omitting them safely; treated as
  // "none"/"false" wherever unset, never as a false "assigned"/"in progress".
  internalTeamCount?: number;
  hasActiveWorkSession?: boolean;
  // Job Card Action Clarity Fix Task 3/4: a single Job-Card-level read of
  // "what's the one right materials action right now", derived from
  // work_order_required_parts vs. Offline Inventory (see
  // summarizeMaterialAvailability() in lib/work-orders/material-fulfillment.ts).
  // Optional/"none" for the same reason as internalTeamCount above — a Job
  // Card with no Required Materials rows (created before that feature, or
  // legacy) has nothing to summarize, so callers fall back to the existing
  // Materials-Request-status wording instead of guessing.
  materialsAvailability?: "none" | "fulfilled" | "issuable" | "partial" | "shortage";
  last_parts_request_status: string | null;
  // Every Materials Request linked to this Job Card (most recent first), each
  // with its item lines — used both for the Materials section's active-request
  // card and for the read-only "View Materials" preview (which shows all of
  // them, not just the active one).
  all_parts_requests: {
    id: string;
    parts_request_number: string | null;
    status: string;
    items: {
      id: string;
      description: string;
      quantity_requested: number;
      issued_quantity: number;
    }[];
  }[];
  attachment_count: number;
  roleSlug: string;
  canApprove: boolean;
  canAssign: boolean;
  canManage: boolean;
  canCreateParts: boolean;
  // work_orders.review (Maintenance Engineer) and work_orders.request_correction
  // (Engineer + Manager) — distinct from canApprove (Manager only). Super Admin
  // bypasses to true for both, same convention as the other can* flags.
  canReview: boolean;
  canRequestCorrection: boolean;
  // Simplified Workflow UI Consistency Cleanup Task 1/3: whether this Job
  // Card has an unresolved maintenance_manager_review clarification right
  // now — drives the secondary "Needs Update" badge and the Bottom Action
  // Area's Edit & Resubmit / Add Materials shortcuts, regardless of the
  // record's raw backend status.
  hasPendingCorrection: boolean;
  // Data Entry Correction Note Visibility Cleanup Task 1/2: the Supervisor /
  // Manager's actual clarification note, resolved the same way the Job Card
  // detail page's correction banner does (getPendingClarificationForWorkOrder),
  // so the quick-view popup no longer leaves Data Entry guessing what to fix.
  // Null when there's no pending correction, or when the record predates this
  // note (question can itself be null on very old rows).
  pendingCorrectionNote: {
    question: string | null;
    requestedByName: string | null;
    requestedAt: string | null;
  } | null;
  isCreator: boolean;
  // Data Entry Job Card Progress Update and Close Action Unit — real
  // work_orders.close / work_orders.update permission checks (Super Admin
  // bypasses to true), replacing the old canApprove||canAssign proxy that
  // happened to work only by coincidence for every role tried so far.
  canClose: boolean;
  canUpdateProgress: boolean;
  // Manager Approval Success Popup and Materials Awaiting Receipt Flow Task
  // 7: mirrors canReceiveIssueMaterials() (lib/parts-requests/visibility.ts)
  // — Data Entry and Supervisor/Manager (and Super Admin) can receive
  // materials once the Job Card is Open, same gate the Materials Request
  // detail page's own Receive Materials panel already enforces.
  canReceiveMaterials: boolean;
  // Legacy signal from the retired Engineer-review step — no longer drives
  // any visible UI in this component (Supervisor/Manager reviews directly),
  // kept on the data contract only so callers don't need a special case.
  reviewed: boolean;
  closeHref: string;
  // Manager Approval Success Popup and Materials Awaiting Receipt Flow Task
  // 1/2: the query-param name THIS host page uses to open this same Job
  // Card's quick-view again (e.g. "preview" on the dashboard/Job Cards list,
  // but "jobPreview" on the Materials Requests list, which already uses
  // "preview" for its own Materials Request quick-view) — threaded through
  // the Approve form so the server action can send Manager back to
  // a working "?<param>=<id>&success=job-card-opened" URL on whichever page
  // they approved from, instead of always forcing the full detail page.
  previewParamName: string;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

type Tone = "green" | "amber" | "red" | "blue" | "gray";

// A Job Card can only ever have one Materials Request in one of these
// statuses at a time — mirrors ACTIVE_MATERIALS_REQUEST_STATUSES in
// lib/backend/parts-requests/repository.ts, kept as a local copy per this
// project's established pattern for small per-file display constants.
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

// Text-color equivalent of materialsReceiptStatusTone's green/amber/gray,
// for the small inline status words in the Materials section (badges
// elsewhere use <StatusBadge tone=.../> directly instead).
const RECEIPT_TONE_TEXT_CLASS: Record<"green" | "amber" | "gray", string> = {
  green: "text-green-700",
  amber: "text-amber-700",
  gray: "text-[#6B7280]",
};

// Plain-language sentence for a Materials Request's overall status — used
// instead of showing the bare status word alone, so a non-technical user
// immediately knows what it means for them right now.
function materialsRequestStageLine(status: string): string {
  switch (status) {
    case "Requested":
      return "Waiting for approval";
    case "Approved":
      return "Approved — ready to be issued";
    case "Waiting Stock":
      return "Marked as not available yet";
    case "Partially Issued":
      return "Some materials were issued; some are still pending";
    case "Issued":
      return "All requested materials were issued";
    default:
      return status;
  }
}

type MaterialItem = {
  id: string;
  description: string;
  quantity_requested: number;
  issued_quantity: number;
};

// Stage-aware item line for the "Requested Materials" popup. Requested
// Materials Popup Readability Improvement: material name is now the visual
// anchor (bigger, bolder) with quantity/status as smaller supporting text
// below it, each item in its own bordered card — non-technical staff should
// be able to read the material name at a glance instead of it blending into
// the supporting detail lines. Wording only ("Requested quantity" /
// "Received") — no change to the underlying issued/remaining logic below.
function MaterialItemLine({ item }: { item: MaterialItem }) {
  const requested = item.quantity_requested;
  const issued = item.issued_quantity;
  const remaining = Math.max(requested - issued, 0);
  return (
    <li className="rounded-lg border border-[#E5E7EB] bg-white p-3 shadow-sm">
      <p className="text-base font-bold text-[#111827]">{item.description}</p>
      <div className="mt-1.5 space-y-0.5 text-xs text-[#6B7280]">
        <p>Requested quantity: <span className="font-semibold text-[#111827]">{requested}</span></p>
        {issued <= 0 ? (
          <p>Received: <span className="font-semibold text-[#6B7280]">Not yet</span></p>
        ) : issued < requested ? (
          <>
            <p>Received: <span className="font-semibold text-amber-700">{issued}</span></p>
            <p>Still pending: <span className="font-semibold text-amber-700">{remaining}</span></p>
            <p>Status: <span className="font-semibold text-amber-700">Partially Received</span></p>
          </>
        ) : (
          <p>Received: <span className="font-semibold text-green-700">Fully received</span></p>
        )}
      </div>
    </li>
  );
}

// Compact one-line item summary for the MAIN quick-view popup only — the
// View Materials preview keeps the fuller MaterialItemLine explanation above.
// Wording is driven primarily by the parent Materials Request's status
// (Requested/Approved/Waiting Stock), falling back to the item's own issued
// quantity once Store has actually issued something against it.
function CompactMaterialItemLine({
  item,
  requestStatus,
  jobCardStatus,
  hasPendingCorrection,
}: {
  item: MaterialItem;
  requestStatus: string;
  jobCardStatus: string;
  // Data Entry Correction Note Visibility Cleanup Task 5: a "Requested"
  // Materials Request sitting under a Job Card that's itself Correction
  // Requested isn't actually waiting on Supervisor / Manager approval right
  // now — it's blocked on Data Entry fixing the Job Card first, so it says
  // so instead of the misleading old "Waiting Approval" wording.
  hasPendingCorrection: boolean;
}) {
  const requested = item.quantity_requested;
  const issued = item.issued_quantity;
  const remaining = Math.max(requested - issued, 0);

  let tailText: string;
  let toneClass: string;
  if (issued > 0 && issued < requested) {
    tailText = `Received ${issued} · Pending ${remaining}`;
    toneClass = "text-amber-700";
  } else if (requested > 0 && issued >= requested) {
    tailText = "Received";
    toneClass = "text-green-700";
  } else {
    // Manager Approval Success Popup and Materials Awaiting Receipt Flow
    // Task 7: a strict Requested / Awaiting Receipt / Received status per
    // item, sharing the exact same mapping the badge/KPI/tab surfaces use —
    // replaces the old per-status wording ("Waiting Stock"/"Ready to
    // Receive") with one consistent vocabulary.
    const receipt = materialsReceiptStatus(requestStatus, jobCardStatus, hasPendingCorrection);
    tailText = receipt;
    toneClass = RECEIPT_TONE_TEXT_CLASS[materialsReceiptStatusTone(receipt)];
  }

  return (
    <li className="text-xs text-[#4B5563]">
      <span className="font-semibold text-[#111827]">{item.description}</span>
      {" · Qty "}{requested}
      {" · "}
      <span className={`font-semibold ${toneClass}`}>{tailText}</span>
    </li>
  );
}

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Simplified main status + sub-status for the quick view popup. Assigned,
// approved, in-progress and completed-but-not-closed statuses are grouped
// under one "In Progress" heading — users treat assignment as the start of
// active work, not a separate stage. Data Entry Correction Note Visibility
// Cleanup Task 4: the raw internal status used to also show as a small
// "Workflow stage: <status>" label — removed, this popup no longer surfaces
// backend/workflow terminology at all.
type StatusInfo = { main: string; sub: string; tone: Tone };

function getStatusInfo(
  status: string,
  canApprove: boolean,
  canAssign: boolean,
  canManage: boolean
): StatusInfo {
  switch (status) {
    // Current (Maintenance Workflow Redesign Unit 3) statuses.
    case "Created":
      return {
        main: "Created",
        sub: canManage
          ? "Complete the details and send for review."
          : "Awaiting review.",
        tone: "gray",
      };
    case "Under Review":
      return {
        main: "Under Review",
        sub: "Waiting on Supervisor / Manager decision.",
        tone: "amber",
      };
    case "Waiting Materials":
      return {
        main: "Waiting Materials",
        sub: "Blocked until requested materials are issued.",
        tone: "amber",
      };
    case "Partially Issued":
      return {
        main: "Partially Issued",
        sub: "Some materials issued — remainder pending.",
        tone: "blue",
      };
    case "Materials Issued":
      return {
        main: "Materials Issued",
        sub: canAssign
          ? "Ready to assign a technician."
          : "Materials issued — awaiting assignment.",
        tone: "blue",
      };
    // "Approved" and "Assigned" status strings are unchanged by Unit 3 (still
    // valid current statuses, just with different transition rules around
    // them) — not legacy fallbacks.
    case "Approved":
      return {
        main: "Approved",
        sub: canAssign
          ? "Approved — assign a technician."
          : "Approved — awaiting technician assignment.",
        tone: "blue",
      };
    case "Assigned":
      return {
        main: "Assigned",
        sub: "Assigned to technician — waiting for work to start.",
        tone: "blue",
      };
    case "In Progress":
      return { main: "In Progress", sub: "Work started.", tone: "blue" };
    // Legacy pre-Unit3 statuses — defensive fallback only.
    case "Draft":
      return {
        main: "Draft",
        sub: canManage
          ? "Not yet submitted — complete the details and submit for review."
          : "Awaiting submission.",
        tone: "gray",
      };
    case "Submitted":
      return {
        main: "Submitted",
        sub: "Awaiting manager review.",
        tone: "amber",
      };
    case "Pending Approval":
      return {
        main: "Manager Review",
        sub: "The Maintenance Manager will review and assign a technician.",
        tone: "amber",
      };
    case "Parts Issued":
      return {
        main: "In Progress",
        sub: "Materials issued — work continuing.",
        tone: "blue",
      };
    case "Completed by Technician":
    case "Verified by Supervisor":
    case "Confirmed by Requester":
      return {
        main: "In Progress",
        sub: "Work completed — waiting for manager closure.",
        tone: "blue",
      };
    case "Waiting for Parts":
      return {
        main: "Waiting Materials",
        sub: "Blocked until requested materials are issued.",
        tone: "amber",
      };
    case "Waiting for Purchase":
      return {
        main: "Waiting Materials",
        sub: "Materials are being procured. Work will resume once they arrive.",
        tone: "amber",
      };
    case "Closed":
      return { main: "Closed", sub: "", tone: "green" };
    case "Rejected":
      return {
        main: "Returned for Fix",
        sub: canManage
          ? "Please update the Job Card and resubmit."
          : "Job Card was returned for corrections.",
        tone: "red",
      };
    case "Cancelled":
      return { main: "Cancelled", sub: "Job card cancelled.", tone: "gray" };
    case "Reopened":
      return {
        main: "In Progress",
        sub: "Job card reopened — awaiting action.",
        tone: "blue",
      };
    default:
      return { main: status, sub: "", tone: "gray" };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RepairOrderQuickView({ data }: { data: QuickViewData }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [showMaterialsPreview, setShowMaterialsPreview] = useState(false);
  const [showAssetPreview, setShowAssetPreview] = useState(false);
  // Which entry point opened the approve/correction panel — only changes the
  // panel's title; every action the viewer has permission for is always
  // offered inside it regardless of which button was clicked.
  const [reviewPanelMode, setReviewPanelMode] = useState<"approve" | "approveMaterials" | "correction" | "askMaterials" | null>(null);
  // Start Work / Close Job Card — the generic (non-technician) progress
  // actions added in the Data Entry Job Card Progress Update and Close
  // Action Unit. Separate from reviewPanelMode since these are a different
  // action family with their own summary content.
  const [actionPanelMode, setActionPanelMode] = useState<"start" | "close" | null>(null);

  function close() {
    router.replace(data.closeHref, { scroll: false });
  }

  function handleAssignSuccess() {
    setShowAssignPanel(false);
    setAssignSuccess("Work assigned successfully.");
    router.refresh();
  }

  // Move focus to close button on open
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.closeHref]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Derived values
  const isTerminal = ["Closed", "Cancelled", "Rejected"].includes(data.status);
  const statusInfo = getStatusInfo(
    data.status,
    data.canApprove,
    data.canAssign,
    data.canManage
  );
  // Job Card Status Simplification Task: the badge/heading always shows the
  // five plain statuses (Draft/Submitted/Approved/Active/Closed), never
  // "Correction Requested" — a pending correction shows as a separate
  // secondary badge instead (see hasPendingCorrection usage below).
  // getStatusInfo's granular "sub" text is kept as secondary detail,
  // overridden only when a correction is actually pending.
  const simplifiedStatus = displaySimplifiedStatus(data.status);
  const displayMain = simplifiedStatus;
  const displayTone = simplifiedStatusTone(simplifiedStatus);
  const displaySub = data.hasPendingCorrection
    ? "Waiting on Data Entry to edit and resubmit."
    : statusInfo.sub;

  const title = (() => {
    const raw =
      data.operator_complaint || data.description_of_work || "Job Card";
    return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  })();

  // Role-specific action flags — Maintenance Workflow Redesign Unit 9 Task 4:
  // re-derived for the simplified 9-status Job Card model. Every button here
  // links to the detail page (or opens the existing inline assign panel,
  // already a real wired action) rather than performing a workflow
  // transition directly from this popup, per Task 4's "not fully safe from
  // the list" rule.
  const isTech = data.roleSlug === "technician";

  // The Job Card's current active Materials Request, if one exists — derived
  // from all linked requests (most recent first).
  const activePartsRequest =
    data.all_parts_requests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;
  const hasActiveMaterialsRequest = activePartsRequest !== null;
  // Manager Approval Success Popup and Materials Awaiting Receipt Flow Task
  // 7: the same Requested / Awaiting Receipt / Received mapping used
  // everywhere else, driving the Materials section's heading and badge.
  const activeReceiptStatus = activePartsRequest
    ? materialsReceiptStatus(activePartsRequest.status, data.status, data.hasPendingCorrection)
    : null;
  const jobCardIsOpen = OPEN_JOB_CARD_STATUSES.includes(data.status) && !data.hasPendingCorrection;
  // Job Card Action Clarity Fix Task 3: once this Job Card has Required
  // Materials rows to reason about (materialsAvailability !== "none"), the
  // new availability-aware Issue/Receive buttons below take over from the
  // old blanket "Receive Materials" shortcut — a Job Card whose required
  // materials are already sitting in Offline Inventory should never be told
  // to "receive" them again. Legacy Job Cards with no Required Materials
  // rows (materialsAvailability === "none"/undefined) keep the old
  // Materials-Request-status-based shortcut exactly as before.
  const materialsAvailability = data.materialsAvailability ?? "none";
  const hasRequiredMaterialsTracking = materialsAvailability !== "none";
  const showReceiveMaterialsShortcut =
    !hasRequiredMaterialsTracking &&
    data.canReceiveMaterials && jobCardIsOpen && activePartsRequest !== null && activeReceiptStatus !== "Completed";
  // Rules: available now -> "Issue Material"; shortage/nothing available ->
  // "Receive Materials"; partially available -> both, relabeled "Issue
  // Available" / "Receive Shortage"; fully issued -> "Materials Completed"
  // (label only, no button — showMaterialsCompletedLabel below).
  const showIssueMaterialAction =
    hasRequiredMaterialsTracking &&
    data.canReceiveMaterials &&
    jobCardIsOpen &&
    (materialsAvailability === "issuable" || materialsAvailability === "partial");
  const showReceiveShortageAction =
    hasRequiredMaterialsTracking &&
    data.canReceiveMaterials &&
    jobCardIsOpen &&
    (materialsAvailability === "shortage" || materialsAvailability === "partial");
  const showMaterialsCompletedLabel = hasRequiredMaterialsTracking && materialsAvailability === "fulfilled";
  const issueMaterialLabel = materialsAvailability === "partial" ? "Issue Available" : "Issue Material";
  const receiveMaterialLabel = materialsAvailability === "partial" ? "Receive Shortage" : "Receive Materials";
  // Issue links to the Job Card detail page's Materials section, where the
  // real per-material Issue links (Unit 6/8C) live — this popup doesn't have
  // the per-material balance-key granularity to issue directly. Receive
  // links to the active Materials Request's own Receive panel when one
  // exists (same target the old shortcut used), else to the same Materials
  // section (which offers Request Materials when nothing's been requested yet).
  const issueMaterialHref = `/maintenance/work-orders/${data.id}#parts`;
  const receiveMaterialHref = activePartsRequest ? `/store/parts-requests/${activePartsRequest.id}` : `/maintenance/work-orders/${data.id}#parts`;
  // Unified Manager Job Card + Materials Approval Flow Fix Task 3: Requested
  // Materials Request(s) linked to this Job Card — drives whether the
  // approve button reads "Approve Job Card & Materials" (Case A) vs. just
  // "Approve Job Card" (Case B), and whether a separate "Approve Materials
  // Request" button (Case C) is needed once the Job Card is already Approved.
  const requestedMaterialsRequests = data.all_parts_requests.filter((pr) => pr.status === "Requested");

  // Approved: assign a technician. Partially Issued / Materials Issued: also
  // ready to assign once materials have started arriving (the backend
  // transition map already allows Assigned from all three — Data Entry Job
  // Card Progress Update Unit Task 2 just surfaces the button that was
  // already missing for Partially Issued). "Under Review" no longer doubles
  // as an assignable stage — review/approve is a separate detail-page action now.
  // Unified Manager Job Card + Materials Approval Flow Fix Task 4: no longer
  // shown while an active (in-progress, not-yet-fully-sent) Materials
  // Request exists — assignment now waits for Store to finish sending
  // materials, matching "assignment should appear only when: no materials
  // required OR all linked active Materials Requests are Issued."
  // Simplified Workflow UI Consistency Cleanup Task 3: none of these normal
  // status actions render while a correction is pending — Edit & Resubmit
  // is the one clear action offered instead, so a Manager/Data Entry never
  // sees "Assign Work"/"Close Job Card" next to a card that's actually
  // waiting on Data Entry to fix something first.
  // Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
  // Task 4 (moved up from below by the Job Card Action Clarity Fix so
  // showAssign, further down, can also read it): true once ANY assignment
  // mechanism has something recorded — Unit 7's Internal Team roster count,
  // or the legacy work_order_assignments-derived technician_names/
  // primary_assignment (technician self-service/Freelancer/Company).
  const hasAnyAssignment =
    (data.internalTeamCount ?? 0) > 0 || data.technician_names.length > 0 || data.primary_assignment !== null;

  // Job Card Action Clarity Fix Task 2: this inline "Assign Work" panel used
  // to render unconditionally whenever the status/permission/materials gates
  // matched, even when the Job Card already had an Internal Team roster or a
  // legacy technician/Freelancer/Company assignment — offering to assign
  // again next to work that's already assigned. Now gated by the same
  // `hasAnyAssignment` check `showAssignWorkers`/`showTrackWork` below
  // already use, so only one of "Assign Work" / "Track Work" ever shows.
  const showAssign =
    !data.hasPendingCorrection &&
    (data.canApprove || data.canAssign) &&
    ["Approved", "Partially Issued", "Materials Issued"].includes(data.status) &&
    !hasActiveMaterialsRequest &&
    !hasAnyAssignment;
  const showApproveBtn = data.canApprove && data.status === "Under Review" && !data.hasPendingCorrection;
  // Manager Quick-View Action Simplification Task 2/5: "Request Correction"/
  // "Ask to Add/Update Materials" no longer render as buttons here — kept as
  // a boolean (still drives hasStatusAction/the fallback-text case below,
  // and the reviewPanelMode "correction"/"askMaterials" panels further down
  // still exist, just unreachable from this popup now) so the underlying
  // requestClarificationAction/ClarificationRequest mechanism is hidden, not
  // deleted, per that task's explicit instruction.
  const showCorrectionBtn = data.canRequestCorrection && data.status === "Under Review" && !data.hasPendingCorrection;
  // Manager can edit the Job Card (and its materials) directly instead of
  // going through a formal correction request — shown in place of the
  // buttons above whenever Manager holds edit access on an Under Review
  // Job Card with no correction already pending.
  const showEditJobCardForReview =
    data.canManage && data.status === "Under Review" && !data.hasPendingCorrection;
  // Simplified Workflow UI Consistency Cleanup Task 3: whoever created this
  // Job Card (or Super Admin/canManage) gets a direct Edit & Resubmit path
  // and, if no active Materials Request already exists, an Add Materials
  // shortcut, whenever a correction is currently pending — regardless of
  // whether the record's raw status has since moved past "Under Review".
  const showEditResubmit = data.hasPendingCorrection && (data.isCreator || data.canManage);
  const showAddMaterialsForCorrection =
    showEditResubmit && data.canCreateParts && !hasActiveMaterialsRequest;
  // Data Entry Correction Note Visibility Cleanup Task 3: when materials
  // were already requested before/alongside the correction, "Add Materials"
  // would just hit the duplicate-request error — offer "Update Materials"
  // instead, linking straight to the existing active request.
  const showUpdateMaterialsForCorrection =
    showEditResubmit && data.canCreateParts && hasActiveMaterialsRequest && activePartsRequest !== null;
  // Case C: Job Card already Approved (or beyond) but a linked Materials
  // Request is still sitting Requested — Manager's remaining action is to
  // approve the Materials Request, not to assign work yet.
  const showApproveMaterialsBtn =
    !data.hasPendingCorrection &&
    data.canApprove && data.status !== "Under Review" && requestedMaterialsRequests.length > 0;
  // Generic Close/Start Work — anyone with the real work_orders.close /
  // work_orders.update permission (Data Entry, Engineer, Manager), excluding
  // Technician: Technician already has its own dedicated Mark Completed /
  // Start Work flow below (assignment-checked, drives /technician/jobs), and
  // Technician also happens to hold these same permissions, so excluding
  // them here avoids showing two different buttons for the same action.
  // Simplified Job Card Approval Workflow Unit Task 4: Close is now available
  // directly from any "Open"-bucket status, matching the widened
  // transitions.work_order map (no required Store-issue/assignment step).
  const showClose =
    !isTech &&
    !data.hasPendingCorrection &&
    data.canClose &&
    ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"].includes(data.status);
  const showStartWorkGeneric = !isTech && !data.hasPendingCorrection && data.canUpdateProgress && data.status === "Assigned";
  const showSubmit =
    data.canManage && data.status === "Created";
  const showStartWork = isTech && !data.hasPendingCorrection && data.status === "Assigned";
  const showMarkComplete = isTech && !data.hasPendingCorrection && data.status === "In Progress";
  // Re-assigning a technician after the initial assignment isn't a supported
  // backend transition (Assigned → Assigned), so managers can only view the
  // current assignment from here, not change it.
  const showViewAssignment =
    !data.hasPendingCorrection && (data.canApprove || data.canAssign) && data.status === "Assigned";

  // Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
  // Task 4: link-only — Unit 7's Internal Team roster picker and Unit 8's
  // Start/Pause/Resume/Stop controls both live on the full detail page, not
  // inline in this already-large popup (same scope boundary Units 5-7
  // already established for this file). "Track Work" covers both "has an
  // assignment" and "has an active session" per the task (an active session
  // can't exist without an assignment anyway).
  const showAssignWorkers =
    !data.hasPendingCorrection && !isTerminal && data.canAssign && !hasAnyAssignment;
  const showTrackWork =
    !data.hasPendingCorrection && !isTerminal && data.canAssign && hasAnyAssignment;

  // Task 3 — Next Action. Priority: terminal states first (a Closed Job
  // Card should never say "materials pending" just because an old request
  // happens to still be open), then materials, then assignment, then
  // whether work is actively running right now.
  // Job Card Action Clarity Fix Task 4: materials-availability-aware cases
  // (shortage/partial/issuable) are read from data.materialsAvailability
  // when this Job Card has Required Materials rows to reason about; Job
  // Cards without that tracking (materialsAvailability "none"/undefined)
  // fall back to the previous open-Materials-Request-count check, exactly
  // as before.
  const nextActionText = (() => {
    if (data.status === "Closed") return "This Job Card is closed.";
    if (data.status === "Closure Requested") return "Waiting for Manager closure approval.";
    if (materialsAvailability === "shortage") return "Materials are pending. Receive materials when they arrive.";
    if (materialsAvailability === "partial") return "Some materials are available. Issue available stock and receive shortage later.";
    if (hasAnyAssignment && materialsAvailability === "issuable") return "Materials are available. Issue materials to this Job Card.";
    if (!hasRequiredMaterialsTracking && data.open_parts_requests_count > 0) return "Materials are pending. Receive materials before continuing.";
    if (!hasAnyAssignment) return "Assign workers to start tracking work.";
    if (data.hasActiveWorkSession) return "Work is in progress. Open Work Tracking to pause or stop.";
    if (hasAnyAssignment && (materialsAvailability === "fulfilled" || !hasRequiredMaterialsTracking)) {
      return "Workers are assigned. Start work tracking.";
    }
    return "Open Work Tracking to start work.";
  })();

  // Request Materials: hidden once Closed, hidden while an active Materials
  // Request already exists (the Job Card can only ever have one active
  // request at a time — "Request Materials" would just fail with a
  // duplicate-request error), and hidden while a correction is pending —
  // showAddMaterialsForCorrection above already offers the same action from
  // the Bottom Action Area in that case, so this doesn't need to duplicate it.
  const showRequestParts =
    data.canCreateParts && data.status !== "Closed" && !hasActiveMaterialsRequest && !data.hasPendingCorrection;
  // View Materials: a read-only preview of every linked Materials Request
  // (active or historical) — shown to anyone as soon as at least one exists,
  // regardless of role, so a store keeper no longer needs a separate
  // status-gated shortcut to see the same information.
  const showViewMaterialsPreview = data.all_parts_requests.length > 0;

  // Legacy pre-Unit3 statuses — defensive fallback only, so a historical
  // record (if one ever exists) still shows a sensible action instead of none.
  const legacyShowAssign =
    (data.canApprove || data.canAssign) &&
    ["Submitted", "Pending Approval"].includes(data.status);
  const legacyShowClose =
    data.canApprove &&
    ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(data.status);
  const legacyShowSubmit = data.canManage && data.status === "Draft";
  const legacyShowReturnToDraft = data.canManage && data.status === "Rejected";
  const legacyShowMarkComplete = isTech && data.status === "Parts Issued";

  // Section-based layout (no separate Quick Actions section): the Job Card
  // workflow action button lives inside Current Status; View/Request
  // Materials live inside the Materials section; View Asset Profile lives
  // inside the Asset section. This flag only covers the Current Status
  // button row.
  const hasStatusAction =
    showAssign ||
    showApproveBtn ||
    showApproveMaterialsBtn ||
    showCorrectionBtn ||
    showEditJobCardForReview ||
    showEditResubmit ||
    showClose ||
    showStartWorkGeneric ||
    showSubmit ||
    showStartWork ||
    showMarkComplete ||
    showViewAssignment ||
    showAssignWorkers ||
    showTrackWork ||
    legacyShowAssign ||
    legacyShowClose ||
    legacyShowSubmit ||
    legacyShowReturnToDraft ||
    legacyShowMarkComplete ||
    !!assignSuccess;

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        aria-hidden="true"
        onClick={close}
      />

      {/* ── Modal centering wrapper ────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qv-heading"
          className="relative flex w-[min(96vw,1100px)] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh]"
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div className="shrink-0 flex items-start gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p
                id="qv-heading"
                className="text-xs font-black uppercase tracking-wide text-[#ED1C24]"
              >
                {data.work_order_number ?? "Job Card"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-[#111827]">
                {title}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge label={displayMain} tone={displayTone} />
                {data.hasPendingCorrection && (
                  <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
                )}
                {data.maintenance_type && (
                  <StatusBadge label={data.maintenance_type} tone="gray" />
                )}
                {data.worker_type &&
                  data.worker_type !== data.maintenance_type && (
                    <StatusBadge label={data.worker_type} tone="gray" />
                  )}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={close}
              className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
              aria-label="Close quick view"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Scrollable body ──────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-y-auto">

            {/* Current Status — text only. Business flow: Understand Job Card
                → Check Asset → Check Materials → Review/Approve/Request
                Correction, so no workflow action button lives here anymore;
                every action moved to the Bottom Action Area below the
                two-column decision summary. */}
            <section
              className={`border-b border-[#E5E7EB] px-5 py-2.5 ${
                data.hasPendingCorrection ? "bg-red-50" : isTerminal ? "bg-gray-50" : "bg-amber-50"
              }`}
            >
              <p
                className={`text-xs font-black uppercase tracking-wide ${
                  data.hasPendingCorrection ? "text-red-800" : isTerminal ? "text-[#4B5563]" : "text-amber-800"
                }`}
              >
                Current Status
              </p>
              <p
                className={`mt-0.5 text-sm font-bold ${
                  data.hasPendingCorrection ? "text-red-900" : isTerminal ? "text-[#111827]" : "text-amber-900"
                }`}
              >
                {displayMain}
              </p>
              {displaySub && (
                <p
                  className={`mt-0.5 text-sm ${
                    data.hasPendingCorrection ? "text-red-800" : isTerminal ? "text-[#4B5563]" : "text-amber-800"
                  }`}
                >
                  {displaySub}
                </p>
              )}
              {/* Unified Manager Job Card + Materials Approval Flow Fix Task
                  4: replaces the generic "awaiting technician assignment"
                  sub-text whenever an active Materials Request is actually
                  what's blocking it. */}
              {["Approved", "Partially Issued", "Materials Issued"].includes(data.status) && hasActiveMaterialsRequest && (
                <p className="mt-0.5 text-sm font-semibold text-amber-900">
                  Waiting for materials before assignment.
                </p>
              )}
              {/* Data Entry Job Card Action Clarity Fix Task 2: whoever
                  cannot act on Under Review right now (Data Entry, Store,
                  Viewer/Auditor — Supervisor/Manager get the Approve/Edit Job
                  Card buttons instead and don't need this) sees an explicit
                  explanation instead of a silent lack of buttons. */}
              {data.status === "Under Review" && !data.hasPendingCorrection && !showApproveBtn && !showCorrectionBtn && (
                <p className="mt-0.5 text-sm text-amber-800">
                  {data.canAssign || data.canUpdateProgress || data.canClose
                    ? "You can update this Job Card after it is approved."
                    : "No update available until approval."}
                </p>
              )}
            </section>

            {/* Job Card Work Tracking Entry Points and Assignment
                Visibility Unit 8B, Task 3 — skipped while a correction is
                pending, since the Supervisor / Manager request block right
                below already gives clearer, more specific guidance than a
                generic Next Action line would. */}
            {!data.hasPendingCorrection && (
              <section className="border-b border-[#E5E7EB] bg-red-50/40 px-5 py-3">
                <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Next Action</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">{nextActionText}</p>
              </section>
            )}

            {/* Data Entry Correction Note Visibility Cleanup Task 2: the
                Supervisor / Manager's correction note, shown immediately
                whenever one is pending — not tucked behind Full Details —
                so Data Entry always knows exactly what to fix without
                leaving this popup. */}
            {data.hasPendingCorrection && (
              <section className="border-b border-red-200 bg-red-50 px-5 py-3">
                <p className="text-xs font-black uppercase tracking-wide text-red-800">
                  Supervisor / Manager request
                </p>
                {data.pendingCorrectionNote?.question ? (
                  <p className="mt-1 text-sm font-semibold leading-relaxed text-red-900">
                    &ldquo;{data.pendingCorrectionNote.question}&rdquo;
                  </p>
                ) : (
                  <p className="mt-1 text-sm leading-relaxed text-red-900">
                    Correction was requested. Please review and update the Job Card.
                  </p>
                )}
                {(data.pendingCorrectionNote?.requestedByName || data.pendingCorrectionNote?.requestedAt) && (
                  <p className="mt-1.5 text-xs text-red-700">
                    Requested by {data.pendingCorrectionNote?.requestedByName ?? "Supervisor / Manager"}
                    {data.pendingCorrectionNote?.requestedAt
                      ? ` · ${formatDateTime(data.pendingCorrectionNote.requestedAt)}`
                      : ""}
                  </p>
                )}
              </section>
            )}

            {/* Main decision area — two columns on desktop: Key Details +
                Asset on the left (context), Materials on the right (what's
                blocking or ready) — both visible before any action button. */}
            <div className="grid grid-cols-1 gap-3 px-5 py-3 lg:grid-cols-2">
              {/* Left column */}
              <div className="space-y-3">
                {/* Key Details */}
                <div className="rounded-md border border-[#E5E7EB] p-2.5">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                    Key Details
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Work Team / Division shown right next to the actual
                        Assignment field below — the two are easy to confuse
                        (both describe "who/what handles this Job Card") so
                        they're kept visually adjacent and separately
                        labeled: this is the maintenance team/category picked
                        at creation, not who Manager later assigns the work
                        to via Assign Work. */}
                    {data.worker_type && (
                      <div>
                        <p className="text-xs text-[#9CA3AF]">Work Team / Division</p>
                        <p className="text-sm text-[#111827]">{data.worker_type}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-[#9CA3AF]">
                        {data.primary_assignment?.assignment_type === "FREELANCER"
                          ? "Freelancer"
                          : data.primary_assignment?.assignment_type === "EXTERNAL_COMPANY"
                          ? "External Company"
                          : "Technician"}
                      </p>
                      <p className="text-sm text-[#111827]">
                        {data.primary_assignment?.assignment_type === "FREELANCER" ? (
                          <>
                            {data.primary_assignment.external_name ?? <span className="text-[#9CA3AF]">Not assigned</span>}
                            {(data.primary_assignment.external_trade || data.primary_assignment.external_phone) && (
                              <span className="block text-xs text-[#6B7280]">
                                {[data.primary_assignment.external_trade, data.primary_assignment.external_phone].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </>
                        ) : data.primary_assignment?.assignment_type === "EXTERNAL_COMPANY" ? (
                          <>
                            {data.primary_assignment.external_company ?? <span className="text-[#9CA3AF]">Not assigned</span>}
                            {(data.primary_assignment.external_contact_person || data.primary_assignment.external_phone) && (
                              <span className="block text-xs text-[#6B7280]">
                                {[data.primary_assignment.external_contact_person, data.primary_assignment.external_phone].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </>
                        ) : data.technician_names.length > 0 ? (
                          data.technician_names.join(", ")
                        ) : (
                          <span className="text-[#9CA3AF]">Not assigned</span>
                        )}
                      </p>
                    </div>
                    {data.ordered_by && (
                      <div>
                        <p className="text-xs text-[#9CA3AF]">Reported by</p>
                        <p className="text-sm text-[#111827]">{data.ordered_by}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Created</p>
                      <p className="text-sm text-[#111827]">
                        {formatDate(data.created_at)}
                      </p>
                    </div>
                    {data.date_of_order && (
                      <div>
                        <p className="text-xs text-[#9CA3AF]">Date of order</p>
                        <p className="text-sm text-[#111827]">
                          {formatDate(data.date_of_order)}
                        </p>
                      </div>
                    )}
                    {data.maintenance_type && (
                      <div>
                        <p className="text-xs text-[#9CA3AF]">Type</p>
                        <p className="text-sm text-[#111827]">{data.maintenance_type}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Asset / Equipment / Vehicle */}
                {data.assets && (
                  <div className="rounded-md border border-[#E5E7EB] p-2.5">
                    <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                      Asset / Equipment / Vehicle
                    </p>
                    <p className="text-sm font-semibold text-[#111827]">
                      {data.assets.asset_code} — {data.assets.asset_name}
                      {data.assets.plate_number && ` - Plate ${data.assets.plate_number}`}
                    </p>
                    {data.assets.location && (
                      <p className="mt-0.5 text-xs text-[#4B5563]">
                        {data.assets.location}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowAssetPreview(true)}
                      className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      View Asset <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Right column: Materials */}
              <div className="rounded-md border border-[#E5E7EB] p-2.5">
                <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  {/* Job Card Action Clarity Fix Task 5: once Required
                      Materials tracking applies, the heading reflects actual
                      Offline Inventory availability (Issue Material/Receive
                      Materials/Materials Available/Materials Completed)
                      instead of the Materials Request's own receipt status —
                      the two can disagree (a request can be "Received" into
                      the store while nothing's been issued to this Job Card
                      yet, or vice versa for legacy manually-recorded stock). */}
                  {hasRequiredMaterialsTracking
                    ? materialsAvailability === "fulfilled"
                      ? "Materials Completed"
                      : materialsAvailability === "issuable"
                        ? "Materials Available"
                        : materialsAvailability === "partial"
                          ? "Materials Partially Available"
                          : "Materials Pending"
                    : activeReceiptStatus === "Pending"
                      ? "Materials Pending"
                      : activeReceiptStatus === "Completed"
                        ? "Materials Completed"
                        : activeReceiptStatus === "Requested"
                          ? "Materials Requested"
                          : "Materials"}
                </p>
                {data.parts_requests_count > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 shrink-0 text-[#4B5563]" />
                      <p className="text-sm text-[#111827]">
                        <span className="font-bold">{data.parts_requests_count}</span>{" "}
                        Materials Request{data.parts_requests_count !== 1 ? "s" : ""}
                        {data.open_parts_requests_count > 0 ? (
                          <span className="ml-1.5 font-bold text-amber-700">open</span>
                        ) : (
                          <span className="ml-1.5 font-bold text-green-700">· All issued</span>
                        )}
                      </p>
                    </div>
                    {activePartsRequest ? (
                      <div className="rounded-md bg-[#F5F6F8] p-2">
                        <p className="text-xs font-bold text-[#111827]">
                          {activePartsRequest.parts_request_number ?? "Materials Request"}
                          {" · "}
                          <span
                            className={`font-semibold ${
                              activeReceiptStatus ? RECEIPT_TONE_TEXT_CLASS[materialsReceiptStatusTone(activeReceiptStatus)] : ""
                            }`}
                          >
                            {activeReceiptStatus}
                          </span>
                        </p>
                        {activePartsRequest.items.length > 0 ? (
                          <>
                            <ul className="mt-1.5 space-y-1">
                              {activePartsRequest.items.slice(0, 3).map((item) => (
                                <CompactMaterialItemLine
                                  key={item.id}
                                  item={item}
                                  requestStatus={activePartsRequest.status}
                                  jobCardStatus={data.status}
                                  hasPendingCorrection={data.hasPendingCorrection}
                                />
                              ))}
                            </ul>
                            {activePartsRequest.items.length > 3 && (
                              <p className="mt-1 text-[11px] font-medium text-[#9CA3AF]">
                                +{activePartsRequest.items.length - 3} more item{activePartsRequest.items.length - 3 !== 1 ? "s" : ""}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-[#9CA3AF]">No items listed for this request.</p>
                        )}
                      </div>
                    ) : (
                      data.last_parts_request_status && (
                        <p className="text-xs text-[#4B5563]">
                          Last request:{" "}
                          <span className="font-semibold">
                            {data.last_parts_request_status}
                          </span>
                        </p>
                      )
                    )}
                  </div>
                ) : data.required_parts_count > 0 ? (
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 shrink-0 text-[#4B5563]" />
                    <p className="text-sm text-[#111827]">
                      <span className="font-bold">{data.required_parts_count}</span>{" "}
                      materials listed — no requests submitted yet
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[#9CA3AF]">No Materials Request yet</p>
                )}
                {showMaterialsCompletedLabel && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Materials Completed
                  </p>
                )}
                {(showViewMaterialsPreview || showRequestParts || showReceiveMaterialsShortcut || showIssueMaterialAction || showReceiveShortageAction) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Job Card Action Clarity Fix Task 3: the primary
                        action once required materials are confirmed
                        available in Offline Inventory — issuing (not
                        receiving) is what's actually needed. */}
                    {showIssueMaterialAction && (
                      <Link
                        href={issueMaterialHref}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                      >
                        {issueMaterialLabel} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {showReceiveShortageAction && (
                      <Link
                        href={receiveMaterialHref}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#111827] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                      >
                        {receiveMaterialLabel} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {/* Manager Approval Success Popup and Materials Awaiting
                        Receipt Flow Task 7: the legacy shortcut for Job Cards
                        with no Required Materials rows to reason about (see
                        hasRequiredMaterialsTracking above) — links to the
                        Materials Request detail page, where the real Receive
                        Materials panel lives. */}
                    {showReceiveMaterialsShortcut && activePartsRequest && (
                      <Link
                        href={`/store/parts-requests/${activePartsRequest.id}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#111827] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                      >
                        Receive Materials <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {showViewMaterialsPreview && (
                      <button
                        type="button"
                        onClick={() => setShowMaterialsPreview(true)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                      >
                        View Materials <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {showRequestParts && (
                      <Link
                        href={`/store/parts-requests/new?repair_order_id=${data.id}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                      >
                        Request Materials <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Attachment count summary */}
            {data.attachment_count > 0 && (
              <div className="border-t border-[#E5E7EB] px-5 py-2">
                <p className="text-xs text-[#4B5563]">
                  <Paperclip className="mr-1 inline h-3 w-3" />
                  <span className="font-bold">{data.attachment_count}</span>{" "}
                  document{data.attachment_count !== 1 ? "s" : ""} &amp; photo{data.attachment_count !== 1 ? "s" : ""} attached
                </p>
              </div>
            )}

            {/* Inline assign panel — shown when "Assign Work" (Bottom Action
                Area) is clicked. */}
            {showAssignPanel && (
              <section className="border-t border-[#E5E7EB] px-5 py-3">
                <AssignmentFormModal
                  workOrderId={data.id}
                  technicians={data.technicians}
                  onSuccess={handleAssignSuccess}
                  onCancel={() => setShowAssignPanel(false)}
                />
              </section>
            )}

            {/* Bottom Action Area — every workflow action button lives here,
                after the Asset and Materials summary have already been shown,
                so a Manager always sees the request context before being
                offered Approve/Request Correction (or any other status
                action). */}
            {(hasStatusAction || assignSuccess) && (
              <section className="border-t border-[#E5E7EB] bg-gray-50 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {assignSuccess && !showAssign && !legacyShowAssign && (
                    <div className="flex w-full items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {assignSuccess}
                    </div>
                  )}
                  {(showAssign || legacyShowAssign) && !showAssignPanel && (
                    <button
                      type="button"
                      onClick={() => { setShowAssignPanel(true); setAssignSuccess(null); }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Assign Work <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {/* Simplified Workflow UI Consistency Cleanup Task 3: the
                      Job Card creator's (or Manager's) way to clear a pending
                      correction — links to the detail page, where the actual
                      question, response field, and Submit Response &
                      Resubmit action live (this popup never performs a
                      workflow transition directly, matching every other
                      status action here). */}
                  {showEditResubmit && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}/edit`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      <AlertTriangle className="h-4 w-4" /> Edit &amp; Resubmit
                    </Link>
                  )}
                  {showAddMaterialsForCorrection && (
                    <Link
                      href={`/store/parts-requests/new?repair_order_id=${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
                    >
                      Add Materials <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showUpdateMaterialsForCorrection && activePartsRequest && (
                    <Link
                      href={`/store/parts-requests/${activePartsRequest.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
                    >
                      Update Materials <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showApproveBtn && (
                    <button
                      type="button"
                      onClick={() => setReviewPanelMode("approve")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      {/* Approving also approves any linked Requested
                          Materials Request in the same action (Simplified Job
                          Card Approval Workflow Unit Task 4/5). */}
                      Approve <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {showApproveMaterialsBtn && (
                    <button
                      type="button"
                      onClick={() => setReviewPanelMode("approveMaterials")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Approve Materials Request <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {/* Manager Quick-View Action Simplification Task 2/3: replaces
                      the old "Request Correction"/"Ask to Add/Update Materials"
                      buttons — Manager can just edit the Job Card (and its
                      materials, on the same edit page) directly instead of
                      routing a formal correction request through Data Entry. */}
                  {showEditJobCardForReview && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}/edit`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Edit Job Card <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showClose && (
                    <button
                      type="button"
                      onClick={() => setActionPanelMode("close")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Close Job Card <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {legacyShowClose && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Close Job Card <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showStartWorkGeneric && (
                    <button
                      type="button"
                      onClick={() => setActionPanelMode("start")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Mark Work Started <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {showStartWork && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Start Work <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {(showMarkComplete || legacyShowMarkComplete) && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Mark Completed <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showViewAssignment && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}#assignment`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      View Assignment <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {/* Job Card Work Tracking Entry Points and Assignment
                      Visibility Unit 8B, Task 4: both link straight to the
                      full detail page's Work Time Tracking section (its
                      empty state has its own "Assign Workers" call to action
                      when nobody's assigned yet — Task 7) — no inline
                      Start/Pause/Resume/Stop controls in this popup. */}
                  {showAssignWorkers && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}#work-time-tracking`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Assign Workers <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showTrackWork && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}#work-time-tracking`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Track Work <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {/* Draft Submit UX Cleanup Task 2/4: submits directly from
                      the popup instead of just linking to the full detail
                      page — carries return_to/return_to_param so the server
                      action sends Data Entry back to this same page (with a
                      success popup) rather than forcing navigation away. */}
                  {(showSubmit || legacyShowSubmit) && (
                    <form action={submitWorkOrderAction} className="contents">
                      <input type="hidden" name="work_order_id" value={data.id} />
                      <input type="hidden" name="return_to" value={data.closeHref} />
                      <input type="hidden" name="return_to_param" value={data.previewParamName} />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                      >
                        Start Job Card <ArrowRight className="h-4 w-4" />
                      </button>
                    </form>
                  )}
                  {(showSubmit || legacyShowSubmit) && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}/edit`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Edit Draft <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {legacyShowReturnToDraft && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Return to Draft <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
                {showApproveBtn && (
                  <p className="mt-2 text-xs text-[#6B7280]">
                    {requestedMaterialsRequests.length > 0
                      ? "Approving will approve this Job Card and its requested materials. Materials will then move to Pending."
                      : "Approving will approve this Job Card."}
                  </p>
                )}
                {showEditJobCardForReview && (
                  <p className="mt-1 text-xs text-[#6B7280]">
                    Use Edit Job Card if details or materials need changes before approval.
                  </p>
                )}
              </section>
            )}
          </div>

          {/* ── Sticky footer ─────────────────────────────────────────────────── */}
          <div className="shrink-0 sticky bottom-0 flex items-center gap-2 rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
            <Link
              href={`/maintenance/work-orders/${data.id}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-[#111827] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
            >
              Full Details <ExternalLink className="h-4 w-4" />
            </Link>
            <button
              onClick={close}
              className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* ── Materials preview (read-only) ───────────────────────────────────
          Opened via the "View Materials" Quick Action. Shows every linked
          Materials Request and its items without leaving the Job Card quick
          view — no create/edit/issue actions live here, only a link to the
          full Materials Request detail page for that. */}
      {showMaterialsPreview && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setShowMaterialsPreview(false)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="materials-preview-heading"
              className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl max-h-[85vh]"
            >
              <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
                <div className="min-w-0">
                  <p id="materials-preview-heading" className="text-sm font-black text-[#111827]">
                    Requested Materials
                  </p>
                  <p className="mt-0.5 text-xs text-[#4B5563]">{data.work_order_number ?? "Job Card"}</p>
                </div>
                <button
                  onClick={() => setShowMaterialsPreview(false)}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
                  aria-label="Close materials preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E5E7EB] px-5 py-4">
                {data.all_parts_requests.length === 0 ? (
                  <p className="text-sm text-[#9CA3AF]">No Materials Request yet</p>
                ) : (
                  data.all_parts_requests.map((pr) => (
                    <div key={pr.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-xs font-bold text-[#111827]">
                        {pr.parts_request_number ?? "Materials Request"}
                        {" · "}
                        <span className="font-semibold text-amber-700">{pr.status}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-[#4B5563]">
                        {pr.status === "Requested"
                          ? "Status: Requested — will be approved with the Job Card."
                          : `Current stage: ${materialsRequestStageLine(pr.status)}`}
                      </p>
                      {pr.status === "Requested" && (
                        <p className="mt-1 text-xs text-[#6B7280]">
                          These materials will be approved together when you click Approve. After approval, they will move to Pending.
                        </p>
                      )}
                      {pr.items.length > 0 ? (
                        <ul className="mt-2 space-y-2.5">
                          {pr.items.map((item) => (
                            <MaterialItemLine key={item.id} item={item} />
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-[#9CA3AF]">No items listed for this request.</p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="shrink-0 flex items-center gap-2 rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
                {(activePartsRequest ?? data.all_parts_requests[0]) && (
                  <Link
                    href={`/store/parts-requests/${(activePartsRequest ?? data.all_parts_requests[0]).id}`}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-[#111827] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                  >
                    Open Full Materials Request <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <button
                  onClick={() => setShowMaterialsPreview(false)}
                  className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Asset Summary (read-only) ────────────────────────────────────────
          Opened via "View Asset Profile" in the Asset / Equipment / Vehicle
          section — no navigation away from the Job Card quick view. "Open
          Full Asset Profile" inside is the only real navigation out. */}
      {showAssetPreview && data.assets && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setShowAssetPreview(false)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="asset-preview-heading"
              className="relative flex w-full max-w-[480px] flex-col rounded-xl bg-white shadow-2xl max-h-[85vh]"
            >
              <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
                <div className="min-w-0">
                  <p id="asset-preview-heading" className="text-sm font-black text-[#111827]">
                    Asset Summary
                  </p>
                  <p className="mt-0.5 text-xs text-[#4B5563]">{data.assets.asset_code}</p>
                </div>
                <button
                  onClick={() => setShowAssetPreview(false)}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
                  aria-label="Close asset summary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Asset Code</p>
                    <p className="text-sm font-semibold text-[#111827]">{data.assets.asset_code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Asset Name</p>
                    <p className="text-sm font-semibold text-[#111827]">{data.assets.asset_name}</p>
                  </div>
                  {data.assets.category && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Category</p>
                      <p className="text-sm text-[#111827]">{data.assets.category}</p>
                    </div>
                  )}
                  {data.assets.plate_number && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Plate Number</p>
                      <p className="text-sm text-[#111827]">{data.assets.plate_number}</p>
                    </div>
                  )}
                  {(data.assets.brand || data.assets.model) && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Brand / Model</p>
                      <p className="text-sm text-[#111827]">
                        {[data.assets.brand, data.assets.model].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  )}
                  {data.assets.status && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Status</p>
                      <p className="text-sm text-[#111827]">{data.assets.status}</p>
                    </div>
                  )}
                  {data.assets.location && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Location</p>
                      <p className="text-sm text-[#111827]">{data.assets.location}</p>
                    </div>
                  )}
                  {data.assets.condition && (
                    <div>
                      <p className="text-xs text-[#9CA3AF]">Condition</p>
                      <p className="text-sm text-[#111827]">{data.assets.condition}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2 rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
                <Link
                  href={`/assets/${data.assets.id}`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-[#111827] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                >
                  Open Full Asset Profile <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => setShowAssetPreview(false)}
                  className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Review / Approve / Request Correction panel ──────────────────────
          Opened via one of the three Bottom Action Area buttons — each
          button opens ONLY its own focused form (Review → review form only,
          Approve → approve form only, Request Correction → correction form
          only), never all three at once. Each form posts to the same server
          action the full Job Card detail page uses (Unit 4's action engine)
          — the only "navigation" is the normal post-submit redirect to the
          detail page once an action actually completes, identical to what
          happens everywhere else in the app after a workflow action. */}
      {reviewPanelMode && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setReviewPanelMode(null)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-panel-heading"
              className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl max-h-[85vh]"
            >
              <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
                <div className="min-w-0">
                  <p id="review-panel-heading" className="text-sm font-black text-[#111827]">
                    {reviewPanelMode === "approve"
                      ? "Approve Job Card"
                      : reviewPanelMode === "approveMaterials"
                        ? "Approve Materials Request"
                        : reviewPanelMode === "askMaterials"
                          ? "Ask to Add/Update Materials"
                          : "Request Correction"}
                  </p>
                  <p className="mt-0.5 text-xs text-[#4B5563]">{data.work_order_number ?? "Job Card"}</p>
                </div>
                <button
                  onClick={() => setReviewPanelMode(null)}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
                  aria-label="Close review panel"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                {/* Read-only summary */}
                <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-3 text-sm">
                  <p className="font-semibold text-[#111827]">{title}</p>
                  {data.assets && (
                    <p className="mt-1 text-xs text-[#4B5563]">
                      {data.assets.asset_code} — {data.assets.asset_name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[#4B5563]">
                    Materials:{" "}
                    {activePartsRequest
                      ? `${activePartsRequest.parts_request_number ?? "Materials Request"} · ${activePartsRequest.status}`
                      : data.parts_requests_count > 0
                        ? "All requested materials issued"
                        : "No Materials Request yet"}
                  </p>
                  {data.ordered_by && (
                    <p className="mt-1 text-xs text-[#4B5563]">Reported by {data.ordered_by} · {formatDate(data.created_at)}</p>
                  )}
                </div>

                <div className="mt-4">
                  {reviewPanelMode === "approve" && showApproveBtn && (
                    <form action={approveJobCardAndMaterialsAction} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
                      <input type="hidden" name="work_order_id" value={data.id} />
                      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
                        Approval
                      </p>
                      <p className="text-xs text-[#4B5563]">
                        {requestedMaterialsRequests.length > 0
                          ? "This will approve the Job Card and requested materials. Materials will be marked as Pending."
                          : "This will approve the Job Card and make it Approved."}
                      </p>
                      <input type="hidden" name="return_to" value={data.closeHref} />
                      <input type="hidden" name="return_to_param" value={data.previewParamName} />
                      <textarea
                        name="comments"
                        placeholder="Approval notes (optional)"
                        className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      />
                      <button type="submit" className="w-full rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]">
                        Approve
                      </button>
                    </form>
                  )}

                  {/* Case C: Job Card already Approved (or beyond), a linked
                      Materials Request is still Requested — approves the
                      Materials Request only via the existing, already-tested
                      approvePartsRequestAction (Store's own approval action),
                      not the Job Card path. */}
                  {reviewPanelMode === "approveMaterials" && showApproveMaterialsBtn && activePartsRequest && (
                    <form action={approvePartsRequestAction} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
                      <input type="hidden" name="parts_request_id" value={activePartsRequest.id} />
                      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
                        Approve {activePartsRequest.parts_request_number ?? "Materials Request"}
                      </p>
                      <p className="text-xs text-[#4B5563]">
                        The Job Card is already approved — this only approves the additional requested materials.
                      </p>
                      <textarea
                        name="comments"
                        placeholder="Approval notes (optional)"
                        className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      />
                      <button type="submit" className="w-full rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]">
                        Approve Materials Request
                      </button>
                    </form>
                  )}

                  {reviewPanelMode === "correction" && showCorrectionBtn && (
                    <form action={requestClarificationAction} className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <input type="hidden" name="work_order_id" value={data.id} />
                      <input type="hidden" name="kind" value="correction" />
                      <p className="text-xs font-black uppercase tracking-wide text-amber-800">Request Correction</p>
                      <textarea
                        name="question"
                        placeholder="What needs to be corrected? (min 10 characters)"
                        required
                        minLength={10}
                        className="focus-ring min-h-16 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                      />
                      <button type="submit" className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100">
                        Request Correction
                      </button>
                    </form>
                  )}
                  {reviewPanelMode === "askMaterials" && showCorrectionBtn && (
                    <form action={requestClarificationAction} className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <input type="hidden" name="work_order_id" value={data.id} />
                      <input type="hidden" name="kind" value="materials" />
                      <p className="text-xs font-black uppercase tracking-wide text-amber-800">Ask to Add/Update Materials</p>
                      <textarea
                        name="question"
                        placeholder="What materials need to be added or changed? (min 10 characters)"
                        required
                        minLength={10}
                        className="focus-ring min-h-16 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                      />
                      <button type="submit" className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100">
                        Ask to Add/Update Materials
                      </button>
                    </form>
                  )}
                </div>
              </div>

              <div className="shrink-0 flex items-center justify-end rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
                <button
                  onClick={() => setReviewPanelMode(null)}
                  className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Start Work panel ──────────────────────────────────────────────
          Opened via the generic "Start Work" button (Data Entry / Engineer /
          Manager — Technician keeps its own separate assignment-checked
          flow). Only this one focused form, no other action offered. */}
      {actionPanelMode === "start" && showStartWorkGeneric && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setActionPanelMode(null)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="start-panel-heading"
              className="relative flex w-full max-w-[480px] flex-col rounded-xl bg-white shadow-2xl max-h-[85vh]"
            >
              <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
                <div className="min-w-0">
                  <p id="start-panel-heading" className="text-sm font-black text-[#111827]">
                    Mark Work Started
                  </p>
                  <p className="mt-0.5 text-xs text-[#4B5563]">{data.work_order_number ?? "Job Card"}</p>
                </div>
                <button
                  onClick={() => setActionPanelMode(null)}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
                  aria-label="Close start work panel"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-3 text-sm">
                  <p className="font-semibold text-[#111827]">
                    {data.primary_assignment?.assignment_type === "FREELANCER"
                      ? data.primary_assignment.external_name ?? "Freelancer"
                      : data.primary_assignment?.assignment_type === "EXTERNAL_COMPANY"
                        ? data.primary_assignment.external_company ?? "External company"
                        : data.technician_names.length > 0
                          ? data.technician_names.join(", ")
                          : "Not assigned"}
                  </p>
                  <p className="mt-1 text-xs text-[#4B5563]">Current status: {data.displayStatus}</p>
                </div>

                <form action={startJobCardProgressAction} className="mt-4 space-y-2 rounded-md border border-[#E5E7EB] p-3">
                  <input type="hidden" name="work_order_id" value={data.id} />
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Progress note</p>
                  <textarea
                    name="note"
                    placeholder="Progress note (optional)"
                    className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                  <button type="submit" className="w-full rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]">
                    Mark Work Started
                  </button>
                </form>
              </div>

              <div className="shrink-0 flex items-center justify-end rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
                <button
                  onClick={() => setActionPanelMode(null)}
                  className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Close Job Card panel ──────────────────────────────────────────
          Opened via the generic "Close Job Card" button (Data Entry /
          Engineer / Manager — Technician keeps its own separate Mark
          Completed flow). Shows the same read-only summary as the
          Review/Approve panel plus a reminder to confirm consumed materials
          before closing (Task 10 — no full consumed-materials entry feature
          in this unit; see final report). */}
      {actionPanelMode === "close" && showClose && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setActionPanelMode(null)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="close-panel-heading"
              className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl max-h-[85vh]"
            >
              <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
                <div className="min-w-0">
                  <p id="close-panel-heading" className="text-sm font-black text-[#111827]">
                    Close Job Card
                  </p>
                  <p className="mt-0.5 text-xs text-[#4B5563]">{data.work_order_number ?? "Job Card"}</p>
                </div>
                <button
                  onClick={() => setActionPanelMode(null)}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
                  aria-label="Close panel"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-3 text-sm">
                  <p className="font-semibold text-[#111827]">{title}</p>
                  {data.assets && (
                    <p className="mt-1 text-xs text-[#4B5563]">
                      {data.assets.asset_code} — {data.assets.asset_name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[#4B5563]">
                    Materials:{" "}
                    {activePartsRequest
                      ? `${activePartsRequest.parts_request_number ?? "Materials Request"} · ${activePartsRequest.status}`
                      : data.parts_requests_count > 0
                        ? "All requested materials issued"
                        : "No Materials Request yet"}
                  </p>
                  <p className="mt-1 text-xs text-[#4B5563]">
                    Assignment:{" "}
                    {data.primary_assignment?.assignment_type === "FREELANCER"
                      ? data.primary_assignment.external_name ?? "Freelancer"
                      : data.primary_assignment?.assignment_type === "EXTERNAL_COMPANY"
                        ? data.primary_assignment.external_company ?? "External company"
                        : data.technician_names.length > 0
                          ? data.technician_names.join(", ")
                          : "Not assigned"}
                  </p>
                </div>

                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  <span>Confirm all used/consumed materials are updated before closing.</span>
                </div>

                <form action={closeWorkOrderAction} className="mt-4 space-y-2 rounded-md border border-[#E5E7EB] p-3">
                  <input type="hidden" name="work_order_id" value={data.id} />
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Closing note</p>
                  <textarea
                    name="comments"
                    placeholder="Describe the work completed (required, min 10 characters)"
                    required
                    minLength={10}
                    className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                  <button type="submit" className="w-full rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]">
                    Close Job Card
                  </button>
                </form>
              </div>

              <div className="shrink-0 flex items-center justify-end rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
                <button
                  onClick={() => setActionPanelMode(null)}
                  className="rounded-md border border-[#E5E7EB] px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
