"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

import { WorkflowSuccessModal, type WorkflowSuccessSummaryItem } from "@/components/ui/workflow-success-modal";

export type MaterialsReceivedModalProps = {
  requestNumber: string | null;
  jobCardNumber: string | null;
  jobCardPreviewHref: string | null;
  assetName: string | null;
  itemsReceivedCount: number | null;
  attachmentWarning: boolean;
  issueHref: string | null;
  dismissHref: string;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function MaterialsReceivedModal({
  requestNumber,
  jobCardNumber,
  jobCardPreviewHref,
  assetName,
  itemsReceivedCount,
  attachmentWarning,
  issueHref,
  dismissHref,
}: MaterialsReceivedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });

  const summaryItems: WorkflowSuccessSummaryItem[] = [
    { label: "Materials Request", value: requestNumber ?? "—" },
    {
      label: "Linked Job Card",
      value: jobCardNumber ? (
        jobCardPreviewHref ? (
          <Link href={jobCardPreviewHref} className="font-semibold text-[#ED1C24] hover:underline">
            {jobCardNumber}
          </Link>
        ) : (
          jobCardNumber
        )
      ) : (
        "—"
      ),
    },
  ];
  if (assetName) summaryItems.push({ label: "Asset / Equipment", value: assetName });
  summaryItems.push({ label: "Items Received", value: itemsReceivedCount ?? "—" });

  return (
    <WorkflowSuccessModal
      headingId="mr-received-heading"
      title="Materials Received"
      description={
        <>
          Materials Request <span className="font-bold text-[#111827]">{requestNumber ?? "—"}</span> has been received
          successfully.
        </>
      }
      warnings={attachmentWarning ? ["Materials were received, but some attachments failed to upload."] : []}
      summaryItems={summaryItems}
      statusLabel={{ label: "Received", tone: "blue" }}
      nextStepDescription="The received material has been added to Offline Inventory Control. You can now issue this material to the linked Job Card when needed."
      primaryAction={{ kind: "link", label: "Issue Now", href: issueHref ?? "/store/parts-requests" }}
      secondaryActions={[
        { kind: "link", label: "Go to Materials Requests", href: "/store/parts-requests", onClick: dismiss },
        { kind: "link", label: "View Offline Inventory", href: "/store/offline-inventory" },
      ]}
      closeAction={dismiss}
    />
  );
}
