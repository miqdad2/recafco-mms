import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { ArchivedMaterialsTable } from "@/components/store/archived-materials-table";
import { requireUser } from "@/lib/auth/context";
import { getArchivedMaterials, isInventorySuperAdmin } from "@/lib/backend/store/material-master";

// Archived materials (zero balance, history kept) — System Administrator
// only. Restoring puts the material back into Inventory Control and new
// material selections with its original identity, Item Code and history.
export default async function ArchivedMaterialsPage() {
  const context = await requireUser();
  if (!isInventorySuperAdmin(context)) redirect("/store/offline-inventory?error=permission-denied");

  const rows = await getArchivedMaterials();

  return (
    <>
      <PageHeader
        title="Archived Materials"
        description="Materials removed from Inventory Control that still have history or references. Movements are kept."
        actions={
          <Link
            href="/store/offline-inventory"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Inventory Control
          </Link>
        }
      />
      <div className="p-3 lg:p-4">
        <ArchivedMaterialsTable
          rows={rows.map((r) => ({
            key: r.key,
            display_name: r.display_name,
            item_code: r.item_code,
            unit: r.unit,
            category: r.category,
            total_received: r.total_received,
            total_issued: r.total_issued,
            last_movement_date: r.last_movement_date,
            archived_at: r.archived_at,
            archived_by_name: r.archived_by_name,
            archive_reason: r.archive_reason,
          }))}
        />
      </div>
    </>
  );
}
