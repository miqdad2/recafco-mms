"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ClosureReviewModal } from "@/components/dashboard/closure-review-modal";

// Manager Closure Navigation and Detail Approval Flow Unit 10G.28, Task 3/4/5.
//
// Reuses ClosureReviewModal wholesale — the exact same component the Manager
// Dashboard's Closure Requests modal (components/dashboard/closure-requests-modal.tsx)
// and the Critical Workflow popup (components/notifications/critical-workflow-popup.tsx)
// already open, fetching its own worker/materials/attachments/closure-note
// detail on demand (nothing loaded until this button is actually clicked)
// and calling the same approveJobCardClosureModalAction every other entry
// point already uses. This component owns nothing but "is the modal open" —
// no second closure-review implementation, no direct approve action here.
export function ReviewApproveClosureButton({
  workOrderId,
  className,
}: {
  workOrderId: string;
  className: string;
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setReviewing(true)} className={className}>
        Review &amp; Approve Closure
      </button>
      {reviewing ? (
        <ClosureReviewModal
          workOrderId={workOrderId}
          onClose={() => setReviewing(false)}
          onApproved={() => {
            // The "Job Card Closed" success toast is already dispatched
            // inside ClosureReviewModal itself — not duplicated here.
            setReviewing(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
