"use client";

import { useRouter } from "next/navigation";

import { WorkflowSuccessModal } from "@/components/ui/workflow-success-modal";

export type CorrectionRequestSentModalProps = {
  jobCardId: string;
  jobCardNumber: string | null;
  question: string | null;
  // Whether this was sent via "Request Correction" or "Ask to Add/Update
  // Materials" — same underlying mechanism, just different framing (Task 5-
  // style wording split, mirrored from the Materials Request created modal).
  kind: "correction" | "materials";
  dismissHref: string;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function CorrectionRequestSentModal({ jobCardId, jobCardNumber, question, kind, dismissHref }: CorrectionRequestSentModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });

  const isMaterials = kind === "materials";
  const heading = isMaterials ? "Materials Request Sent to Data Entry" : "Correction Request Sent";
  const introText = isMaterials
    ? "has been sent back to Data Entry to add or update materials."
    : "has been returned to Data Entry for correction.";
  const questionLabel = isMaterials ? "Requested materials" : "Requested correction";

  return (
    <WorkflowSuccessModal
      headingId="crs-heading"
      title={heading}
      description={
        <>
          Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> {introText}
        </>
      }
      summaryItems={question ? [{ label: questionLabel, value: question }] : []}
      statusLabel={{ label: "Needs Update", tone: "amber" }}
      nextStepDescription="Data Entry will update the Job Card and resubmit it for Supervisor / Manager review."
      primaryAction={{ kind: "link", label: "Go to Dashboard", href: "/dashboard", onClick: dismiss }}
      secondaryActions={[{ kind: "link", label: "View Job Card", href: `/maintenance/work-orders/${jobCardId}`, onClick: dismiss }]}
      closeAction={dismiss}
    />
  );
}
