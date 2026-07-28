import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { IssueMaterialForm } from "@/components/store/issue-material-form";
import {
  getOfflineInventoryBalance,
  getWorkOrderOptions,
  requireOfflineInventoryManage,
} from "@/lib/store/offline-inventory-data";

export default async function IssueMaterialPage() {
  await requireOfflineInventoryManage();

  const [{ balanceItems }, workOrders] = await Promise.all([
    getOfflineInventoryBalance(),
    getWorkOrderOptions(),
  ]);
  const availableItems = balanceItems.filter((b) => b.balance > 0);

  return (
    <>
      <PageHeader
        title="Record Used Material"
        description="Record materials used for a Job Card or maintenance work."
        actions={
          <Link
            href="/store/offline-inventory"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Offline Inventory Control
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <IssueMaterialForm availableItems={availableItems} workOrders={workOrders} />
      </div>
    </>
  );
}
