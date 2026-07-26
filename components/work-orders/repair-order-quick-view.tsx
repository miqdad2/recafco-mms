"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  CheckCircle2,
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
  reviewJobCardModalAction,
  startJobCardProgressAction,
  type ReviewModalState,
} from "@/app/actions/workflow";
import { approvePartsRequestAction } from "@/app/actions/phase4";

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
  // Data Entry Job Card Progress Update and Close Action Unit — real
  // work_orders.close / work_orders.update permission checks (Super Admin
  // bypasses to true), replacing the old canApprove||canAssign proxy that
  // happened to work only by coincidence for every role tried so far.
  canClose: boolean;
  canUpdateProgress: boolean;
  // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 5/7:
  // whether a work_order.review audit entry already exists for this Job
  // Card — Job Card status stays "Under Review" through both the Engineer
  // review and Manager approval steps, so this is the only signal that
  // distinguishes "not yet reviewed" from "reviewed, waiting on Manager".
  reviewed: boolean;
  closeHref: string;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

type Tone = "green" | "amber" | "red" | "blue" | "gray";

// A Job Card can only ever have one Materials Request in one of these
// statuses at a time — mirrors ACTIVE_MATERIALS_REQUEST_STATUSES in
// lib/backend/parts-requests/repository.ts, kept as a local copy per this
// project's established pattern for small per-file display constants.
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

