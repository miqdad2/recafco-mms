import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { OpeningStockImportForm } from "@/components/store/opening-stock-import-form";
import { requireOfflineInventoryManage } from "@/lib/store/offline-inventory-data";

export default async function ImportOpeningStockPage() {
  await requireOfflineInventoryManage();

  return (
    <>
      <PageHeader
        title="Import Opening Stock"
        description="Upload existing maintenance materials from Excel and review before saving."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/store/opening-stock-template"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download Excel Template
            </a>
            <Link
              href="/store/offline-inventory"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to Offline Inventory Control
            </Link>
          </div>
        }
      />
      <div className="p-4 lg:p-6">
        <OpeningStockImportForm />
      </div>
    </>
  );
}
