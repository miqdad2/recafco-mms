import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { OpeningStockForm } from "@/components/store/opening-stock-form";
import { requireOfflineInventoryManage } from "@/lib/store/offline-inventory-data";

export default async function AddOpeningStockPage() {
  await requireOfflineInventoryManage();

  return (
    <>
      <PageHeader
        title="Add Opening Stock"
        description="Enter existing maintenance materials before system tracking starts."
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
        <OpeningStockForm />
      </div>
    </>
  );
}
