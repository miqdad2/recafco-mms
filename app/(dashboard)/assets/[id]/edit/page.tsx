import { AssetForm } from "@/components/assets/asset-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("assets.manage");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: asset }, { data: departments }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).single(),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name")
  ]);

  return (
    <>
      <PageHeader title="Edit Asset" description="Update asset master fields and next service details." />
      <div className="p-4 lg:p-6">
        <AssetForm asset={asset} departments={departments ?? []} />
      </div>
    </>
  );
}
