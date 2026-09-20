import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { AddNewMaterialForm } from "@/components/store/add-new-material-form";
import { requireOfflineInventoryManage } from "@/lib/store/offline-inventory-data";
import { canViewCosts } from "@/lib/security/permissions";

export default async function AddNewMaterialPage() {
  const context = await requireOfflineInventoryManage();

  return (
    <>
      <PageHeader
        title="Add New Material"
        description="Register a new material in Offline Inventory Control."
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
        <AddNewMaterialForm canViewCosts={canViewCosts(context)} />
      </div>
    </>
  );
}
