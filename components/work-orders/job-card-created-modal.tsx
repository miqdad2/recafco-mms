"use client";

import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowSuccessModal, type WorkflowSuccessSummaryItem, type WorkflowSuccessAction } from "@/components/ui/workflow-success-modal";
import { submitWorkOrderAction } from "@/app/actions/workflow";

export type JobCardCreatedModalProps = {
  jobCardId: string | null;
  jobCardNumber: string | null;
  isDraft: boolean;
  assetName: string | null;
  issue: string | null;
  attachmentWarning: boolean;
  materialsRequestWarning?: boolean;
  // Optional Work Assignment During Job Card Creation Unit 7C.
  assignmentWarning?: boolean;
  // Simplify Assignment Picker and Started Modal Unit 7D, Task 9/11 — cheap
  // booleans read off the same query the quick-view preview already runs
  // (no new query), used only to pick the Next Recommended Step text and the
  // status checklist. Undefined (e.g. a Draft, which has neither yet) is
  // treated the same as false.
  hasAssignment?: boolean;
  hasRequiredMaterials?: boolean;
  dismissHref: string;
};

// Approval Workflow Unit 4 — Closure Approval Only: mirrors the current
// plain, user-facing statuses (lib/work-orders/simplified-status.ts) —
// Draft → Active → Closure Requested → Closed. No Manager approval before
// starting a Job Card any more, so "Submitted"/"Approved" are no longer
// separate stages here. "Correction Requested" isn't part of this bar since
// a just-created Job Card can't have a pending correction yet.
const WORKFLOW_STAGES = ["Draft", "Active", "Closure Requested", "Closed"] as const;

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function JobCardCreatedModal({
  jobCardId,
  jobCardNumber,
  isDraft,
  assetName,
  issue,
  attachmentWarning,
  materialsRequestWarning = false,
  assignmentWarning = false,
  hasAssignment = false,
  hasRequiredMaterials = false,
  dismissHref,
}: JobCardCreatedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });
  const canViewFull = !!jobCardId;

  // Save Draft Success Popup Submit Option Cleanup Task 2/3/6: this same
  // modal renders for both outcomes of the create wizard — saved as Draft
  // (isDraft, driven by the just-created record's real status === "Created")
  // or started directly (status === "Approved", displayed as "Active") —
  // never confused, since isDraft is derived from the actual DB status, not
  // from user intent guessed some other way.
  const modalTitle = isDraft ? "Job Card Draft Saved" : "Job Card Started Successfully";
  const modalMessage = isDraft ? "has been saved as draft." : "is now Active.";

  // Simplify Assignment Picker and Started Modal Unit 7D, Task 9/12: direct,
  // case-based guidance instead of the old one-size-fits-all "Assign work,
  // update details, or request closure once work is done." Uses only data
  // already available from the creation result (no heavy new queries) —
  // real material-shortage detection would need a fresh per-item query this
  // unit deliberately doesn't add, so that case falls back to the materials
  // case below it, which is still accurate and still actionable.
  const nextStepText = isDraft
    ? "Start this Job Card when you're ready to begin work."
    : !canViewFull
      ? "Open the Job Card to continue."
      : !hasAssignment
        ? "Assign workers to this Job Card."
        : hasRequiredMaterials
          ? "Review materials and issue available stock when ready."
          : "Open the Job Card to track work time and updates.";

  const warnings: string[] = [];
  if (attachmentWarning) warnings.push("Job Card created, but some attachments failed to upload.");
  if (materialsRequestWarning) {
    warnings.push('Job Card created, but the Materials Request could not be created automatically. Use "Request Materials" from the Job Card to add it.');
  }
  if (assignmentWarning) {
    warnings.push("Job Card created, but the assignment could not be saved automatically. Assign work from the Job Card instead.");
  }

  const summaryItems: WorkflowSuccessSummaryItem[] = [];
  if (assetName) summaryItems.push({ label: "Asset", value: assetName });
  if (issue) summaryItems.push({ label: "Issue", value: issue });
  summaryItems.push({ label: "Status", value: <StatusBadge label={isDraft ? "Draft" : "Active"} tone={isDraft ? "gray" : "blue"} /> });
  summaryItems.push({
    label: "Assignment",
    value: <span className={hasAssignment ? "font-semibold text-[#16A34A]" : "font-semibold text-[#9CA3AF]"}>{hasAssignment ? "Assigned" : "Not assigned"}</span>,
  });
  summaryItems.push({
    label: "Required Materials",
    value: <span className={hasRequiredMaterials ? "font-semibold text-[#16A34A]" : "font-semibold text-[#9CA3AF]"}>{hasRequiredMaterials ? "Added" : "None"}</span>,
  });
  summaryItems.push({
    label: "Work Time Tracking",
    value: (
      <span className={hasAssignment ? "font-semibold text-[#16A34A]" : "font-semibold text-[#9CA3AF]"}>
        {hasAssignment ? "Available now" : "Available after assignment"}
      </span>
    ),
  });

  const nextStepDescription = !isDraft ? (
    <>
      {nextStepText}
      <span className="mt-1 block text-xs font-normal text-[#6B7280]">
        {hasAssignment ? "Workers are assigned. You can track work time from the Job Card." : "Assignment can be added now from the Job Card."}
      </span>
    </>
  ) : (
    nextStepText
  );

  const primaryAction: WorkflowSuccessAction | undefined =
    isDraft && canViewFull
      ? {
          kind: "form",
          label: "Start Job Card",
          action: submitWorkOrderAction,
          hiddenFields: { work_order_id: jobCardId!, return_to: dismissHref, return_to_param: "preview" },
        }
      : canViewFull
        ? { kind: "link", label: "Continue This Job Card", href: `/maintenance/work-orders/${jobCardId}`, onClick: dismiss }
        : undefined;

  return (
    <WorkflowSuccessModal
      headingId="jc-created-heading"
      title={modalTitle}
      description={
        <>
          Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> {modalMessage}
        </>
      }
      warnings={warnings}
      summaryItems={summaryItems}
      nextStepDescription={nextStepDescription}
      progressSteps={{ steps: WORKFLOW_STAGES, currentIndex: isDraft ? 0 : 1 }}
      primaryAction={primaryAction}
      secondaryActions={[
        { kind: "link", label: "Create Another Job Card", href: "/maintenance/work-orders/new", onClick: dismiss },
        { kind: "link", label: "Go to Job Cards", href: "/maintenance/work-orders", onClick: dismiss },
      ]}
      closeAction={dismiss}
    />
  );
}
