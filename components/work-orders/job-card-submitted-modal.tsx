"use client";

import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowSuccessModal, type WorkflowSuccessSummaryItem } from "@/components/ui/workflow-success-modal";

// Draft Submit UX Cleanup Task 3: a leaner, purpose-built data shape instead
// of the full QuickViewData — any QuickViewData object already satisfies
// this structurally (dashboard/Job Cards list/Materials Requests list can
// pass their existing drawerData straight through), and the Job Card detail
// page (which never fetches QuickViewData) can build a small compatible
// literal from its own already-loaded `wo` record.
export type JobCardSubmittedModalData = {
  id: string;
  work_order_number: string | null;
  operator_complaint: string | null;
  description_of_work: string | null;
  assets: { asset_code: string; asset_name: string } | null;
  all_parts_requests: {
    id: string;
    parts_request_number: string | null;
    status: string;
    items: { id: string; description: string; quantity_requested: number }[];
  }[];
};

// Same local copy used by the quick-view popup and JobCardOpenedModal — a
// Job Card can only ever have one Materials Request in one of these
// statuses at a time. A just-submitted Draft's linked request (if any) is
// always "Requested" (nothing downstream of it can exist yet).
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

export type JobCardSubmittedModalProps = {
  data: JobCardSubmittedModalData;
  dismissHref: string;
  // Job Card detail page (Task 5, Option A): already on the full Job Card
  // page, so "View Job Card" would just reload the same URL — hidden there
  // instead of shown as a no-op button.
  hideViewJobCard?: boolean;
};

// Popup and Feedback Design Standardization Unit 8D, Task 3: now a thin
// wrapper around the shared WorkflowSuccessModal shell — same external
// props/call sites as before.
export function JobCardSubmittedModal({ data, dismissHref, hideViewJobCard = false }: JobCardSubmittedModalProps) {
  const router = useRouter();
  const dismiss = () => router.replace(dismissHref, { scroll: false });

  const activeRequest = data.all_parts_requests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;
  const hasMaterials = activeRequest !== null;
  const issue = data.operator_complaint || data.description_of_work;
  const assetLabel = data.assets ? `${data.assets.asset_code} — ${data.assets.asset_name}` : null;

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
  summaryItems.push({ label: "Status", value: <StatusBadge label="Active" tone="blue" /> });
  summaryItems.push({
    label: "Required Materials",
    value: <span className={hasMaterials ? "font-semibold text-[#16A34A]" : "font-semibold text-[#9CA3AF]"}>{hasMaterials ? "Added" : "None"}</span>,
  });

  return (
    <WorkflowSuccessModal
      headingId="jc-submitted-heading"
      title="Job Card Started"
      description={
        <>
          Job Card <span className="font-bold text-[#111827]">{data.work_order_number ?? "—"}</span> is now Active.
          {hasMaterials && " Requested materials were submitted with this Job Card."}
        </>
      }
      summaryItems={summaryItems}
      nextStepDescription={hasMaterials ? "Review materials and issue available stock when ready." : "Open the Job Card to continue."}
      primaryAction={
        hideViewJobCard
          ? { kind: "link", label: "Go to Job Cards", href: "/maintenance/work-orders", onClick: dismiss }
          : { kind: "link", label: "Continue This Job Card", href: `/maintenance/work-orders/${data.id}`, onClick: dismiss }
      }
      secondaryActions={[
        { kind: "link", label: "Create Another Job Card", href: "/maintenance/work-orders/new", onClick: dismiss },
        ...(hideViewJobCard ? [] : [{ kind: "link" as const, label: "Go to Job Cards", href: "/maintenance/work-orders", onClick: dismiss }]),
      ]}
      closeAction={dismiss}
    />
  );
}
