import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Cpu,
  History,
  PackageSearch,
  Paperclip,
  Printer,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { addWorkOrderMaterialAction } from "@/app/actions/maintenance";
import { respondToClarificationAction } from "@/app/actions/workflow";
import { uploadWorkOrderFileAction } from "@/app/actions/files";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowActions } from "@/components/work-orders/workflow-actions";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewCosts as canViewCostsForContext, hasPermission } from "@/lib/security/permissions";
import { canViewEntityFile } from "@/lib/security/file-access";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { displayStatus } from "@/lib/display/work-order-labels";
import { AutoRefresh } from "@/components/auto-refresh";

// ── 7-stage display tracker ───────────────────────────────────────────────────

const DISPLAY_STAGES = [
  "Submitted",
  "Manager Review",
  "Assigned",
  "In Progress",
  "Waiting Materials",
  "Ready to Close",
  "Closed",
] as const;

function statusToStageIndex(status: string): number {
  switch (status) {
    case "Draft":
    case "Submitted":
    case "Reopened":
      return 0;
    case "Pending Approval":
      return 1;
    case "Approved":
    case "Assigned":
      return 2;
    case "In Progress":
    case "Parts Issued":
      return 3;
    case "Waiting for Parts":
    case "Waiting for Purchase":
      return 4;
    case "Completed by Technician":
    case "Verified by Supervisor":
    case "Confirmed by Requester":
      return 5;
    case "Closed":
      return 6;
    default:
      return -1;
  }
}

