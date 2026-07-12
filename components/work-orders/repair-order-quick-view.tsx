"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  CheckCircle2,
  ArrowRight,
  Package,
  ExternalLink,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { AssignmentFormModal } from "@/components/work-orders/assignment-form-modal";

// ── Data contract ─────────────────────────────────────────────────────────────

export type QuickViewData = {
  id: string;
  work_order_number: string | null;
  status: string;
  displayStatus: string;
  priority: string;
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
  roleSlug: string;
  canApprove: boolean;
  canAssign: boolean;
  canManage: boolean;
  canCreateParts: boolean;
  closeHref: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DISPLAY_STAGES = [
  "Submitted",
  "Manager Review",
  "Assigned",
  "In Progress",
  "Waiting Materials",
  "Ready to Close",
  "Closed",
] as const;

// ── Pure helpers ──────────────────────────────────────────────────────────────

function getStageIndex(status: string): number {
  const map: Record<string, number> = {
    Draft: 0,
    Submitted: 0,
    "Pending Approval": 1,
    Approved: 2,
    Assigned: 2,
    "In Progress": 3,
    "Parts Issued": 3,
    "Waiting for Parts": 4,
    "Waiting for Purchase": 4,
    "Completed by Technician": 5,
    "Verified by Supervisor": 5,
    "Confirmed by Requester": 5,
    Closed: 6,
    Cancelled: 6,
    Rejected: 0,
    Reopened: 0,
  };
  return map[status] ?? 0;
}

function priorityTone(p: string): "red" | "amber" | "blue" | "gray" {
  if (p === "Urgent") return "red";
  if (p === "High") return "amber";
  if (p === "Normal") return "blue";
  return "gray";
}

function statusTone(s: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (
    [
      "Closed",
      "Verified by Supervisor",
      "Confirmed by Requester",
      "Completed by Technician",
    ].includes(s)
  )
    return "green";
  if (s.includes("Waiting") || ["Submitted", "Pending Approval"].includes(s))
    return "amber";
  if (["Rejected", "Cancelled"].includes(s)) return "red";
  if (["Assigned", "In Progress", "Parts Issued", "Approved"].includes(s))
    return "blue";
  return "gray";
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

type NextAction = { title: string; description: string };

function getNextAction(
  status: string,
  canApprove: boolean,
  canAssign: boolean,
  canManage: boolean
): NextAction {
  switch (status) {
    case "Draft":
      return {
        title: "Draft — not yet submitted.",
        description: canManage
          ? "Complete the repair order details and submit for review."
          : "Awaiting submission.",
      };
    case "Submitted":
    case "Pending Approval":
      return {
        title: "Awaiting manager review.",
        description:
          "The Maintenance Manager will review and assign a technician.",
      };
    case "Approved":
      return {
        title: canAssign
          ? "Assign a technician."
          : "Awaiting technician assignment.",
        description: "Job card is approved. A technician needs to be assigned.",
      };
    case "Assigned":
      return {
        title: "Technician assigned.",
        description: "Waiting for the technician to start work.",
      };
    case "In Progress":
      return {
        title: "Work in progress.",
        description: "Technician is currently working on this repair order.",
      };
    case "Parts Issued":
      return {
        title: "Materials issued — work continuing.",
        description:
          "Materials have been issued from the store. Technician is continuing work.",
      };
    case "Waiting for Parts":
      return {
        title: "Waiting for materials.",
        description:
          "Job card is blocked until requested materials are issued.",
      };
    case "Waiting for Purchase":
      return {
        title: "Waiting for materials.",
        description:
          "Materials are being procured. Work will resume once they arrive.",
      };
    case "Completed by Technician":
      return {
        title:
          canApprove || canAssign
            ? "Ready to close."
            : "Awaiting verification.",
        description:
          "Technician completed work. Waiting for supervisor verification and manager closure.",
      };
    case "Verified by Supervisor":
      return {
        title: canApprove ? "Verified — ready to close." : "Awaiting manager closure.",
        description: "Work has been verified by the supervisor.",
      };
    case "Confirmed by Requester":
      return {
        title: canApprove ? "Confirmed — ready to close." : "Awaiting manager closure.",
        description:
          "Requester has confirmed the repair. Ready for final closure.",
      };
    case "Closed":
      return { title: "Job card closed.", description: "" };
    case "Rejected":
      return {
        title: "Returned for fix.",
        description: canManage
          ? "Please update the repair order and resubmit."
          : "Repair order was returned for corrections.",
      };
    case "Cancelled":
      return { title: "Job card cancelled.", description: "" };
    case "Reopened":
      return { title: "Job card reopened.", description: "Awaiting action." };
    default:
      return { title: status, description: "" };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RepairOrderQuickView({ data }: { data: QuickViewData }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

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
  const stageIndex = getStageIndex(data.status);
  const nextAction = getNextAction(
    data.status,
    data.canApprove,
    data.canAssign,
    data.canManage
  );

  const title = (() => {
    const raw =
      data.operator_complaint || data.description_of_work || "Repair order";
    return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  })();

  // Role-specific action flags
  const isTech = data.roleSlug === "technician";
  const isStore = data.roleSlug === "store_keeper";

  const showAssign =
    (data.canApprove || data.canAssign) &&
    ["Submitted", "Pending Approval", "Approved"].includes(data.status);
  const showSendBack =
    data.canApprove &&
    ["Submitted", "Pending Approval"].includes(data.status);
  const showClose =
    data.canApprove &&
    [
      "Completed by Technician",
      "Verified by Supervisor",
      "Confirmed by Requester",
    ].includes(data.status);
  const showSubmit =
    data.canManage && ["Draft", "Submitted"].includes(data.status);
  const showReturnToDraft = data.canManage && data.status === "Rejected";
  const showStartWork = isTech && data.status === "Assigned";
  const showMarkComplete =
    isTech && ["In Progress", "Parts Issued"].includes(data.status);
  const showViewPRs =
    isStore &&
    ["Waiting for Parts", "Parts Issued", "Waiting for Purchase"].includes(
      data.status
    );

  // Request Parts: hide if Closed, Cancelled, or Rejected (Returned for Fix)
  const showRequestParts =
    data.canCreateParts &&
    !["Cancelled", "Closed", "Rejected"].includes(data.status);

  const hasQuickActions =
    showAssign ||
    showSendBack ||
    showClose ||
    showSubmit ||
    showReturnToDraft ||
    showStartWork ||
    showMarkComplete ||
    showViewPRs ||
    showRequestParts ||
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
          className="relative flex w-full max-w-[880px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh] sm:max-h-[85vh]"
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div className="shrink-0 flex items-start gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p
                id="qv-heading"
                className="text-xs font-black uppercase tracking-wide text-[#ED1C24]"
              >
                {data.work_order_number ?? "Repair Order"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-[#111827]">
                {title}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge
                  label={data.displayStatus}
                  tone={statusTone(data.status)}
                />
                <StatusBadge
                  label={data.priority}
                  tone={priorityTone(data.priority)}
                />
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
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E5E7EB]">

            {/* Status stepper */}
            <section aria-label="Repair order progress" className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-y-2">
                {DISPLAY_STAGES.map((stage, idx) => {
                  const isDone = stageIndex > idx;
                  const isCurrent = stageIndex === idx;
                  return (
                    <div key={stage} className="flex shrink-0 items-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black leading-none ${
                          isCurrent
                            ? "bg-[#ED1C24] text-white"
                            : isDone
                            ? "bg-green-100 text-[#16A34A]"
                            : "bg-gray-100 text-[#9CA3AF]"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                        ) : (
                          <span className="shrink-0">{idx + 1}</span>
                        )}
                        {stage}
                      </span>
                      {idx < DISPLAY_STAGES.length - 1 && (
                        <span
                          className={`mx-1 text-xs font-bold ${
                            isDone ? "text-[#16A34A]" : "text-gray-300"
                          }`}
                          aria-hidden="true"
                        >
                          ›
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Next Action card */}
            <section
              className={`px-5 py-3 ${isTerminal ? "bg-gray-50" : "bg-amber-50"}`}
            >
              <p
                className={`text-xs font-black uppercase tracking-wide ${
                  isTerminal ? "text-[#4B5563]" : "text-amber-800"
                }`}
              >
                {isTerminal ? "Status" : "Next Action"}
              </p>
              <p
                className={`mt-1 text-sm font-bold ${
                  isTerminal ? "text-[#111827]" : "text-amber-900"
                }`}
              >
                {nextAction.title}
              </p>
              {nextAction.description && (
                <p
                  className={`mt-0.5 text-sm ${
                    isTerminal ? "text-[#4B5563]" : "text-amber-800"
                  }`}
                >
                  {nextAction.description}
                </p>
              )}
            </section>

            {/* Key Details grid */}
            <section className="px-5 py-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                Key Details
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data.assets && (
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Asset</p>
                    <p className="text-sm font-semibold text-[#111827]">
                      {data.assets.asset_code} — {data.assets.asset_name}
                    </p>
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
                {data.job_location && (
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Location</p>
                    <p className="text-sm text-[#111827]">{data.job_location}</p>
                  </div>
                )}
                {data.department_name && (
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Department</p>
                    <p className="text-sm text-[#111827]">{data.department_name}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-[#9CA3AF]">Priority</p>
                  <p className="text-sm text-[#111827]">{data.priority}</p>
                </div>
                {data.maintenance_type && (
                  <div>
                    <p className="text-xs text-[#9CA3AF]">Type</p>
                    <p className="text-sm text-[#111827]">{data.maintenance_type}</p>
                  </div>
                )}
              </div>
            </section>

            {/* Asset Profile */}
            {data.assets && (
              <section className="px-5 py-4">
                <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  Asset Profile
                </p>
                <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-3">
                  <p className="font-semibold text-[#111827]">
                    {data.assets.asset_code} — {data.assets.asset_name}
                  </p>
                  {data.assets.location && (
                    <p className="mt-0.5 text-xs text-[#4B5563]">
                      {data.assets.location}
                    </p>
                  )}
                  {(data.assets.condition || data.assets.criticality) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.assets.condition && (
                        <StatusBadge label={data.assets.condition} tone="gray" />
                      )}
                      {data.assets.criticality && (
                        <StatusBadge
                          label={data.assets.criticality}
                          tone={
                            data.assets.criticality === "Critical" ? "red" : "amber"
                          }
                        />
                      )}
                    </div>
                  )}
                  <div className="mt-3">
                    <Link
                      href={`/assets/${data.assets.id}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#ED1C24] hover:underline"
                    >
                      View asset profile <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </section>
            )}

            {/* Materials summary */}
            <section className="px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  Materials
                </p>
                {showRequestParts && (
                  <Link
                    href={`/store/parts-requests/new?repair_order_id=${data.id}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#ED1C24] hover:underline"
                  >
                    Request Materials <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <div className="mt-2">
                {data.parts_requests_count > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 shrink-0 text-[#4B5563]" />
                      <p className="text-sm text-[#111827]">
                        <span className="font-bold">
                          {data.parts_requests_count}
                        </span>{" "}
                        materials request
                        {data.parts_requests_count !== 1 ? "s" : ""}
                        {data.open_parts_requests_count > 0 && (
                          <span className="ml-1.5 font-bold text-amber-700">
                            · {data.open_parts_requests_count} open
                          </span>
                        )}
                      </p>
                    </div>
                    {data.last_parts_request_status && (
                      <p className="ml-6 text-xs text-[#4B5563]">
                        Last request:{" "}
                        <span className="font-semibold">
                          {data.last_parts_request_status}
                        </span>
                      </p>
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
                  <p className="text-sm text-[#9CA3AF]">No materials requested yet.</p>
                )}
              </div>
            </section>

            {/* Inline assign panel — shown above Quick Actions when open */}
            {showAssignPanel && (
              <section className="px-5 py-4">
                <AssignmentFormModal
                  workOrderId={data.id}
                  technicians={data.technicians}
                  onSuccess={handleAssignSuccess}
                  onCancel={() => setShowAssignPanel(false)}
                />
              </section>
            )}

            {/* Quick Actions */}
            {(hasQuickActions || assignSuccess) && (
              <section className="px-5 py-4">
                <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  Quick Actions
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {assignSuccess && !showAssign && (
                    <div className="col-span-full flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {assignSuccess}
                    </div>
                  )}
                  {showAssign && !showAssignPanel && (
                    <button
                      type="button"
                      onClick={() => { setShowAssignPanel(true); setAssignSuccess(null); }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Assign Work <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {showClose && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Close Repair Order <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showStartWork && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Start Work <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showMarkComplete && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#15803d]"
                    >
                      Mark Completed <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showSubmit && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Submit Repair Order <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showReturnToDraft && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Return to Draft <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showSendBack && (
                    <Link
                      href={`/maintenance/work-orders/${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Return for Fix <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showViewPRs && (
                    <Link
                      href={
                        data.work_order_number
                          ? `/store/parts-requests?q=${encodeURIComponent(data.work_order_number)}`
                          : "/store/parts-requests"
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      View Materials Requests <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {showRequestParts && (
                    <Link
                      href={`/store/parts-requests/new?repair_order_id=${data.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Request Materials <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* ── Sticky footer ─────────────────────────────────────────────────── */}
          <div className="shrink-0 flex items-center gap-2 rounded-b-xl border-t border-[#E5E7EB] bg-white px-5 py-3">
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
    </>
  );
}
