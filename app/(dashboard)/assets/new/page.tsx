import { AssetForm } from "@/components/assets/asset-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function NewAssetPage() {
  await requirePermission("assets.manage");
  const departments = await prisma.departments.findMany({
    where: { is_active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });

  return (
    <>
      <PageHeader title="New Asset" description="Create a full RECAFCO asset, vehicle, equipment, or facility master record." />
      <div className="p-4 lg:p-6">
        <AssetForm departments={departments ?? []} />
      </div>
    </>
  );
}