// ── DB include ────────────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function WorkOrderDetailPage({
  params,
  searchParams,
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

  const [wo, auditLogs, pendingClarification, technicians] = await Promise.all([
    prisma.work_orders.findFirst({
      where: { AND: [{ id }, { deleted_at: null }, visibilityFilter] },
      include: workOrderControlInclude,
    }),
    prisma.audit_logs.findMany({
      where: { entity_type: "work_order", entity_id: id },
      orderBy: { created_at: "desc" },
      take: 30,
    }),
    getPendingClarificationForWorkOrder(id),
    prisma.profiles.findMany({
      where: { is_active: true, deleted_at: null },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
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
    pendingClarification?.requested_by,
  ].filter((value): value is string => Boolean(value));

  const actors = actorIds.length
    ? await prisma.profiles.findMany({
        where: { id: { in: [...new Set(actorIds)] } },
        include: { roles: true, departments: true },
      })
    : [];
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
  const actorName = (profileId?: string | null) =>
    profileId ? (actorMap.get(profileId)?.full_name ?? "System user") : "System";

  const latestRejection =
    wo.status === "Rejected" ? (wo.approvals.find((a) => a.status === "Rejected") ?? null) : null;

  const canViewCosts = canViewCostsForContext(context);
  const canManage = hasPermission(context, "work_orders.manage");
  const canPrint = hasPermission(context, "work_orders.print");
  const isCreator = wo.created_by === context.userId;
  const canRespondToClarification =
    pendingClarification !== null &&
    (isCreator || canManage || context.role?.slug === "super_admin");
  const canCreatePartsRequest = hasPermission(context, "parts_requests.create");
  const canUploadFiles = hasPermission(context, "files.upload");

  const signedAttachments = await Promise.all(
    wo.work_order_attachments.map(async (attachment) => ({
      id: attachment.id,
      label: attachment.attachment_type,
      fileName: attachment.file_name,
      signedUrl:
        (await canViewEntityFile(context, "work-order-files", wo.id))
          ? await createSignedFileUrl("work-order-files", attachment.file_path)
          : null,
      createdAt: attachment.created_at.toISOString(),
    }))
  );

  const timeline = buildTimeline(wo, auditLogs, actorName);
  const openPartsRequests = wo.parts_requests.filter(
    (r) => !["Closed", "Cancelled", "Issued"].includes(r.status)
  ).length;
  const stageIndex = statusToStageIndex(wo.status);
  const isTerminal = ["Rejected", "Cancelled"].includes(wo.status);
  const hasTechnicianContent =
    wo.work_order_assignments.length > 0 ||
    wo.work_order_technician_notes.length > 0 ||
    wo.work_order_labor.length > 0 ||
    Boolean(wo.starting_datetime) ||
    Boolean(wo.ending_datetime);

  const primaryAssignment = wo.work_order_assignments[0] ?? null;
  const currentAssignment = primaryAssignment
    ? {
        type: primaryAssignment.assignment_type,
        externalName: primaryAssignment.external_name,
        externalCompany: primaryAssignment.external_company,
      }
    : null;

  // Truncate complaint for the summary heading (full text lives in Problem Details)
  const summaryTitle = (() => {
    const raw = wo.operator_complaint || wo.description_of_work || "Repair order";
    return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  })();

  return (
    <>
      <AutoRefresh intervalMs={20000} enabled={!isTerminal} />
      <PageHeader
        title={wo.work_order_number ?? "Job Card"}
        description={summaryTitle.length > 80 ? summaryTitle.slice(0, 80) + "…" : summaryTitle}
        actions={
          <>
            {canPrint ? (
              <Link href={`/maintenance/work-orders/${wo.id}/print`}>
                <Button variant="secondary">
                  <Printer className="h-4 w-4" /> Print
                </Button>
              </Link>
            ) : null}
            {canManage && ["Draft", "Rejected"].includes(wo.status) ? (
              <Link href={`/maintenance/work-orders/${wo.id}/edit`}>
                <Button>Edit</Button>
              </Link>
            ) : null}
          </>
        }
      />

      <div className="space-y-5 p-4 lg:p-6">

        {/* ── Flash banners ───────────────────────────────────────────────── */}
        {errorMessage ? (
          <div className="rounded-md border border-[#DC2626] bg-red-50 p-4">
            <p className="text-sm font-black text-[#DC2626]">Action could not be completed</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">{humanizeError(errorMessage)}</p>
          </div>
        ) : null}
        {warningMessage === "recovery-draft-saved" ? (
          <div className="rounded-md border border-[#F59E0B] bg-amber-50 p-4">
            <p className="text-sm font-black text-[#92400E]">Submit failed — job card saved as draft</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              Your submission could not be processed. The job card was saved as a draft. Review the
              details, correct any issues, then resubmit using the actions on the right.
            </p>
          </div>
        ) : null}
        {successMessage === "clarification-responded" ? (
          <div className="rounded-md border border-[#16A34A] bg-green-50 p-4">
            <p className="text-sm font-black text-[#16A34A]">Response submitted</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              Your clarification response has been recorded and the job card will be processed.
            </p>
          </div>
        ) : null}
        {successMessage === "material-added" ? (
          <div className="rounded-md border border-[#16A34A] bg-green-50 p-4">
            <p className="text-sm font-black text-[#16A34A]">Parts usage recorded</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">The part has been added to this job card.</p>
          </div>
        ) : null}

        {/* ── Status banners (rejection only — awaiting-manager moved to sidebar) */}
        {wo.status === "Rejected" ? (
          <div className="rounded-md border border-[#ED1C24] bg-red-50 p-4">
            <p className="font-black text-[#ED1C24]">This job card was returned for fix</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              {latestRejection?.comments
                ? `Reason: "${latestRejection.comments}". `
                : "No reason was provided. "}
              {canManage
                ? "Use the Return to Draft button on the right to revise and resubmit."
                : "Contact your supervisor for next steps."}
            </p>
          </div>
        ) : null}

        {/* ── Clarification banner ────────────────────────────────────────── */}
        {pendingClarification ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="font-black text-amber-800">More information requested</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#111827]">
              {pendingClarification.question}
            </p>
            <p className="mt-1 text-xs text-[#4B5563]">
              Requested by {actorName(pendingClarification.requested_by)} on{" "}
              {formatDateTimeValue(pendingClarification.requested_at)}
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
                  <Button type="submit">Submit Response</Button>
                  <p className="text-xs text-[#4B5563]">Responding sends this back for processing.</p>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-xs text-[#4B5563]">
                Only the job card creator or an authorized supervisor can respond to this request.
              </p>
            )}
          </div>
        ) : null}

        {/* ── Identity summary strip ───────────────────────────────────────── */}
        <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={displayStatus(wo.status)} tone={statusTone(wo.status)} />
            <StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />
            <StatusBadge label={wo.worker_type} tone="gray" />
          </div>
          <h2 className="mt-2 text-xl font-black text-[#111827]">{summaryTitle}</h2>
          {wo.assets ? (
            <p className="mt-1 text-sm text-[#4B5563]">
              {wo.assets.asset_code} — {wo.assets.asset_name}
              {wo.assets.location ? ` · ${wo.assets.location}` : ""}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs text-[#4B5563]">
            Created {formatDateValue(wo.created_at)}
            {wo.departments ? ` · ${wo.departments.name}` : ""}
          </p>
        </section>

        {/* ── Compact 7-stage stepper ───────────────────────────────────── */}
        {!isTerminal ? (
          <section className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-y-2">
              {DISPLAY_STAGES.map((stage, idx) => {
                const isDone = stageIndex > idx;
                const isCurrent = stageIndex === idx;
                return (
                  <div key={stage} className="flex shrink-0 items-center">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black leading-none ${
                        isCurrent
                          ? "bg-[#ED1C24] text-white"
                          : isDone
                            ? "bg-green-100 text-[#16A34A]"
                            : "bg-gray-100 text-[#9CA3AF]"
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <span className="shrink-0">{idx + 1}</span>
                      )}
                      {stage}
                    </span>
                    {idx < DISPLAY_STAGES.length - 1 ? (
                      <span
                        className={`mx-1 text-xs font-bold ${isDone ? "text-[#16A34A]" : "text-gray-300"}`}
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div
            className={`rounded-md border p-3 text-sm font-bold ${
              wo.status === "Rejected"
                ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]"
                : "border-[#E5E7EB] bg-gray-50 text-[#4B5563]"
            }`}
          >
            This repair order is {displayStatus(wo.status).toLowerCase()}.
          </div>
        )}

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <main className="space-y-5">

            {/* 1 — Asset Details (compact) */}
            {wo.assets ? (
              <section id="linked-asset" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Machine / equipment" title="Asset Details" icon={Cpu} />
                <div className="mt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-black text-[#111827]">
                        {wo.assets.asset_code} — {wo.assets.asset_name}
                      </p>
                      {(wo.assets.category || wo.assets.location) ? (
                        <p className="mt-0.5 text-sm text-[#4B5563]">
                          {[wo.assets.category, wo.assets.location].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge
                      label={wo.assets.status}
                      tone={wo.assets.status === "Breakdown" ? "red" : "green"}
                    />
                  </div>

                  {(wo.assets.condition || wo.assets.criticality) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {wo.assets.condition ? (
                        <StatusBadge label={wo.assets.condition} tone="gray" />
                      ) : null}
                      {wo.assets.criticality ? (
                        <StatusBadge
                          label={wo.assets.criticality}
                          tone={wo.assets.criticality === "Critical" ? "red" : "amber"}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {(wo.assets.brand || wo.assets.model || wo.assets.serial_number) ? (
                    <p className="mt-3 text-xs text-[#4B5563]">
                      {[
                        wo.assets.brand ? `Brand: ${wo.assets.brand}` : null,
                        wo.assets.model ? `Model: ${wo.assets.model}` : null,
                        wo.assets.serial_number ? `S/N: ${wo.assets.serial_number}` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <Link
                      href={`/assets/${wo.asset_id}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#ED1C24] hover:underline"
                    >
                      View asset profile
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </section>
            ) : null}

            {/* 2 — Problem Details */}
            <section id="problem" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Issue reported" title="Problem Details" icon={ClipboardList} />
              <div className="mt-5 space-y-4">
                {wo.operator_complaint ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Operator complaint</p>
                    <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 p-3 text-sm leading-6 text-[#111827]">
                      {wo.operator_complaint}
                    </p>
                  </div>
                ) : null}
                {wo.description_of_work ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Description of work required</p>
                    <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 p-3 text-sm leading-6 text-[#111827]">
                      {wo.description_of_work}
                    </p>
                  </div>
                ) : null}
                {wo.notes ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Notes</p>
                    <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 p-3 text-sm leading-6 text-[#111827]">
                      {wo.notes}
                    </p>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-3">
                  {wo.maintenance_type ? <InfoBlock label="Maintenance type" value={wo.maintenance_type} /> : null}
                  {wo.priority ? <InfoBlock label="Priority" value={wo.priority} /> : null}
                  {wo.ordered_by ? <InfoBlock label="Reported by" value={wo.ordered_by} /> : null}
                  {wo.date_of_order ? <InfoBlock label="Date of order" value={formatDateValue(wo.date_of_order)} /> : null}
                  {wo.job_location ? <InfoBlock label="Job location" value={wo.job_location} /> : null}
                  {wo.profiles ? <InfoBlock label="Supervisor" value={wo.profiles.full_name} /> : null}
                  {wo.plate_number ? <InfoBlock label="Plate number" value={wo.plate_number} /> : null}
                  {wo.serial_number ? <InfoBlock label="RO serial no." value={wo.serial_number} /> : null}
                  {wo.running_hours != null ? <InfoBlock label="Running hours" value={displayValue(wo.running_hours)} /> : null}
                  {wo.kilometers != null ? <InfoBlock label="Kilometers" value={displayValue(wo.kilometers)} /> : null}
                </div>
              </div>
            </section>

            {/* 3 — Technician Work (hidden when empty) */}
            {hasTechnicianContent ? (
              <section id="technicians" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Execution" title="Technician Work" icon={Wrench} />
                <div className="mt-5 space-y-4">
                  {(wo.starting_datetime || wo.ending_datetime) ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {wo.starting_datetime ? (
                        <InfoBlock label="Work started" value={formatDateTimeValue(wo.starting_datetime)} />
                      ) : null}
                      {wo.ending_datetime ? (
                        <InfoBlock label="Work completed" value={formatDateTimeValue(wo.ending_datetime)} />
                      ) : null}
                    </div>
                  ) : null}

                  {wo.work_order_assignments.length ? (
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Assignment</p>
                      <div className="mt-2 space-y-2">
                        {wo.work_order_assignments.map((a) => {
                          const isInternal = a.assignment_type === "INTERNAL_TECHNICIAN";
                          const isFreelancer = a.assignment_type === "FREELANCER";
                          const assignedAt = `Assigned ${formatDateTimeValue(a.assigned_at)} by ${actorName(a.assigned_by)}`;
                          if (isInternal) {
                            return (
                              <RecordLine
                                key={a.id}
                                title={`Internal: ${a.profiles?.full_name ?? "Unknown technician"}`}
                                detail={assignedAt}
                              />
                            );
                          }
                          if (isFreelancer) {
                            return (
                              <div key={a.id} className="rounded-md border border-[#E5E7EB] p-3 text-sm">
                                <p className="font-semibold text-[#111827]">Freelancer: {a.external_name}</p>
                                {a.external_trade ? <p className="text-[#4B5563]">Trade: {a.external_trade}</p> : null}
                                {a.external_phone ? <p className="text-[#4B5563]">Phone: {a.external_phone}</p> : null}
                                {a.external_expected_visit_date ? (
                                  <p className="text-[#4B5563]">
                                    Expected visit: {new Date(a.external_expected_visit_date).toLocaleDateString("en-GB")}
                                  </p>
                                ) : null}
                                {a.notes ? <p className="mt-1 text-xs text-[#9CA3AF]">{a.notes}</p> : null}
                                <p className="mt-1 text-xs text-[#9CA3AF]">{assignedAt}</p>
                              </div>
                            );
                          }
                          // EXTERNAL_COMPANY
                          return (
                            <div key={a.id} className="rounded-md border border-[#E5E7EB] p-3 text-sm">
                              <p className="font-semibold text-[#111827]">External Company: {a.external_company}</p>
                              {a.external_contact_person ? <p className="text-[#4B5563]">Contact: {a.external_contact_person}</p> : null}
                              {a.external_trade ? <p className="text-[#4B5563]">Service type: {a.external_trade}</p> : null}
                              {a.external_phone ? <p className="text-[#4B5563]">Phone: {a.external_phone}</p> : null}
                              {a.external_expected_visit_date ? (
                                <p className="text-[#4B5563]">
                                  Expected visit: {new Date(a.external_expected_visit_date).toLocaleDateString("en-GB")}
                                </p>
                              ) : null}
                              {a.notes ? <p className="mt-1 text-xs text-[#9CA3AF]">{a.notes}</p> : null}
                              <p className="mt-1 text-xs text-[#9CA3AF]">{assignedAt}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {wo.work_order_technician_notes.length ? (
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Technician notes</p>
                      <div className="mt-2 space-y-2">
                        {wo.work_order_technician_notes.map((note) => (
                          <RecordLine
                            key={note.id}
                            title={note.profiles.full_name}
                            detail={`${displayValue(note.labor_hours)} hours — ${note.note}`}
                            meta={formatDateTimeValue(note.created_at)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {wo.work_order_labor.length ? (
                    <div>
                      <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Labor records</p>
                      <Table
                        columns={
                          canViewCosts
                            ? ["Labor", "Technician", "Hours", "Rate (KWD)", "Amount (KWD)"]
                            : ["Labor", "Technician", "Hours"]
                        }
                        rows={wo.work_order_labor.map((row) =>
                          canViewCosts
                            ? [row.labor_name, row.profiles?.full_name ?? "-", displayValue(row.hours), money(row.rate), money(row.amount)]
                            : [row.labor_name, row.profiles?.full_name ?? "-", displayValue(row.hours)]
                        )}
                        empty="No labor rows recorded."
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* 4 — Materials */}
            <section id="parts" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeader eyebrow="Materials" title="Materials" icon={PackageSearch} />
                {canCreatePartsRequest && !["Closed", "Cancelled", "Rejected"].includes(wo.status) ? (
                  <Link
                    href={`/store/parts-requests/new?repair_order_id=${wo.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                  >
                    <PackageSearch className="h-4 w-4" aria-hidden="true" />
                    Request Materials
                  </Link>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <MetricCard label="Parts requests" value={wo.parts_requests.length} icon={PackageSearch} tone="blue" />
                <MetricCard
                  label="Open requests"
                  value={openPartsRequests}
                  icon={AlertTriangle}
                  tone={openPartsRequests ? "amber" : "green"}
                />
              </div>

              {wo.work_order_required_parts.length > 0 ? (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                    Required parts — listed at creation
                  </p>
                  <Table
                    columns={["Description", "Part no.", "Qty", "Unit", "Store status"]}
                    rows={wo.work_order_required_parts.map((row) => [
                      row.description,
                      row.part_number ?? "-",
                      row.quantity_required.toString(),
                      row.unit_of_measure,
                      <StatusBadge
                        key="status"
                        label={
                          row.availability_status === "unchecked" ? "Unchecked"
                          : row.availability_status === "available" ? "Available"
                          : row.availability_status === "partial" ? "Partial"
                          : row.availability_status === "unavailable" ? "Unavailable"
                          : row.availability_status
                        }
                        tone={
                          row.availability_status === "available" ? "green"
                          : row.availability_status === "unavailable" ? "red"
                          : row.availability_status === "partial" ? "amber"
                          : "gray"
                        }
                      />,
                    ])}
                    empty=""
                  />
                </div>
              ) : null}

              {wo.work_order_materials.length ? (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Materials used</p>
                  <Table
                    columns={
                      canViewCosts
                        ? ["Material", "Part no.", "SS rec", "Qty", "Amount (KWD)"]
                        : ["Material", "Part no.", "SS rec", "Qty"]
                    }
                    rows={wo.work_order_materials.map((row) =>
                      canViewCosts
                        ? [
                            row.material_name,
                            row.part_number ?? row.parts?.part_number ?? "-",
                            row.ss_rec_code ?? row.parts?.ss_rec_code ?? "-",
                            displayValue(row.quantity),
                            money(row.amount),
                          ]
                        : [
                            row.material_name,
                            row.part_number ?? row.parts?.part_number ?? "-",
                            row.ss_rec_code ?? row.parts?.ss_rec_code ?? "-",
                            displayValue(row.quantity),
                          ]
                    )}
                    empty="No material rows recorded."
                  />
                </div>
              ) : null}

              {canManage && !["Closed", "Cancelled", "Rejected"].includes(wo.status) ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">Record material used</p>
                  <form
                    action={addWorkOrderMaterialAction}
                    className="flex flex-wrap items-end gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-4"
                  >
                    <input type="hidden" name="work_order_id" value={wo.id} />
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Material *</label>
                      <input
                        name="material_name"
                        type="text"
                        required
                        placeholder="e.g. oil filter…"
                        className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="w-36 shrink-0">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Part No.</label>
                      <input
                        name="part_number_free"
                        type="text"
                        placeholder="optional"
                        className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity *</label>
                      <input
                        type="number"
                        name="quantity"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="0"
                        className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <Button type="submit" variant="secondary" className="shrink-0">Record</Button>
                  </form>
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {wo.parts_requests.length ? (
                  wo.parts_requests.map((request) => (
                    <Link
                      key={request.id}
                      href={`/store/parts-requests/${request.id}`}
                      className="block rounded-md border border-[#E5E7EB] p-4 transition hover:border-[#ED1C24]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-black text-[#111827]">{request.parts_request_number ?? "Parts request"}</p>
                          <p className="mt-1 text-sm text-[#4B5563]">
                            {request.remarks || "No remarks"} — {request.parts_request_items.length} items
                          </p>
                        </div>
                        <StatusBadge label={request.status} tone={statusTone(request.status)} />
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <p className="text-sm font-semibold text-[#111827]">No materials requested yet.</p>
                    <p className="text-xs text-[#4B5563]">Request materials for this job card.</p>
                    {canCreatePartsRequest && !["Closed", "Cancelled", "Rejected"].includes(wo.status) ? (
                      <Link
                        href={`/store/parts-requests/new?repair_order_id=${wo.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                      >
                        <PackageSearch className="h-4 w-4" aria-hidden="true" />
                        Request Materials
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            {/* 5 — Attachments & Photos (merged) */}
            <section id="attachments" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Photos &amp; Documents" title="Attachments &amp; Photos" icon={Paperclip} />

              <div className="mt-5">
                {signedAttachments.length > 0 ? (
                  <div className="divide-y divide-[#E5E7EB]">
                    {signedAttachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[#111827]">
                            <Paperclip className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-[#111827]">{file.label}</p>
                            <p className="text-sm text-[#4B5563]">{file.fileName}</p>
                          </div>
                        </div>
                        {file.signedUrl ? (
                          <Link className="shrink-0 text-sm font-bold text-[#ED1C24]" href={file.signedUrl} target="_blank">
                            View file
                          </Link>
                        ) : (
                          <span className="text-sm text-[#4B5563]">Signed link unavailable</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#4B5563]">No files uploaded yet.</p>
                )}
              </div>

              {canUploadFiles ? (
                <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                  <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">Upload file or photo</p>
                  <form
                    action={uploadWorkOrderFileAction}
                    className="grid gap-3 sm:grid-cols-[180px_1fr_auto]"
                  >
                    <input type="hidden" name="work_order_id" value={wo.id} />
                    <input type="hidden" name="return_to" value={`/maintenance/work-orders/${wo.id}`} />
                    <select
                      name="attachment_type"
                      className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    >
                      {["Complaint Photo", "Before Repair Photo", "After Repair Photo", "Damaged Part Photo", "Meter Photo", "Document"].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <input
                      required
                      type="file"
                      name="file"
                      className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                      accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx"
                    />
                    <Button type="submit">Upload</Button>
                  </form>
                  <p className="mt-3 text-xs text-[#4B5563]">
                    Accepted formats: PDF, JPG, PNG, XLS, XLSX, DOC, DOCX.
                  </p>
                </div>
              ) : null}
            </section>
          </main>

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <aside className="space-y-5">
            {/* Current Action (shows context for all users; action buttons for managers/supervisors) */}
            <WorkflowActions workOrderId={wo.id} status={wo.status} context={context} technicians={technicians} currentAssignment={currentAssignment} />

            {/* Quick Facts */}
            <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Quick Facts</p>
              <dl className="mt-3 space-y-3 text-sm">
                <InfoLine label="Status" value={<StatusBadge label={displayStatus(wo.status)} tone={statusTone(wo.status)} />} />
                <InfoLine label="Priority" value={<StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />} />
                {wo.maintenance_type ? <InfoLine label="Type" value={wo.maintenance_type} /> : null}
                {wo.ordered_by ? <InfoLine label="Reported by" value={wo.ordered_by} /> : null}
                <InfoLine label="Created" value={formatDateValue(wo.created_at)} />
                <InfoLine
                  label="Technician"
                  value={
                    wo.work_order_assignments.length > 0
                      ? wo.work_order_assignments.map((a) => a.profiles?.full_name ?? "—").join(", ")
                      : "Not assigned"
                  }
                />
                {wo.assets ? (
                  <InfoLine label="Asset" value="View profile" href={`/assets/${wo.asset_id}`} />
                ) : null}
              </dl>
            </section>

            <QrLinkCard title="Repair order QR" href={`/maintenance/work-orders/${wo.id}`} />
          </aside>
        </div>

        {/* ── Activity Timeline — bottom accordion ─────────────────────────── */}
        <section id="timeline" className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <details open>
            <summary className="flex cursor-pointer select-none items-center gap-3 p-5 hover:bg-gray-50">
              <div className="rounded-md bg-[#111827] p-2 text-white">
                <History className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">History</p>
                <h2 className="text-lg font-black text-[#111827]">Activity Timeline</h2>
              </div>
            </summary>
            <div className="space-y-3 border-t border-[#E5E7EB] p-5">
              {timeline.length ? (
                timeline.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-md border border-[#E5E7EB] p-4 md:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <div>
                      <StatusBadge label={item.label} tone={item.tone} />
                      <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                        {formatDateTimeValue(item.at)}
                      </p>
                    </div>
                    <div>
                      <p className="font-black text-[#111827]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#4B5563]">{item.detail}</p>
                      <p className="mt-2 text-xs font-bold text-[#4B5563]">{item.actor || "System"}</p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No activity recorded yet."
                  message="Status changes, technician assignments, materials requests, uploads, and work updates will appear here."
                />
              )}
            </div>
          </details>

          {canManage && auditLogs.length > 0 ? (
            <details className="border-t border-[#E5E7EB]">
              <summary className="flex cursor-pointer select-none items-center gap-2 p-5 hover:bg-gray-50">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">System Audit</p>
                  <h3 className="text-base font-black text-[#111827]">
                    Audit Details ({auditLogs.length} records)
                  </h3>
                </div>
              </summary>
              <div className="space-y-2 border-t border-[#E5E7EB] p-5">
                {auditLogs.slice(0, 15).map((log) => (
                  <RecordLine
                    key={log.id}
                    title={log.action}
                    detail={log.summary}
                    meta={`${actorName(log.actor_id)} — ${formatDateTimeValue(log.created_at)}`}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </section>
      </div>
    </>
  );
}

// ── Timeline builder ──────────────────────────────────────────────────────────

function buildTimeline(
  wo: WorkOrderControl,
  auditLogs: Array<{
    id: string;
    action: string;
    summary: string;
    created_at: Date;
    actor_id: string | null;
  }>,
  actorName: (id?: string | null) => string
): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `created-${wo.id}`,
      at: wo.created_at,
      title: `Created ${wo.work_order_number ?? "work order"}`,
      detail: wo.operator_complaint || wo.description_of_work || "Work order was created.",
      actor: actorName(wo.created_by),
      tone: "blue",
      label: "Created",
    },
    ...wo.work_order_status_history.map((item) => ({
      id: `status-${item.id}`,
      at: item.changed_at,
      title: item.from_status
        ? `${displayStatus(item.from_status)} → ${displayStatus(item.to_status)}`
        : displayStatus(item.to_status),
      detail: item.notes || "Status updated.",
      actor: actorName(item.changed_by),
      tone: statusTone(item.to_status),
      label: "Status",
    })),
    ...wo.work_order_assignments.map((item) => ({
      id: `assignment-${item.id}`,
      at: item.assigned_at,
      title: `Assigned to ${item.profiles?.full_name ?? "technician"}`,
      detail: item.notes || "Technician assignment recorded.",
      actor: actorName(item.assigned_by),
      tone: "blue" as BadgeTone,
      label: "Assign",
    })),
    ...wo.work_order_technician_notes.map((item) => ({
      id: `tech-note-${item.id}`,
      at: item.created_at,
      title: `Technician update by ${item.profiles.full_name}`,
      detail: `${displayValue(item.labor_hours)} labor hours. ${item.note}`,
      actor: item.profiles.full_name,
      tone: "gray" as BadgeTone,
      label: "Tech",
    })),
    ...wo.parts_requests.map((item) => ({
      id: `parts-request-${item.id}`,
      at: item.created_at,
      title: `Parts request ${item.parts_request_number ?? ""}`.trim(),
      detail: `${item.status}. ${item.remarks || "No remarks."}`,
      actor:
        item.profiles_parts_requests_prepared_byToprofiles?.full_name ??
        actorName(item.created_by),
      tone: statusTone(item.status),
      label: "Parts",
    })),
    ...wo.work_order_attachments.map((item) => ({
      id: `attachment-${item.id}`,
      at: item.created_at,
      title: `${item.attachment_type} uploaded`,
      detail: item.file_name,
      actor: actorName(item.uploaded_by),
      tone: "gray" as BadgeTone,
      label: "File",
    })),
    ...wo.inventory_movements.map((item) => ({
      id: `inventory-${item.id}`,
      at: item.created_at,
      title: `${item.movement_type} stock movement`,
      detail: `${item.parts.part_name} — quantity ${displayValue(item.quantity)}. ${item.comments || ""}`,
      actor: actorName(item.created_by),
      tone: "blue" as BadgeTone,
      label: "Stock",
    })),
  ];

  return items.sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-[#111827] p-2 text-white">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-black text-[#111827]">{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone: BadgeTone;
}) {
  const toneClass = {
    green: "bg-[#16A34A]",
    amber: "bg-[#F59E0B]",
    red: "bg-[#ED1C24]",
    blue: "bg-[#2563EB]",
    gray: "bg-[#111827]",
  }[tone];

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4">
      <div className={`inline-flex rounded-md p-2 text-white ${toneClass}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-[#111827]">{value}</p>
    </div>
  );
}

function InfoLine({
  label,
  value,
  href,
}: {
  label: string;
  value: ReactNode;
  href?: string;
}) {
  const content = <span className="font-bold text-[#111827]">{value}</span>;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F6] pb-2 last:border-b-0 last:pb-0">
      <dt className="text-[#4B5563]">{label}</dt>
      <dd className="text-right">
        {href ? (
          <Link
            className="inline-flex items-center gap-1 text-[#ED1C24] hover:text-[#c9151c]"
            href={href}
          >
            {content}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : (
          content
        )}
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

function RecordLine({ title, detail, meta }: { title: string; detail: string; meta?: string }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="font-bold text-[#111827]">{title}</p>
      <p className="mt-1 text-sm leading-5 text-[#4B5563]">{detail}</p>
      {meta ? <p className="mt-2 text-xs font-semibold text-[#4B5563]">{meta}</p> : null}
    </div>
  );
}

function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-3 align-top">{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-4 text-[#4B5563]" colSpan={columns.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Utility functions ─────────────────────────────────────────────────────────

function priorityTone(priority: string): BadgeTone {
  if (priority === "Urgent") return "red";
  if (priority === "High") return "amber";
  if (priority === "Low") return "gray";
  return "blue";
}

function statusTone(status: string): BadgeTone {
  if (
    ["Closed", "Verified", "Verified by Supervisor", "Confirmed by Requester", "Approved", "Issued", "Received"].includes(status)
  )
    return "green";
  if (
    status.includes("Waiting") ||
    status.includes("Pending") ||
    status === "Submitted" ||
    status === "Partially Issued"
  )
    return "amber";
  if (["Rejected", "Cancelled", "Failed"].includes(status)) return "red";
  return "blue";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "0.000";
  return Number(value).toFixed(3);
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
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanizeError(code: string) {
  const map: Record<string, string> = {
    "not-editable":
      "This work order cannot be edited in its current status. Only Draft and Rejected orders can be updated through the form.",
    "not-found": "This work order could not be found.",
    "invalid-input": "Some required fields are missing or invalid. Please check and try again.",
    "save-failed": "Changes could not be saved. Please try again.",
    "invalid-status": "The requested status change is not allowed.",
    "clarification-question-too-short": "The clarification question must be at least 10 characters.",
    "clarification-response-too-short": "The clarification response must be at least 10 characters.",
  };
  return map[code] ?? code;
}
