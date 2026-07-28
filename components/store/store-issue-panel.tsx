"use client";

import { useState } from "react";
import { storeIssueAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";

// Status gate matches issueMaterials' ISSUABLE_MATERIALS_REQUEST_STATUSES.
// No system stock/opening balance check happens here or on the backend
// (see lib/backend/parts-requests/service.ts issueMaterials) — this only
// records what physically arrived.
const SENDABLE_STATUSES = ["Approved", "Waiting Stock", "Partially Issued"];

function unavailableMessage(status: string): string {
  if (status === "Issued") return "All materials for this request have already been received. No further action is needed.";
  if (status === "Requested") return "This Materials Request hasn't been approved yet.";
  return "No receive action is available for this status.";
}

// The Materials Request can say Approved while the linked Job Card itself
// hasn't been approved yet — materials cannot be recorded as received in
// that state (matches the backend gate in issueMaterials).
const JOB_CARD_BLOCKED_STATUSES = ["Created", "Under Review"];

type Item = {
  id: string;
  part_id: string | null;
  description: string;
  quantity_requested: number;
  issued_quantity: number;
};

// Task 4/5: Store enters "Quantity to send now" (a delta, defaulting to the
// full remaining quantity) rather than an absolute running total — the
// hidden field still submits the absolute new total under the same field
// name the backend expects (issued_<itemId>), so issueMaterials' contract
// and its duplicate-send safety are unchanged; only the on-screen UX and
// wording are new.
function SendItemRow({ item }: { item: Item; balance?: number | undefined }) {
  const remaining = Math.max(item.quantity_requested - item.issued_quantity, 0);
  const [qtyReceivedNow, setQtyReceivedNow] = useState(remaining);
  const newTotal = item.issued_quantity + qtyReceivedNow;

  return (
    <div className="grid gap-3 rounded-md border border-[#E5E7EB] p-3 md:grid-cols-3">
      <div>
        <p className="font-semibold">{item.description}</p>
        <p className="mt-1 text-xs text-[#4B5563]">
          Requested: {item.quantity_requested} · Already received: {item.issued_quantity} · Remaining: {remaining}
        </p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity received now</label>
        <input
          className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2"
          type="number"
          min="0"
          max={remaining}
          step="0.01"
          value={qtyReceivedNow}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), remaining) : 0;
            setQtyReceivedNow(clamped);
          }}
        />
        <input type="hidden" name={`issued_${item.id}`} value={newTotal} />
      </div>
    </div>
  );
}

export function StoreIssuePanel({
  requestId,
  status,
  jobCardStatus,
  jobCardHasPendingCorrection = false,
  items,
  context,
}: {
  requestId: string;
  status: string;
  jobCardStatus?: string | null;
  jobCardHasPendingCorrection?: boolean;
  items: Array<{ id: unknown; part_id: unknown; description: unknown; quantity_requested: unknown; issued_quantity: unknown }>;
  context: CurrentUserContext;
}) {
  // Mirrors canReceiveIssueMaterials() (lib/parts-requests/visibility.ts) —
  // duplicated inline since that helper is server-only and this is a client
  // component receiving a plain CurrentUserContext data prop.
  const canSend =
    context.role?.slug === "super_admin" ||
    context.role?.slug === "maintenance_data_entry" ||
    context.role?.slug === "maintenance_manager" ||
    context.permissions.includes("parts_requests.issue") ||
    context.permissions.includes("store.issue");

  const jobCardBlocked = Boolean(jobCardStatus && JOB_CARD_BLOCKED_STATUSES.includes(jobCardStatus));

  const parsedItems: Item[] = items.map((item) => ({
    id: String(item.id),
    part_id: item.part_id ? String(item.part_id) : null,
    description: String(item.description),
    quantity_requested: Number(item.quantity_requested ?? 0),
    issued_quantity: Number(item.issued_quantity ?? 0),
  }));

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Receive Materials</h2>
      {jobCardBlocked ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-800">
            {jobCardStatus === "Created"
              ? "Waiting for Job Card to be opened"
              : jobCardHasPendingCorrection
                ? "Waiting on Data Entry correction"
                : "Waiting Supervisor / Manager review"}
          </p>
          <p className="mt-1 text-sm text-amber-700">
            {jobCardStatus === "Created"
              ? "Materials can be received once the Job Card is submitted and opened."
              : jobCardHasPendingCorrection
                ? "The Job Card was sent back to Data Entry for a correction. Materials can be received once it's resubmitted and opened."
                : "Materials can be received once the Job Card is reviewed and opened."}
          </p>
        </div>
      ) : canSend && SENDABLE_STATUSES.includes(status) ? (
        <form action={storeIssueAction} className="mt-4 space-y-4">
          <input type="hidden" name="parts_request_id" value={requestId} />
          {parsedItems.map((item) => (
            <SendItemRow key={item.id} item={item} />
          ))}
          <textarea
            className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
            name="store_issue_comments"
            placeholder="Note (optional)"
          />
          <Button type="submit">Receive Materials</Button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-[#4B5563]">{unavailableMessage(status)}</p>
      )}
    </section>
  );
}
