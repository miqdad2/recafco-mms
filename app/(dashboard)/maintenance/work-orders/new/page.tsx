import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
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

  const assets = await prisma.assets.findMany({
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
      model_year: true,
    },
    orderBy: { asset_code: "asc" },
  });

  return (
    <>
      <PageHeader
        title="New Job Card"
        description="Capture the job request as structured maintenance data. Reference number is generated on save."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Job Cards", href: "/maintenance/work-orders" }, { label: "New Job Card" }]} />
        }
        actions={<BackLink href="/maintenance/work-orders" label="Back to Job Cards" />}
      />
      <div className="p-4 lg:p-6">
        <WorkOrderWizard
          assets={assets}
          preselectedAssetId={preselectedAssetId}
        />
      </div>
    </>
  );
}
