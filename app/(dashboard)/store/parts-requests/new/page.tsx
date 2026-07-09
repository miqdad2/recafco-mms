import { PartsRequestWizard } from "@/components/store/parts-request-wizard";
import type { WorkOrderOption } from "@/components/store/parts-request-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

export default async function NewPartsRequestPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireUser();
  const canCreate =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage");

  if (!canCreate) {
    return (
      <>
        <PageHeader
          title="New Parts Request"
          description="You do not have permission to create parts requests."
        />
        <div className="p-4 lg:p-6" />
      </>
    );
  }

  const sp = (await searchParams) ?? {};
  // repair_order_id in the URL maps to the work_orders.id (same entity)
  const preselectedId = sp.repair_order_id?.trim() ?? "";

  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  const woSelect = {
    id: true,
    work_order_number: true,
    ordered_by: true,
    worker_type: true,
    maintenance_type: true,
    operator_complaint: true,
    created_at: true,
    assets: {
      select: {
        asset_code: true,
        asset_name: true,
        location: true,
        category: true,
        status: true,
      },
    },
  } as const;

  function mapWo(w: {
    id: string;
    work_order_number: string | null;
    ordered_by: string | null;
    worker_type: string | null;
    maintenance_type: string | null;
    operator_complaint: string | null;
    created_at: Date;
    assets: {
      asset_code: string;
      asset_name: string;
      location: string | null;
      category: string | null;
      status: string;
    } | null;
  }): WorkOrderOption {
    return {
      id: w.id,
      work_order_number: w.work_order_number,
      ordered_by: w.ordered_by,
      worker_type: w.worker_type,
      maintenance_type: w.maintenance_type,
      operator_complaint: w.operator_complaint,
      created_at: w.created_at.toISOString(),
      assets: w.assets
        ? {
            asset_code: w.assets.asset_code,
            asset_name: w.assets.asset_name,
            location: w.assets.location,
            category: w.assets.category,
            status: w.assets.status,
          }
        : null,
    };
  }

  // When pre-selected, fetch that specific WO in addition to the full list
  const [rawWorkOrders, rawPreselected] = await Promise.all([
    prisma.work_orders.findMany({
      where: { AND: [{ deleted_at: null }, visibilityFilter] },
      select: woSelect,
      orderBy: { created_at: "desc" },
      take: 100,
    }),
    preselectedId
      ? prisma.work_orders.findFirst({
          where: { id: preselectedId, deleted_at: null, ...visibilityFilter },
          select: woSelect,
        })
      : Promise.resolve(null),
  ]);

  const workOrders: WorkOrderOption[] = rawWorkOrders.map(mapWo);
  const preselectedWorkOrder: WorkOrderOption | null = rawPreselected
    ? mapWo(rawPreselected)
    : null;

  const pageDescription = preselectedWorkOrder
    ? `Requesting parts for repair order ${preselectedWorkOrder.work_order_number ?? "Draft"}.`
    : "Request spare parts or materials linked to a repair order. Reference number is generated on save.";

  return (
    <>
      <PageHeader title="Parts Request" description={pageDescription} />
      <div className="p-4 lg:p-6">
        <PartsRequestWizard
          workOrders={workOrders}
          preselectedWorkOrderId={preselectedId || undefined}
          preselectedWorkOrder={preselectedWorkOrder}
        />
      </div>
    </>
  );
}
