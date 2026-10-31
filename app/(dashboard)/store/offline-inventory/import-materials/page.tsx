import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { MaterialMasterImportForm } from "@/components/store/material-master-import-form";
import { requireUser } from "@/lib/auth/context";
import { getRecentMaterialImportBatches, isInventorySuperAdmin } from "@/lib/backend/store/material-master";
import { fmtDate } from "@/components/store/offline-inventory-types";

// Material Master import (Item Code / Description / Unit, zero stock) —
// System Administrator only. Separate from Import Opening Stock, which
// brings in quantities.
export default async function ImportMaterialsPage() {
  const context = await requireUser();
  if (!isInventorySuperAdmin(context)) redirect("/store/offline-inventory?error=permission-denied");

  const batches = await getRecentMaterialImportBatches(10);

  return (
    <>
      <PageHeader
        title="Import Materials from Excel"
        description="Register the Maintenance Department material master (Item Code, description, unit) with zero stock."
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
      <div className="space-y-4 p-3 lg:p-4">
        <MaterialMasterImportForm />

        <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <h2 className="border-b border-[#E5E7EB] px-4 py-3 text-sm font-black text-[#111827]">Import history</h2>
          {batches.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[#6B7280]">No material master imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#F3F4F6] text-left text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">
                  <tr>
                    <th className="px-2.5 py-2">Date</th>
                    <th className="px-2.5 py-2">Batch</th>
                    <th className="px-2.5 py-2">File / Sheet</th>
                    <th className="px-2.5 py-2 text-right">Rows</th>
                    <th className="px-2.5 py-2 text-right">Imported</th>
                    <th className="px-2.5 py-2 text-right">Existing</th>
                    <th className="px-2.5 py-2 text-right">Duplicates</th>
                    <th className="px-2.5 py-2 text-right">Invalid</th>
                    <th className="px-2.5 py-2 text-right">Rejected Units</th>
                    <th className="px-2.5 py-2">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-xs">{fmtDate(b.created_at)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-xs">{b.batch_reference}</td>
                      <td className="min-w-[160px] px-2.5 py-1.5 text-xs">{b.file_name} / {b.sheet_name}</td>
                      <td className="px-2.5 py-1.5 text-right">{b.total_rows}</td>
                      <td className="px-2.5 py-1.5 text-right font-bold">{b.imported_count}</td>
                      <td className="px-2.5 py-1.5 text-right">{b.existing_count}</td>
                      <td className="px-2.5 py-1.5 text-right">{b.duplicate_count}</td>
                      <td className="px-2.5 py-1.5 text-right">{b.invalid_count}</td>
                      <td className="px-2.5 py-1.5 text-right">{b.unsupported_unit_count}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-xs">{b.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
