"use client";

import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowSuccessModal, type WorkflowSuccessSummaryItem } from "@/components/ui/workflow-success-modal";
import type { QuickViewData } from "@/components/work-orders/repair-order-quick-view";

// Manager Approval Success Popup and Materials Awaiting Receipt Flow Task 2:
// mirrors CorrectionRequestSentModal/JobCardClosedModal's pattern, but reuses
// the same QuickViewData shape every host page (dashboard, Job Cards list,
// Materials Requests list) already fetches for the ?preview= quick-view
// popup — approveJobCardAndMaterialsAction now redirects back to the
// originating list page with both ?success=job-card-opened and the same
// ?preview=<id> it always used, so no separate query is needed here.

// Same local copy used by the quick-view popup itself — a Job Card can only
// ever have one Materials Request in one of these statuses at a time.
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

export type JobCardOpenedModalProps = {
  data: QuickViewData;
  dismissHref: string;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function JobCardOpenedModal({ data, dismissHref }: JobCardOpenedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });

  const activeRequest = data.all_parts_requests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;
  const hasMaterials = activeRequest !== null;
  const issue = data.operator_complaint || data.description_of_work;
  const assetLabel = data.assets ? `${data.assets.asset_code} — ${data.assets.asset_name}` : null;

  const nextStepText = hasMaterials
    ? "Receive materials when they arrive, then close the Job Card after the work is done."
    : "Close the Job Card after the work is done.";

  const summaryItems: WorkflowSuccessSummaryItem[] = [{ label: "Job Card", value: data.work_order_number ?? "—" }];
  if (assetLabel) summaryItems.push({ label: "Asset / Equipment / Vehicle", value: assetLabel });
  if (issue) summaryItems.push({ label: "Issue", value: issue });
  if (activeRequest) {
    summaryItems.push({ label: "Materials Request", value: activeRequest.parts_request_number ?? "—" });
    summaryItems.push({
      label: "Requested materials",
      value: (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {activeRequest.items.map((item) => (
            <li key={item.id}>
              {item.description} <span className="text-xs">· Qty {item.quantity_requested}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  summaryItems.push({ label: "Job Card status", value: <StatusBadge label="Approved" tone="blue" /> });
  if (hasMaterials) {
    summaryItems.push({ label: "Materials status", value: <StatusBadge label="Pending" tone="amber" /> });
  }

  return (
    <WorkflowSuccessModal
      headingId="jc-opened-heading"
      title="Job Card Approved"
      description={
        <>
          Job Card <span className="font-bold text-[#111827]">{data.work_order_number ?? "—"}</span> has been
          approved.
          {hasMaterials && " Requested materials are approved and waiting to be received."}
        </>
      }
      summaryItems={summaryItems}
      nextStepDescription={nextStepText}
      primaryAction={{ kind: "link", label: "Go to Dashboard", href: "/dashboard", onClick: dismiss }}
      secondaryActions={[
        ...(activeRequest
          ? [{ kind: "link" as const, label: "View Materials Request", href: `/store/parts-requests/${activeRequest.id}`, onClick: dismiss }]
          : []),
        { kind: "link", label: "View Job Card", href: `/maintenance/work-orders/${data.id}`, onClick: dismiss },
      ]}
      closeAction={dismiss}
    />
  );
}
