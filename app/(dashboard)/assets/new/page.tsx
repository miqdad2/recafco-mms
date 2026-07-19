import { AssetWizard } from "@/components/assets/asset-wizard";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function NewAssetPage() {
  const context = await requirePermission("assets.manage");
  const canManageCategories = context.role?.slug === "super_admin";

  const categories = await prisma.asset_categories.findMany({
    where: { is_active: true },
    select: { id: true, name: true, parent_id: true, is_active: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="New Asset"
        description="Add a new asset, vehicle, or equipment record to the RECAFCO register."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Assets & Equipment", href: "/assets" }, { label: "New Asset" }]} />
        }
        actions={<BackLink href="/assets" label="Back to Assets & Equipment" />}
      />
      <div className="p-4 lg:p-6">
        <AssetWizard
          categories={categories}
          canManageCategories={canManageCategories}
        />
      </div>
    </>
  );
}
