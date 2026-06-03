import { createPurchaseRequestAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";

export function PurchaseRequestForm({ partsRequestId }: { partsRequestId: string }) {
  return (
    <form action={createPurchaseRequestAction}>
      <input type="hidden" name="parts_request_id" value={partsRequestId} />
      <Button type="submit" variant="secondary">Create purchase request from unavailable items</Button>
    </form>
  );
}
