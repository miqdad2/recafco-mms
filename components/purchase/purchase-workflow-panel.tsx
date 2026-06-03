import { receivePurchaseAction, updatePurchaseRequestAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";

export function PurchaseWorkflowPanel({ purchase, context }: { purchase: Record<string, unknown>; context: CurrentUserContext }) {
  const canManage = context.role?.slug === "super_admin" || context.permissions.includes("purchase_requests.manage");
  if (!canManage) return null;
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Purchase Workflow</h2>
      <form action={updatePurchaseRequestAction} className="mt-4 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="purchase_request_id" value={String(purchase.id)} />
        <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2" name="supplier" defaultValue={String(purchase.supplier ?? "")} placeholder="Supplier" />
        <select className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2" name="status" defaultValue={String(purchase.status)}>
          {["Submitted","Pending Purchase","Pending Finance Approval","Pending CEO Approval","Approved","Ordered","Received","Rejected","Cancelled"].map((status) => <option key={status}>{status}</option>)}
        </select>
        <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2" name="quotation_file_name" defaultValue={String(purchase.quotation_file_name ?? "")} placeholder="Quotation file name" />
        <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2" name="quotation_file_path" defaultValue={String(purchase.quotation_file_path ?? "")} placeholder="Private quotation path" />
        <textarea className="focus-ring min-h-20 rounded-md border border-[#E5E7EB] px-3 py-2 md:col-span-2" name="purchase_officer_notes" defaultValue={String(purchase.purchase_officer_notes ?? "")} placeholder="Purchase notes" />
        <Button type="submit">Save purchase update</Button>
      </form>
      {String(purchase.status) === "Ordered" || String(purchase.status) === "Approved" ? (
        <form action={receivePurchaseAction} className="mt-4">
          <input type="hidden" name="purchase_request_id" value={String(purchase.id)} />
          <Button type="submit" variant="secondary">Mark received and update stock</Button>
        </form>
      ) : null}
    </section>
  );
}
