"use client";

import { useState } from "react";
import { storeIssueAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";

// Store Send Materials Flow Unit: status gate matches issueMaterials'
// ISSUABLE_MATERIALS_REQUEST_STATUSES. Store sends materials based on the
// approved Materials Request and physically handles availability — no
// system stock/opening/received balance check happens here or on the
// backend (see lib/backend/parts-requests/service.ts issueMaterials).
const SENDABLE_STATUSES = ["Approved", "Waiting Stock", "Partially Issued"];

// Task 4: clearer per-status messaging — never mentions stock/balance, since
// that's no longer a real constraint for this flow.
function unavailableMessage(status: string): string {
  if (status === "Issued") return "All materials for this request have already been sent. No further action is needed.";
  if (status === "Requested") return "Waiting Manager Approval — materials cannot be sent until this request is approved.";
  return "No send action is available for this status.";
}

// Store Send Materials Approval Gate Unit Task 3: the Materials Request can
// say Approved while the linked Job Card itself hasn't been Manager-approved
// yet — Store must not send in that state (matches the backend gate in
// issueMaterials).
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
function SendItemRow({ item, balance }: { item: Item; balance: number | undefined }) {
  const remaining = Math.max(item.quantity_requested - item.issued_quantity, 0);
  const [qtyToSendNow, setQtyToSendNow] = useState(remaining);
  const newTotal = item.issued_quantity + qtyToSendNow;
  // Store Materials Issue Page Simplification Unit Task 2: informational
  // only, never blocking — Store can still send the full remaining quantity
  // regardless of what this note says.
  const showNoBalanceNote = (balance ?? 0) <= 0;

  return (
    <div className="grid gap-3 rounded-md border border-[#E5E7EB] p-3 md:grid-cols-3">
      <div>
        <p className="font-semibold">{item.description}</p>
        <p className="mt-1 text-xs text-[#4B5563]">
          Requested: {item.quantity_requested} · Already sent: {item.issued_quantity} · Remaining: {remaining}
        </p>
        {showNoBalanceNote && (
          <p className="mt-1.5 text-xs text-amber-700">
            No store balance is recorded in this system for this material. This issue will still be recorded for
            Maintenance tracking.
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity to send now</label>
        <input
          className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2"
          type="number"
          min="0"
          max={remaining}
          step="0.01"
          value={qtyToSendNow}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), remaining) : 0;
            setQtyToSendNow(clamped);
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
  items,
  context,
  materialBalances,
}: {
  requestId: string;
  status: string;
  jobCardStatus?: string | null;
  items: Array<{ id: unknown; part_id: unknown; description: unknown; quantity_requested: unknown; issued_quantity: unknown }>;
  context: CurrentUserContext;
  materialBalances?: Record<string, number>;
}) {
  const canSend =
    context.role?.slug === "super_admin" ||
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
      <h2 className="text-lg font-bold">Send Materials to Job Card</h2>
      {jobCardBlocked ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-800">Waiting Manager Approval</p>
          <p className="mt-1 text-sm text-amber-700">
            Store can send materials after the Job Card is approved.
          </p>
        </div>
      ) : canSend && SENDABLE_STATUSES.includes(status) ? (
        <form action={storeIssueAction} className="mt-4 space-y-4">
          <input type="hidden" name="parts_request_id" value={requestId} />
          {parsedItems.map((item) => (
            <SendItemRow key={item.id} item={item} balance={materialBalances?.[item.part_id ?? item.description]} />
          ))}
          <textarea
            className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
            name="store_issue_comments"
            placeholder="Note (optional)"
          />
          <Button type="submit">Send Materials</Button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-[#4B5563]">{unavailableMessage(status)}</p>
      )}
    </section>
  );
}
