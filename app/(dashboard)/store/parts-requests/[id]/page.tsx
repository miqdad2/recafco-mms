import { ArrowRight, Paperclip } from "lucide-react";
import Link from "next/link";

import {
  approvePartsRequestAction,
  receiveMaterialFromRequestAction,
} from "@/app/actions/phase4";
import {
  uploadPartsRequestAttachmentAction,
  deletePartsRequestAttachmentAction,
} from "@/app/actions/files";
import { PartsRequestItemsTable } from "@/components/store/parts-request-items-table";
import { StoreIssuePanel } from "@/components/store/store-issue-panel";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { canViewCosts } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
  materialsReceiptStatus,
} from "@/lib/display/parts-request-labels";
import {
  getPendingCorrectionWorkOrderIds,
  displaySimplifiedStatus,
  simplifiedStatusTone,
  NEEDS_UPDATE_LABEL,
  NEEDS_UPDATE_TONE,
} from "@/lib/work-orders/simplified-status";
import { canReceiveIssueMaterials, getPartsRequestVisibilityFilter } from "@/lib/parts-requests/visibility";
import { PARTS_REQUEST_ATTACHMENT_CATEGORIES } from "@/lib/files/attachment-constants";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BadgeTone = "green" | "amber" | "red" | "blue" | "gray";

type MaterialsRequestTimelineItem = {
  id: string;
  at: Date | string | null;
  title: string;
  detail: string;
  actor?: string | null;
  tone: BadgeTone;
  label: string;
};

type AuditLogRow = { id: string; action: string; created_at: Date; actor_id: string | null; metadata: unknown };
type OfflineMovementRow = {
  id: string;
  movement_type: string;
  quantity: unknown;
  unit: string;
  manual_material_name: string | null;
  counterparty: string | null;
  created_by: string;
  created_at: Date;
};

function metaGet(metadata: unknown, key: string): string | undefined {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === "") return undefined;
    return String(value);
  }
  return undefined;
}

// Maps a parts_request-scoped audit_logs row to a clean timeline entry.
// parts_request.issue is intentionally skipped — the linked Offline Inventory
// movement(s) already show that action with the exact material/quantity (same
// convention as the Job Card Activity Timeline built in Unit 7).
function materialsRequestAuditEntry(
  log: AuditLogRow,
  actorName: (id?: string | null) => string
): MaterialsRequestTimelineItem | null {
  const actor = actorName(log.actor_id);
  switch (log.action) {
    case "parts_request.approve":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Materials Request approved",
        detail: metaGet(log.metadata, "comments") ?? "Approved for Store issue.",
        actor, tone: "green", label: "Materials",
      };
    case "parts_request.waiting_stock":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Waiting stock",
        detail: metaGet(log.metadata, "reason") ?? "Marked as waiting stock.",
        actor, tone: "amber", label: "Materials",
      };
    case "parts_request.edit":
      return {
        id: `audit-${log.id}`, at: log.created_at, title: "Request updated",
        detail: "Materials request details were edited.",
        actor, tone: "gray", label: "Materials",
      };
    default:
      return null; // create (dedicated entry below), issue (see movements) — System Audit only
  }
}

/**
 * Builds the staff-facing timeline for a single Materials Request
 * (Maintenance Workflow Redesign Unit 8 Task 3/4): Requested, Approved,
 * Waiting Stock, and any linked Offline Inventory issue/receipt movements —
 * each with actor, timestamp, and material name + quantity where relevant.
 */
