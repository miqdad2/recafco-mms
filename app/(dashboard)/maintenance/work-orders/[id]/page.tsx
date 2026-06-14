import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  History,
  LockKeyhole,
  PackageSearch,
  Printer,
  ShieldCheck,
  ShoppingCart,
  Timer,
  UserCheck,
  Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { respondToClarificationAction } from "@/app/actions/workflow";
import { uploadWorkOrderFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { PartsRequestForm } from "@/components/store/parts-request-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowActions } from "@/components/work-orders/workflow-actions";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkflowInstanceForWorkOrder, getPendingClarificationForWorkOrder, type WorkflowTrackingData } from "@/lib/backend/workflows/queries";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewCosts as canViewCostsForContext, hasPermission } from "@/lib/security/permissions";
import { canViewEntityFile } from "@/lib/security/file-access";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

const lifecycle = [
  "Draft",
  "Pending Approval",
  "Approved",
  "Assigned",
  "In Progress",
  "Waiting for Parts",
  "Waiting for Purchase",
  "Parts Issued",
  "Completed by Technician",
  "Verified by Supervisor",
  "Confirmed by Requester",
  "Closed"
];

type BadgeTone = "green" | "amber" | "red" | "blue" | "gray";

type TimelineItem = {
  id: string;
  at: Date | string | null;
  title: string;
  detail: string;
  actor?: string | null;
  tone: BadgeTone;
  label: string;
};

const workOrderControlInclude = {
  assets: true,
  departments: true,
  profiles: true,
  approvals: { orderBy: { decided_at: "desc" } },
  inventory_movements: { include: { parts: true, parts_requests: true, purchase_requests: true }, orderBy: { created_at: "desc" } },
  parts_requests: {
    include: {
      parts_request_items: { include: { parts: true } },
      purchase_requests: {
        include: {
          purchase_request_items: { include: { parts: true } },
          profiles_purchase_requests_finance_approved_byToprofiles: true,
          profiles_purchase_requests_ceo_approved_byToprofiles: true
        },
        orderBy: { created_at: "desc" }
      },
      profiles_parts_requests_requested_byToprofiles: true,
      profiles_parts_requests_prepared_byToprofiles: true,
      profiles_parts_requests_approved_byToprofiles: true
    },
    orderBy: { created_at: "desc" }
  },
  purchase_requests: {
    include: {
      purchase_request_items: { include: { parts: true } },
      profiles_purchase_requests_finance_approved_byToprofiles: true,
      profiles_purchase_requests_ceo_approved_byToprofiles: true
    },
    orderBy: { created_at: "desc" }
  },
  work_order_assignments: { include: { profiles: true }, orderBy: { assigned_at: "asc" } },
  work_order_attachments: { orderBy: { created_at: "desc" } },
  work_order_labor: { include: { profiles: true }, orderBy: { created_at: "desc" } },
  work_order_materials: { include: { parts: true }, orderBy: { created_at: "desc" } },
  work_order_required_parts: { orderBy: { created_at: "asc" } },
  work_order_status_history: { orderBy: { changed_at: "asc" } },
  work_order_technician_notes: { include: { profiles: true }, orderBy: { created_at: "desc" } }
} satisfies Prisma.work_ordersInclude;

type WorkOrderControl = Prisma.work_ordersGetPayload<{ include: typeof workOrderControlInclude }>;

export default async function WorkOrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string; warning?: string }>;
}) {
  const context = await requirePermission("work_orders.view");
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const errorMessage = resolvedSearch.error;
  const warningMessage = resolvedSearch.warning;
  const successMessage = resolvedSearch.success;
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const [wo, parts, auditLogs, workflowTracking, pendingClarification] = await Promise.all([
    prisma.work_orders.findFirst({
      where: { AND: [{ id }, { deleted_at: null }, visibilityFilter] },
      include: workOrderControlInclude
    }),
    prisma.parts.findMany({
      where: { deleted_at: null },
      orderBy: { part_code: "asc" },
      select: { id: true, part_code: true, part_name: true, part_number: true, ss_rec_code: true, unit_price: true }
    }),
    prisma.audit_logs.findMany({
      where: { entity_type: "work_order", entity_id: id },
      orderBy: { created_at: "desc" },
      take: 30
    }),
    getWorkflowInstanceForWorkOrder(id),
    getPendingClarificationForWorkOrder(id)
  ]);

  if (!wo) notFound();

  const actorIds = [
    wo.created_by,
    wo.updated_by,
    wo.assigned_supervisor_id,
    ...wo.approvals.map((item) => item.decided_by),
    ...wo.work_order_status_history.map((item) => item.changed_by),
    ...wo.work_order_assignments.map((item) => item.assigned_by),
    ...wo.work_order_attachments.map((item) => item.uploaded_by),
    ...wo.inventory_movements.map((item) => item.created_by),
    ...auditLogs.map((item) => item.actor_id),
    ...(workflowTracking?.step_instances.map((si) => si.actor_id) ?? []),
    pendingClarification?.requested_by
  ].filter((value): value is string => Boolean(value));
  const actors = actorIds.length
    ? await prisma.profiles.findMany({ where: { id: { in: [...new Set(actorIds)] } }, include: { roles: true, departments: true } })
    : [];
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
  const actorName = (profileId?: string | null) => profileId ? actorMap.get(profileId)?.full_name ?? "System user" : "System";

  // Most recent rejection approval — used in the rejection callout banner.
  const latestRejection = wo.status === "Rejected"
    ? wo.approvals.find((a) => a.status === "Rejected") ?? null
    : null;

  const canViewCosts = canViewCostsForContext(context);
  const canManage = hasPermission(context, "work_orders.manage");
  const canPrint = hasPermission(context, "work_orders.print");
  const isCreator = wo.created_by === context.userId;
  const canRespondToClarification =
    pendingClarification !== null &&
    (isCreator || canManage || context.role?.slug === "super_admin");
  const canCreatePartsRequest = hasPermission(context, "parts_requests.create");
  const canUploadFiles = hasPermission(context, "files.upload");
  const signedAttachments = await Promise.all(wo.work_order_attachments.map(async (attachment) => ({
    id: attachment.id,
    label: attachment.attachment_type,
    fileName: attachment.file_name,
    signedUrl: await canViewEntityFile(context, "work-order-files", wo.id) ? await createSignedFileUrl("work-order-files", attachment.file_path) : null,
    createdAt: attachment.created_at.toISOString()
  })));
  const timeline = buildTimeline(wo, auditLogs, actorName);
  const openPartsRequests = wo.parts_requests.filter((request) => !["Closed", "Cancelled", "Issued"].includes(request.status)).length;
  const purchaseQueue = [...wo.purchase_requests, ...wo.parts_requests.flatMap((request) => request.purchase_requests)].filter((request) => !["Received", "Rejected", "Cancelled"].includes(request.status));
  const latestActivity = timeline[0]?.at ?? wo.updated_at;
  const owner = currentOwner(wo.status, wo.work_order_assignments.map((assignment) => assignment.profiles?.full_name).filter(Boolean) as string[]);
  const blocker = currentBlocker(wo.status, openPartsRequests, purchaseQueue.length, wo.work_order_assignments.length);
  const lifecycleIndex = lifecycle.includes(wo.status) ? lifecycle.indexOf(wo.status) : -1;

  return (
    <>
      <PageHeader
        title={wo.work_order_number ?? "Unnumbered work order"}
        description="Work order control center with lifecycle tracking, accountability, approval history, parts, purchasing, costs, attachments, and audit trail."
        actions={
          <>
            {canPrint ? <Link href={`/maintenance/work-orders/${wo.id}/print`}><Button variant="secondary"><Printer className="h-4 w-4" /> Print</Button></Link> : null}
            {canManage && ["Draft", "Rejected"].includes(wo.status) ? <Link href={`/maintenance/work-orders/${wo.id}/edit`}><Button>Edit work order</Button></Link> : null}
          </>
        }
      />

      <div className="space-y-5 p-4 lg:p-6">
        {errorMessage ? (
          <div className="rounded-md border border-[#DC2626] bg-red-50 p-4">
            <p className="text-sm font-black text-[#DC2626]">Action could not be completed</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">{humanizeError(errorMessage)}</p>
          </div>
        ) : null}
        {warningMessage === "recovery-draft-saved" ? (
          <div className="rounded-md border border-[#F59E0B] bg-amber-50 p-4">
            <p className="text-sm font-black text-[#92400E]">Submit failed — work order saved as draft</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              Your submission could not be processed, but your work order was saved as a draft so your work is not lost.
              Review the details below, correct any issues, then use the workflow actions to resubmit for approval.
            </p>
          </div>
        ) : null}
        {successMessage === "clarification-responded" ? (
          <div className="rounded-md border border-[#16A34A] bg-green-50 p-4">
            <p className="text-sm font-black text-[#16A34A]">Response submitted</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              Your clarification response has been recorded. The Maintenance Manager has been notified and can now approve or reject this work order.
            </p>
          </div>
        ) : null}
        {successMessage === "clarification-sent" ? (
          <div className="rounded-md border border-[#16A34A] bg-green-50 p-4">
            <p className="text-sm font-black text-[#16A34A]">Clarification request sent</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              The work order creator has been notified. The work order status remains Pending Approval until you approve or reject.
            </p>
          </div>
        ) : null}
        {wo.status === "Rejected" ? (
          <div className="rounded-md border border-[#ED1C24] bg-red-50 p-4">
            <p className="font-black text-[#ED1C24]">This work order was rejected</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              {latestRejection?.comments ? `Rejection reason: "${latestRejection.comments}". ` : "No rejection reason was provided. "}
              {canManage ? "Use the Return to Draft & Edit button on the right to revise and resubmit." : "Contact your manager for next steps."}
            </p>
          </div>
        ) : null}
        {pendingClarification ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="font-black text-amber-800">Clarification requested by Maintenance Manager</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#111827]">{pendingClarification.question}</p>
            <p className="mt-1 text-xs text-[#4B5563]">
              Requested by {actorName(pendingClarification.requested_by)} on {formatDateTimeValue(pendingClarification.requested_at)}
            </p>
            {canRespondToClarification ? (
              <form action={respondToClarificationAction} className="mt-4 space-y-2">
                <input type="hidden" name="work_order_id" value={wo.id} />
                <textarea
                  className="focus-ring min-h-24 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                  name="response"
                  placeholder="Provide the requested information (required, min 10 characters)"
                  required
                  minLength={10}
                />
                <div className="flex items-center gap-3">
                  <Button type="submit">Submit Clarification Response</Button>
                  <p className="text-xs text-[#4B5563]">Responding sends this back to Maintenance Manager review. Work order status remains Pending Approval.</p>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-xs text-[#4B5563]">Only the work order creator or an authorized manager can respond to this clarification request.</p>
            )}
          </div>
        ) : null}
        <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                <StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />
                <StatusBadge label={wo.worker_type} tone="gray" />
              </div>
              <h2 className="mt-3 text-2xl font-black text-[#111827]">{wo.operator_complaint || wo.description_of_work || "Maintenance work order"}</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#4B5563]">
                {wo.description_of_work || "No work description was recorded. Add clear work details before approval to reduce execution errors."}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <MetricCard label="Current owner" value={owner} icon={UserCheck} tone="blue" />
                <MetricCard label="Current blocker" value={blocker} icon={AlertTriangle} tone={blocker === "No active blocker" ? "green" : "amber"} />
                <MetricCard label="Latest activity" value={formatDateTimeValue(latestActivity)} icon={Timer} tone="gray" />
                <MetricCard label="Total cost" value={canViewCosts ? money(wo.total_work_order_cost) : "Restricted"} icon={ShieldCheck} tone={canViewCosts ? "red" : "gray"} />
              </div>
            </div>
            <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-4">
              <p className="text-xs font-black uppercase text-[#ED1C24]">Control summary</p>
              <dl className="mt-3 space-y-3 text-sm">
                <InfoLine label="Asset" value={wo.assets ? `${wo.assets.asset_code} - ${wo.assets.asset_name}` : "No asset linked"} href={wo.asset_id ? `/assets/${wo.asset_id}` : undefined} />
                <InfoLine label="Department" value={wo.departments?.name ?? "Not assigned"} />
                <InfoLine label="Location" value={wo.job_location ?? "Not recorded"} />
                <InfoLine label="Created by" value={actorName(wo.created_by)} />
                <InfoLine label="Created" value={formatDateTimeValue(wo.created_at)} />
              </dl>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#ED1C24]">Lifecycle tracker</p>
              <h2 className="mt-1 text-lg font-black text-[#111827]">Work Order Engine</h2>
            </div>
            <StatusBadge label={`${Math.max(0, lifecycleIndex + 1)} of ${lifecycle.length}`} tone="blue" />
          </div>
          <div className="mt-5 grid gap-2 lg:grid-cols-12">
            {lifecycle.map((step, index) => {
              const isDone = lifecycleIndex > index || wo.status === "Closed";
              const isCurrent = wo.status === step;
              return (
                <div key={step} className={`min-h-24 rounded-md border p-3 ${isCurrent ? "border-[#ED1C24] bg-red-50" : isDone ? "border-green-200 bg-green-50" : "border-[#E5E7EB] bg-gray-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`grid h-6 w-6 place-items-center rounded-md text-xs font-black ${isCurrent ? "bg-[#ED1C24] text-white" : isDone ? "bg-[#16A34A] text-white" : "bg-white text-[#4B5563]"}`}>
                      {index + 1}
                    </span>
                    {isDone ? <CheckCircle2 className="h-4 w-4 text-[#16A34A]" aria-hidden="true" /> : null}
                  </div>
                  <p className="mt-3 text-xs font-black uppercase leading-4 text-[#111827]">{step}</p>
                </div>
              );
            })}
          </div>
        </section>

        <WorkflowTrackingSection tracking={workflowTracking} actorName={actorName} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <main className="space-y-5">
            <section id="overview" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Operational record" title="Work Order Overview" icon={ClipboardList} />
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <InfoBlock label="Ordered by" value={wo.ordered_by} />
                <InfoBlock label="Maintenance type" value={wo.maintenance_type} />
                <InfoBlock label="Worker type" value={wo.worker_type} />
                <InfoBlock label="Date of order" value={formatDateValue(wo.date_of_order)} />
                <InfoBlock label="Start" value={formatDateTimeValue(wo.starting_datetime)} />
                <InfoBlock label="End" value={formatDateTimeValue(wo.ending_datetime)} />
                <InfoBlock label="Serial number" value={wo.serial_number ?? "Not recorded"} />
                <InfoBlock label="Plate number" value={wo.plate_number ?? "Not recorded"} />
                <InfoBlock label="Asset category" value={wo.asset_category ?? wo.assets?.category ?? "Not recorded"} />
                <InfoBlock label="Running hours" value={displayValue(wo.running_hours)} />
                <InfoBlock label="Kilometers" value={displayValue(wo.kilometers)} />
                <InfoBlock label="Supervisor" value={wo.profiles?.full_name ?? "Not assigned"} />
              </div>
              <div className="mt-5 grid gap-4">
                <TextBlock label="Operator complaint" value={wo.operator_complaint} />
                <TextBlock label="Description of work" value={wo.description_of_work} />
                <TextBlock label="Notes" value={wo.notes} />
              </div>
            </section>

            <section id="timeline" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Complete trace" title="Unified Work Order Timeline" icon={History} />
              <div className="mt-5 space-y-3">
                {timeline.length ? timeline.map((item) => (
                  <div key={item.id} className="grid gap-3 rounded-md border border-[#E5E7EB] p-4 md:grid-cols-[9rem_minmax(0,1fr)]">
                    <div>
                      <StatusBadge label={item.label} tone={item.tone} />
                      <p className="mt-2 text-xs font-semibold text-[#4B5563]">{formatDateTimeValue(item.at)}</p>
                    </div>
                    <div>
                      <p className="font-black text-[#111827]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#4B5563]">{item.detail}</p>
                      <p className="mt-2 text-xs font-bold text-[#111827]">Actor: {item.actor || "System"}</p>
                    </div>
                  </div>
                )) : <EmptyState title="No timeline activity" message="Status changes, approvals, assignments, notes, parts, purchases, uploads, and audits will appear here." />}
              </div>
            </section>

            <section id="approvals" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Decision control" title="Approvals and Accountability" icon={ClipboardCheck} />
              <Table
                columns={["Decision", "Actor", "Comments", "Date"]}
                rows={wo.approvals.map((approval) => [
                  <StatusBadge key="status" label={approval.status} tone={statusTone(approval.status)} />,
                  actorName(approval.decided_by),
                  approval.comments || "No comments",
                  formatDateTimeValue(approval.decided_at)
                ])}
                empty="No approval decisions recorded yet."
              />
            </section>

            <section id="technicians" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Execution" title="Technician Work and Labor" icon={Wrench} />
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <DataPanel title="Assigned Technicians">
                  {wo.work_order_assignments.length ? wo.work_order_assignments.map((assignment) => (
                    <RecordLine key={assignment.id} title={assignment.profiles?.full_name ?? "Unknown technician"} detail={`Assigned ${formatDateTimeValue(assignment.assigned_at)} by ${actorName(assignment.assigned_by)}`} />
                  )) : <p className="text-sm text-[#4B5563]">No technician assigned.</p>}
                </DataPanel>
                <DataPanel title="Technician Notes">
                  {wo.work_order_technician_notes.length ? wo.work_order_technician_notes.map((note) => (
                    <RecordLine key={note.id} title={note.profiles.full_name} detail={`${displayValue(note.labor_hours)} hours - ${note.note}`} meta={formatDateTimeValue(note.created_at)} />
                  )) : <p className="text-sm text-[#4B5563]">No technician notes recorded.</p>}
                </DataPanel>
              </div>
              <Table
                columns={canViewCosts ? ["Labor", "Technician", "Employee no.", "Hours", "Rate", "Amount"] : ["Labor", "Technician", "Employee no.", "Hours"]}
                rows={wo.work_order_labor.map((row) => canViewCosts
                  ? [row.labor_name, row.profiles?.full_name ?? "-", row.employee_number ?? "-", displayValue(row.hours), money(row.rate), money(row.amount)]
                  : [row.labor_name, row.profiles?.full_name ?? "-", row.employee_number ?? "-", displayValue(row.hours)]
                )}
                empty="No labor rows recorded."
              />
            </section>

            <section id="parts" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Materials and inventory" title="Parts, Store, and Purchase Tracking" icon={PackageSearch} />
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <MetricCard label="Parts requests" value={wo.parts_requests.length} icon={PackageSearch} tone="blue" />
                <MetricCard label="Open requests" value={openPartsRequests} icon={AlertTriangle} tone={openPartsRequests ? "amber" : "green"} />
                <MetricCard label="Purchase queue" value={purchaseQueue.length} icon={ShoppingCart} tone={purchaseQueue.length ? "red" : "green"} />
              </div>
              {wo.work_order_required_parts.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Required parts — listed at creation</p>
                  <Table
                    columns={["Description", "Part no.", "Qty", "Unit", "Store status"]}
                    rows={wo.work_order_required_parts.map((row) => [
                      row.description,
                      row.part_number ?? "-",
                      row.quantity_required.toString(),
                      row.unit_of_measure,
                      <StatusBadge
                        key="status"
                        label={row.availability_status === "unchecked" ? "Unchecked" : row.availability_status === "available" ? "Available" : row.availability_status === "partial" ? "Partial" : row.availability_status === "unavailable" ? "Unavailable" : row.availability_status}
                        tone={row.availability_status === "available" ? "green" : row.availability_status === "unavailable" ? "red" : row.availability_status === "partial" ? "amber" : "gray"}
                      />
                    ])}
                    empty=""
                  />
                </div>
              ) : null}
              <Table
                columns={canViewCosts ? ["Material", "Part no.", "SS rec", "Qty", "Unit", "Amount"] : ["Material", "Part no.", "SS rec", "Qty"]}
                rows={wo.work_order_materials.map((row) => canViewCosts
                  ? [row.material_name, row.part_number ?? row.parts?.part_number ?? "-", row.ss_rec_code ?? row.parts?.ss_rec_code ?? "-", displayValue(row.quantity), money(row.unit_price), money(row.amount)]
                  : [row.material_name, row.part_number ?? row.parts?.part_number ?? "-", row.ss_rec_code ?? row.parts?.ss_rec_code ?? "-", displayValue(row.quantity)]
                )}
                empty="No material rows recorded."
              />
              <div className="mt-5 space-y-3">
                {wo.parts_requests.length ? wo.parts_requests.map((request) => (
                  <Link key={request.id} href={`/store/parts-requests/${request.id}`} className="block rounded-md border border-[#E5E7EB] p-4 transition hover:border-[#ED1C24]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-[#111827]">{request.parts_request_number ?? "Parts request"}</p>
                        <p className="mt-1 text-sm text-[#4B5563]">{request.remarks || "No remarks"} - {request.parts_request_items.length} items</p>
                      </div>
                      <StatusBadge label={request.status} tone={statusTone(request.status)} />
                    </div>
                  </Link>
                )) : <EmptyState title="No parts request" message="Technicians or supervisors can submit a linked parts request when materials are needed." />}
              </div>
            </section>

            <section id="purchase" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Financial control" title="Purchase and Finance Chain" icon={ShoppingCart} />
              <Table
                columns={canViewCosts ? ["Purchase request", "Supplier", "Status", "Estimate", "Finance", "CEO"] : ["Purchase request", "Supplier", "Status", "Finance", "CEO"]}
                rows={[...wo.purchase_requests, ...wo.parts_requests.flatMap((request) => request.purchase_requests)].map((request) => canViewCosts
                  ? [
                      request.purchase_request_number ? <Link key="link" href={`/purchase/requests/${request.id}`} className="font-bold text-[#ED1C24]">{request.purchase_request_number}</Link> : "Draft purchase",
                      request.supplier ?? "-",
                      <StatusBadge key="status" label={request.status} tone={statusTone(request.status)} />,
                      money(request.estimated_total),
                      request.finance_approved_at ? `Approved by ${request.profiles_purchase_requests_finance_approved_byToprofiles?.full_name ?? "Finance"}` : request.finance_comments || "-",
                      request.ceo_approved_at ? `Approved by ${request.profiles_purchase_requests_ceo_approved_byToprofiles?.full_name ?? "CEO"}` : request.ceo_comments || "-"
                    ]
                  : [
                      request.purchase_request_number ? <Link key="link" href={`/purchase/requests/${request.id}`} className="font-bold text-[#ED1C24]">{request.purchase_request_number}</Link> : "Draft purchase",
                      request.supplier ?? "-",
                      <StatusBadge key="status" label={request.status} tone={statusTone(request.status)} />,
                      request.finance_approved_at ? "Approved" : request.finance_comments || "-",
                      request.ceo_approved_at ? "Approved" : request.ceo_comments || "-"
                    ]
                )}
                empty="No purchase request is linked to this work order."
              />
            </section>
          </main>

          <aside className="space-y-5">
            <WorkflowActions workOrderId={wo.id} status={wo.status} context={context} />

            <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Fraud prevention" title="Controls Active" icon={LockKeyhole} />
              <div className="mt-4 space-y-3">
                <ControlLine title="Role-separated approvals" ok detail="Approvals, assignment, store, purchase, and finance actions are split by permission." />
                <ControlLine title="Immutable audit trail" ok={auditLogs.length > 0 || wo.work_order_status_history.length > 0} detail={`${auditLogs.length + wo.work_order_status_history.length} trace records available.`} />
                <ControlLine title="Cost visibility protected" ok={!canViewCosts || context.permissions.includes("costs.view") || context.role?.slug === "super_admin"} detail={canViewCosts ? "Your role can view cost fields." : "Costs are hidden for this role."} />
                <ControlLine title="Stock movement trace" ok={wo.inventory_movements.length > 0 || !wo.work_order_materials.length} detail={`${wo.inventory_movements.length} inventory movements linked.`} />
              </div>
            </section>

            <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Cost control" title="Financial Snapshot" icon={ShieldCheck} />
              {canViewCosts ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <InfoLine label="Labor" value={money(wo.total_labor_cost)} />
                  <InfoLine label="Material" value={money(wo.total_material_cost)} />
                  <InfoLine label="Total work order" value={money(wo.total_work_order_cost)} strong />
                  <InfoLine label="Purchase estimate" value={money(sumValues([...wo.purchase_requests, ...wo.parts_requests.flatMap((request) => request.purchase_requests)].map((request) => request.estimated_total)))} strong />
                </dl>
              ) : <p className="mt-3 text-sm leading-6 text-[#4B5563]">Cost visibility is restricted for your role. This protects sensitive price and finance data.</p>}
            </section>

            <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Service planning" title="Next Service" icon={Timer} />
              <dl className="mt-4 space-y-3 text-sm">
                <InfoLine label="Date" value={formatDateValue(wo.next_service_date)} />
                <InfoLine label="Kilometer" value={displayValue(wo.next_service_kilometer)} />
                <InfoLine label="Running hours" value={displayValue(wo.next_service_running_hours)} />
              </dl>
            </section>

            <QrLinkCard title="Internal work order route" href={`/maintenance/work-orders/${wo.id}`} />
          </aside>
        </div>

        <section id="audit" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_0.8fr]">
          <SignedFileList title="Private Attachments" files={signedAttachments} />
          <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
            <SectionHeader eyebrow="Audit evidence" title="Audit Logs" icon={FileText} />
            <div className="mt-4 space-y-3">
              {auditLogs.length ? auditLogs.slice(0, 12).map((log) => (
                <RecordLine key={log.id} title={log.action} detail={log.summary} meta={`${actorName(log.actor_id)} - ${formatDateTimeValue(log.created_at)}`} />
              )) : <p className="text-sm text-[#4B5563]">No audit log rows found for this work order yet.</p>}
            </div>
          </section>
        </section>

        {canUploadFiles ? (
          <PrivateFilePanel
            title="Upload Work Order File"
            description="Add complaint photos, before/after photos, meter photos, documents, and PDF support files."
            action={uploadWorkOrderFileAction}
            hiddenFields={{ work_order_id: wo.id, return_to: `/maintenance/work-orders/${wo.id}` }}
            typeFieldName="attachment_type"
            typeOptions={["Complaint Photo", "Before Repair Photo", "After Repair Photo", "Damaged Part Photo", "Meter Photo", "Document"]}
          />
        ) : null}

        {canCreatePartsRequest ? <PartsRequestForm workOrderId={wo.id} parts={parts.map((part) => ({ ...part, unit_price: Number(part.unit_price) }))} /> : null}
      </div>
    </>
  );
}

function stepInstanceTone(status: string): BadgeTone {
  if (status === "completed") return "green";
  if (status === "pending") return "amber";
  if (status === "active") return "blue";
  if (status === "clarification_requested") return "blue";
  return "gray";
}

function WorkflowTrackingSection({
  tracking,
  actorName
}: {
  tracking: WorkflowTrackingData | null;
  actorName: (id?: string | null) => string;
}) {
  if (!tracking) {
    return (
      <p className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs text-[#4B5563]">
        No workflow tracking record exists for this work order. Workflow tracking is created for newly submitted work orders.
      </p>
    );
  }

  return (
    <section className="rounded-md border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-blue-600 p-2 text-white">
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">Workflow engine</p>
            <h2 className="mt-1 text-lg font-black text-[#111827]">Workflow Tracking</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={tracking.workflow_definition.name} tone="blue" />
          <StatusBadge label={tracking.status} tone={tracking.status === "active" ? "blue" : tracking.status === "completed" ? "green" : "gray"} />
        </div>
      </div>

      <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-2">
        <p className="text-xs font-semibold text-blue-800">
          Workflow tracking is active. The <span className="font-mono">inventory_check</span> step is now live — Store Keeper confirms required part availability before technician assignment can proceed. Steps advance automatically as each stage completes.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
          <p className="text-xs font-black uppercase text-[#4B5563]">Definition</p>
          <p className="mt-1 font-mono text-sm font-bold text-[#111827]">{tracking.workflow_definition.code}</p>
        </div>
        <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
          <p className="text-xs font-black uppercase text-[#4B5563]">Current step</p>
          <p className="mt-1 font-mono text-sm font-bold text-[#111827]">{tracking.current_step?.code ?? "—"}</p>
          <p className="text-xs text-[#4B5563]">{tracking.current_step?.name ?? ""}</p>
        </div>
        <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
          <p className="text-xs font-black uppercase text-[#4B5563]">Tracking started</p>
          <p className="mt-1 text-sm font-bold text-[#111827]">{tracking.started_at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        </div>
      </div>

      {tracking.step_instances.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase text-[#4B5563]">Step timeline</p>
          <div className="mt-2 space-y-2">
            {tracking.step_instances.map((si) => (
              <div key={si.id} className="grid gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div className="flex flex-col gap-1">
                  <StatusBadge label={si.status} tone={stepInstanceTone(si.status)} />
                  {si.completed_at ? (
                    <p className="text-xs text-[#4B5563]">{si.completed_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  ) : null}
                </div>
                <div>
                  <p className="font-mono text-xs font-black text-[#ED1C24]">{si.workflow_step.code}</p>
                  <p className="mt-0.5 text-sm font-bold text-[#111827]">{si.workflow_step.name}</p>
                  {si.actor_id ? <p className="mt-1 text-xs text-[#4B5563]">Actor: {actorName(si.actor_id)}</p> : null}
                  {si.decision ? <p className="mt-0.5 text-xs text-[#4B5563]">Decision: <span className="font-semibold">{si.decision}</span></p> : null}
                  {si.comments ? <p className="mt-0.5 text-xs text-[#4B5563]">Comment: {si.comments}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildTimeline(wo: WorkOrderControl, auditLogs: Array<{ id: string; action: string; summary: string; created_at: Date; actor_id: string | null }>, actorName: (id?: string | null) => string): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `created-${wo.id}`,
      at: wo.created_at,
      title: `Created ${wo.work_order_number ?? "work order"}`,
      detail: wo.operator_complaint || wo.description_of_work || "Work order was created.",
      actor: actorName(wo.created_by),
      tone: "blue",
      label: "Created"
    },
    ...wo.work_order_status_history.map((item) => ({
      id: `status-${item.id}`,
      at: item.changed_at,
      title: item.from_status ? `${item.from_status} -> ${item.to_status}` : item.to_status,
      detail: item.notes || "Status changed in the workflow engine.",
      actor: actorName(item.changed_by),
      tone: statusTone(item.to_status),
      label: "Status"
    })),
    ...wo.approvals.map((item) => ({
      id: `approval-${item.id}`,
      at: item.decided_at,
      title: `${item.approval_type} ${item.status}`,
      detail: item.comments || "Decision recorded without comments.",
      actor: actorName(item.decided_by),
      tone: statusTone(item.status),
      label: "Approval"
    })),
    ...wo.work_order_assignments.map((item) => ({
      id: `assignment-${item.id}`,
      at: item.assigned_at,
      title: `Assigned to ${item.profiles?.full_name ?? "technician"}`,
      detail: item.notes || "Technician assignment recorded.",
      actor: actorName(item.assigned_by),
      tone: "blue" as BadgeTone,
      label: "Assign"
    })),
    ...wo.work_order_technician_notes.map((item) => ({
      id: `tech-note-${item.id}`,
      at: item.created_at,
      title: `Technician update by ${item.profiles.full_name}`,
      detail: `${displayValue(item.labor_hours)} labor hours. ${item.note}`,
      actor: item.profiles.full_name,
      tone: "gray" as BadgeTone,
      label: "Tech"
    })),
    ...wo.parts_requests.map((item) => ({
      id: `parts-request-${item.id}`,
      at: item.created_at,
      title: `Parts request ${item.parts_request_number ?? ""}`.trim(),
      detail: `${item.status}. ${item.remarks || "No remarks."}`,
      actor: item.profiles_parts_requests_prepared_byToprofiles?.full_name ?? actorName(item.created_by),
      tone: statusTone(item.status),
      label: "Parts"
    })),
    ...wo.purchase_requests.map((item) => ({
      id: `purchase-${item.id}`,
      at: item.created_at,
      title: `Purchase request ${item.purchase_request_number ?? ""}`.trim(),
      detail: `${item.status}. Supplier: ${item.supplier ?? "not recorded"}.`,
      actor: actorName(item.created_by),
      tone: statusTone(item.status),
      label: "Purchase"
    })),
    ...wo.work_order_attachments.map((item) => ({
      id: `attachment-${item.id}`,
      at: item.created_at,
      title: `${item.attachment_type} uploaded`,
      detail: item.file_name,
      actor: actorName(item.uploaded_by),
      tone: "gray" as BadgeTone,
      label: "File"
    })),
    ...wo.inventory_movements.map((item) => ({
      id: `inventory-${item.id}`,
      at: item.created_at,
      title: `${item.movement_type} stock movement`,
      detail: `${item.parts.part_name} - quantity ${displayValue(item.quantity)}. ${item.comments || ""}`,
      actor: actorName(item.created_by),
      tone: "blue" as BadgeTone,
      label: "Stock"
    })),
    ...auditLogs.map((item) => ({
      id: `audit-${item.id}`,
      at: item.created_at,
      title: item.action,
      detail: item.summary,
      actor: actorName(item.actor_id),
      tone: "gray" as BadgeTone,
      label: "Audit"
    }))
  ];

  return items.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
}

function currentOwner(status: string, technicianNames: string[]) {
  if (["Draft", "Rejected", "Reopened"].includes(status)) return "Maintenance Data Entry";
  if (["Submitted", "Pending Approval"].includes(status)) return "Maintenance Manager";
  if (status === "Approved") return "Maintenance Supervisor";
  if (["Assigned", "In Progress", "Waiting for Parts", "Parts Issued"].includes(status)) return technicianNames.length ? technicianNames.join(", ") : "Assigned technician";
  if (status === "Waiting for Purchase") return "Purchase / Finance";
  if (status === "Completed by Technician") return "Maintenance Supervisor";
  if (status === "Verified by Supervisor") return "Maintenance Manager";
  if (status === "Closed") return "Closed / Audit";
  return "Maintenance team";
}

function currentBlocker(status: string, openPartsRequests: number, purchaseQueue: number, assignmentCount: number) {
  if (status === "Approved" && assignmentCount === 0) return "Technician assignment needed";
  if (["Submitted", "Pending Approval"].includes(status)) return "Manager approval needed";
  if (status === "Waiting for Parts" || openPartsRequests > 0) return "Parts/store action needed";
  if (status === "Waiting for Purchase" || purchaseQueue > 0) return "Purchase or finance action needed";
  if (status === "Completed by Technician") return "Supervisor verification needed";
  if (status === "Verified by Supervisor") return "Manager closure needed";
  return "No active blocker";
}

function SectionHeader({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-[#111827] p-2 text-white"><Icon className="h-4 w-4" aria-hidden="true" /></div>
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-black text-[#111827]">{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: ReactNode; icon: LucideIcon; tone: BadgeTone }) {
  const toneClass = {
    green: "bg-[#16A34A]",
    amber: "bg-[#F59E0B]",
    red: "bg-[#ED1C24]",
    blue: "bg-[#2563EB]",
    gray: "bg-[#111827]"
  }[tone];

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${toneClass}`}><Icon className="h-4 w-4" aria-hidden="true" /></div>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-[#111827]">{value}</p>
    </div>
  );
}

function InfoLine({ label, value, href, strong = false }: { label: string; value: ReactNode; href?: string; strong?: boolean }) {
  const content = <span className={strong ? "font-black text-[#ED1C24]" : "font-bold text-[#111827]"}>{value}</span>;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F6] pb-2 last:border-b-0 last:pb-0">
      <dt className="text-[#4B5563]">{label}</dt>
      <dd className="text-right">
        {href ? <Link className="inline-flex items-center gap-1 text-[#ED1C24] hover:text-[#c9151c]" href={href}>{content}<ArrowRight className="h-3 w-3" aria-hidden="true" /></Link> : content}
      </dd>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
      <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-[#111827]">{value}</p>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-sm font-black text-[#4B5563]">{label}</p>
      <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 p-3 text-sm leading-6 text-[#111827]">{value || "Not recorded"}</p>
    </div>
  );
}

function DataPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-4">
      <h3 className="font-black text-[#111827]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function RecordLine({ title, detail, meta }: { title: string; detail: string; meta?: string }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="font-bold text-[#111827]">{title}</p>
      <p className="mt-1 text-sm leading-5 text-[#4B5563]">{detail}</p>
      {meta ? <p className="mt-2 text-xs font-semibold text-[#4B5563]">{meta}</p> : null}
    </div>
  );
}

function ControlLine({ title, detail, ok }: { title: string; detail: string; ok: boolean }) {
  return (
    <div className="flex gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" aria-hidden="true" />}
      <div>
        <p className="text-sm font-black text-[#111827]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#4B5563]">{detail}</p>
      </div>
    </div>
  );
}

function Table({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
          <tr>{columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-3 align-top">{cell}</td>)}
            </tr>
          )) : (
            <tr><td className="px-3 py-4 text-[#4B5563]" colSpan={columns.length}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function priorityTone(priority: string): BadgeTone {
  if (priority === "Urgent") return "red";
  if (priority === "High") return "amber";
  if (priority === "Low") return "gray";
  return "blue";
}

function statusTone(status: string): BadgeTone {
  if (["Closed", "Verified", "Verified by Supervisor", "Confirmed by Requester", "Approved", "Issued", "Received"].includes(status)) return "green";
  if (status.includes("Waiting") || status.includes("Pending") || status === "Submitted" || status === "Partially Issued") return "amber";
  if (["Rejected", "Cancelled", "Failed"].includes(status)) return "red";
  return "blue";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "0.000 KWD";
  return `${Number(value).toFixed(3)} KWD`;
}

function sumValues(values: unknown[]) {
  return values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
}

function formatDateValue(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTimeValue(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function humanizeError(code: string) {
  const map: Record<string, string> = {
    "not-editable": "This work order cannot be edited in its current status. Only Draft and Rejected work orders can be updated through the form. Status changes must go through the workflow actions.",
    "not-found": "This work order could not be found.",
    "invalid-input": "Some required fields are missing or invalid. Please check the form and try again.",
    "save-failed": "Changes could not be saved. Please try again.",
    "invalid-status": "The requested status change is not allowed by the workflow rules.",
    "clarification-question-too-short": "The clarification question must be at least 10 characters.",
    "clarification-response-too-short": "The clarification response must be at least 10 characters."
  };
  return map[code] ?? code;
}
