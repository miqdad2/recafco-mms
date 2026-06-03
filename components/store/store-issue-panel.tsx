import { storeIssueAction } from "@/app/actions/phase4";
import { PurchaseRequestForm } from "@/components/purchase/purchase-request-form";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";

export function StoreIssuePanel({ requestId, status, items, context }: { requestId: string; status: string; items: Array<Record<string, unknown>>; context: CurrentUserContext }) {
  const canIssue = context.role?.slug === "super_admin" || context.permissions.includes("store.issue");
  const canPurchase = context.role?.slug === "super_admin" || context.permissions.includes("purchase_requests.manage");
  const hasUnavailable = items.some((item) => item.stock_availability === "Unavailable");
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Store Issue Panel</h2>
      {canIssue && ["Waiting for Store", "Approved", "Partially Issued"].includes(status) ? (
        <form action={storeIssueAction} className="mt-4 space-y-4">
          <input type="hidden" name="parts_request_id" value={requestId} />
          {items.map((item) => (
            <div key={String(item.id)} className="grid gap-3 rounded-md border border-[#E5E7EB] p-3 md:grid-cols-3">
              <p className="font-semibold">{String(item.description)}</p>
              <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2" name={`issued_${String(item.id)}`} type="number" min="0" step="0.01" placeholder="Issued quantity" defaultValue={String(item.issued_quantity ?? 0)} />
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name={`unavailable_${String(item.id)}`} /> Mark unavailable</label>
            </div>
          ))}
          <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="store_issue_comments" placeholder="Store comments" />
          <Button type="submit">Confirm store issue</Button>
        </form>
      ) : <p className="mt-3 text-sm text-[#4B5563]">No store issue action is available for this status.</p>}
      {canPurchase && (hasUnavailable || status === "Waiting for Purchase") ? (
        <div className="mt-4"><PurchaseRequestForm partsRequestId={requestId} /></div>
      ) : null}
    </section>
  );
}
