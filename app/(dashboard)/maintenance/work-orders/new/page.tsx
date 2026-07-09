import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; asset_id?: string }>;
}) {
  await requirePermission("work_orders.manage");
  const sp = (await searchParams) ?? {};
  const preselectedAssetId = sp.asset_id ?? null;

  const [assets, supervisors] = await Promise.all([
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        asset_code: true,
        asset_name: true,
        category: true,
        serial_number: true,
        plate_number: true,
        location: true,
        status: true,
        brand: true,
        model: true,
      },
      orderBy: { asset_code: "asc" },
    }),
    prisma.profiles.findMany({
      where: { is_active: true },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="New Repair Order"
        description="Capture the repair request as structured maintenance data. Reference number is generated on save."
      />
      <div className="p-4 lg:p-6">
        <WorkOrderWizard
          assets={assets}
          supervisors={supervisors.map((p) => ({ id: p.id, name: p.full_name }))}
          preselectedAssetId={preselectedAssetId}
        />
      </div>
    </>
  );
}
