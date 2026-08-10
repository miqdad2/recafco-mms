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
  // or created directly (status === "Approved", displayed as "Active") —
  // never confused, since isDraft is derived from the actual DB status, not
  // from user intent guessed some other way.
  //
  // New Job Card Button Wording and Success Popup Clarity Unit 10F.2, Task
  // 3/6: "Job Card Started Successfully" read as if a worker timer had
  // started — it only creates/activates the Job Card. Worker time only ever
  // starts from Daily Activity/Work Time Tracking, so this title (and every
  // other string in this modal) avoids "Start"/"Started" for that reason.
  const modalTitle = isDraft ? "Job Card Draft Saved" : "Job Card Created Successfully";
  const modalMessage = isDraft ? "has been saved as draft." : "is now Active.";

  // Unit 10F.2, Task 4: for the just-created (Active) case, the correct next
  // step is Daily Activity — that's where materials are issued/received and
  // worker time is started/paused/stopped, not this popup or the Job Card
  // page itself. `activeSubStep` keeps the same materials-before-assignment
  // priority the previous ladder used, just phrased around Daily Activity.
  const nextStepText = isDraft
    ? "Activate this Job Card when you're ready to begin work."
    : !canViewFull
      ? "Open the Job Card to continue."
      : "Open Daily Activity to issue materials, track worker time, and monitor this Job Card.";

  const activeSubStep = hasRequiredMaterials
    ? "Review materials in Daily Activity, then issue available stock or receive missing materials."
    : hasAssignment
      ? "Track worker time from Daily Activity."
      : "Assign workers from the Job Card or Daily Activity.";

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
    canViewFull ? (
      <>
        {nextStepText}
        <span className="mt-1 block text-xs font-normal text-[#6B7280]">{activeSubStep}</span>
      </>
    ) : (
      nextStepText
    )
  ) : (
    nextStepText
  );

  // Unit 10F.2, Task 1/6: renamed from "Start Job Card" — this form still
  // calls the exact same submitWorkOrderAction with the exact same hidden
  // fields, only the label changed, since this literally just moves the
  // record Draft -> Active (never starts a worker timer either).
  const primaryAction: WorkflowSuccessAction | undefined =
    isDraft && canViewFull
      ? {
          kind: "form",
          label: "Activate Job Card",
          action: submitWorkOrderAction,
          hiddenFields: { work_order_id: jobCardId!, return_to: dismissHref, return_to_param: "preview" },
        }
      : canViewFull
        ? {
            // Task 5: primary next step after creation is Daily Activity, not
            // the Job Card page — `q` reuses Daily Activity's existing
            // free-text search (matches on work_order_number) to land the
            // user already filtered to this one Job Card when the number is
            // known; no new query support was added for this.
            kind: "link",
            label: "Open in Daily Activity",
            href: jobCardNumber ? `/maintenance/daily-activity?q=${encodeURIComponent(jobCardNumber)}` : "/maintenance/daily-activity",
            onClick: dismiss,
          }
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
      secondaryActions={
        // Task 5: for the just-created (Active) case, "View Job Card
        // Details" replaces "Continue This Job Card" as a secondary button
        // alongside "Create Another Job Card"; "Go to Job Cards" moves to
        // the shared small/neutral trailing slot below (`closeLabel`) since
        // `dismissHref` already points at the Job Cards list either way —
        // same destination, no behavior change. Draft keeps its previous
        // two secondary buttons unchanged (Task 7).
        isDraft
          ? [
              { kind: "link", label: "Create Another Job Card", href: "/maintenance/work-orders/new", onClick: dismiss },
              { kind: "link", label: "Go to Job Cards", href: "/maintenance/work-orders", onClick: dismiss },
            ]
          : [
              ...(canViewFull
                ? [{ kind: "link" as const, label: "View Job Card Details", href: `/maintenance/work-orders/${jobCardId}`, onClick: dismiss }]
                : []),
              { kind: "link", label: "Create Another Job Card", href: "/maintenance/work-orders/new", onClick: dismiss },
            ]
      }
      closeLabel={isDraft ? undefined : "Go to Job Cards"}
      closeAction={dismiss}
    />
  );
}