function buildMaterialsRequestTimeline(
  request: { id: string; created_at: Date; requested_by: string | null },
  itemSummary: string,
  jobCardNumber: string | null,
  auditLogs: AuditLogRow[],
  offlineMovements: OfflineMovementRow[],
  actorName: (id?: string | null) => string
): MaterialsRequestTimelineItem[] {
  const items: MaterialsRequestTimelineItem[] = [
    {
      id: `mr-created-${request.id}`,
      at: request.created_at,
      title: "Materials requested",
      detail: `${jobCardNumber ? `Linked to Job Card ${jobCardNumber}. ` : ""}${itemSummary ? `Requested: ${itemSummary}` : "Materials requested."}`,
      actor: actorName(request.requested_by),
      tone: "amber",
      label: "Materials",
    },
  ];

  for (const log of auditLogs) {
    const entry = materialsRequestAuditEntry(log, actorName);
    if (entry) items.push(entry);
  }

  for (const m of offlineMovements) {
    const materialName = m.manual_material_name || "material";
    const qty = String(m.quantity);
    if (m.movement_type === "RECEIVED") {
      items.push({
        id: `movement-${m.id}`, at: m.created_at, title: "Materials received",
        detail: `${materialName} — quantity ${qty} ${m.unit}${m.counterparty ? ` from ${m.counterparty}` : ""}`,
        actor: actorName(m.created_by), tone: "blue", label: "Store Issue",
      });
    } else if (m.movement_type === "ISSUED") {
      items.push({
        id: `movement-${m.id}`, at: m.created_at, title: "Materials issued",
        detail: `${materialName} — quantity ${qty} ${m.unit}${m.counterparty ? ` to ${m.counterparty}` : ""}`,
        actor: actorName(m.created_by), tone: "green", label: "Store Issue",
      });
    } else {
      items.push({
        id: `movement-${m.id}`, at: m.created_at,
        title: `${m.movement_type.charAt(0)}${m.movement_type.slice(1).toLowerCase()} recorded`,
        detail: `${materialName} — quantity ${qty} ${m.unit}`,
        actor: actorName(m.created_by), tone: "gray", label: "Store Issue",
      });
    }
  }

  return items.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
}

function notFoundResponse() {
  return (
    <>
      <PageHeader
        title="Materials Request not found"
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "Request Details" }]} />
        }
      />
      <div className="p-4 lg:p-6">
        <EmptyState
          title="Materials Request not found"
          message="This Materials Request may have been deleted, moved, or you may not have permission to view it."
          action={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
        />
      </div>
    </>
  );
}

