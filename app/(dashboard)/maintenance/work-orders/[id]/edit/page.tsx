import { JobCardEditForm, type JobCardEditRelated } from "@/components/work-orders/job-card-edit-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { toKuwaitInputValue } from "@/lib/format/kuwait-time";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import { ACTIVE_MATERIALS_REQUEST_STATUSES } from "@/lib/backend/parts-requests/repository";
import { ON_TEAM_ASSIGNMENT_STATUSES } from "@/lib/backend/workers/constants";
import { assignmentGates } from "@/lib/work-orders/assignment-edit";
import { getJobCardTiming } from "@/lib/work-orders/job-card-dates-data";
import { isJobCardEditable, toIsoDateOnly } from "@/lib/work-orders/job-card-edit";
import { getMaterialFulfillmentForWorkOrder } from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { notFound, redirect } from "next/navigation";

export default async function EditWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const context = await requirePermission("work_orders.manage");
  const { id } = await params;
  // Cancel Edit returns to Daily Activity when the editor was opened from
  // there (?from=daily-activity), otherwise to this Job Card. Only these two
  // fixed internal paths — the query value is a flag, never a URL.
  const from = (await searchParams)?.from;
  const cancelHref = from === "daily-activity" ? "/maintenance/daily-activity" : `/maintenance/work-orders/${id}`;
  // Same visibility filter as every other Job Card query, and only while the
  // Job Card can still be edited (not deleted, closure not yet requested) —
  // the save action re-checks both.
  const editable = await prisma.work_orders.findFirst({
    where: { AND: [{ id, deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
    select: { status: true },
  });
  if (!editable) notFound();
  if (!isJobCardEditable(editable.status)) redirect(`/maintenance/work-orders/${id}?error=not-editable`);
  const [rawWorkOrder, departments, assets, attachmentsCount, fulfillment, roster, externalAssignment, partsRequests, pendingClarification] = await Promise.all([
    prisma.work_orders.findUnique({ where: { id } }),
    prisma.departments.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    }),
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: { id: true, asset_code: true, asset_name: true },
      orderBy: { asset_code: "asc" }
    }),
    // Read-only on this page: attachments, required materials (with what was
    // issued), the team and the Materials Request each have their own workflow.
    prisma.work_order_attachments.count({ where: { work_order_id: id } }),
    getMaterialFulfillmentForWorkOrder(prisma, id),
    prisma.workOrderWorkerAssignment.findMany({
      where: { work_order_id: id, status: { in: ON_TEAM_ASSIGNMENT_STATUSES } },
      select: { worker_role: true, worker_profiles: { select: { name: true } } },
      orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
    }),
    prisma.work_order_assignments.findFirst({
      where: { work_order_id: id },
      orderBy: { assigned_at: "asc" },
      select: { assignment_type: true, external_name: true, external_company: true, profiles: { select: { full_name: true } } },
    }),
    prisma.parts_requests.findMany({ where: { work_order_id: id }, orderBy: { created_at: "desc" }, select: { id: true, parts_request_number: true, status: true } }),
    getPendingClarificationForWorkOrder(id),
  ]);
  if (!rawWorkOrder) notFound();
  const { timing } = await getJobCardTiming(prisma, rawWorkOrder);

  const workOrder = {
    ...rawWorkOrder,
    // <input type="date"> only accepts yyyy-mm-dd; a full ISO timestamp left
    // the field blank, so the required Date of order blocked every save and
    // Next service date was silently cleared on save. Both are @db.Date
    // (stored as UTC midnight), so the first 10 characters are the date.
    date_of_order: rawWorkOrder.date_of_order.toISOString().slice(0, 10),
    job_card_start_date: toIsoDateOnly(rawWorkOrder.job_card_start_date),
    job_card_end_date: toIsoDateOnly(rawWorkOrder.job_card_end_date),
    job_card_opened_at: rawWorkOrder.job_card_opened_at?.toISOString() ?? null,
    job_card_open_time: rawWorkOrder.job_card_opened_at ? toKuwaitInputValue(rawWorkOrder.job_card_opened_at).slice(11) : null,
    work_completed_at: rawWorkOrder.work_completed_at?.toISOString() ?? null,
    starting_datetime: rawWorkOrder.starting_datetime?.toISOString() ?? null,
    ending_datetime: rawWorkOrder.ending_datetime?.toISOString() ?? null,
    next_service_date: rawWorkOrder.next_service_date?.toISOString().slice(0, 10) ?? null,
    created_at: rawWorkOrder.created_at.toISOString(),
    updated_at: rawWorkOrder.updated_at.toISOString(),
    deleted_at: rawWorkOrder.deleted_at?.toISOString() ?? null,
    running_hours: rawWorkOrder.running_hours?.toNumber() ?? null,
    kilometers: rawWorkOrder.kilometers?.toNumber() ?? null,
    total_labor_cost: rawWorkOrder.total_labor_cost.toNumber(),
    total_material_cost: rawWorkOrder.total_material_cost.toNumber(),
    total_work_order_cost: rawWorkOrder.total_work_order_cost?.toNumber() ?? null,
    next_service_kilometer: rawWorkOrder.next_service_kilometer?.toNumber() ?? null,
    next_service_running_hours: rawWorkOrder.next_service_running_hours?.toNumber() ?? null,
    estimated_labor_hours: rawWorkOrder.estimated_labor_hours?.toNumber() ?? null,
  };

  const names = (role: string) => roster.filter((r) => r.worker_role === role).map((r) => r.worker_profiles.name);
  const external = externalAssignment
    ? externalAssignment.assignment_type === "FREELANCER"
      ? `Freelancer: ${externalAssignment.external_name ?? ""}`
      : externalAssignment.assignment_type === "EXTERNAL_COMPANY"
        ? `Company: ${externalAssignment.external_company ?? ""}`
        : externalAssignment.profiles?.full_name ?? externalAssignment.external_name ?? null
    : null;
  const activeRequest =
    partsRequests.find((r) => (ACTIVE_MATERIALS_REQUEST_STATUSES as readonly string[]).includes(r.status)) ?? partsRequests[0] ?? null;
  const gates = assignmentGates(context, rawWorkOrder.status, {
    hasPendingCorrection: pendingClarification !== null,
    hasActiveMaterialsRequest: partsRequests.some((r) => (ACTIVE_MATERIALS_REQUEST_STATUSES as readonly string[]).includes(r.status)),
  });
  const related: JobCardEditRelated = {
    detailHref: `/maintenance/work-orders/${id}`,
    team: { supervisor: names("Supervisor"), technicians: names("Technician"), helpers: names("Helper/Labor"), external },
    canEditAssignment: gates.canAssign || gates.canManageRoster,
    timing: { completed: timing.completedText, duration: timing.durationText, approved: timing.managerApprovedText },
    requiredMaterials: fulfillment.map((f) => ({ name: f.description, partNumber: f.part_number, quantity: f.required_qty, unit: f.unit, issued: f.issued_qty })),
    materialsRequest: activeRequest
      ? { number: activeRequest.parts_request_number, status: activeRequest.status, href: `/store/parts-requests/${activeRequest.id}` }
      : null,
    attachmentsCount,
  };

  return (
    <>
      <PageHeader title="Edit Job Card" description={`${workOrder.work_order_number ?? "Job Card"}: change the Job Card details. Workers, worker time, materials and closure each have their own step.`} />
      <div className="p-4 lg:p-6">
        <JobCardEditForm
          workOrder={workOrder}
          departments={departments}
          assets={assets}
          related={related}
          cancelHref={cancelHref}
        />
      </div>
    </>
  );
}
