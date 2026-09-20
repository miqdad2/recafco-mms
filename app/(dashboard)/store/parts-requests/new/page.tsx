import { PartsRequestWizard } from "@/components/store/parts-request-wizard";
import type { WorkOrderOption } from "@/components/store/parts-request-wizard";
import { MaterialsRequestTypeSelector } from "@/components/store/materials-request-type-selector";
import { GeneralInventoryRequestForm } from "@/components/store/general-inventory-request-form";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { formatDate } from "@/lib/utils";

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
          title="New Materials Request"
          description="You do not have permission to create materials requests."
          breadcrumb={
            <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "New Materials Request" }]} />
          }
          actions={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
        />
        <div className="p-4 lg:p-6" />
      </>
    );
  }

  const sp = (await searchParams) ?? {};
  // repair_order_id in the URL maps to the work_orders.id (same entity)
  const preselectedId = sp.repair_order_id?.trim() ?? "";

  // Materials Request Type Selection Flow Unit 10G.58, Task 1/2/3 — same
  // &type= gate as the modal entry point on the list page. A
  // repair_order_id deep link already implies "For Job Card" and skips the
  // selector, matching the modal's ?jobCardId= behavior.
  const requestedType = sp.type?.trim() ?? "";
  const effectiveType: "" | "job_card" | "general" =
    requestedType === "job_card" || requestedType === "general"
      ? requestedType
      : preselectedId
        ? "job_card"
        : "";
  const formError = sp.error?.trim() ?? null;

  if (!effectiveType) {
    return (
      <>
        <PageHeader
          title="New Materials Request"
          description="Choose how this material request will be used."
          breadcrumb={
            <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "New Materials Request" }]} />
          }
          actions={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
        />
        <div className="p-4 lg:p-6">
          <div className="mx-auto max-w-2xl rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <MaterialsRequestTypeSelector
              baseHref="/store/parts-requests/new"
              cancelHref="/store/parts-requests"
            />
          </div>
        </div>
      </>
    );
  }

  if (effectiveType === "general") {
    const requester = await prisma.profiles.findUnique({ where: { id: context.userId }, select: { full_name: true } });
    return (
      <>
        <PageHeader
          title="New Materials Request"
          description="Request materials for store stock or general inventory. No Job Card required."
          breadcrumb={
            <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "New Materials Request" }]} />
          }
          actions={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
        />
        <div className="p-4 lg:p-6">
          <GeneralInventoryRequestForm
            requesterName={requester?.full_name ?? null}
            requestedDateLabel={formatDate(new Date())}
            errorMessage={formError}
          />
        </div>
      </>
    );
  }

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
    ? `Requesting materials for job card ${preselectedWorkOrder.work_order_number ?? "Draft"}.`
    : "Request materials linked to a job card. Reference number is generated on save.";

  return (
    <>
      <PageHeader
        title="New Materials Request"
        description={pageDescription}
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "New Materials Request" }]} />
        }
        actions={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
      />
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
