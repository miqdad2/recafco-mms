import Link from "next/link";
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
import { uploadWorkOrderFileAction, deleteWorkOrderAttachmentAction } from "@/app/actions/files";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowActions } from "@/components/work-orders/workflow-actions";
import { CorrectionRequestSentModal } from "@/components/work-orders/correction-request-sent-modal";
import { JobCardClosedModal } from "@/components/work-orders/job-card-closed-modal";
import { JobCardSubmittedModal } from "@/components/work-orders/job-card-submitted-modal";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewCosts as canViewCostsForContext, hasPermission } from "@/lib/security/permissions";
import { canViewEntityFile } from "@/lib/security/file-access";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  displaySimplifiedStatus,
  simplifiedStatusTone,
  NEEDS_UPDATE_LABEL,
  NEEDS_UPDATE_TONE,
} from "@/lib/work-orders/simplified-status";
import { displayPartsRequestStatus, partsRequestStatusTone } from "@/lib/display/parts-request-labels";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Must match the AppError message thrown by assertNoActiveDuplicateMaterialsRequest
// (lib/backend/parts-requests/repository.ts) exactly — used to detect this
// specific failure so the banner can link straight to the blocking request
// (Maintenance Workflow Redesign Unit 8 Task 6).
const DUPLICATE_MATERIALS_REQUEST_ERROR =
  "This Job Card already has an active Materials Request. Please update the existing request instead.";
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

// ── Simplified 5-stage display tracker ────────────────────────────────────────

// Job Card Status Simplification Task: the stepper mirrors the five plain
// user-facing statuses everywhere else (Draft/Submitted/Approved/Active/
// Closed) — "Open" is now split into "Approved" and "Active", and a pending
// correction is no longer a stage swap ("Correction Requested" retired as a
// primary value); it's shown as a small "Needs Update" chip next to whatever
// the current stage already is, since a correction is a loop back onto that
// same stage, not further progress.
const DISPLAY_STAGES = ["Draft", "Submitted", "Approved", "Active", "Closed"] as const;

