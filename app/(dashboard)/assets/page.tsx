import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AssetsPage() {
  await requirePermission("assets.view");
  const supabase = await createSupabaseServerClient();
  const { data: assets } = await supabase
    .from("assets")
    .select("id, asset_code, asset_name, category, status, location, current_kilometer_reading, current_running_hours, next_service_date")
    .is("deleted_at", null)
    .order("asset_code");

  return (
    <>
      <PageHeader
        title="Assets"
        description="Asset, vehicle, equipment, and facility master records with next service tracking."
        actions={
          <Link href="/assets/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New asset
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">KM</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">Next service</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {assets?.map((asset) => (
                  <tr key={asset.id}>
                    <td className="px-4 py-3">
                      <Link href={`/assets/${asset.id}`} className="font-bold text-[#111827] hover:text-[#ED1C24]">
                        {asset.asset_code}
                      </Link>
                      <p className="text-[#4B5563]">{asset.asset_name}</p>
                    </td>
                    <td className="px-4 py-3">{asset.category}</td>
                    <td className="px-4 py-3">{asset.location ?? "Not recorded"}</td>
                    <td className="px-4 py-3">{asset.current_kilometer_reading ?? "-"}</td>
                    <td className="px-4 py-3">{asset.current_running_hours ?? "-"}</td>
                    <td className="px-4 py-3">{asset.next_service_date ?? "Not scheduled"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={asset.status} tone={asset.status === "Breakdown" ? "red" : asset.status === "Under Maintenance" ? "amber" : "green"} />
                    </td>
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
