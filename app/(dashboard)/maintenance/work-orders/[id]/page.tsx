import Link from "next/link";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  History,
  PackageSearch,
  Paperclip,
  Printer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { addWorkOrderMaterialAction } from "@/app/actions/maintenance";
import { respondToClarificationAction } from "@/app/actions/workflow";
import { uploadWorkOrderFileAction, deleteWorkOrderAttachmentAction } from "@/app/actions/files";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LargeFormModal } from "@/components/ui/large-form-modal";
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
import { getTechnicianPickerOptions } from "@/lib/technicians/picker-options";
import { getMaterialFulfillmentForWorkOrder, anyMaterialsIncomplete, summarizeMaterialAvailability } from "@/lib/work-orders/material-fulfillment";
import { buildBalanceKey, canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";
import { getWorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";
import { WorkTimeTracking } from "@/components/work-orders/work-time-tracking";
import { ScrollToSection } from "@/components/work-orders/scroll-to-section";
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

// Approval Workflow Unit 4 — Closure Approval Only: the stepper mirrors the
// current plain user-facing statuses (Draft/Active/Closure Requested/
// Closed). No Manager approval before starting a Job Card any more, so
// "Submitted"/"Approved" are no longer their own stages — "Submitted" only
// still appears via displaySimplifiedStatus() for a legacy pre-existing
// "Under Review" row, in which case it's shown collapsed onto the "Active"
// step here (that legacy status sits between Draft and Active either way). A
// pending correction is not a stage swap ("Correction Requested" retired as
// a primary value); it's shown as a small "Needs Update" chip next to
// whatever the current stage already is, since a correction is a loop back
// onto that same stage, not further progress.
const DISPLAY_STAGES = ["Draft", "Active", "Closure Requested", "Closed"] as const;

// Job Card Detail Simplification Unit 8C: matches ACTIVE_BUCKET_STATUSES in
// components/work-orders/workflow-actions.tsx exactly — kept in sync
// manually (same convention as that file's own duplicated constants), used
// here only to decide when the Next Action panel's 7-case ladder applies.
const ACTIVE_BUCKET_STATUSES = ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"];

function statusToStageIndex(status: string): number {
  const simplified = displaySimplifiedStatus(status);
  switch (simplified) {
    case "Draft":
      return 0;
    case "Submitted": // legacy only
    case "Active":
      return 1;
    case "Closure Requested":
      return 2;
    case "Closed":
      return 3;
  }
}

// ── DB include ────────────────────────────────────────────────────────────────

// Performance Optimization Unit 3, Task 4: this include previously had no
// `take` on any nested list, meaning a long-lived Job Card's entire history
// (every status change, every technician note, every attachment, every labor/
// material line) loaded in full on every view and every 20s AutoRefresh tick.
// `parts_requests`/`purchase_requests` and their nested chains are left
// unbounded on purpose — real business logic downstream (activeMaterialsRequest,
// hasIssuedMaterialsRequest, the "View/Request Materials" button) scans the
// FULL set to find a specific record, so truncating them could silently pick
// the wrong "active" request; they're also naturally small in practice (a Job
// Card rarely has more than a handful). The append-only history/activity-log
// relations below get a generous take limit instead — large enough that no
// real Job Card today is anywhere close to it (see context/progress-tracker.md's
// baseline: 20 seeded work orders total), so this changes nothing observable
// today, but caps worst-case growth for a long-lived Job Card years from now.
// If a genuine need for "see everything, not just recent" ever arises for one
// of these, that should be its own paginated section/action, not a bigger
// default load here.
const RECENT_HISTORY_TAKE = 200;

const workOrderControlInclude = {
  assets: true,
  departments: true,
  profiles: true,
  approvals: { orderBy: { decided_at: "desc" }, take: RECENT_HISTORY_TAKE },
  inventory_movements: { include: { parts: true, parts_requests: true, purchase_requests: true }, orderBy: { created_at: "desc" }, take: RECENT_HISTORY_TAKE },
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
  // Work Assignment and Worker Profiles Foundation Unit 7: the new Internal
  // Team labor roster — separate from work_order_assignments above (see
  // lib/backend/work-orders/worker-roster.ts). Only "active" rows; "removed"
  // history rows stay in the DB (for a future work-session unit) but are not
  // displayed here.
  work_order_worker_assignments: {
    where: { status: "active" },
    include: { worker_profiles: true, profiles: true },
    orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }]
  },
  work_order_attachments: { orderBy: { created_at: "desc" }, take: RECENT_HISTORY_TAKE },
  work_order_labor: { include: { profiles: true }, orderBy: { created_at: "desc" }, take: RECENT_HISTORY_TAKE },
  work_order_materials: { include: { parts: true }, orderBy: { created_at: "desc" }, take: RECENT_HISTORY_TAKE },
  work_order_required_parts: { orderBy: { created_at: "asc" } },
  // Fetched newest-first (with the cap) so a truncation keeps the most recent
  // entries, not the oldest — buildTimeline() below re-sorts everything by
  // timestamp for display anyway, so the fetch order itself is otherwise moot.
  work_order_status_history: { orderBy: { changed_at: "desc" }, take: RECENT_HISTORY_TAKE },
  work_order_technician_notes: { include: { profiles: true }, orderBy: { created_at: "desc" }, take: RECENT_HISTORY_TAKE }
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
  searchParams: Promise<{
    error?: string;
    success?: string;
    warning?: string;
    kind?: string;
    editAssignment?: string;
    recordMaterial?: string;
  }>;
}) {
  const context = await requirePermission("work_orders.view");
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const errorMessage = resolvedSearch.error;
  const warningMessage = resolvedSearch.warning;
  const successMessage = resolvedSearch.success;
  const successKind = resolvedSearch.kind === "materials" ? "materials" : "correction";
  // Job Card Detail Simplification Unit 8C: the Edit Assignment and Record
  // Material Used forms (previously always-visible inline forms) now open as
  // modals via these query params, following the same pattern already used
  // by the Materials Requests page's "New Materials Request" modal.
  const showEditAssignment = resolvedSearch.editAssignment === "1";
  const showRecordMaterial = resolvedSearch.recordMaterial === "1";
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

  const [auditLogs, partsRequestAuditLogs, offlineMovements, pendingClarification, technicians, materialFulfillment, activeWorkers, laborSummary] = await Promise.all([
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
    getTechnicianPickerOptions(),
    getMaterialFulfillmentForWorkOrder(prisma, wo.id),
    getActiveWorkerProfilesForAssignment(),
    getWorkOrderLaborSummary(prisma, wo.id),
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
  // Required Materials Issue and Shortage Tracking Unit 6: "Issue" link on a
  // shortfall row jumps straight to Offline Inventory Control's own Issue
  // Material action (the only place stock is actually deducted) with both
  // the material and this Job Card pre-selected.
  const canIssueFromJobCard = canManageOfflineInventory(context) && !["Closed", "Cancelled", "Rejected"].includes(wo.status);
  const fulfillmentByRowId = new Map(materialFulfillment.map((f) => [f.id, f]));
  // Work Session Time Tracking and Labor Cost Calculation Unit 8: same
  // audience/gate as Unit 7's Internal Team roster (work_orders.assign,
  // blocked once Closed) for Start/Pause/Resume/Stop/Manual Entry; Manager-
  // only for editing/correcting/cancelling an existing session.
  const canManageWorkSessions =
    (hasPermission(context, "work_orders.assign") || context.role?.slug === "maintenance_manager" || context.role?.slug === "super_admin") &&
    wo.status !== "Closed";
  const isManagerRoleForSessions = context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  // Job Card Detail Simplification Unit 8C: page-level mirror of
  // WorkflowActions' own canAssign/canManageRoster gates (kept in sync
  // manually, same convention as isManagerRoleForSessions above) — used only
  // to decide whether the read-only Assignment section's "Edit Assignment"
  // button is worth showing. The actual authorization for the forms
  // themselves still lives entirely inside WorkflowActions section="assignment".
  const canAssignWorkNow =
    !hasPendingCorrection &&
    (hasPermission(context, "work_orders.approve") || hasPermission(context, "work_orders.assign")) &&
    ["Approved", "Partially Issued", "Materials Issued", "Assigned", "In Progress"].includes(wo.status) &&
    (wo.status === "Assigned" || wo.status === "In Progress" || !activeMaterialsRequest);
  const canManageRosterNow =
    !hasPendingCorrection && (hasPermission(context, "work_orders.assign") || isManagerRoleForSessions) && wo.status !== "Closed";
  const canEditAssignmentNow = canAssignWorkNow || canManageRosterNow;
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

  // Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
  // Task 6 — assignment presence/summary, reused by the Top Operational
  // Summary chips and the new Assignment section (Unit 8C) below.
  const hasInternalTeam = wo.work_order_worker_assignments.length > 0;
  const hasAssignment = wo.work_order_assignments.length > 0 || hasInternalTeam;
  const assignmentSummaryText = (() => {
    if (hasInternalTeam) {
      const n = wo.work_order_worker_assignments.length;
      return `Internal Team assigned (${n} worker${n === 1 ? "" : "s"})`;
    }
    const a = wo.work_order_assignments[0];
    if (!a) return "Not assigned";
    if (a.assignment_type === "FREELANCER") return `Freelancer: ${a.external_name ?? ""}`;
    if (a.assignment_type === "EXTERNAL_COMPANY") return `Company: ${a.external_company ?? ""}`;
    return wo.work_order_assignments
      .map((x) => x.profiles?.full_name)
      .filter((n): n is string => Boolean(n))
      .join(", ") || "Not assigned";
  })();

  // Job Card Detail Simplification Unit 8C — readiness/chip data for the new
  // Top Operational Summary, Next Action panel, and Closure panel. Mirrors
  // (read-only, does not call) the same three closure guards enforced
  // server-side in lib/backend/work-orders/service.ts
  // (assertNoPendingMaterialsRequests / assertRequiredMaterialsFulfilled /
  // assertNoActiveWorkSessions) purely so the UI can show "not ready yet and
  // why" before the user attempts an action that would otherwise fail.
  const pendingMaterialsRequestsCount = wo.parts_requests.filter((r) => r.status !== "Issued").length;
  const materialsIncomplete = anyMaterialsIncomplete(materialFulfillment);
  const materialsPendingForClosure = pendingMaterialsRequestsCount > 0 || materialsIncomplete;
  // Job Card Action Clarity Fix Task 5: "none" when this Job Card has no
  // work_order_required_parts rows — the Next Action panel's materials
  // branch below falls back to the plain pending-request check above in
  // that case, same as the quick-view popup.
  const materialsAvailability = summarizeMaterialAvailability(materialFulfillment);
  const closureBlockers: string[] = [];
  if (hasPendingCorrection) closureBlockers.push("A correction is pending — respond to it before requesting closure.");
  if (pendingMaterialsRequestsCount > 0) closureBlockers.push("A Materials Request is still pending — receive it first.");
  if (materialsIncomplete) closureBlockers.push("Required materials have not been fully issued yet.");
  if (laborSummary.has_active_session) closureBlockers.push("A work session is active — stop it before requesting closure.");
  const closureReady = closureBlockers.length === 0;

  // Status chips for the hero header (Task 2, Premium Job Card Detail Page
  // Redesign Unit 8C.2). Assignment/Closure chips unchanged; Materials and
  // Work Time chips gained a distinct "in-between" state each (Ready to
  // Issue / Paused) instead of only reading "Pending"/"Not Started" while
  // stock was already sitting in Offline Inventory or a worker was paused.
  const assignmentChip: { label: string; tone: BadgeTone } = hasAssignment
    ? { label: "Assigned", tone: "green" }
    : { label: "Not assigned", tone: "gray" };
  const materialsChip: { label: string; tone: BadgeTone } =
    wo.parts_requests.length === 0 && materialFulfillment.length === 0
      ? { label: "No materials", tone: "gray" }
      : materialsAvailability === "issuable" || materialsAvailability === "partial"
        ? { label: "Ready to Issue", tone: "blue" }
        : openPartsRequests > 0 || materialsIncomplete
          ? { label: "Pending", tone: "amber" }
          : { label: "Completed", tone: "green" };
  const anyWorkerPaused = laborSummary.workers.some((w) => w.status === "Paused");
  const workTimeChip: { label: string; tone: BadgeTone } = !hasInternalTeam
    ? { label: "Not Started", tone: "gray" }
    : laborSummary.has_active_session
      ? { label: "Working", tone: "blue" }
      : anyWorkerPaused
        ? { label: "Paused", tone: "amber" }
        : laborSummary.total_minutes > 0
          ? { label: "Sessions Recorded", tone: "green" }
          : { label: "Not Started", tone: "gray" };
  const closureChip: { label: string; tone: BadgeTone } =
    wo.status === "Closed"
      ? { label: "Closed", tone: "green" }
      : wo.status === "Closure Requested"
        ? { label: "Requested", tone: "amber" }
        : closureReady
          ? { label: "Ready", tone: "blue" }
          : { label: "Not Ready", tone: "gray" };

  // Next Action panel (section 2) 7-case ladder — only applies once a Job
  // Card is past creation/review (Created/Under Review keep their own
  // Submit/Approve/Edit forms, rendered via WorkflowActions section="status"
  // in the same panel instead of this ladder).
  const NEXT_ACTION_LADDER_STATUSES = [...ACTIVE_BUCKET_STATUSES, "Closure Requested", "Closed"];
  const showNextActionLadder = !hasPendingCorrection && NEXT_ACTION_LADDER_STATUSES.includes(wo.status);
  const nextActionLadder = (() => {
    type ActionButton = { label: string; href: string };
    if (wo.status === "Closed") {
      return { message: "This Job Card is closed.", buttons: [] as ActionButton[] };
    }
    if (wo.status === "Closure Requested") {
      const buttons: ActionButton[] = isManagerRoleForSessions ? [{ label: "Approve Closure", href: "#closure-panel" }] : [];
      return { message: "Waiting for Manager approval to close this Job Card.", buttons };
    }
    // Job Card Action Clarity Fix Task 5: same Issue/Receive/partial wording
    // and precedence as the quick-view popup (Task 4), driven by the same
    // summarizeMaterialAvailability() read of Required Materials vs. Offline
    // Inventory — never leads with "Receive Materials" when stock to issue
    // is already sitting in Offline Inventory.
    if (materialsAvailability === "partial") {
      const buttons: ActionButton[] = [];
      if (canIssueFromJobCard) buttons.push({ label: "Issue Available", href: "#parts" });
      buttons.push({ label: activeMaterialsRequest ? "Receive Shortage" : materialsButtonLabel, href: materialsButtonHref });
      return { message: "Some materials are available. Issue available stock and receive shortage later.", buttons };
    }
    if (materialsAvailability === "issuable") {
      const buttons: ActionButton[] = canIssueFromJobCard
        ? [{ label: "Issue Material", href: "#parts" }]
        : [{ label: activeMaterialsRequest ? "Receive Materials" : materialsButtonLabel, href: materialsButtonHref }];
      return { message: "Materials are available. Issue materials to this Job Card.", buttons };
    }
    if (materialsPendingForClosure) {
      const buttons: ActionButton[] = [
        { label: activeMaterialsRequest ? "Receive Materials" : materialsButtonLabel, href: materialsButtonHref },
      ];
      return { message: "Materials are pending. Receive materials when they arrive.", buttons };
    }
    if (!hasAssignment) {
      return { message: "Assign workers to start work tracking.", buttons: [{ label: "Assign Workers", href: "?editAssignment=1#assignment" }] };
    }
    if (hasInternalTeam && laborSummary.has_active_session) {
      return { message: "Work is in progress. Pause or stop active sessions when needed.", buttons: [{ label: "Track Work", href: "#work-time-tracking" }] };
    }
    if (hasInternalTeam && laborSummary.total_minutes === 0) {
      return { message: "Workers are assigned. Start work tracking.", buttons: [{ label: "Track Work", href: "#work-time-tracking" }] };
    }
    return { message: "Work is ready for closure request.", buttons: [{ label: "Request Closure", href: "#closure-panel" }] };
  })();

  const stageIndex = statusToStageIndex(wo.status);
  const isTerminal = ["Rejected", "Cancelled"].includes(wo.status);
  // Job Card Detail Simplification Unit 8C: the Assignment display used to
  // live inside this section and gate it; it now has its own dedicated
  // section above, so this residual section (notes/labor rows/start-end
  // timestamps only) is gated without the assignments term.
  const hasTechnicianNotesContent =
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
      <ScrollToSection paramName="section" paramValue="work-time" targetId="work-time-tracking" />
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

      <div className="space-y-6 p-4 lg:p-6">

        {/* ── 1. Hero header ──────────────────────────────────────────────
            Premium Job Card Detail Page Redesign Unit 8C.2, Task 1: this
            Job Card's identity — number, issue, asset on the left; status
            and the facts that place it (created/reported by/work team) on
            the right — replacing Unit 8C's flat 6-box info grid with a
            layout that reads like a document header, not a database row.
            Task 2's four operational chips live in their own band directly
            below, visually distinct from the identity facts above them. */}
        <section className="overflow-hidden rounded-lg border border-[#DDE2EA] bg-white shadow-sm">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8 lg:p-6">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Job Card</p>
              <h1 className="mt-1 break-words text-2xl font-black leading-tight text-[#111827]">
                {wo.work_order_number ?? "Job Card"}
              </h1>
              <p className="mt-2 text-base leading-6 text-[#374151]">{summaryTitle}</p>
              <p className="mt-3 text-sm text-[#4B5563]">
                {wo.assets ? (
                  <>
                    <span className="font-semibold text-[#111827]">
                      {wo.assets.asset_code} — {wo.assets.asset_name}
                    </span>
                    {wo.assets.location ? ` · ${wo.assets.location}` : ""}
                  </>
                ) : (
                  "No asset linked"
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-[#EEF2F6] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Status</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <StatusBadge label={displaySimplifiedStatus(wo.status)} tone={simplifiedStatusTone(displaySimplifiedStatus(wo.status))} />
                  {hasPendingCorrection && <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Created</p>
                <p className="mt-1 text-sm font-bold text-[#111827]">{formatDateValue(wo.created_at)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Reported by</p>
                <p className="mt-1 break-words text-sm font-bold text-[#111827]">{wo.ordered_by ?? "-"}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Work Team / Division</p>
                <p className="mt-1 break-words text-sm font-bold text-[#111827]">{wo.departments?.name ?? wo.worker_type ?? "-"}</p>
              </div>
            </div>
          </div>

          {/* ── 2. Operational chips ──────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF2F6] bg-[#F9FAFB] px-5 py-3.5 lg:px-6">
            <StatusBadge label={`Assignment: ${assignmentChip.label}`} tone={assignmentChip.tone} />
            <StatusBadge label={`Materials: ${materialsChip.label}`} tone={materialsChip.tone} />
            <StatusBadge label={`Work Time: ${workTimeChip.label}`} tone={workTimeChip.tone} />
            <StatusBadge label={`Closure: ${closureChip.label}`} tone={closureChip.tone} />
          </div>
        </section>

        {/* ── 3. Next Action panel ────────────────────────────────────────
            Premium Job Card Detail Page Redesign Unit 8C.2, Task 3: a
            stronger left-accent treatment (not just another white card) so
            it reads as the one place to look for "what do I do next". For
            Created/Under Review (and while a correction is pending) this
            hosts the same Submit/Approve/Edit/Mark-Started/Mark-External-
            Complete actions that used to live in the sidebar (WorkflowActions
            section="status", untouched logic). Once the Job Card is in the
            Active bucket (or Closure Requested/Closed) the 7-case ladder
            below takes over with plain-language guidance and buttons that
            jump to the section where the actual action lives — Assignment,
            Work Time Tracking, Materials, or the Closure panel. No new forms
            here; every button either navigates or reuses an existing action
            already rendered elsewhere. */}
        <section
          id="next-action"
          className="rounded-lg border border-[#F3D6D6] border-l-4 border-l-[#ED1C24] bg-red-50/40 p-5 shadow-sm"
        >
          <h2 className="text-base font-black uppercase tracking-wide text-[#ED1C24]">Next Action</h2>
          {showNextActionLadder ? (
            <div className="mt-2">
              <p className="text-base font-bold leading-6 text-[#111827]">{nextActionLadder.message}</p>
              {nextActionLadder.buttons.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {nextActionLadder.buttons.map((btn, idx) => (
                    <Link
                      key={btn.label}
                      href={btn.href}
                      className={
                        idx === 0
                          ? "inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e] sm:w-auto"
                          : "inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] transition hover:bg-gray-50 sm:w-auto"
                      }
                    >
                      {btn.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={showNextActionLadder ? "mt-4 border-t border-[#F3D6D6] pt-4" : "mt-2"}>
            <WorkflowActions
              section="status"
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
          </div>
        </section>

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
          <main className="space-y-6">

            {/* 1 — Overview (Premium Job Card Detail Page Redesign Unit
                8C.2, Task 5): Asset Details and Problem Details combined
                into one section, two clear sub-groups side by side on
                desktop. Status is deliberately not repeated here — it
                already lives in the hero header above. */}
            <section id="overview" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="What this job is" title="Overview" icon={ClipboardList} />
              <div className="mt-5 grid gap-6 lg:grid-cols-2">
                {/* Asset sub-group */}
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Asset / Equipment / Vehicle</p>
                  {wo.assets ? (
                    <div className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-black text-[#111827]">
                          {wo.assets.asset_code} — {wo.assets.asset_name}
                        </p>
                        <StatusBadge label={wo.assets.status} tone={wo.assets.status === "Breakdown" ? "red" : "green"} />
                      </div>
                      {(wo.assets.category || wo.assets.location) ? (
                        <p className="mt-1 text-xs text-[#4B5563]">
                          {[wo.assets.category, wo.assets.location].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {wo.plate_number ? (
                        <p className="mt-1 text-xs text-[#4B5563]">Plate number: <span className="font-semibold text-[#111827]">{wo.plate_number}</span></p>
                      ) : null}
                      {(wo.assets.brand || wo.assets.model || wo.assets.serial_number) ? (
                        <p className="mt-1 text-xs text-[#4B5563]">
                          {[
                            wo.assets.brand ? `Brand: ${wo.assets.brand}` : null,
                            wo.assets.model ? `Model: ${wo.assets.model}` : null,
                            wo.assets.serial_number ? `S/N: ${wo.assets.serial_number}` : null,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      <Link
                        href={`/assets/${wo.asset_id}`}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[#ED1C24] hover:underline"
                      >
                        View asset profile
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[#9CA3AF]">No asset linked.</p>
                  )}
                </div>

                {/* Problem sub-group */}
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Problem Reported</p>
                  <div className="mt-2 space-y-2">
                    {wo.operator_complaint ? (
                      <p className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm leading-6 text-[#111827]">
                        {wo.operator_complaint}
                      </p>
                    ) : null}
                    {wo.description_of_work ? (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF]">Description of work required</p>
                        <p className="mt-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm leading-6 text-[#111827]">
                          {wo.description_of_work}
                        </p>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      {wo.maintenance_type ? <InfoBlock label="Maintenance type" value={wo.maintenance_type} /> : null}
                      {wo.date_of_order ? <InfoBlock label="Date of order" value={formatDateValue(wo.date_of_order)} /> : null}
                      {wo.ordered_by ? <InfoBlock label="Reported by" value={wo.ordered_by} /> : null}
                      {wo.job_location ? <InfoBlock label="Job location" value={wo.job_location} /> : null}
                      {wo.profiles ? <InfoBlock label="Supervisor" value={wo.profiles.full_name} /> : null}
                      {wo.serial_number ? <InfoBlock label="RO serial no." value={wo.serial_number} /> : null}
                      {wo.running_hours != null ? <InfoBlock label="Running hours" value={displayValue(wo.running_hours)} /> : null}
                      {wo.kilometers != null ? <InfoBlock label="Kilometers" value={displayValue(wo.kilometers)} /> : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution notes/labor records — legacy/secondary content,
                  collapsed by default so it doesn't compete with the two
                  sub-groups above for a Job Card that has any. */}
              {hasTechnicianNotesContent ? (
                <details className="mt-5 border-t border-[#E5E7EB] pt-4">
                  <summary className="cursor-pointer select-none text-xs font-black uppercase tracking-wide text-[#4B5563]">
                    Execution notes &amp; labor records
                  </summary>
                  <div className="mt-3 space-y-4">
                    {(wo.starting_datetime || wo.ending_datetime) ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {wo.starting_datetime ? <InfoBlock label="Work started" value={formatDateTimeValue(wo.starting_datetime)} /> : null}
                        {wo.ending_datetime ? <InfoBlock label="Work completed" value={formatDateTimeValue(wo.ending_datetime)} /> : null}
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
                </details>
              ) : null}
            </section>

            {/* 2 — Assignment (Job Card Detail Simplification Unit 8C).
                Read-only summary only — the actual Assign Work / Internal
                Team roster forms (WorkflowActions section="assignment",
                logic untouched) now live in the "Edit Assignment" modal
                instead of being permanently visible here. */}
            <section id="assignment" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeader eyebrow="Who's doing the work" title="Assignment" icon={Users} />
                {canEditAssignmentNow ? (
                  <Link
                    href={`/maintenance/work-orders/${wo.id}?editAssignment=1`}
                    className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
                  >
                    Edit Assignment
                  </Link>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-bold text-[#111827]">{assignmentSummaryText}</p>

              <div className="mt-5 space-y-4">
                {hasInternalTeam ? (
                  <div>
                    <InfoBlock label="Assignment type" value="Internal Team" />
                    <div className="mt-3 space-y-3">
                      {(["Supervisor", "Technician", "Helper/Labor"] as const).map((role) => {
                        const rows = wo.work_order_worker_assignments.filter((r) => r.worker_role === role);
                        if (rows.length === 0) return null;
                        return (
                          <div key={role}>
                            <p className="text-xs font-bold text-[#6B7280]">
                              {role === "Helper/Labor" ? "Helpers / Labor" : `${role}${rows.length > 1 ? "s" : ""}`}
                            </p>
                            <div className="mt-1 space-y-1.5">
                              {rows.map((r) => (
                                <div key={r.id} className="flex items-center justify-between rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                                  <span className="font-semibold text-[#111827]">{r.worker_profiles.name}</span>
                                  {canViewCosts ? (
                                    <span className="text-[#4B5563]">{money(r.hourly_rate_snapshot)} KWD/hr</span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-[#9CA3AF]">
                      Assigned {formatDateTimeValue(wo.work_order_worker_assignments[0].assigned_at)} by{" "}
                      {wo.work_order_worker_assignments[0].profiles?.full_name ?? "System"}
                      {wo.work_order_worker_assignments[0].notes ? ` — ${wo.work_order_worker_assignments[0].notes}` : ""}
                    </p>
                  </div>
                ) : wo.work_order_assignments.length ? (
                  <div className="space-y-2">
                    {wo.work_order_assignments.map((a) => {
                      const isInternal = a.assignment_type === "INTERNAL_TECHNICIAN";
                      const isFreelancer = a.assignment_type === "FREELANCER";
                      const assignedAt = `Assigned ${formatDateTimeValue(a.assigned_at)} by ${actorName(a.assigned_by)}`;
                      const typeLabel = isInternal ? "Internal Technician" : isFreelancer ? "Freelancer" : "External Company";
                      if (isInternal) {
                        return (
                          <div key={a.id}>
                            <InfoBlock label="Assignment type" value={typeLabel} />
                            <div className="mt-2">
                              <RecordLine title={a.profiles?.full_name ?? "Unknown technician"} detail={assignedAt} />
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={a.id}>
                          <InfoBlock label="Assignment type" value={typeLabel} />
                          <div className="mt-2 rounded-md border border-[#E5E7EB] p-3 text-sm">
                            <p className="font-semibold text-[#111827]">{isFreelancer ? a.external_name : a.external_company}</p>
                            {a.external_contact_person ? <p className="text-[#4B5563]">Contact: {a.external_contact_person}</p> : null}
                            {a.external_trade ? <p className="text-[#4B5563]">Work type: {a.external_trade}</p> : null}
                            {a.external_phone ? <p className="text-[#4B5563]">Phone: {a.external_phone}</p> : null}
                            {canViewCosts && a.agreed_amount != null ? (
                              <p className="text-[#4B5563]">Agreed amount: {money(a.agreed_amount)} KWD</p>
                            ) : null}
                            {a.external_expected_visit_date ? (
                              <p className="text-[#4B5563]">
                                Expected visit: {new Date(a.external_expected_visit_date).toLocaleDateString("en-GB")}
                              </p>
                            ) : null}
                            {a.notes ? <p className="mt-1 text-xs text-[#9CA3AF]">{a.notes}</p> : null}
                            <p className="mt-1 text-xs text-[#9CA3AF]">{assignedAt}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[#E5E7EB] bg-[#F9FAFB] py-8 text-center">
                    <p className="text-sm text-[#6B7280]">No workers assigned yet.</p>
                    {canEditAssignmentNow ? (
                      <Link
                        href={`/maintenance/work-orders/${wo.id}?editAssignment=1`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
                      >
                        <Users className="h-4 w-4" aria-hidden /> Assign Workers
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            {/* 3 — Work Time Tracking (Work Session Time Tracking and Labor
                Cost Calculation Unit 8, Task 6) — its own section, separate
                from Assignment above (which is about who's assigned, not
                time actually worked). Notes/labor records that used to sit
                in a "Technician Work" section here now live collapsed
                inside Overview above (Premium Redesign Unit 8C.2, Task 4). */}
            <WorkTimeTracking
              workOrderId={wo.id}
              summary={laborSummary}
              canManageSessions={canManageWorkSessions}
              isManager={isManagerRoleForSessions}
              canViewCosts={canViewCosts}
              canAssign={hasPermission(context, "work_orders.assign") || context.role?.slug === "super_admin"}
            />

            {/* 4 — Materials (Job Card Detail Simplification Unit 8C:
                summary cards + one clear Action per row; "Record material
                used" moved into a modal instead of an always-visible form). */}
            <section id="parts" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeader eyebrow="Materials" title="Materials" icon={PackageSearch} />
                {/* Premium Job Card Detail Page Redesign Unit 8C.2, Task
                    12: red is reserved for a true call-to-action —
                    "View Materials" is navigation to a record that already
                    exists, not a new action, so it gets the neutral
                    secondary style instead of competing with Next Action's
                    red buttons for attention. */}
                {canCreatePartsRequest && !["Closed", "Cancelled", "Rejected"].includes(wo.status) ? (
                  <Link
                    href={materialsButtonHref}
                    className={
                      materialsButtonLabel === "View Materials"
                        ? "inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
                        : "inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                    }
                  >
                    <PackageSearch className="h-4 w-4" aria-hidden="true" />
                    {materialsButtonLabel}
                  </Link>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Required items" value={wo.work_order_required_parts.length} icon={PackageSearch} tone="blue" />
                <MetricCard
                  label="Issued items"
                  value={materialFulfillment.filter((f) => f.status === "fulfilled").length}
                  icon={CheckCircle2}
                  tone="green"
                />
                <MetricCard
                  label="Remaining items"
                  value={materialFulfillment.filter((f) => f.remaining_qty > 0).length}
                  icon={AlertTriangle}
                  tone={materialsIncomplete ? "amber" : "green"}
                />
                <MetricCard
                  label="Open material requests"
                  value={openPartsRequests}
                  icon={PackageSearch}
                  tone={openPartsRequests ? "amber" : "green"}
                />
              </div>

              {wo.work_order_required_parts.length > 0 ? (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                    Required materials — Required / Issued / Shortage
                  </p>
                  <Table
                    columns={["Material", "Required", "Issued", "Remaining", "Available now", "Status", "Action"]}
                    rows={wo.work_order_required_parts.map((row) => {
                      const f = fulfillmentByRowId.get(row.id) ?? null;
                      const unit = row.unit_of_measure;
                      const requiredQty = f?.required_qty ?? Number(row.quantity_required);
                      const issuedQty = f?.issued_qty ?? 0;
                      const remainingQty = f?.remaining_qty ?? requiredQty;
                      const availableNow = f?.available_now ?? 0;
                      const shortageQty = f?.shortage_qty ?? 0;
                      const status = f?.status ?? "shortage";
                      const canIssueRow = canIssueFromJobCard && remainingQty > 0 && availableNow > 0;
                      const issueHref = `/store/offline-inventory?issueMaterial=${encodeURIComponent(
                        buildBalanceKey({ part_id: row.part_id, manual_material_name: row.part_id ? null : row.description, unit })
                      )}&workOrder=${wo.id}`;

                      return [
                        <div key="mat">
                          <p className="font-semibold text-[#111827]">{row.description}</p>
                          <p className="text-xs text-[#9CA3AF]">{row.part_number ?? "-"}</p>
                        </div>,
                        `${requiredQty} ${unit}`,
                        `${issuedQty} ${unit}`,
                        `${remainingQty} ${unit}`,
                        `${availableNow} ${unit}`,
                        <div key="status" className="space-y-1">
                          <StatusBadge
                            label={
                              status === "fulfilled" ? "Fully Issued"
                              : status === "partial_issued" ? "Partially Issued"
                              : status === "shortage" ? "Shortage"
                              : "Ready to Issue"
                            }
                            tone={
                              status === "fulfilled" ? "green"
                              : status === "partial_issued" ? "amber"
                              : status === "shortage" ? "red"
                              : "blue"
                            }
                          />
                          {shortageQty > 0 && (
                            <p className="text-[11px] font-semibold text-[#B45309]">
                              Shortage: {shortageQty} {unit}
                            </p>
                          )}
                        </div>,
                        <div key="action">
                          {/* Premium Job Card Detail Page Redesign Unit
                              8C.2, Task 8/12: small pill buttons instead of
                              bare text links — Issue/Receive/Request stay
                              the one red call-to-action per row; View
                              Request is neutral (navigation only); Fulfilled
                              is a plain green label, not a link. */}
                          {canIssueRow ? (
                            <Link
                              href={issueHref}
                              className="inline-flex items-center rounded-md bg-[#ED1C24] px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#c8181e]"
                            >
                              Issue Material
                            </Link>
                          ) : remainingQty > 0 && activeMaterialsRequest ? (
                            <Link
                              href={materialsButtonHref}
                              className="inline-flex items-center rounded-md bg-[#ED1C24] px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#c8181e]"
                            >
                              Receive Materials
                            </Link>
                          ) : remainingQty > 0 && canCreatePartsRequest ? (
                            <Link
                              href={`/store/parts-requests/new?repair_order_id=${wo.id}`}
                              className="inline-flex items-center rounded-md bg-[#ED1C24] px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#c8181e]"
                            >
                              Request Materials
                            </Link>
                          ) : activeMaterialsRequest ? (
                            <Link
                              href={materialsButtonHref}
                              className="inline-flex items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-bold text-[#4B5563] transition hover:bg-gray-50"
                            >
                              View Request
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Fulfilled
                            </span>
                          )}
                        </div>,
                      ];
                    })}
                    empty=""
                  />
                </div>
              ) : null}

              {wo.work_order_materials.length ? (
                <details className="mt-5">
                  <summary className="cursor-pointer select-none text-xs font-black uppercase tracking-wide text-[#4B5563]">
                    Materials used ({wo.work_order_materials.length})
                  </summary>
                  <div className="mt-2">
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
                </details>
              ) : null}

              {canManage && !["Closed", "Cancelled", "Rejected"].includes(wo.status) ? (
                <div className="mt-5">
                  <Link
                    href={`/maintenance/work-orders/${wo.id}?recordMaterial=1`}
                    className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
                  >
                    Record Material Used
                  </Link>
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

            {/* 6 — Closure panel (Job Card Detail Simplification Unit 8C).
                Readiness summary computed read-only from the same data used
                elsewhere on this page (materialFulfillment/parts_requests/
                laborSummary) — never calls the backend guards directly, just
                mirrors their conditions so Data Entry/Manager can see *why*
                before attempting an action that would otherwise fail. The
                actual Request Closure / Approve Closure / Close Job Card
                forms (WorkflowActions section="closure") are unchanged. */}
            <section id="closure-panel" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Wrap-up" title="Closure" icon={CheckCircle2} />
              <div className="mt-4">
                <StatusBadge label={closureChip.label} tone={closureChip.tone} />
                {wo.status === "Closed" ? (
                  <p className="mt-3 text-sm text-[#4B5563]">This Job Card is closed.</p>
                ) : closureReady ? (
                  <p className="mt-3 text-sm text-[#4B5563]">
                    {wo.status === "Closure Requested"
                      ? "Closure has been requested and is waiting for Manager approval."
                      : "This Job Card is ready for closure."}
                  </p>
                ) : (
                  <div className="mt-3">
                    <p className="text-sm font-bold text-[#111827]">Not ready for closure yet:</p>
                    <ul className="mt-1 list-inside list-disc text-sm text-[#4B5563]">
                      {closureBlockers.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="mt-4 border-t border-[#E5E7EB] pt-4">
                {closureReady || wo.status === "Closure Requested" ? (
                  <WorkflowActions
                    section="closure"
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
                ) : (
                  // Premium Job Card Detail Page Redesign Unit 8C.2, Task 9:
                  // a visibly disabled button (not just absent) so it's
                  // obvious closure is blocked, not just not-yet-offered —
                  // the reasons are already listed above.
                  <div>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="inline-flex min-h-10 w-full cursor-not-allowed items-center justify-center rounded-md border border-[#E5E7EB] bg-[#F3F4F6] px-4 py-2 text-sm font-bold text-[#9CA3AF] sm:w-auto"
                    >
                      Request Closure
                    </button>
                    <p className="mt-2 text-xs text-[#9CA3AF]">Resolve the items above to unlock closure actions.</p>
                  </div>
                )}
              </div>
            </section>
          </main>

          {/* ── 7. Sidebar — lightweight info only (Job Card Detail
              Simplification Unit 8C: no forms here any more; Assign/Track
              Work/Materials/Closure actions all moved to their own sections
              above). ─────────────────────────────────────────────────── */}
          <aside className="space-y-5">
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

      {/* Job Card Detail Simplification Unit 8C — Edit Assignment modal.
          Opens via ?editAssignment=1 (same pattern as the Materials
          Requests page's "New Materials Request" modal). Renders the exact
          same forms/gates as before (WorkflowActions section="assignment"),
          just relocated out of the always-visible sidebar. */}
      {showEditAssignment && (
        <LargeFormModal
          title="Edit Assignment"
          subtitle="Assign or update who is working on this Job Card."
          closeHref={`/maintenance/work-orders/${wo.id}`}
        >
          <WorkflowActions
            section="assignment"
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
            activeWorkers={activeWorkers}
            internalTeamRoster={wo.work_order_worker_assignments.map((r) => ({ worker_id: r.worker_id, worker_role: r.worker_role }))}
            hasPendingCorrection={hasPendingCorrection}
          />
        </LargeFormModal>
      )}

      {/* Job Card Detail Simplification Unit 8C — Record Material Used
          modal. Same addWorkOrderMaterialAction form/fields as before, just
          no longer permanently visible inline in the Materials section. */}
      {showRecordMaterial && (
        <LargeFormModal
          title="Record Material Used"
          subtitle="Log a material consumed on this Job Card."
          closeHref={`/maintenance/work-orders/${wo.id}`}
        >
          <form action={addWorkOrderMaterialAction} className="space-y-4">
            <input type="hidden" name="work_order_id" value={wo.id} />
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Material *</label>
              <input
                name="material_name"
                type="text"
                required
                placeholder="e.g. oil filter…"
                className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Part No.</label>
                <input
                  name="part_number_free"
                  type="text"
                  placeholder="optional"
                  className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
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
            </div>
            <Button type="submit" className="w-full sm:w-auto">Record</Button>
          </form>
        </LargeFormModal>
      )}
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
    // Approval Workflow Unit 4: Data Entry starting a Job Card directly (no
    // Manager approval before starting any more) and the new closure-request
    // flow — distinct action strings from work_order.start (technician's own
    // start) and work_order.close (Manager's direct close) so each keeps its
    // own accurate wording.
    case "work_order.activated":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Job Card started",
        detail: "Job Card started — now Active.", actor, tone: "blue", label: "Job Card",
      };
    case "work_order.closure_requested":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Closure requested",
        detail: metaGet(log.metadata, "note") ?? "Closure requested.",
        actor, tone: "amber", label: "Closure",
      };
    case "work_order.closure_approved":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Closure approved",
        detail: metaGet(log.metadata, "comments") ?? "Manager approved closing this Job Card.",
        actor, tone: "green", label: "Closure",
      };
    // Work Session Time Tracking and Labor Cost Calculation Unit 8.
    case "work_order.work_session_started":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Work session started — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: "Started work.", actor, tone: "blue", label: "Time Tracking",
      };
    case "work_order.work_session_paused":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Work session paused — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: `${metaGet(log.metadata, "duration_minutes") ?? "0"} min recorded.`, actor, tone: "amber", label: "Time Tracking",
      };
    case "work_order.work_session_stopped":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Work session stopped — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: `${metaGet(log.metadata, "duration_minutes") ?? "0"} min recorded.`, actor, tone: "green", label: "Time Tracking",
      };
    case "work_order.work_session_manual_entry":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Manual time entry — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: `${metaGet(log.metadata, "duration_minutes") ?? "0"} min added.`, actor, tone: "gray", label: "Time Tracking",
      };
    case "work_order.work_session_edited":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Work session corrected — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: metaGet(log.metadata, "correctionReason") ?? "Session corrected by Manager.",
        actor, tone: "amber", label: "Time Tracking",
      };
    case "work_order.work_session_cancelled":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: `Work session cancelled — ${metaGet(log.metadata, "worker_name") ?? "worker"}`,
        detail: metaGet(log.metadata, "correctionReason") ?? "Session cancelled by Manager.",
        actor, tone: "red", label: "Time Tracking",
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
