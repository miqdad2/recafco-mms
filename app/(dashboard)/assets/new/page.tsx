import { SimpleAssetForm } from "@/components/assets/simple-asset-form";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function NewAssetPage() {
  const context = await requirePermission("assets.manage");
  // New Asset Popup and Add Asset Type Unit 10G.38, Task 8: Super Admin and
  // Maintenance Manager may add new asset types; every other role keeps
  // dropdown-selection only.
  const canAddAssetType = context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";

  // Task 11 — "dropdown with existing asset types": the real, currently-used
  // asset types (Car, Pickup, Bus, ...), not the admin category tree.
  const assetTypeRows = await prisma.assets.findMany({
    where: { deleted_at: null },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  const assetTypes = assetTypeRows.map((r) => r.category);

  return (
    <>
      <PageHeader
        title="New Asset"
        description="Add a new asset to the RECAFCO register."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Assets & Equipment", href: "/assets" }, { label: "New Asset" }]} />
        }
        actions={<BackLink href="/assets" label="Back to Assets & Equipment" />}
      />
      <div className="p-4 lg:p-6">
        <SimpleAssetForm assetTypes={assetTypes} canAddAssetType={canAddAssetType} />
      </div>
    </>
  );
}
