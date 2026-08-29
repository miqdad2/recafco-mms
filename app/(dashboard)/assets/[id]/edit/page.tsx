import { SimpleAssetForm } from "@/components/assets/simple-asset-form";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("assets.manage");
  // New Asset Popup and Add Asset Type Unit 10G.38, Task 8: Super Admin and
  // Maintenance Manager may add new asset types; every other role keeps
  // dropdown-selection only.
  const canAddAssetType = context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  const { id } = await params;
  const [rawAsset, assetTypeRows] = await Promise.all([
    prisma.assets.findUnique({ where: { id } }),
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);
  const assetTypes = assetTypeRows.map((r) => r.category);
  const asset = rawAsset ? {
    id: rawAsset.id,
    asset_code: rawAsset.asset_code,
    asset_name: rawAsset.asset_name,
    category: rawAsset.category,
    department_id: rawAsset.department_id,
    location: rawAsset.location,
    assigned_operator_driver: rawAsset.assigned_operator_driver,
    model: rawAsset.model,
    model_year: rawAsset.model_year,
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
      <PageHeader
        title="Edit Asset"
        description="Update this asset's details."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Assets & Equipment", href: "/assets" }, { label: "Edit Asset" }]} />
        }
        actions={<BackLink href={`/assets/${id}`} label="Back to Asset Details" />}
      />
      <div className="p-4 lg:p-6">
        <SimpleAssetForm asset={asset} assetTypes={assetTypes} canAddAssetType={canAddAssetType} />
      </div>
    </>
  );
}
