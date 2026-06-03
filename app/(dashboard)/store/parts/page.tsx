import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LowStockBadge } from "@/components/store/stock-badges";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PartsPage() {
  await requirePermission("parts.view");
  const supabase = await createSupabaseServerClient();
  const { data: parts } = await supabase.from("parts").select("*").is("deleted_at", null).order("part_code");

  return (
    <>
      <PageHeader
        title="Spare Parts Inventory"
        description="Store inventory master with stock, low-stock alerts, supplier, bin, part number, and SS rec code."
        actions={
          <Link href="/store/parts/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New part
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Part</th>
                  <th className="px-4 py-3">Part No.</th>
                  <th className="px-4 py-3">SS rec</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Minimum</th>
                  <th className="px-4 py-3">Unit price</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Bin</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {parts?.map((part) => (
                    <tr key={part.id}>
                      <td className="px-4 py-3">
                        <p className="font-bold text-[#111827]">{part.part_code}</p>
                        <p className="text-[#4B5563]">{part.part_name}</p>
                      </td>
                      <td className="px-4 py-3">{part.part_number ?? "-"}</td>
                      <td className="px-4 py-3">{part.ss_rec_code ?? "-"}</td>
                      <td className="px-4 py-3 font-semibold">{part.current_stock} {part.unit_of_measure}</td>
                      <td className="px-4 py-3">{part.minimum_stock}</td>
                      <td className="px-4 py-3">{part.unit_price}</td>
                      <td className="px-4 py-3">{part.supplier ?? "Not recorded"}</td>
                      <td className="px-4 py-3">{part.store_location_bin ?? "-"}</td>
                      <td className="px-4 py-3"><LowStockBadge current={part.current_stock} minimum={part.minimum_stock} /></td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