export default async function PartsRequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | undefined>> }) {
  const context = await requirePermission("parts_requests.view");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : null;
  const warningMsg = sp.warning ?? null;

  // Same visibility rule the list page uses (Route Detail Fix Unit 1 Task 6)
  // — a previous hand-rolled check here used `parts_requests.approve` instead
  // of `work_orders.approve`, which could disagree with the list page for a
  // role that has one permission but not the other. Sharing the exact same
  // function guarantees the two can never drift apart again.
  const visibilityFilter = getPartsRequestVisibilityFilter(context);
  const includeShape = {
    work_orders: {
      select: {
        id: true,
        work_order_number: true,
        status: true,
        operator_complaint: true,
        description_of_work: true,
      },
    },
    assets: { select: { asset_code: true, asset_name: true, category: true, plate_number: true } },
    departments: { select: { name: true } },
  };

  // Look up by id first; `id` is `@db.Uuid` so only attempt that lookup when
  // the param is actually UUID-shaped. Otherwise fall back to a request-number
  // match (accepting the dash-separated URL form of "REC/STORE/PR/0006").
  const isUuid = UUID_RE.test(id);
  let request = isUuid
    ? await prisma.parts_requests.findFirst({
        where: { AND: [{ id }, visibilityFilter] },
        include: includeShape,
      })
    : null;
  if (!request) {
    request = await prisma.parts_requests.findFirst({
      where: {
        AND: [
          { parts_request_number: { equals: id.replace(/-/g, "/"), mode: "insensitive" } },
          visibilityFilter,
        ],
      },
      include: includeShape,
    });
  }

  if (!request) return notFoundResponse();

  // Job Card / Asset are to-one relations selected above but read defensively
  // (Array.isArray) — matches the pattern already used elsewhere on this page
  // for the same fields.
  const jobCard = Array.isArray(request.work_orders) ? (request.work_orders[0] ?? null) : (request.work_orders ?? null);
  const asset = Array.isArray(request.assets) ? (request.assets[0] ?? null) : (request.assets ?? null);
  const dept = Array.isArray(request.departments) ? (request.departments[0] ?? null) : (request.departments ?? null);

  // Batched: items, attachments, this request's own audit trail, and any
  // Offline Inventory movements linked to it — scoped strictly by
  // parts_request_id so only THIS request's movements appear, never another
  // Materials Request's or an unrelated OPENING_STOCK entry (Unit 8 Task 4/10).
  const [rawItems, rawAttachments, auditLogs, offlineMovements] = await Promise.all([
    prisma.parts_request_items.findMany({
      where: { parts_request_id: request.id },
    }),
    prisma.parts_request_attachments.findMany({
      where: { parts_request_id: request.id },
      orderBy: { created_at: "desc" },
    }),
    prisma.audit_logs.findMany({
      where: { entity_type: "parts_request", entity_id: request.id },
      orderBy: { created_at: "desc" },
      take: 50,
    }),
    prisma.offline_inventory_movements.findMany({
      where: { parts_request_id: request.id, deleted_at: null },
      orderBy: { created_at: "desc" },
    }),
  ]);

  const items = rawItems.map((item) => ({
    ...item,
    quantity_requested: item.quantity_requested.toFixed(2),
    unit_price: item.unit_price.toFixed(3),
    total_price: item.total_price?.toFixed(3) ?? null,
    issued_quantity: item.issued_quantity.toFixed(2)
  }));

  const canApprove = context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.approve");
  const canReceive = canReceiveIssueMaterials(context);
  const jobCardHasPendingCorrection = jobCard
    ? (await getPendingCorrectionWorkOrderIds([jobCard.id])).has(jobCard.id)
    : false;

  // The single-material receive panel below only applies while the request
  // is still "Requested" — once received, use the list's Issue popup instead
  // (MaterialsRequest-DataEntryReceiveIssue-01 Task 2/5).
  const isOpen = displayPartsRequestStatus(request.status) === "Requested";

  const canUploadFiles =
    context.role?.slug === "super_admin" ||
    (context.permissions.includes("files.upload") &&
      (context.permissions.includes("parts_requests.approve") ||
        context.permissions.includes("store.issue") ||
        context.permissions.includes("work_orders.manage") ||
        context.permissions.includes("parts_requests.create")));

  const canDeleteFiles =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.approve") ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.manage");

  // Files stored in work-order-files under the linked work_order_id folder
  const workOrderId = (Array.isArray(request.work_orders)
    ? request.work_orders[0]?.id
    : request.work_orders?.id) ?? "";
  const canViewFiles = workOrderId
    ? await canViewEntityFile(context, "work-order-files", workOrderId)
    : false;

  // Single batched profile lookup covering every actor this page needs to
  // display a name for — attachment uploaders, the requester/approver, audit
  // log actors, and Offline Inventory movement creators (Unit 8 Task 10: one
  // round trip instead of a separate query per concern).
  const uploaderIds = [...new Set(rawAttachments.map((a) => a.uploaded_by).filter(Boolean))] as string[];
  const actorIds = [
    ...new Set(
      [
        ...uploaderIds,
        request.requested_by,
        request.approved_by,
        ...auditLogs.map((l) => l.actor_id),
        ...offlineMovements.map((m) => m.created_by),
      ].filter((value): value is string => Boolean(value))
    ),
  ];
  const actorProfiles =
    actorIds.length > 0
      ? await prisma.profiles.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, full_name: true },
        })
      : [];
  const actorMap = new Map(actorProfiles.map((p) => [p.id, p.full_name]));
  const actorName = (id?: string | null) => (id ? (actorMap.get(id) ?? "System user") : "System");

  const signedAttachments = await Promise.all(
    rawAttachments.map(async (a) => ({
      id: a.id,
      label: a.attachment_type,
      fileName: a.file_name,
      contentType: a.content_type ?? "",
      signedUrl: canViewFiles ? await createSignedFileUrl("work-order-files", a.file_path) : null,
      uploadedByName: actorName(a.uploaded_by),
      createdAt: a.created_at.toISOString(),
    }))
  );

  const itemSummary = rawItems
    .slice(0, 3)
    .map((item) => `${item.description} (${item.quantity_requested.toFixed(2)})`)
    .join(", ");
  const timeline = buildMaterialsRequestTimeline(
    { id: request.id, created_at: request.created_at, requested_by: request.requested_by },
    itemSummary,
    jobCard?.work_order_number ?? null,
    auditLogs,
    offlineMovements,
    actorName
  );

  return (
    <>
      {/* Enterprise-Wide Real-Time Update Verification Task 3/8: this page
          previously had no auto-refresh mechanism at all — two users viewing
          the same Materials Request (e.g. one receiving materials while the
          other watches) never saw the other's change without a manual
          reload. */}
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["materials_request.", "job_card.", "work_order.", "offline_inventory.", "material_ledger."]} />
      <PageHeader
        title={request.parts_request_number ?? ""}
        description="Materials request details, linked Job Card, and item tracking."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "Request Details" }]} />
        }
        actions={
          <>
            <BackLink href="/store/parts-requests" label="Back to Materials Requests" />
            <Link href={`/store/parts-requests/${request.id}/print`}>
              <Button variant="secondary">Print</Button>
            </Link>
            <StatusBadge
              label={displayPartsRequestStatus(request.status)}
              tone={partsRequestStatusTone(request.status)}
            />
          </>
        }
      />

      {errorMsg && (
        <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 lg:mx-6">
          {errorMsg}
        </div>
      )}
      {warningMsg === "attachments-failed" && (
        <div className="mx-4 mt-4 rounded-md border border-[#F59E0B] bg-amber-50 px-4 py-3 lg:mx-6">
          <p className="text-sm font-black text-[#92400E]">
            Materials Request created, but some attachments failed to upload
          </p>
          <p className="mt-1 text-sm leading-5 text-[#4B5563]">
            The request was saved successfully. You can upload the missing files again from
            Attachments below.
          </p>
        </div>
      )}

      {/* ── Linked Job Card ─────────────────────────────────────────────
          A Materials Request is a child/queue record of a Job Card — never
          shown disconnected from it (Unit 8 Task 2). */}
      <div className="px-4 pt-4 lg:px-6 lg:pt-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Linked Job Card</h2>
              <p className="mt-1 text-sm text-[#4B5563]">
                This Materials Request belongs to the Job Card below and follows its workflow.
              </p>
            </div>
            {jobCard ? (
              <Link
                href={`/maintenance/work-orders/${jobCard.id}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
              >
                Open Job Card <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Job Card" value={jobCard?.work_order_number ?? "-"} />
            <Info
              label="Job Card Status"
              value={
                jobCard ? (() => {
                  const simplified = displaySimplifiedStatus(jobCard.status);
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge label={simplified} tone={simplifiedStatusTone(simplified)} />
                      {jobCardHasPendingCorrection && (
                        <StatusBadge label={NEEDS_UPDATE_LABEL} tone={NEEDS_UPDATE_TONE} />
                      )}
                    </div>
                  );
                })() : (
                  "-"
                )
              }
            />
            <Info
              label="Asset / Equipment / Vehicle"
              value={asset ? `${asset.asset_name}${asset.asset_code ? ` (${asset.asset_code})` : ""}` : "-"}
            />
            <Info
              label="Category / Plate"
              value={
                asset
                  ? [asset.category, asset.plate_number ? `Plate ${asset.plate_number}` : null].filter(Boolean).join(" · ") || "-"
                  : "-"
              }
            />
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-sm text-[#4B5563]">Problem Summary</dt>
              <dd className="mt-0.5 font-bold text-[#111827]">
                {jobCard?.operator_complaint || jobCard?.description_of_work || "-"}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.8fr] lg:p-6">
        {/* ── Summary ─────────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Request Summary</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Info label="Requested By" value={actorName(request.requested_by)} />
            <Info label="Department" value={dept?.name ?? "-"} />
            <Info label="Items" value={String(items.length)} />
            {/* Store Materials Issue Page Simplification Unit Task 4: a
                viewer without cost visibility (e.g. Store, who has no
                operational need for pricing) used to see "Total: Restricted"
                here — hidden entirely for them instead, since a
                permission-restricted field showing "Restricted" reads as
                confusing/broken rather than intentional. */}
            {canViewCosts(context) && (
              <Info label="Total" value={request.total_price.toFixed(3)} />
            )}
          </dl>
        </section>

        {/* ── Action panels ────────────────────────────────────────── */}
        <section className="space-y-5">
          {/* Simplified Workflow UI Consistency Cleanup Task 4: no standalone
              "Materials Request approval" step while the linked Job Card
              isn't Open yet — the Materials Request is approved together
              with its Job Card in one step (approveJobCardAndMaterialsAction),
              so Manager's primary action here is always "Open Job Card"
              until that happens. The only case a standalone Approve button
              still appears is materials requested/added AFTER the Job Card
              was already Open (Case C — a second Materials Request on an
              already-open Job Card). */}
          {canApprove && request.status === "Requested" && jobCard ? (
            jobCard.status === "Created" ? (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <h2 className="text-lg font-bold text-amber-900">Waiting for Job Card to be opened</h2>
                <p className="mt-1 text-sm text-amber-800">
                  This Materials Request belongs to {jobCard.work_order_number ?? "a Job Card"}, which hasn&apos;t been submitted for review yet.
                </p>
                <Link
                  href={`/maintenance/work-orders/${jobCard.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                >
                  Open Job Card <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </section>
            ) : jobCard.status === "Under Review" ? (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <h2 className="text-lg font-bold text-amber-900">
                  {jobCardHasPendingCorrection ? "Waiting on Data Entry correction" : "Waiting Supervisor / Manager review"}
                </h2>
                <p className="mt-1 text-sm text-amber-800">
                  {jobCardHasPendingCorrection
                    ? `${jobCard.work_order_number ?? "The Job Card"} was sent back to Data Entry for a correction. This Materials Request will be reviewed once it's resubmitted.`
                    : `This Materials Request belongs to ${jobCard.work_order_number ?? "a Job Card"}, which is still awaiting review. Open the Job Card to review both together.`}
                </p>
                <Link
                  href={`/maintenance/work-orders/${jobCard.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                >
                  Open Job Card <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </section>
            ) : jobCard.status !== "Closed" ? (
              <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Approve Materials Request</h2>
                <p className="mt-1 text-sm text-[#4B5563]">
                  {jobCard.work_order_number ?? "This Job Card"} is already open — approve these additional materials to make them ready to receive.
                </p>
                <div className="mt-4 grid gap-3">
                  <form action={approvePartsRequestAction} className="space-y-2">
                    <input type="hidden" name="parts_request_id" value={request.id} />
                    <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder="Approval comments" />
                    <Button type="submit" className="w-full">Approve</Button>
                  </form>
                </div>
              </section>
            ) : null
          ) : null}

          {/* Generic free-text receive log — superseded by the per-item
              "Receive Materials" panel below for the active workflow (Data
              Entry/Manager/Super Admin); kept available to Store Keeper only
              so a legacy free-text log capability isn't deleted outright. */}
          {canReceive && isOpen && context.role?.slug === "store_keeper" && (
            <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Receive Material</h2>
              <p className="mt-1 text-sm text-[#4B5563]">Record materials received against this request.</p>
              <form action={receiveMaterialFromRequestAction} className="mt-4 space-y-3">
                <input type="hidden" name="parts_request_id" value={request.id} />
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Material name *</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="material_name"
                    required
                    placeholder="e.g. Hydraulic oil, Filter, Bearing…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity received *</label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      name="quantity_received"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Unit</label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      name="unit"
                      defaultValue="PCS"
                      placeholder="PCS"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Received from</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="received_from"
                    placeholder="Supplier / vendor name (optional)"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Reference number</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="reference_number"
                    placeholder="Invoice or delivery note number (optional)"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Remarks</label>
                  <textarea
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="remarks"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>
                <Button type="submit">Confirm receipt</Button>
              </form>
            </section>
          )}

          {/* Manager Approval Success Popup and Materials Awaiting Receipt
              Flow Task 8: a short, plain-language banner ahead of the
              Receive Materials panel below, sharing the exact same 3-value
              status mapping as the badge/KPI/quick-view surfaces. */}
          {(() => {
            const receipt = materialsReceiptStatus(request.status, jobCard?.status ?? null, jobCardHasPendingCorrection);
            if (receipt === "Received") {
              return (
                <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
                  Materials received and recorded in Offline Inventory Control.
                </div>
              );
            }
            if (receipt === "To Receive") {
              return (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  Materials are approved and not received yet.
                </div>
              );
            }
            return (
              <div className="mb-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-semibold text-[#4B5563]">
                Materials can be received after the Job Card is approved.
              </div>
            );
          })()}

          {/* Receive Materials panel — per-item receive against the approved
              Materials Request; creates the Offline Inventory Control
              movement and marks the request Received once fully received. */}
          <StoreIssuePanel
            requestId={request.id}
            status={request.status}
            jobCardStatus={jobCard?.status ?? null}
            jobCardHasPendingCorrection={jobCardHasPendingCorrection}
            items={items ?? []}
            context={context}
          />
        </section>

        {/* ── Items table ──────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Items</h2>
          <PartsRequestItemsTable items={items ?? []} context={context} />
        </section>

        {/* ── Materials Request Timeline ──────────────────────────────
            Staff-friendly lifecycle: Requested -> Approved -> Waiting Stock
            -> Partially Issued -> Issued, plus linked Offline Inventory
            issue/receipt movements (Unit 8 Task 3/4). */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Materials Request Timeline</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-[#4B5563]">No activity recorded yet.</p>
          ) : (
            <ol className="space-y-4">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex gap-3 border-b border-[#F3F4F6] pb-4 last:border-0 last:pb-0">
                  <span className="mt-0.5 shrink-0">
                    <StatusBadge label={entry.label} tone={entry.tone} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#111827]">{entry.title}</p>
                    <p className="mt-0.5 text-sm text-[#4B5563]">{entry.detail}</p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      {entry.actor ?? "System"} · {entry.at ? new Date(entry.at).toLocaleString() : "-"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── Attachments ───────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#111827] text-white">
              <Paperclip className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Files</p>
              <h2 className="text-lg font-bold text-[#111827]">Attachments</h2>
            </div>
          </div>

          {/* File list */}
          <div className="mt-5">
            {signedAttachments.length > 0 ? (
              <div className="divide-y divide-[#E5E7EB]">
                {signedAttachments.map((file) => {
                  const isPhoto = file.contentType.startsWith("image/");
                  return (
                    <div key={file.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                          <Paperclip className="h-4 w-4 text-[#4B5563]" />
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
                            <Link className="text-sm font-bold text-[#ED1C24] hover:underline" href={file.signedUrl} target="_blank">View</Link>
                            <Link className="text-sm font-bold text-[#4B5563] hover:underline" href={`${file.signedUrl}?download=1`} download>Download</Link>
                          </>
                        ) : (
                          <span className="text-sm text-[#9CA3AF]">Access restricted</span>
                        )}
                        {canDeleteFiles && (
                          <form action={deletePartsRequestAttachmentAction}>
                            <input type="hidden" name="attachment_id" value={file.id} />
                            <input type="hidden" name="parts_request_id" value={request.id} />
                            <button type="submit" className="text-sm text-red-500 hover:text-red-700 hover:underline">Delete</button>
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
                <form action={uploadPartsRequestAttachmentAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                    {PARTS_REQUEST_ATTACHMENT_CATEGORIES.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <input
                    required
                    type="file"
                    name="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                    className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                  />
                  <Button type="submit">Upload File</Button>
                </form>
              </div>

              {/* Take Photo — rear camera on mobile */}
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Take Photo</p>
                <form action={uploadPartsRequestAttachmentAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                    {["Received Material Photo", "Material Photo", "Delivery Note", "Other Document"].map((opt) => (
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
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="font-bold text-[#111827]">{value}</dd></div>;
}