function statusToStageIndex(status: string): number {
  const simplified = displaySimplifiedStatus(status);
  switch (simplified) {
    case "Draft":
      return 0;
    case "Submitted":
      return 1;
    case "Approved":
      return 2;
    case "Active":
      return 3;
    case "Closed":
      return 4;
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
  searchParams: Promise<{ error?: string; success?: string; warning?: string; kind?: string }>;
}) {
  const context = await requirePermission("work_orders.view");
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const errorMessage = resolvedSearch.error;
  const warningMessage = resolvedSearch.warning;
  const successMessage = resolvedSearch.success;
  const successKind = resolvedSearch.kind === "materials" ? "materials" : "correction";
  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  // Look up by id first (the normal case). If that doesn't resolve, fall
  // back to a job-number match — `id` is `@db.Uuid`, so only attempt the
  // id-based lookup when the param is actually UUID-shaped, otherwise Prisma
  // throws a validation error instead of returning null (Route Detail Fix
  // Unit 1 Task 5). Job numbers are stored with "/" (e.g. "REC/MD/MECH/JOB/0013")
  // but a URL path segment can't contain a literal "/", so the fallback also
  // accepts the dash-separated form (e.g. "REC-MD-MECH-JOB-0013").
  const isUuid = UUID_RE.test(id);
  let wo = isUuid
    ? await prisma.work_orders.findFirst({
        where: { AND: [{ id }, { deleted_at: null }, visibilityFilter] },
        include: workOrderControlInclude,
      })
    : null;
  if (!wo) {
    wo = await prisma.work_orders.findFirst({
      where: {
        AND: [
          { work_order_number: { equals: id.replace(/-/g, "/"), mode: "insensitive" } },
          { deleted_at: null },
          visibilityFilter,
        ],
      },
      include: workOrderControlInclude,
    });
  }

  if (!wo) {
    return (
      <>
        <PageHeader
          title="Job Card not found"
          breadcrumb={
            <PageBreadcrumb items={[{ label: "Job Cards", href: "/maintenance/work-orders" }, { label: "Job Card Details" }]} />
          }
        />
        <div className="p-4 lg:p-6">
          <EmptyState
            title="Job Card not found"
            message="This Job Card may have been deleted, moved, or you may not have permission to view it."
            action={<BackLink href="/maintenance/work-orders" label="Back to Job Cards" />}
          />
        </div>
      </>
    );
  }

  // Unit 7: linked Materials Request ids, needed to batch-fetch their audit
  // trail and any Offline Inventory movements tied to them (Task 4/5/8 —
  // single round-trip, no N+1 per request/movement).
  const linkedPartsRequestIds = wo.parts_requests.map((pr) => pr.id);

  // Unit 8 Task 6: when creation fails with the duplicate-active-request
  // error, link straight to the request that's blocking it. wo.parts_requests
  // is already loaded above (no extra query needed).
  const activeMaterialsRequest =
    wo.parts_requests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;

  // Store Send Materials Approval Gate Unit Task 5: an active/open request
  // already exists -> View Materials, never a second "Request Materials"
  // button (the backend already blocks a duplicate active request; this
  // avoids the user hitting that error in the first place). Once a request
  // has fully Issued at least once, a fresh request is a deliberate "more
  // materials needed" case, so it's worded "Request Extra Materials" rather
  // than the first-time "Request Materials" (matches the wording already
  // used on the Technician's own job page).
  const hasIssuedMaterialsRequest = wo.parts_requests.some((pr) => pr.status === "Issued");
  const materialsButtonLabel = activeMaterialsRequest
    ? "View Materials"
    : hasIssuedMaterialsRequest
      ? "Request Extra Materials"
      : "Request Materials";
  const materialsButtonHref = activeMaterialsRequest
    ? `/store/parts-requests/${activeMaterialsRequest.id}`
    : `/store/parts-requests/new?repair_order_id=${wo.id}`;

  const [auditLogs, partsRequestAuditLogs, offlineMovements, pendingClarification, technicians] = await Promise.all([
    prisma.audit_logs.findMany({
      where: { entity_type: "work_order", entity_id: wo.id },
      orderBy: { created_at: "desc" },
      take: 30,
    }),
    linkedPartsRequestIds.length
      ? prisma.audit_logs.findMany({
          where: { entity_type: "parts_request", entity_id: { in: linkedPartsRequestIds } },
          orderBy: { created_at: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    // OPENING_STOCK is never linked to a specific Job Card (related_work_order_id
    // is always null for it), so excluding it here also naturally excludes it —
    // no separate "unrelated movement" filtering needed (Task 5).
    prisma.offline_inventory_movements.findMany({
      where: {
        deleted_at: null,
        movement_type: { not: "OPENING_STOCK" },
        OR: [
          { related_work_order_id: wo.id },
          ...(linkedPartsRequestIds.length ? [{ parts_request_id: { in: linkedPartsRequestIds } }] : [])
        ]
      },
      orderBy: { created_at: "desc" },
    }),
    getPendingClarificationForWorkOrder(wo.id),
    prisma.profiles.findMany({
      where: { is_active: true, deleted_at: null },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
  ]);

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
    ...partsRequestAuditLogs.map((item) => item.actor_id),
    ...offlineMovements.map((item) => item.created_by),
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
  const hasPendingCorrection = pendingClarification !== null;
  const canRespondToClarification =
    hasPendingCorrection &&
    (isCreator || canManage || context.role?.slug === "super_admin");
  const canCreatePartsRequest = hasPermission(context, "parts_requests.create");
  const canUploadFiles = hasPermission(context, "files.upload");
  const canDeleteFiles =
    context.role?.slug === "super_admin" ||
    (hasPermission(context, "files.upload") &&
      (hasPermission(context, "work_orders.manage") || hasPermission(context, "technician.jobs.update")));

  const canViewFiles = await canViewEntityFile(context, "work-order-files", wo.id);
  const signedAttachments = await Promise.all(
    wo.work_order_attachments.map(async (attachment) => ({
      id: attachment.id,
      label: attachment.attachment_type,
      fileName: attachment.file_name,
      contentType: attachment.content_type ?? "",
      fileSize: attachment.file_size ?? 0,
      signedUrl: canViewFiles
        ? await createSignedFileUrl("work-order-files", attachment.file_path)
        : null,
      uploadedByName: actorName(attachment.uploaded_by),
      createdAt: attachment.created_at.toISOString(),
    }))
  );

  const timeline = buildTimeline(wo, auditLogs, partsRequestAuditLogs, offlineMovements, actorName);
  // Unit 7: System Audit (manager-only, technical) now also includes the
  // linked Materials Requests' raw audit trail, not just the Job Card's own —
  // merged and re-sorted since they were fetched as two separate queries.
  const systemAuditLogs = [...auditLogs, ...partsRequestAuditLogs].sort(
    (a, b) => b.created_at.getTime() - a.created_at.getTime()
  );
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
    const raw = wo.operator_complaint || wo.description_of_work || "Job Card";
    return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  })();

  return (
    <>
      <AutoRefresh intervalMs={20000} enabled={!isTerminal} />
      <RealtimeRefresh
        watch={["job_card.", "work_order.", "materials_request.", "store_materials.", "technician_job."]}
        enabled={!isTerminal}
      />
      {successMessage === "clarification-sent" && (
        <CorrectionRequestSentModal
          jobCardId={wo.id}
          jobCardNumber={wo.work_order_number}
          question={pendingClarification?.question ?? null}
          kind={successKind}
          dismissHref={`/maintenance/work-orders/${wo.id}`}
        />
      )}
      {successMessage === "job-card-closed" && (
        <JobCardClosedModal
          jobCardId={wo.id}
          jobCardNumber={wo.work_order_number}
          dismissHref={`/maintenance/work-orders/${wo.id}`}
        />
      )}
      {/* Draft Submit UX Cleanup Task 5 (Option A): the same success popup
          used by the quick-view's Submit for Review — submitWorkOrderAction
          falls back to this same detail-page URL (self-redirect) when
          submitted from the detail page's own WorkflowActions form, which
          carries no return_to/return_to_param. "View Job Card" is hidden
          since it would just reload the page already showing. */}
      {successMessage === "job-card-submitted" && (
        <JobCardSubmittedModal
          data={{
            id: wo.id,
            work_order_number: wo.work_order_number,
            operator_complaint: wo.operator_complaint,
            description_of_work: wo.description_of_work,
            assets: wo.assets ? { asset_code: wo.assets.asset_code, asset_name: wo.assets.asset_name } : null,
            all_parts_requests: wo.parts_requests.map((pr) => ({
              id: pr.id,
              parts_request_number: pr.parts_request_number,
              status: pr.status,
              items: pr.parts_request_items.map((item) => ({
                id: item.id,
                description: item.description,
                quantity_requested: Number(item.quantity_requested),
              })),
            })),
          }}
          dismissHref={`/maintenance/work-orders/${wo.id}`}
          hideViewJobCard
        />
      )}
      <PageHeader
        title={wo.work_order_number ?? "Job Card"}
        description={summaryTitle.length > 80 ? summaryTitle.slice(0, 80) + "…" : summaryTitle}
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Job Cards", href: "/maintenance/work-orders" }, { label: "Job Card Details" }]} />
        }
        actions={
          <>
            <BackLink href="/maintenance/work-orders" label="Back to Job Cards" />
            {canPrint ? (
              <Link href={`/maintenance/work-orders/${wo.id}/print`}>
                <Button variant="secondary">
                  <Printer className="h-4 w-4" /> Print
                </Button>
              </Link>
            ) : null}
            {/* New Job Card Wizard Cleanup + Draft/Material Submit Fix Task 5:
                this gate checked the pre-Unit3 status names ("Draft"/"Rejected"),
                which no longer exist in the simplified workflow (status-rules.ts
                renamed them to "Created"/"Under Review") — no current Job Card
                could ever match, so a saved draft had no way back into its own
                edit form (the only reachable action was blind Submit). Matches
                EDITABLE_STATUSES in upsertWorkOrderAction exactly. */}
            {canManage && ["Created", "Under Review"].includes(wo.status) ? (
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
            {errorMessage === DUPLICATE_MATERIALS_REQUEST_ERROR && activeMaterialsRequest ? (
              <Link
                href={`/store/parts-requests/${activeMaterialsRequest.id}`}
                className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[#ED1C24] hover:underline"
              >
                Open Existing Materials Request <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
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
        {warningMessage === "attachments-failed" ? (
          <div className="rounded-md border border-[#F59E0B] bg-amber-50 p-4">
            <p className="text-sm font-black text-[#92400E]">
              Job Card created, but some attachments failed to upload
            </p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              The job card was saved successfully. You can upload the missing files again from
              Attachments below.
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
        {/* Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/8:
            the Confirm Review submit used to redirect here with no visible
            confirmation at all — this makes the outcome unambiguous. */}
        {successMessage === "reviewed" ? (
          <div className="rounded-md border border-[#16A34A] bg-green-50 p-4">
            <p className="text-sm font-black text-[#16A34A]">Job Card reviewed</p>
            <p className="mt-1 text-sm leading-5 text-[#4B5563]">
              {wo.work_order_number ?? "This Job Card"} reviewed successfully. Next step: Waiting Supervisor / Manager Review.
            </p>
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

        {/* ── Correction Requested banner ─────────────────────────────────── */}
        {pendingClarification ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-black text-red-800">Correction Requested</p>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-red-700">
                Waiting on Data Entry
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-5 text-[#111827]">
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
                  className="focus-ring min-h-24 w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm"
                  name="response"
                  placeholder="Describe what you corrected or updated (required, min 10 characters)"
                  required
                  minLength={10}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit">Submit Response &amp; Resubmit</Button>
                  {canCreatePartsRequest && !activeMaterialsRequest && (
                    <Link
                      href={`/store/parts-requests/new?repair_order_id=${wo.id}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#ED1C24] hover:underline"
                    >
                      Add Materials <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  <p className="text-xs text-[#4B5563]">Submitting sends this back to Supervisor / Manager for review.</p>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-xs text-[#4B5563]">
                Waiting on the Job Card creator to respond to this request.
              </p>
            )}
          </div>
        ) : null}

        {/* ── Identity summary strip ───────────────────────────────────────── */}
        <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const simplified = displaySimplifiedStatus(wo.status);
              return <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />;
            })()}
            {hasPendingCorrection && (
              <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
            )}
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

        {/* ── Compact 5-stage stepper ───────────────────────────────────── */}
        {!isTerminal ? (
          <section className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-y-2">
              {DISPLAY_STAGES.map((stage, idx) => {
                const isDone = stageIndex > idx;
                const isCurrent = stageIndex === idx;
                // A pending correction no longer swaps the current stage's
                // own label/color — it's a loop back onto whatever stage the
                // Job Card is already at, shown as a small "Needs Update"
                // chip next to that stage instead of a separate 6th stage.
                const showNeedsUpdate = isCurrent && hasPendingCorrection;
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
                    {showNeedsUpdate && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black leading-none text-amber-800">
                        {NEEDS_UPDATE_LABEL}
                      </span>
                    )}
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
          <div className="rounded-md border border-[#E5E7EB] bg-gray-50 p-3 text-sm font-bold text-[#4B5563]">
            This Job Card is {displaySimplifiedStatus(wo.status).toLowerCase()}.
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
                <div className="grid gap-3 md:grid-cols-3">
                  {wo.maintenance_type ? <InfoBlock label="Maintenance type" value={wo.maintenance_type} /> : null}
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
                    <div id="assignment">
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
                    href={materialsButtonHref}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                  >
                    <PackageSearch className="h-4 w-4" aria-hidden="true" />
                    {materialsButtonLabel}
                  </Link>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <MetricCard label="Materials requests" value={wo.parts_requests.length} icon={PackageSearch} tone="blue" />
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
                    Required materials — listed at creation
                  </p>
                  <Table
                    columns={["Material Name / Description", "Part No. / Code", "Qty", "Unit", "Materials status"]}
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
                          <p className="font-black text-[#111827]">{request.parts_request_number ?? "Materials Request"}</p>
                          <p className="mt-1 text-sm text-[#4B5563]">
                            {request.remarks || "No remarks"} — {request.parts_request_items.length} items
                          </p>
                        </div>
                        <StatusBadge
                          label={displayPartsRequestStatus(request.status)}
                          tone={partsRequestStatusTone(request.status)}
                        />
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

            {/* 5 — Attachments */}
            <section id="attachments" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Files" title="Attachments" icon={Paperclip} />

              {/* File list */}
              <div className="mt-5">
                {signedAttachments.length > 0 ? (
                  <div className="divide-y divide-[#E5E7EB]">
                    {signedAttachments.map((file) => {
                      const isPhoto = file.contentType.startsWith("image/");
                      return (
                        <div
                          key={file.id}
                          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[#111827]">
                              <Paperclip className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#111827]">{file.label}</p>
                              <p className="truncate text-sm text-[#4B5563]">{file.fileName}</p>
                              <p className="mt-0.5 text-xs text-[#9CA3AF]">
                                {isPhoto ? "Photo" : "Document"} · Uploaded by {file.uploadedByName} · {file.createdAt.slice(0, 10)}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            {file.signedUrl ? (
                              <>
                                <Link className="text-sm font-bold text-[#ED1C24] hover:underline" href={file.signedUrl} target="_blank">
                                  View
                                </Link>
                                <Link className="text-sm font-bold text-[#4B5563] hover:underline" href={`${file.signedUrl}?download=1`} download>
                                  Download
                                </Link>
                              </>
                            ) : (
                              <span className="text-sm text-[#9CA3AF]">Access restricted</span>
                            )}
                            {canDeleteFiles && (
                              <form action={deleteWorkOrderAttachmentAction}>
                                <input type="hidden" name="attachment_id" value={file.id} />
                                <input type="hidden" name="work_order_id" value={wo.id} />
                                <input type="hidden" name="return_to" value={`/maintenance/work-orders/${wo.id}`} />
                                <button type="submit" className="text-sm text-red-500 hover:text-red-700 hover:underline">
                                  Delete
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[#4B5563]">No files uploaded yet.</p>
                )}
              </div>

              {/* Upload forms */}
              {canUploadFiles && (
                <div className="mt-5 space-y-4 border-t border-[#E5E7EB] pt-4">
                  <p className="text-xs text-[#4B5563]">
                    Upload PDFs, Excel files, Word documents, or photos. On mobile, you can take a live photo.
                  </p>

                  {/* Upload File */}
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Upload File</p>
                    <form action={uploadWorkOrderFileAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                      <input type="hidden" name="work_order_id" value={wo.id} />
                      <input type="hidden" name="return_to" value={`/maintenance/work-orders/${wo.id}#attachments`} />
                      <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                        {[
                          "Problem Photo",
                          "Before Repair Photo",
                          "After Repair Photo",
                          "Technician Work Photo",
                          "Inspection Report",
                          "Service Report",
                          "Quotation",
                          "Invoice",
                          "Other Document",
                        ].map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <input
                        required
                        type="file"
                        name="file"
                        className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                      />
                      <Button type="submit">Upload File</Button>
                    </form>
                  </div>

                  {/* Take Photo — camera-targeted on mobile */}
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Take Photo</p>
                    <form action={uploadWorkOrderFileAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                      <input type="hidden" name="work_order_id" value={wo.id} />
                      <input type="hidden" name="return_to" value={`/maintenance/work-orders/${wo.id}#attachments`} />
                      <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                        {[
                          "Problem Photo",
                          "Before Repair Photo",
                          "After Repair Photo",
                          "Technician Work Photo",
                          "Inspection Report",
                          "Other Document",
                        ].map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <input
                        required
                        type="file"
                        name="file"
                        accept="image/*"
                        capture="environment"
                        className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                      />
                      <Button type="submit">Take Photo</Button>
                    </form>
                  </div>

                  <p className="text-xs text-[#9CA3AF]">
                    Accepted: PDF, JPG, PNG, WEBP, XLS, XLSX, DOC, DOCX · Max 10 MB per file
                  </p>
                </div>
              )}
            </section>
          </main>

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <aside className="space-y-5">
            {/* Current Action (shows context for all users; action buttons for managers/supervisors) */}
            <WorkflowActions
              workOrderId={wo.id}
              status={wo.status}
              context={context}
              technicians={technicians}
              currentAssignment={currentAssignment}
              activeMaterialsRequest={
                activeMaterialsRequest
                  ? { id: activeMaterialsRequest.id, number: activeMaterialsRequest.parts_request_number, status: activeMaterialsRequest.status }
                  : null
              }
              hasPendingCorrection={hasPendingCorrection}
            />

            {/* Quick Facts */}
            <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Quick Facts</p>
              <dl className="mt-3 space-y-3 text-sm">
                <InfoLine label="Status" value={(() => {
                  const simplified = displaySimplifiedStatus(wo.status);
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />
                      {hasPendingCorrection && (
                        <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
                      )}
                    </div>
                  );
                })()} />
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

            <QrLinkCard title="Job Card QR" href={`/maintenance/work-orders/${wo.id}`} />
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

          {canManage && systemAuditLogs.length > 0 ? (
            <details className="border-t border-[#E5E7EB]">
              <summary className="flex cursor-pointer select-none items-center gap-2 p-5 hover:bg-gray-50">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">System Audit</p>
                  <h3 className="text-base font-black text-[#111827]">
                    Audit Details ({systemAuditLogs.length} records)
                  </h3>
                </div>
              </summary>
              <div className="space-y-2 border-t border-[#E5E7EB] p-5">
                {systemAuditLogs.slice(0, 15).map((log) => (
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

// Maintenance Workflow Redesign Unit 7 — statuses reachable under the
// simplified model. Any work_order_status_history row whose to_status falls
// outside this set is pre-redesign history with no matching semantic audit
// log action (Task 6) — shown as a neutral "Legacy status update" fallback
// instead of guessing at a clean title for it.
const NEW_JOB_CARD_STATUSES = new Set([
  "Created", "Under Review", "Approved", "Waiting Materials", "Partially Issued",
  "Materials Issued", "Assigned", "In Progress", "Closed"
]);

function metaGet(metadata: unknown, key: string): string | undefined {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === "") return undefined;
    return String(value);
  }
  return undefined;
}

type AuditLogRow = { id: string; action: string; summary: string; created_at: Date; actor_id: string | null; entity_id: string | null; metadata: unknown };
type OfflineMovementRow = {
  id: string;
  movement_type: string;
  quantity: Prisma.Decimal | number;
  unit: string;
  manual_material_name: string | null;
  counterparty: string | null;
  parts_request_id: string | null;
  created_by: string;
  created_at: Date;
};

/**
 * Builds the staff-facing Activity Timeline. Job Card lifecycle events
 * (submit/review/correction/approve/start/close) come primarily from
 * audit_logs (entity_type="work_order") rather than work_order_status_history,
 * because Unit 4's no-op review/correction actions never change status (so
 * they never produce a status_history row at all — audit_logs is the only
 * record of them) and because audit_logs carries the actual human-entered
 * comments/reasons, while the DB trigger only writes a generic "Status
 * updated" note. Materials Request and Offline Inventory activity from every
 * linked request appear inline (Task 4/5) — Job Card is the parent, so its
 * timeline is the one place staff need to look.
 */
function buildTimeline(
  wo: WorkOrderControl,
  auditLogs: AuditLogRow[],
  partsRequestAuditLogs: AuditLogRow[],
  offlineMovements: OfflineMovementRow[],
  actorName: (id?: string | null) => string
): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `created-${wo.id}`,
      at: wo.created_at,
      title: "Job Card created",
      detail: wo.operator_complaint || wo.description_of_work || "Job Card created.",
      actor: actorName(wo.created_by),
      tone: "blue",
      label: "Job Card",
    },
  ];

  // ── Job Card lifecycle (submit/review/correction/approve/start/close) ──────
  for (const log of auditLogs) {
    const entry = jobCardAuditEntry(log, actorName);
    if (entry) items.push(entry);
  }

  // ── Legacy fallback for pre-redesign status history ─────────────────────────
  for (const item of wo.work_order_status_history) {
    if (NEW_JOB_CARD_STATUSES.has(item.to_status)) continue; // covered by a semantic audit entry above
    items.push({
      id: `status-legacy-${item.id}`,
      at: item.changed_at,
      title: "Legacy status update",
      detail: item.from_status ? `${item.from_status} → ${item.to_status}` : item.to_status,
      actor: actorName(item.changed_by),
      tone: "gray",
      label: "Job Card",
    });
  }

  // ── Assignment (current assignment only — reassignment replaces the row) ───
  for (const item of wo.work_order_assignments) {
    const { assigneeName, typeLabel } = describeAssignee(item);
    items.push({
      id: `assignment-${item.id}`,
      at: item.assigned_at,
      title: `Assigned to ${assigneeName} (${typeLabel})`,
      detail: item.notes || "Assignment recorded.",
      actor: actorName(item.assigned_by),
      tone: "blue",
      label: "Assignment",
    });
  }

  // ── Work progress (technician notes) ────────────────────────────────────────
  for (const item of wo.work_order_technician_notes) {
    items.push({
      id: `tech-note-${item.id}`,
      at: item.created_at,
      title: `Work update by ${item.profiles.full_name}`,
      detail: `${displayValue(item.labor_hours)} labor hours. ${item.note}`,
      actor: item.profiles.full_name,
      tone: "gray",
      label: "Work Progress",
    });
  }

  // ── Materials Request lifecycle (every request linked to this Job Card) ────
  for (const pr of wo.parts_requests) {
    const itemSummary = pr.parts_request_items
      .slice(0, 3)
      .map((line) => `${line.description} (${displayValue(line.quantity_requested)})`)
      .join(", ");
    const requesterName =
      pr.profiles_parts_requests_requested_byToprofiles?.full_name ?? actorName(pr.requested_by ?? pr.created_by);

    items.push({
      id: `mr-created-${pr.id}`,
      at: pr.created_at,
      title: "Materials requested",
      detail: `${pr.parts_request_number ?? "Materials Request"}${itemSummary ? ` — ${itemSummary}` : ""}`,
      actor: requesterName,
      tone: "amber",
      label: "Materials",
    });

    for (const log of partsRequestAuditLogs.filter((l) => l.entity_id === pr.id)) {
      const entry = materialsRequestAuditEntry(log, pr.parts_request_number, actorName);
      if (entry) items.push(entry);
    }
  }

  // ── Offline Inventory Control movements linked to this Job Card ────────────
  const prNumberById = new Map(wo.parts_requests.map((pr) => [pr.id, pr.parts_request_number]));
  for (const item of offlineMovements) {
    const materialName = item.manual_material_name || "material";
    const prNumber = item.parts_request_id ? prNumberById.get(item.parts_request_id) : null;
    const linkedNote = prNumber ? ` (Materials Request ${prNumber})` : "";
    const qty = displayValue(item.quantity);

    if (item.movement_type === "RECEIVED") {
      items.push({
        id: `movement-${item.id}`,
        at: item.created_at,
        title: "Materials received",
        detail: `${materialName} — quantity ${qty} ${item.unit}${item.counterparty ? ` from ${item.counterparty}` : ""}${linkedNote}`,
        actor: actorName(item.created_by),
        tone: "blue",
        label: "Movement History",
      });
    } else if (item.movement_type === "ISSUED") {
      items.push({
        id: `movement-${item.id}`,
        at: item.created_at,
        title: "Materials issued",
        detail: `${materialName} — quantity ${qty} ${item.unit}${item.counterparty ? ` to ${item.counterparty}` : ""}${linkedNote}`,
        actor: actorName(item.created_by),
        tone: "green",
        label: "Movement History",
      });
    } else {
      // RETURNED / ADJUSTMENT — not currently produced by any workflow action
      // linked to a Job Card, kept for defensive completeness (Task 5).
      items.push({
        id: `movement-${item.id}`,
        at: item.created_at,
        title: `${item.movement_type.charAt(0)}${item.movement_type.slice(1).toLowerCase()} recorded`,
        detail: `${materialName} — quantity ${qty} ${item.unit}${linkedNote}`,
        actor: actorName(item.created_by),
        tone: "gray",
        label: "Movement History",
      });
    }
  }

  // ── Attachments ──────────────────────────────────────────────────────────────
  for (const item of wo.work_order_attachments) {
    items.push({
      id: `attachment-${item.id}`,
      at: item.created_at,
      title: `${item.attachment_type} uploaded`,
      detail: item.file_name,
      actor: actorName(item.uploaded_by),
      tone: "gray",
      label: "Attachment",
    });
  }

  return items.sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
  );
}

// Maps a Job Card-scoped audit_logs row to a clean timeline entry, or
// returns null to leave it in System Audit only (creation/edit/assign/file
// actions are already represented by richer, dedicated entries above).
function jobCardAuditEntry(log: AuditLogRow, actorName: (id?: string | null) => string): TimelineItem | null {
  const actor = actorName(log.actor_id);
  switch (log.action) {
    case "work_order.submit":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Submitted for review",
        detail: "Sent to the Supervisor / Manager for review.", actor, tone: "amber", label: "Job Card",
      };
    // Simplified Workflow Correction Unit: the Engineer review step is
    // retired from the active workflow — Supervisor/Manager reviews
    // directly. This entry only renders for historical/legacy audit rows.
    case "work_order.review":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Reviewed and sent to Manager",
        detail: metaGet(log.metadata, "comments") ?? "Reviewed and sent to the Supervisor / Manager for approval.",
        actor, tone: "amber", label: "Review",
      };
    case "work_order.correction_requested":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Correction requested",
        detail: metaGet(log.metadata, "note") ?? "Correction requested.",
        actor, tone: "red", label: "Correction",
      };
    case "work_order.correction_responded":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Correction addressed",
        detail: metaGet(log.metadata, "response") ?? "Response submitted.",
        actor, tone: "amber", label: "Correction",
      };
    case "work_order.approve":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Approved by Maintenance Manager",
        detail: metaGet(log.metadata, "comments") ?? "Job Card approved.",
        actor, tone: "green", label: "Approval",
      };
    case "work_order.waiting_materials":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Waiting materials",
        detail: "Job Card is waiting for materials.", actor, tone: "amber", label: "Materials",
      };
    case "work_order.start":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Work started",
        detail: "Technician started work on this Job Card.", actor, tone: "blue", label: "Work Progress",
      };
    // Data Entry Job Card Progress Update and Close Action Unit: the generic
    // (non-technician) Start Work action — Data Entry/Engineer/Manager
    // marking progress after being informed work has started. Distinct from
    // work_order.start above so the wording never wrongly implies a
    // technician did it; the actor name already shows who really did.
    case "work_order.start_progress":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Work started",
        detail: metaGet(log.metadata, "note") ?? "Marked as In Progress.", actor, tone: "blue", label: "Work Progress",
      };
    // Technician Dashboard and My Jobs Workflow Alignment Unit Task 8: was
    // previously unmapped here (System Audit only) — a technician's work
    // update or photo upload never appeared in the friendly Activity
    // Timeline at all. work_order_technician_notes already has its own rich
    // timeline entry elsewhere in this file; this covers the audit action
    // itself so "photo uploaded" is visible even if that richer entry is
    // ever removed.
    case "work_order.technician_update":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Technician update added",
        detail: metaGet(log.metadata, "laborHours") ? `Labor hours logged: ${metaGet(log.metadata, "laborHours")}` : "Work update added by technician.",
        actor, tone: "gray", label: "Work Progress",
      };
    case "work_order.complete":
    case "work_order.external_completed":
    case "work_order.close":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Job Card closed",
        detail: metaGet(log.metadata, "comments") ?? metaGet(log.metadata, "notes") ?? "Job Card closed.",
        actor, tone: "green", label: "Closure",
      };
    default:
      return null; // work_order.create/update/assign, file.upload — covered elsewhere or System Audit only
  }
}

// Maps a Materials Request-scoped audit_logs row to a clean timeline entry.
// parts_request.issue is intentionally skipped — the linked Offline Inventory
// movement(s) already show that action with the exact material/quantity, so
// including both would report the same real event twice.
function materialsRequestAuditEntry(
  log: AuditLogRow,
  requestNumber: string | null,
  actorName: (id?: string | null) => string
): TimelineItem | null {
  const label = requestNumber ?? "Materials Request";
  const actor = actorName(log.actor_id);
  switch (log.action) {
    case "parts_request.approve":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Materials Request approved",
        detail: `${label} approved.`, actor, tone: "green", label: "Materials",
      };
    case "parts_request.waiting_stock":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Waiting stock",
        detail: `${label}: ${metaGet(log.metadata, "reason") ?? "waiting for stock."}`,
        actor, tone: "amber", label: "Materials",
      };
    default:
      return null; // create (own dedicated entry), edit, issue (see movements) — System Audit only
  }
}

function describeAssignee(item: WorkOrderControl["work_order_assignments"][number]): { assigneeName: string; typeLabel: string } {
  switch (item.assignment_type) {
    case "FREELANCER":
      return { assigneeName: item.external_name || "freelancer", typeLabel: "freelancer" };
    case "EXTERNAL_COMPANY":
      return { assigneeName: item.external_company || "external company", typeLabel: "third-party company" };
    case "OTHER":
      return { assigneeName: item.external_name || item.external_company || "assignee", typeLabel: "outside assignee" };
    default:
      return { assigneeName: item.profiles?.full_name ?? "technician", typeLabel: "internal technician" };
  }
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
