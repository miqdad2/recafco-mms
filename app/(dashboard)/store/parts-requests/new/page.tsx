import { PartsRequestForm } from "@/components/store/parts-request-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

export default async function NewPartsRequestPage() {
  const context = await requireUser();
  const canCreate =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage");

  if (!canCreate) {
    return (
      <>
        <PageHeader title="New Parts Request" description="You do not have permission to create parts requests." />
        <div className="p-4 lg:p-6" />
      </>
    );
  }

  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const workOrders = await prisma.work_orders.findMany({
    where: { AND: [{ deleted_at: null }, visibilityFilter] },
    select: { id: true, work_order_number: true, ordered_by: true, worker_type: true, created_at: true },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader
        title="Parts Request"
        description="Request spare parts or materials linked to a work order. Reference number is generated on save."
      />
      <div className="p-4 lg:p-6">
        <PartsRequestForm workOrders={workOrders} />
      </div>
    </>
  );
}