// Plain-language sentence for a Materials Request's overall status — used
// instead of showing the bare status word alone, so a non-technical user
// immediately knows what it means for them right now.
function materialsRequestStageLine(status: string): string {
  switch (status) {
    case "Requested":
      return "Waiting for approval before Store issue";
    case "Approved":
      return "Store can issue materials";
    case "Waiting Stock":
      return "Store marked materials as not available yet";
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
// the supporting detail lines. Wording only ("Requested quantity" / "Store
// sent") — no change to the underlying issued/remaining logic below.
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
          <p>Store sent: <span className="font-semibold text-[#6B7280]">Not sent yet</span></p>
        ) : issued < requested ? (
          <>
            <p>Sent by Store: <span className="font-semibold text-amber-700">{issued}</span></p>
            <p>Still pending: <span className="font-semibold text-amber-700">{remaining}</span></p>
            <p>Status: <span className="font-semibold text-amber-700">Partially Sent</span></p>
          </>
        ) : (
          <p>Store sent: <span className="font-semibold text-green-700">Fully sent</span></p>
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
function CompactMaterialItemLine({ item, requestStatus }: { item: MaterialItem; requestStatus: string }) {
  const requested = item.quantity_requested;
  const issued = item.issued_quantity;
  const remaining = Math.max(requested - issued, 0);

  let tailText: string;
  let toneClass: string;
  if (issued > 0 && issued < requested) {
    tailText = `Issued ${issued} · Pending ${remaining}`;
    toneClass = "text-amber-700";
  } else if (requested > 0 && issued >= requested) {
    tailText = "Fully Issued";
    toneClass = "text-green-700";
  } else if (requestStatus === "Waiting Stock") {
    tailText = "Waiting Stock";
    toneClass = "text-amber-700";
  } else if (requestStatus === "Approved") {
    tailText = "Ready for Store Issue";
    toneClass = "text-blue-700";
  } else if (requestStatus === "Requested") {
    tailText = "Waiting Approval";
    toneClass = "text-[#6B7280]";
  } else {
    tailText = requestStatus;
    toneClass = "text-[#6B7280]";
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
// active work, not a separate stage. The exact internal status is still
// shown as a small "Workflow stage" label so nothing is hidden.
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
        sub: "Waiting for Maintenance Engineer / Manager review.",
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

// Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/7/8: a
// small leaf component (mirrors AssignmentFormModal's own useActionState +
// onSuccess-callback pattern) so the "stay in the quick-view, refresh, show a
// success banner" logic lives in the same component that owns the action
// state — keeping the parent's setState calls in plain callbacks, not inside
// a useEffect, and giving each panel open/close a fresh action state.
function ReviewJobCardForm({
  workOrderId,
  reviewed,
  onSuccess,
}: {
  workOrderId: string;
  reviewed: boolean;
  onSuccess: (workOrderNumber: string | null) => void;
}) {
  const [state, formAction, isPending] = useActionState<ReviewModalState, FormData>(
    reviewJobCardModalAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onSuccess(state.workOrderNumber ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
        {reviewed ? "Add Review Note" : "Confirm Review"}
      </p>
      {reviewed && (
        <p className="text-xs text-[#4B5563]">
          Already reviewed and sent to the Maintenance Manager — this adds another note without repeating
          the notification.
        </p>
      )}
      {state?.ok === false && state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {state.error}
        </div>
      )}
      <textarea
        name="comments"
        placeholder="Review notes (optional)"
        disabled={isPending}
        className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm disabled:bg-gray-50"
      />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e] disabled:opacity-60"
      >
        {isPending ? "Submitting…" : reviewed ? "Add Review Note" : "Confirm Review / Send to Manager"}
      </button>
    </form>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RepairOrderQuickView({ data }: { data: QuickViewData }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/8: the
  // Review form used to be a plain <form action={reviewJobCardAction}>,
  // which redirected straight to the Full Details page with no visible
  // confirmation — the exact "did it work?" complaint this unit fixes.
  // ReviewJobCardForm (below) mirrors AssignmentFormModal's own
  // useActionState + onSuccess-callback pattern so it stays in the quick-view.
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [showMaterialsPreview, setShowMaterialsPreview] = useState(false);
  const [showAssetPreview, setShowAssetPreview] = useState(false);
  // Which entry point opened the review/approve/correction panel — only
  // changes the panel's title; every action the viewer has permission for is
  // always offered inside it regardless of which button was clicked.
  const [reviewPanelMode, setReviewPanelMode] = useState<"review" | "approve" | "approveMaterials" | "correction" | null>(null);
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

  // Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/7/8: on
  // success, close the review panel, show an inline banner naming the Job
  // Card and the next step, and refresh so data.reviewed flips to true (which
  // then relabels the Bottom Action Area button to "Add Review Note"). Called
  // from ReviewJobCardForm's own onSuccess (mirrors handleAssignSuccess above)
  // rather than a useEffect here, since the effect (and its setState calls)
  // belongs to whichever component owns the useActionState call.
  function handleReviewSuccess(workOrderNumber: string | null) {
    setReviewPanelMode(null);
    setReviewSuccess(
      `${workOrderNumber ?? data.work_order_number ?? "Job Card"} reviewed successfully. Sent to Maintenance Manager for approval. Next step: Waiting Manager Approval.`
    );
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
  const showAssign =
    (data.canApprove || data.canAssign) &&
    ["Approved", "Partially Issued", "Materials Issued"].includes(data.status) &&
    !hasActiveMaterialsRequest;
  // Under Review: up to three separate actions, each gated by its own
  // permission (an Engineer typically has review+correction, a Manager
  // typically has approve+correction, Super Admin has all three) — all three
  // open the same inline Review/Approve/Correction panel (never a page
  // navigation), which only offers the sub-actions the viewer is permitted.
  const showReviewBtn = data.canReview && data.status === "Under Review";
  const showApproveBtn = data.canApprove && data.status === "Under Review";
  const showCorrectionBtn = data.canRequestCorrection && data.status === "Under Review";
  // Case C: Job Card already Approved (or beyond) but a linked Materials
  // Request is still sitting Requested — Manager's remaining action is to
  // approve the Materials Request, not to assign work yet.
  const showApproveMaterialsBtn =
    data.canApprove && data.status !== "Under Review" && requestedMaterialsRequests.length > 0;
  // Generic Close/Start Work — anyone with the real work_orders.close /
  // work_orders.update permission (Data Entry, Engineer, Manager), excluding
  // Technician: Technician already has its own dedicated Mark Completed /
  // Start Work flow below (assignment-checked, drives /technician/jobs), and
  // Technician also happens to hold these same permissions, so excluding
  // them here avoids showing two different buttons for the same action.
  const showClose = !isTech && data.canClose && data.status === "In Progress";
  const showStartWorkGeneric = !isTech && data.canUpdateProgress && data.status === "Assigned";
  const showSubmit =
    data.canManage && data.status === "Created";
  const showStartWork = isTech && data.status === "Assigned";
  const showMarkComplete = isTech && data.status === "In Progress";
  // Re-assigning a technician after the initial assignment isn't a supported
  // backend transition (Assigned → Assigned), so managers can only view the
  // current assignment from here, not change it.
  const showViewAssignment =
    (data.canApprove || data.canAssign) && data.status === "Assigned";

  // Request Materials: hidden once Closed, and hidden while an active
  // Materials Request already exists — the Job Card can only ever have one
  // active request at a time, so "Request Materials" would just fail with a
  // duplicate-request error. Once every linked request reaches Issued,
  // hasActiveMaterialsRequest is false again and "Request Materials" reappears.
  const showRequestParts =
    data.canCreateParts && data.status !== "Closed" && !hasActiveMaterialsRequest;
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
    showReviewBtn ||
    showApproveBtn ||
    showApproveMaterialsBtn ||
    showCorrectionBtn ||
    showClose ||
    showStartWorkGeneric ||
    showSubmit ||
    showStartWork ||
    showMarkComplete ||
    showViewAssignment ||
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
                <StatusBadge label={statusInfo.main} tone={statusInfo.tone} />
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
              className={`border-b border-[#E5E7EB] px-5 py-2.5 ${isTerminal ? "bg-gray-50" : "bg-amber-50"}`}
            >
              <p
                className={`text-xs font-black uppercase tracking-wide ${
                  isTerminal ? "text-[#4B5563]" : "text-amber-800"
                }`}
              >
                Current Status
              </p>
              <p
                className={`mt-0.5 text-sm font-bold ${
                  isTerminal ? "text-[#111827]" : "text-amber-900"
                }`}
              >
                {statusInfo.main}
              </p>
              {statusInfo.sub && (
                <p
                  className={`mt-0.5 text-sm ${
                    isTerminal ? "text-[#4B5563]" : "text-amber-800"
                  }`}
                >
                  {statusInfo.sub}
                </p>
              )}
              {/* Maintenance Engineer Dashboard + Review-to-Manager UX Fix
                  Task 7: an Engineer who already reviewed sees this instead
                  of the generic "waiting for review" sub-text above, so
                  re-opening the same Job Card never reads as if nothing
                  happened. */}
              {data.status === "Under Review" && showReviewBtn && data.reviewed && (
                <p className="mt-0.5 text-sm font-semibold text-amber-900">
                  Reviewed — waiting Manager approval.
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
                  Viewer/Auditor — Engineer/Manager get the Review/Approve/
                  Correction buttons instead and don't need this) sees an
                  explicit explanation instead of a silent lack of buttons. */}
              {data.status === "Under Review" && !showReviewBtn && !showApproveBtn && !showCorrectionBtn && (
                <p className="mt-0.5 text-sm text-amber-800">
                  {data.canAssign || data.canUpdateProgress || data.canClose
                    ? "You can update this Job Card after it is approved."
                    : "No update available until approval."}
                </p>
              )}
              {statusInfo.main !== data.status && (
                <p className="mt-1 text-[11px] font-medium text-[#9CA3AF]">
                  Workflow stage: {data.status}
                </p>
              )}
            </section>

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
                  Materials
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
                          <span className="font-semibold text-amber-700">{activePartsRequest.status}</span>
                        </p>
                        {activePartsRequest.items.length > 0 ? (
                          <>
                            <ul className="mt-1.5 space-y-1">
                              {activePartsRequest.items.slice(0, 3).map((item) => (
                                <CompactMaterialItemLine key={item.id} item={item} requestStatus={activePartsRequest.status} />
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
                {(showViewMaterialsPreview || showRequestParts) && (
                  <div className="mt-2 flex flex-wrap gap-2">
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
                so a Manager/Engineer always sees the request context before
                being offered Review/Approve/Request Correction (or any other
                status action). */}
            {(hasStatusAction || assignSuccess || reviewSuccess) && (
              <section className="border-t border-[#E5E7EB] bg-gray-50 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {assignSuccess && !showAssign && !legacyShowAssign && (
                    <div className="flex w-full items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {assignSuccess}
                    </div>
                  )}
                  {/* Maintenance Engineer Dashboard + Review-to-Manager UX Fix
                      Task 4: the required success message, shown inline
                      without navigating away from the quick-view. */}
                  {reviewSuccess && (
                    <div className="flex w-full items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {reviewSuccess}
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
                  {showReviewBtn && (
                    <button
                      type="button"
                      onClick={() => { setReviewPanelMode("review"); setReviewSuccess(null); }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      {/* Maintenance Engineer Dashboard + Review-to-Manager UX
                          Fix Task 7: once already reviewed, relabels so a
                          repeat click never reads as "nothing happened yet". */}
                      {data.reviewed ? "Add Review Note" : "Review Job Card"} <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {showApproveBtn && (
                    <button
                      type="button"
                      onClick={() => setReviewPanelMode("approve")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      {/* Unified Manager Job Card + Materials Approval Flow
                          Fix Task 3 Case A/B: one main button — approving
                          also approves any linked Requested Materials
                          Request(s) in the same action, so the label says so
                          whenever one exists. */}
                      {requestedMaterialsRequests.length > 0 ? "Approve Job Card & Materials" : "Approve Job Card"} <ArrowRight className="h-4 w-4" />
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
                  {showCorrectionBtn && (
                    <button
                      type="button"
                      onClick={() => setReviewPanelMode("correction")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100"
                    >
                      Request Correction <ArrowRight className="h-4 w-4" />
                    </button>
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
                  {(showSubmit || legacyShowSubmit) && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Submit for Review <ArrowRight className="h-4 w-4" />
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
                        Current stage: {materialsRequestStageLine(pr.status)}
                      </p>
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
                    {reviewPanelMode === "review"
                      ? "Review Job Card"
                      : reviewPanelMode === "approve"
                        ? (requestedMaterialsRequests.length > 0 ? "Approve Job Card & Materials" : "Approve Job Card")
                        : reviewPanelMode === "approveMaterials"
                          ? "Approve Materials Request"
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
                  {reviewPanelMode === "review" && showReviewBtn && (
                    <ReviewJobCardForm
                      workOrderId={data.id}
                      reviewed={data.reviewed}
                      onSuccess={handleReviewSuccess}
                    />
                  )}

                  {reviewPanelMode === "approve" && showApproveBtn && (
                    <form action={approveJobCardAndMaterialsAction} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
                      <input type="hidden" name="work_order_id" value={data.id} />
                      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
                        {requestedMaterialsRequests.length > 0 ? "Approve Job Card & Materials" : "Approve Job Card"}
                      </p>
                      {requestedMaterialsRequests.length > 0 && (
                        <p className="text-xs text-[#4B5563]">
                          Also approves {requestedMaterialsRequests.map((pr) => pr.parts_request_number ?? "this Materials Request").join(", ")} — Store can send materials right after.
                        </p>
                      )}
                      <textarea
                        name="comments"
                        placeholder="Approval notes (optional)"
                        className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      />
                      <button type="submit" className="w-full rounded-md bg-[#16A34A] px-3 py-2 text-sm font-bold text-white hover:bg-[#15803d]">
                        {requestedMaterialsRequests.length > 0 ? "Approve Job Card & Materials" : "Approve Job Card"}
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
                        The Job Card is already approved — this only approves the Materials Request so Store can send materials.
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
                    placeholder="Completion note (optional)"
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
