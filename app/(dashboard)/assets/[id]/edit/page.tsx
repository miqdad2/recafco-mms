import { AssetWizard } from "@/components/assets/asset-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("assets.manage");
  const canManageCategories = context.role?.slug === "super_admin";
  const { id } = await params;
  const [rawAsset, categories] = await Promise.all([
    prisma.assets.findUnique({ where: { id } }),
    prisma.asset_categories.findMany({
      where: { is_active: true },
      select: { id: true, name: true, parent_id: true, is_active: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    }),
  ]);
  const asset = rawAsset ? {
    id: rawAsset.id,
    asset_code: rawAsset.asset_code,
    asset_name: rawAsset.asset_name,
    category: rawAsset.category,
    department_id: rawAsset.department_id,
    location: rawAsset.location,
    assigned_operator_driver: rawAsset.assigned_operator_driver,
    brand: rawAsset.brand,
    model: rawAsset.model,
    serial_number: rawAsset.serial_number,
    plate_number: rawAsset.plate_number,
    chassis_number: rawAsset.chassis_number,
    engine_number: rawAsset.engine_number,
    purchase_date: rawAsset.purchase_date?.toISOString() ?? null,
    warranty_expiry_date: rawAsset.warranty_expiry_date?.toISOString() ?? null,
    registration_expiry_date: rawAsset.registration_expiry_date?.toISOString() ?? null,
    insurance_expiry_date: rawAsset.insurance_expiry_date?.toISOString() ?? null,
    current_kilometer_reading: rawAsset.current_kilometer_reading?.toNumber() ?? null,
    current_running_hours: rawAsset.current_running_hours?.toNumber() ?? null,
    status: rawAsset.status,
    next_service_date: rawAsset.next_service_date?.toISOString() ?? null,
    next_service_kilometer: rawAsset.next_service_kilometer?.toNumber() ?? null,
    next_service_running_hours: rawAsset.next_service_running_hours?.toNumber() ?? null,
    notes: rawAsset.notes,
    condition: rawAsset.condition,
    criticality: rawAsset.criticality,
    remarks: rawAsset.remarks,
  } : null;

  return (
    <>
      <PageHeader title="Edit Asset" description="Update asset master fields and next service details." />
      <div className="p-4 lg:p-6">
        <AssetWizard
          asset={asset}
          categories={categories}
          canManageCategories={canManageCategories}
        />
      </div>
    </>
  );
}
