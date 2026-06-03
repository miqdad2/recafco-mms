import { AssetForm } from "@/components/assets/asset-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewAssetPage() {
  await requirePermission("assets.manage");
  const supabase = await createSupabaseServerClient();
  const { data: departments } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name");

  return (
    <>
      <PageHeader title="New Asset" description="Create a full RECAFCO asset, vehicle, equipment, or facility master record." />
      <div className="p-4 lg:p-6">
        <AssetForm departments={departments ?? []} />
      </div>
    </>
  );
}
