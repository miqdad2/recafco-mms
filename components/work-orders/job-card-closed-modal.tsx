"use client";

import { useRouter } from "next/navigation";

import { WorkflowSuccessModal } from "@/components/ui/workflow-success-modal";

export type JobCardClosedModalProps = {
  jobCardId: string;
  jobCardNumber: string | null;
  dismissHref: string;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before, only the internal markup was de-duplicated.
export function JobCardClosedModal({ jobCardId, jobCardNumber, dismissHref }: JobCardClosedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });

  return (
    <WorkflowSuccessModal
      headingId="jc-closed-heading"
      title="Job Card Closed"
      description={
        <>
          Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> has been closed
          successfully.
        </>
      }
      primaryAction={{ kind: "link", label: "Go to Dashboard", href: "/dashboard", onClick: dismiss }}
      secondaryActions={[{ kind: "link", label: "View Job Card", href: `/maintenance/work-orders/${jobCardId}`, onClick: dismiss }]}
      closeAction={dismiss}
    />
  );
}
