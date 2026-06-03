import { ceoDecisionAction, financeDecisionAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";

function DecisionForm({ id, action, title }: { id: string; action: (formData: FormData) => void; title: string }) {
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="purchase_request_id" value={id} />
      <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder={`${title} comments`} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="submit" name="decision" value="Approved">Approve</Button>
        <Button type="submit" name="decision" value="Rejected" variant="danger">Reject</Button>
      </div>
    </form>
  );
}

export function FinanceApprovalPanel({ purchase, context }: { purchase: Record<string, unknown>; context: CurrentUserContext }) {
  const canFinance = context.role?.slug === "super_admin" || context.permissions.includes("finance.approve");
  if (!canFinance || purchase.status !== "Pending Finance Approval") return null;
  return <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">Finance Approval</h2><DecisionForm id={String(purchase.id)} action={financeDecisionAction} title="Finance" /></section>;
}

export function CEOApprovalPanel({ purchase, context }: { purchase: Record<string, unknown>; context: CurrentUserContext }) {
  const canCEO = context.role?.slug === "super_admin" || context.permissions.includes("ceo.approve");
  if (!canCEO || purchase.status !== "Pending CEO Approval") return null;
  return <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">CEO Approval</h2><DecisionForm id={String(purchase.id)} action={ceoDecisionAction} title="CEO" /></section>;
}
