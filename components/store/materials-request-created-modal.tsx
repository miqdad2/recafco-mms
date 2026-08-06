"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

import { WorkflowSuccessModal, type WorkflowSuccessSummaryItem } from "@/components/ui/workflow-success-modal";

export type MaterialsRequestCreatedModalProps = {
  requestId: string | null;
  requestNumber: string | null;
  jobCardNumber: string | null;
  jobCardPreviewHref: string | null;
  assetName: string | null;
  itemCount: number | null;
  attachmentWarning: boolean;
  // Simplified Workflow UI Consistency Cleanup Task 5: whether the linked
  // Job Card had a pending correction at the moment this Materials Request
  // was created (e.g. added via the correction banner's "Add Materials"
  // shortcut) — changes the "Next" guidance from "open the Job Card" to
  // "resubmit the Job Card".
  jobCardHasPendingCorrection?: boolean;
  dismissHref: string;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function MaterialsRequestCreatedModal({
  requestId,
  requestNumber,
  jobCardNumber,
  jobCardPreviewHref,
  assetName,
  itemCount,
  attachmentWarning,
  jobCardHasPendingCorrection = false,
  dismissHref,
}: MaterialsRequestCreatedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });
  const canViewFull = !!requestId;

  const summaryItems: WorkflowSuccessSummaryItem[] = [];
  if (jobCardNumber) {
    summaryItems.push({
      label: "Linked Job Card",
      value: jobCardPreviewHref ? (
        <Link href={jobCardPreviewHref} className="font-semibold text-[#ED1C24] hover:underline">
          {jobCardNumber}
        </Link>
      ) : (
        jobCardNumber
      ),
    });
  }
  if (assetName) summaryItems.push({ label: "Asset / Equipment", value: assetName });
  if (itemCount !== null) summaryItems.push({ label: "Items requested", value: itemCount });

  return (
    <WorkflowSuccessModal
      headingId="mr-created-heading"
      title="Materials Request Created"
      description={
        <>
          Materials Request <span className="font-bold text-[#111827]">{requestNumber ?? "—"}</span> has been created
          successfully.
        </>
      }
      warnings={attachmentWarning ? ["Materials Request created, but some attachments failed to upload."] : []}
      summaryItems={summaryItems}
      statusLabel={{ label: "Requested", tone: "amber" }}
      nextStepDescription={
        jobCardHasPendingCorrection
          ? "Resubmit the Job Card for Supervisor / Manager review."
          : "Open the linked Job Card. Once the Job Card is Open, received materials can be recorded in Offline Inventory Control."
      }
      primaryAction={{ kind: "link", label: "Go to Materials Requests", href: "/store/parts-requests", onClick: dismiss }}
      secondaryActions={[
        { kind: "link", label: "Create Another", href: "/store/parts-requests/new" },
        ...(canViewFull ? [{ kind: "link" as const, label: "View Request", href: `/store/parts-requests/${requestId}` }] : []),
      ]}
      closeAction={dismiss}
    />
  );
}
