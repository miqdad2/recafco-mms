import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Plus, X } from "lucide-react";

import {
  receiveMaterialsForRequestAction,
  issueMaterialsForRequestAction,
} from "@/app/actions/phase4";
import { computeBalance } from "@/app/actions/offline-inventory";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";
import { MaterialsRequestCreatedModal } from "@/components/store/materials-request-created-modal";
import { MaterialsReceivedModal } from "@/components/store/materials-received-modal";
import { MaterialIssuedModal, type IssuedItem } from "@/components/store/material-issued-modal";
import {
  MaterialsRequestQuickView,
  type MaterialsRequestQuickViewData,
} from "@/components/store/materials-request-quick-view";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
  OPEN_PR_STATUSES,
} from "@/lib/display/parts-request-labels";
import { displayStatus } from "@/lib/display/work-order-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  getPartsRequestVisibilityFilter,
  canReceiveIssueMaterials,
} from "@/lib/parts-requests/visibility";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";

const PAGE_SIZE = 25;

const MATERIAL_UNITS = [
  "PCS", "SET", "BOX", "PACK", "MTR", "ROLL",
  "KG", "LTR", "DRUM", "BAG", "PAIR", "NOS",
];

// Virtual filter value → internal DB status array.
// Mirrors the simple 4-state display model in lib/display/parts-request-labels.ts
// (MaterialsRequest-DataEntryReceiveIssue-01 Task 2): Requested / Received / Issued / Cancelled.
const FILTER_STATUS_MAP: Record<string, string[]> = {
  Requested: ["Draft", "Submitted", "Pending Approval", "Waiting for Purchase"],
  Received:  ["Waiting for Store", "Partially Issued"],
  Issued:    ["Issued", "Closed"],
  Rejected:  ["Rejected"],
  Cancelled: ["Cancelled"],
};

const STATUS_FILTER_OPTIONS = [
  { label: "Requested", value: "Requested" },
  { label: "Received",  value: "Received" },
  { label: "Issued",    value: "Issued" },
  { label: "Rejected",  value: "Rejected" },
  { label: "Cancelled", value: "Cancelled" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function listHref({ query, status, page }: { query: string; status: string; page: number }) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
}

function receiveHref(
  requestId: string,
  { query, status, page }: { query: string; status: string; page: number }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  p.set("receive", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

function issueHref(
  requestId: string,
  { query, status, page }: { query: string; status: string; page: number }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  p.set("issueMr", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

function jobCardPreviewHref(
  woId: string,
  { query, status, page }: { query: string; status: string; page: number }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  p.set("jobPreview", woId);
  return `/store/parts-requests?${p.toString()}`;
}

function previewHref(
  requestId: string,
  { query, status, page }: { query: string; status: string; page: number }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  p.set("preview", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

function paginationClass(disabled: boolean) {
  return cn(
    "rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold",
    disabled
      ? "pointer-events-none bg-gray-50 text-gray-400"
      : "bg-white text-[#111827] hover:bg-gray-50"
  );
}

export default async function PartsRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await requirePermission("parts_requests.view");

  const canCreate =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage");

  const canReceive = canReceiveIssueMaterials(context);
  // Manager/Super Admin may receive more than the requested quantity
  // (Task 4's explicit exception); Data Entry is capped at what's remaining.
  const isManagerOrAdmin =
    context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
  const receiveId = single(params.receive)?.trim() ?? null;
  const receiveError =
    receiveId && params.receive_error
      ? decodeURIComponent(String(single(params.receive_error) ?? ""))
      : null;
  const issueMrId = single(params.issueMr)?.trim() ?? null;
  const issueError =
    issueMrId && params.issue_error
      ? decodeURIComponent(String(single(params.issue_error) ?? ""))
      : null;
  const jobPreviewId = single(params.jobPreview)?.trim() ?? null;
  const validJobPreviewId =
    jobPreviewId && UUID_RE.test(jobPreviewId) ? jobPreviewId : null;
  const previewId = single(params.preview)?.trim() ?? null;
  const validPreviewId = previewId && UUID_RE.test(previewId) ? previewId : null;
  const successCode = single(params.success)?.trim() ?? "";
  const showCreatedModal = successCode === "materials-request-created";
  const createdId = single(params.created)?.trim() ?? null;
  const validCreatedId = createdId && UUID_RE.test(createdId) ? createdId : null;
  const mrNumber = single(params.mr) ? decodeURIComponent(String(single(params.mr))) : null;
  const attachmentWarning = single(params.warning) === "attachments-failed";
  const showReceivedModal = successCode === "material-request-received";
  const receivedId = single(params.received)?.trim() ?? null;
  const validReceivedId = receivedId && UUID_RE.test(receivedId) ? receivedId : null;
  const showIssuedModal = successCode === "material-request-issued";
  const issuedReqId = single(params.issued)?.trim() ?? null;
  const validIssuedReqId = issuedReqId && UUID_RE.test(issuedReqId) ? issuedReqId : null;

  // ── Visibility: a user can always see requests they created/requested ────
  const partsRequestVisibility = getPartsRequestVisibilityFilter(context);

  // ── List query ───────────────────────────────────────────────────────────
  const conditions: Prisma.parts_requestsWhereInput[] = [partsRequestVisibility];
  if (status) {
    const mapped = FILTER_STATUS_MAP[status];
    if (mapped) {
      conditions.push(
        mapped.length === 1 ? { status: mapped[0] } : { status: { in: mapped } }
      );
    } else {
      // Backward-compat: old bookmarks may pass raw internal status values
      conditions.push({ status });
    }
  }
  if (query) {
    conditions.push({
      OR: [
        { parts_request_number: { contains: query, mode: "insensitive" } },
        { work_orders: { work_order_number: { contains: query, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.parts_requestsWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [requests, total] = await Promise.all([
    prisma.parts_requests.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        parts_request_number: true,
        status: true,
        work_orders: { select: { id: true, work_order_number: true } },
        profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
        _count: { select: { parts_request_items: true } },
      },
    }),
    prisma.parts_requests.count({ where }),
  ]);

  // ── Receive modal data ────────────────────────────────────────────────────
  const foundReceive =
    receiveId && canReceive && UUID_RE.test(receiveId)
      ? await prisma.parts_requests.findFirst({
          where: { AND: [{ id: receiveId }, partsRequestVisibility] },
          select: {
            id: true,
            parts_request_number: true,
            status: true,
            request_date: true,
            work_orders: { select: { work_order_number: true } },
            assets: { select: { asset_code: true, asset_name: true } },
            profiles_parts_requests_requested_byToprofiles: {
              select: { full_name: true },
            },
            parts_request_items: {
              select: {
                id: true,
                description: true,
                part_number: true,
                ss_rec_code: true,
                quantity_requested: true,
                issued_quantity: true,
              },
              orderBy: { created_at: "asc" },
            },
          },
        })
      : null;

  // Receive only applies while the request is still in the "Requested"
  // state — once it's Received/Issued, the Issue popup takes over.
  const receiveRequest =
    foundReceive && displayPartsRequestStatus(foundReceive.status) === "Requested"
      ? foundReceive
      : null;

  // ── Issue modal data ───────────────────────────────────────────────────────
  // Materials available to issue are derived from what was actually received
  // against this request (the offline_inventory_movements ledger), not from
  // parts_request_items, since items don't carry a unit — the ledger does.
  const foundIssue =
    issueMrId && canReceive && UUID_RE.test(issueMrId)
      ? await prisma.parts_requests.findFirst({
          where: { AND: [{ id: issueMrId }, partsRequestVisibility] },
          select: {
            id: true,
            parts_request_number: true,
            status: true,
            work_orders: { select: { work_order_number: true } },
          },
        })
      : null;

  const issueRequest =
    foundIssue && displayPartsRequestStatus(foundIssue.status) === "Received"
      ? foundIssue
      : null;

  const receivedLinesRaw = issueRequest
    ? await prisma.offline_inventory_movements.findMany({
        where: { parts_request_id: issueRequest.id, movement_type: "RECEIVED", deleted_at: null },
        select: {
          part_id: true,
          manual_material_name: true,
          manual_part_number: true,
          ss_rec_code: true,
          unit: true,
        },
        distinct: ["part_id", "manual_material_name", "unit"],
      })
    : [];

  const issueLines = await Promise.all(
    receivedLinesRaw.map(async (line) => ({
      key: line.part_id ?? `${line.manual_material_name ?? ""}|${line.unit}`,
      materialName: line.manual_material_name,
      partNumber: line.manual_part_number,
      ssRecCode: line.ss_rec_code,
      unit: line.unit,
      available: await computeBalance({
        partId: line.part_id,
        manualName: line.manual_material_name,
        unit: line.unit,
      }),
    }))
  );

  // ── Materials Request created-success modal data ──────────────────────────
  // Best-effort enrichment only — the modal itself must render from query
  // params alone even if this fetch finds nothing (MaterialsRequest-
  // CreateSuccess-UX-01 Task 4). Scoped by the same visibility filter as the
  // list so a tampered `created` id can never leak someone else's request.
  const createdRequest =
    showCreatedModal && validCreatedId
      ? await prisma.parts_requests.findFirst({
          where: { AND: [{ id: validCreatedId }, partsRequestVisibility] },
          select: {
            id: true,
            parts_request_number: true,
            work_orders: { select: { id: true, work_order_number: true } },
            assets: { select: { asset_name: true, asset_code: true } },
            _count: { select: { parts_request_items: true } },
          },
        })
      : null;

  // ── Materials Received success modal data ──────────────────────────────────
  // Same best-effort-enrichment pattern as the created modal above. "Items
  // Received" counts lines with a positive received quantity — since this
  // modal only ever appears immediately after the request's first-ever
  // receive (Requested -> Received), that's exactly what was just received.
  const receivedRequest =
    showReceivedModal && validReceivedId
      ? await prisma.parts_requests.findFirst({
          where: { AND: [{ id: validReceivedId }, partsRequestVisibility] },
          select: {
            id: true,
            parts_request_number: true,
            work_orders: { select: { id: true, work_order_number: true } },
            assets: { select: { asset_name: true } },
            _count: { select: { parts_request_items: { where: { issued_quantity: { gt: 0 } } } } },
          },
        })
      : null;

  // ── Material Issued success modal data ──────────────────────────────────────
  // Same best-effort-enrichment pattern as the created/received modals above.
  // A request can only be issued once (status moves straight to "Issued" and
  // the Action column no longer offers an Issue button), so every ISSUED
  // movement linked to this request id is exactly what was just issued.
  const issuedRequest =
    showIssuedModal && validIssuedReqId
      ? await prisma.parts_requests.findFirst({
          where: { AND: [{ id: validIssuedReqId }, partsRequestVisibility] },
          select: {
            id: true,
            parts_request_number: true,
            work_orders: { select: { id: true, work_order_number: true } },
            assets: { select: { asset_name: true } },
          },
        })
      : null;

  const issuedMovements = issuedRequest
    ? await prisma.offline_inventory_movements.findMany({
        where: { parts_request_id: issuedRequest.id, movement_type: "ISSUED", deleted_at: null },
        select: {
          manual_material_name: true,
          quantity: true,
          unit: true,
          parts: { select: { part_name: true } },
        },
        orderBy: { created_at: "asc" },
      })
    : [];

  const issuedItems: IssuedItem[] = issuedMovements.map((m) => ({
    materialName: m.parts?.part_name ?? m.manual_material_name ?? null,
    quantity: Number(m.quantity),
    unit: m.unit,
  }));

  // ── Materials Request quick view data ──────────────────────────────────────
  // Opens via ?preview=<id> when a request number is clicked — Task 7.
  // Mutually exclusive with the receive modal and the created-success modal.
  const shouldFetchPreview =
    !receiveId && !issueMrId && !showCreatedModal && !showReceivedModal && !showIssuedModal && validPreviewId !== null;
  const previewRequest = shouldFetchPreview
    ? await prisma.parts_requests.findFirst({
        where: { AND: [{ id: validPreviewId! }, partsRequestVisibility] },
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          remarks: true,
          work_orders: { select: { id: true, work_order_number: true } },
          assets: { select: { asset_name: true, asset_code: true } },
          profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
          parts_request_items: {
            select: {
              id: true,
              description: true,
              part_number: true,
              ss_rec_code: true,
              quantity_requested: true,
              issued_quantity: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
      })
    : null;

  // ── Job Card quick view data ──────────────────────────────────────────────
  // Only fetch when no receive/issue modal is active (mutually exclusive modals)
  const shouldFetchJobPreview = !receiveId && !issueMrId && !showIssuedModal && validJobPreviewId !== null;

  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const canAssignModal =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("work_orders.assign") ||
    context.permissions.includes("work_orders.approve");

  const [previewWO, prDataForWO, techsForModal] = shouldFetchJobPreview
    ? await Promise.all([
        prisma.work_orders.findFirst({
          where: {
            AND: [{ id: validJobPreviewId! }, { deleted_at: null }, visibilityFilter],
          },
          select: {
            id: true,
            work_order_number: true,
            status: true,
            maintenance_type: true,
            worker_type: true,
            operator_complaint: true,
            description_of_work: true,
            ordered_by: true,
            date_of_order: true,
            created_at: true,
            job_location: true,
            assets: {
              select: {
                id: true,
                asset_code: true,
                asset_name: true,
                location: true,
                condition: true,
                criticality: true,
              },
            },
            departments: { select: { name: true } },
            work_order_assignments: {
              select: {
                assignment_type: true,
                external_name: true,
                external_company: true,
                external_contact_person: true,
                external_phone: true,
                external_trade: true,
                profiles: { select: { full_name: true } },
              },
            },
            _count: { select: { work_order_required_parts: true, work_order_attachments: true } },
          },
        }),
        prisma.parts_requests.findMany({
          where: { work_order_id: validJobPreviewId! },
          select: { status: true },
          orderBy: { created_at: "desc" },
          take: 20,
        }),
        canAssignModal
          ? prisma.profiles.findMany({
              where: { is_active: true, deleted_at: null },
              select: { id: true, full_name: true },
              orderBy: { full_name: "asc" },
            })
          : Promise.resolve([] as Array<{ id: string; full_name: string }>),
      ])
    : [
        null,
        [] as Array<{ status: string }>,
        [] as Array<{ id: string; full_name: string }>,
      ];

  const isAdmin = context.role?.slug === "super_admin";
  const jobPreviewCloseHref = listHref({ query, status, page });

  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displayStatus(previewWO.status),
        maintenance_type: previewWO.maintenance_type,
        worker_type: previewWO.worker_type,
        operator_complaint: previewWO.operator_complaint,
        description_of_work: previewWO.description_of_work,
        ordered_by: previewWO.ordered_by,
        date_of_order: previewWO.date_of_order?.toISOString() ?? null,
        created_at: previewWO.created_at.toISOString(),
        job_location: previewWO.job_location,
        assets: previewWO.assets
          ? {
              id: previewWO.assets.id,
              asset_code: previewWO.assets.asset_code,
              asset_name: previewWO.assets.asset_name,
              location: previewWO.assets.location,
              condition: previewWO.assets.condition,
              criticality: previewWO.assets.criticality,
            }
          : null,
        department_name: previewWO.departments?.name ?? null,
        technician_names: previewWO.work_order_assignments
          .filter(
            (a) =>
              a.assignment_type === "INTERNAL_TECHNICIAN" && a.profiles?.full_name
          )
          .map((a) => a.profiles!.full_name),
        technicians: techsForModal,
        primary_assignment: previewWO.work_order_assignments[0]
          ? {
              assignment_type: previewWO.work_order_assignments[0].assignment_type,
              external_name:
                previewWO.work_order_assignments[0].external_name ?? null,
              external_company:
                previewWO.work_order_assignments[0].external_company ?? null,
              external_contact_person:
                previewWO.work_order_assignments[0].external_contact_person ?? null,
              external_phone:
                previewWO.work_order_assignments[0].external_phone ?? null,
              external_trade:
                previewWO.work_order_assignments[0].external_trade ?? null,
            }
          : null,
        required_parts_count: previewWO._count.work_order_required_parts,
        parts_requests_count: prDataForWO.length,
        open_parts_requests_count: prDataForWO.filter((pr) =>
          OPEN_PR_STATUSES.includes(pr.status)
        ).length,
        last_parts_request_status: prDataForWO[0]
          ? displayPartsRequestStatus(prDataForWO[0].status)
          : null,
        attachment_count: previewWO._count.work_order_attachments,
        roleSlug: context.role?.slug ?? "",
        canApprove: isAdmin || context.permissions.includes("work_orders.approve"),
        canAssign: isAdmin || context.permissions.includes("work_orders.assign"),
        canManage: isAdmin || context.permissions.includes("work_orders.manage"),
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        closeHref: jobPreviewCloseHref,
      }
    : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const closeHref = listHref({ query, status, page });

  // ── Created-success modal props ───────────────────────────────────────────
  const createdDismissHref = listHref({ query: "", status: "", page: 1 });
  const createdJobCardHref = createdRequest?.work_orders
    ? jobCardPreviewHref(createdRequest.work_orders.id, { query: "", status: "", page: 1 })
    : null;

  // ── Received-success modal props ──────────────────────────────────────────
  const receivedDismissHref = listHref({ query: "", status: "", page: 1 });
  const receivedJobCardHref = receivedRequest?.work_orders
    ? jobCardPreviewHref(receivedRequest.work_orders.id, { query: "", status: "", page: 1 })
    : null;
  // Opens the Issue Material popup directly for this same request (Task 2) —
  // only when we actually resolved the request id from the re-fetch above.
  const receivedIssueHref = receivedRequest
    ? issueHref(receivedRequest.id, { query: "", status: "", page: 1 })
    : validReceivedId
      ? issueHref(validReceivedId, { query: "", status: "", page: 1 })
      : null;

  // ── Material Issued success modal props ───────────────────────────────────
  const issuedDismissHref = listHref({ query: "", status: "", page: 1 });
  const issuedJobCardHref = issuedRequest?.work_orders
    ? jobCardPreviewHref(issuedRequest.work_orders.id, { query: "", status: "", page: 1 })
    : null;

  // ── Materials Request quick view props ────────────────────────────────────
  const previewCloseHref = listHref({ query, status, page });
  const previewQuickViewData: MaterialsRequestQuickViewData | null = previewRequest
    ? {
        id: previewRequest.id,
        parts_request_number: previewRequest.parts_request_number,
        displayStatus: displayPartsRequestStatus(previewRequest.status),
        tone: partsRequestStatusTone(previewRequest.status),
        work_order_number: previewRequest.work_orders?.work_order_number ?? null,
        asset_name: previewRequest.assets?.asset_name ?? null,
        asset_code: previewRequest.assets?.asset_code ?? null,
        requested_by_name:
          previewRequest.profiles_parts_requests_requested_byToprofiles?.full_name ?? null,
        remarks: previewRequest.remarks,
        items: previewRequest.parts_request_items.map((item) => ({
          id: item.id,
          description: item.description,
          part_number: item.part_number,
          ss_rec_code: item.ss_rec_code,
          quantity_requested: Number(item.quantity_requested),
          issued_quantity: Number(item.issued_quantity),
        })),
        closeHref: previewCloseHref,
        jobCardPreviewHref: previewRequest.work_orders
          ? jobCardPreviewHref(previewRequest.work_orders.id, { query, status, page })
          : null,
        detailHref: `/store/parts-requests/${previewRequest.id}`,
      }
    : null;

  return (
    <>
      <AutoRefresh intervalMs={30000} />
      {showCreatedModal && (
        <MaterialsRequestCreatedModal
          requestId={createdRequest?.id ?? null}
          requestNumber={createdRequest?.parts_request_number ?? mrNumber}
          jobCardNumber={createdRequest?.work_orders?.work_order_number ?? null}
          jobCardPreviewHref={createdJobCardHref}
          assetName={createdRequest?.assets?.asset_name ?? null}
          itemCount={createdRequest ? createdRequest._count.parts_request_items : null}
          attachmentWarning={attachmentWarning}
          dismissHref={createdDismissHref}
        />
      )}
      {showReceivedModal && (
        <MaterialsReceivedModal
          requestNumber={receivedRequest?.parts_request_number ?? null}
          jobCardNumber={receivedRequest?.work_orders?.work_order_number ?? null}
          jobCardPreviewHref={receivedJobCardHref}
          assetName={receivedRequest?.assets?.asset_name ?? null}
          itemsReceivedCount={receivedRequest ? receivedRequest._count.parts_request_items : null}
          attachmentWarning={attachmentWarning}
          issueHref={receivedIssueHref}
          dismissHref={receivedDismissHref}
        />
      )}
      {showIssuedModal && (
        <MaterialIssuedModal
          requestNumber={issuedRequest?.parts_request_number ?? null}
          jobCardNumber={issuedRequest?.work_orders?.work_order_number ?? null}
          jobCardPreviewHref={issuedJobCardHref}
          assetName={issuedRequest?.assets?.asset_name ?? null}
          issuedItems={issuedItems}
          attachmentWarning={attachmentWarning}
          dismissHref={issuedDismissHref}
        />
      )}
      <PageHeader
        title="Materials Requests"
        description="Materials request queue for approval and follow-up."
        actions={
          canCreate ? (
            <Link
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c9151c]"
              href="/store/parts-requests/new"
            >
              <Plus className="h-4 w-4" />
              New materials request
            </Link>
          ) : null
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* ── Filter ───────────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
            <input
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="q"
              defaultValue={query}
              placeholder="Search request number or job card number"
            />
            <select
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="status"
              defaultValue={status}
            >
              <option value="">All statuses</option>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
              type="submit"
            >
              Filter
            </button>
          </form>
        </section>

        {/* ── Table ────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">
                Materials requests
              </p>
              <p className="text-sm font-semibold text-[#111827]">
                {total} matching requests
              </p>
            </div>
            <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
          </div>
          {requests.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Request</th>
                    <th className="px-4 py-3">Job Card</th>
                    <th className="px-4 py-3">Requester</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {requests.map((request) => {
                    const displaySt = displayPartsRequestStatus(request.status);
                    const woId = request.work_orders?.id ?? null;
                    const woNumber = request.work_orders?.work_order_number ?? null;
                    return (
                      <tr key={request.id} className="hover:bg-gray-50">
                        {/* Request number — opens the quick view (Task 7) */}
                        <td className="px-4 py-3">
                          <Link
                            className="font-bold hover:text-[#ED1C24]"
                            href={previewHref(request.id, { query, status, page })}
                            scroll={false}
                          >
                            {request.parts_request_number}
                          </Link>
                        </td>

                        {/* Job Card — clickable to open quick view */}
                        <td className="px-4 py-3">
                          {woId && woNumber ? (
                            <Link
                              href={jobCardPreviewHref(woId, { query, status, page })}
                              scroll={false}
                              className="font-semibold text-[#ED1C24] hover:underline"
                            >
                              {woNumber}
                            </Link>
                          ) : (
                            <span className="text-[#9CA3AF]">-</span>
                          )}
                        </td>

                        {/* Requester */}
                        <td className="px-4 py-3">
                          {request.profiles_parts_requests_requested_byToprofiles
                            ?.full_name ?? "-"}
                        </td>

                        {/* Items count */}
                        <td className="px-4 py-3">
                          {request._count.parts_request_items}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={displaySt}
                            tone={partsRequestStatusTone(request.status)}
                          />
                        </td>

                        {/* Action — Task 3: Requested -> Receive, Received -> Issue,
                            Issued/Cancelled/Rejected -> plain status text */}
                        <td className="px-4 py-3">
                          {canReceive && displaySt === "Requested" ? (
                            <Link
                              href={receiveHref(request.id, { query, status, page })}
                              className="inline-flex min-h-[30px] items-center rounded-md bg-[#ED1C24] px-3 py-1 text-xs font-semibold text-white hover:bg-[#c9151c]"
                            >
                              Receive
                            </Link>
                          ) : canReceive && displaySt === "Received" ? (
                            <Link
                              href={issueHref(request.id, { query, status, page })}
                              className="inline-flex min-h-[30px] items-center rounded-md bg-[#111827] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                            >
                              Issue
                            </Link>
                          ) : displaySt === "Issued" ? (
                            <span className="text-xs font-semibold text-green-700">
                              Issued
                            </span>
                          ) : displaySt === "Cancelled" ? (
                            <span className="text-xs font-semibold text-[#4B5563]">
                              Cancelled
                            </span>
                          ) : (
                            <span className="text-xs text-[#4B5563]">{displaySt}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title={
                  query || status
                    ? "No materials requests match the current filters."
                    : "No Materials Requests found."
                }
                message={
                  query || status
                    ? "Try clearing the search or status filter."
                    : "Create a Materials Request from a Job Card or use New Materials Request to request materials."
                }
              />
            </div>
          )}
        </section>

        {/* ── Pagination ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <Link
            className={paginationClass(page <= 1)}
            href={listHref({ query, status, page: Math.max(1, page - 1) })}
            aria-disabled={page <= 1}
          >
            Previous
          </Link>
          <span className="text-sm font-semibold text-[#4B5563]">
            Showing {requests.length ? (page - 1) * PAGE_SIZE + 1 : 0}–
            {Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <Link
            className={paginationClass(page >= totalPages)}
            href={listHref({ query, status, page: Math.min(totalPages, page + 1) })}
            aria-disabled={page >= totalPages}
          >
            Next
          </Link>
        </div>
      </div>

      {/* ── Job Card quick view modal ────────────────────────────────
          Opens via ?jobPreview=<woId>. Mutually exclusive with receive modal.
          RepairOrderQuickView is a client component; it handles ESC, backdrop
          click, and body-scroll lock. closeHref returns to the list page.
      ────────────────────────────────────────────────────────────── */}
      {!receiveId && validJobPreviewId && (
        drawerData ? (
          <RepairOrderQuickView data={drawerData} />
        ) : (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            {/* Not-found / no-access card */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Job Card not found</p>
                <p className="mt-1 text-sm text-[#4B5563]">
                  This job card is not available or you do not have access to it.
                </p>
                <div className="mt-4">
                  <Link
                    href={jobPreviewCloseHref}
                    className="inline-block rounded-md border border-[#E5E7EB] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Close
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* ── Materials Request quick view modal ───────────────────────
          Opens via ?preview=<id> when a request number is clicked (Task 7).
          Mutually exclusive with receive modal and the created-success modal.
      ────────────────────────────────────────────────────────────── */}
      {!receiveId && !showCreatedModal && validPreviewId && (
        previewQuickViewData ? (
          <MaterialsRequestQuickView data={previewQuickViewData} />
        ) : (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Materials Request not found</p>
                <p className="mt-1 text-sm text-[#4B5563]">
                  This request is not available or you do not have access to it.
                </p>
                <div className="mt-4">
                  <Link
                    href={previewCloseHref}
                    className="inline-block rounded-md border border-[#E5E7EB] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Close
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* ── Receive Material modal ───────────────────────────────────
          Opens via ?receive=<prId>. Receive takes precedence over job preview.
          Closes via Cancel/X links back to the list without receive param.
      ────────────────────────────────────────────────────────────── */}
      {receiveRequest && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto w-full max-w-[800px]">
            <div className="overflow-x-hidden rounded-lg bg-white shadow-xl">
              {/* Modal header */}
              <div className="flex items-start justify-between border-b border-[#E5E7EB] px-6 py-4">
                <div>
                  <h2 className="text-lg font-bold text-[#111827]">
                    Receive Materials
                  </h2>
                  <p className="text-sm text-[#4B5563]">
                    {receiveRequest.parts_request_number ?? "Materials Request"}
                  </p>
                </div>
                <Link
                  href={closeHref}
                  aria-label="Close"
                  className="rounded-md p-1 text-[#4B5563] hover:bg-gray-100 hover:text-[#111827]"
                >
                  <X className="h-5 w-5" />
                </Link>
              </div>

              {/* Error from failed submission */}
              {receiveError && (
                <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {receiveError}
                </div>
              )}

              {/* Context summary — Task 4: request number, linked Job Card, asset, items count */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-[#4B5563]">Materials Request</dt>
                  <dd className="font-semibold">
                    {receiveRequest.parts_request_number ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Job Card</dt>
                  <dd className="font-semibold">
                    {receiveRequest.work_orders?.work_order_number ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Asset / Equipment</dt>
                  <dd className="font-semibold">
                    {receiveRequest.assets?.asset_name
                      ? `${receiveRequest.assets.asset_name}${receiveRequest.assets.asset_code ? ` (${receiveRequest.assets.asset_code})` : ""}`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Requested items</dt>
                  <dd className="font-semibold">
                    {receiveRequest.parts_request_items.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Requested by</dt>
                  <dd className="font-semibold">
                    {receiveRequest
                      .profiles_parts_requests_requested_byToprofiles
                      ?.full_name ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Status</dt>
                  <dd>
                    <StatusBadge
                      label={displayPartsRequestStatus(receiveRequest.status)}
                      tone={partsRequestStatusTone(receiveRequest.status)}
                    />
                  </dd>
                </div>
              </dl>

              {/* Form */}
              <form
                action={receiveMaterialsForRequestAction}
                className="px-6 pb-6 pt-4"
              >
                <input
                  type="hidden"
                  name="parts_request_id"
                  value={receiveRequest.id}
                />

                {/* Items table */}
                {receiveRequest.parts_request_items.length === 0 ? (
                  <p className="py-4 text-sm text-[#4B5563]">
                    No materials listed for this request.
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-md border border-[#E5E7EB]">
                    <p className="border-b border-[#E5E7EB] bg-gray-50 px-3 py-2 text-xs text-[#4B5563]">
                      {isManagerOrAdmin
                        ? "As Manager/Admin, you may receive more than the requested quantity if needed."
                        : "Quantity received cannot exceed the requested quantity."}
                    </p>
                    <table className="w-full min-w-[580px] text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                        <tr>
                          <th className="px-3 py-2 text-left">Material Name</th>
                          <th className="px-3 py-2 text-left">Part / SS</th>
                          <th className="px-3 py-2 text-right">Requested</th>
                          <th className="px-3 py-2 text-right">Received</th>
                          <th className="px-3 py-2 text-right">Remaining</th>
                          <th className="px-3 py-2 text-left">Quantity Received</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {receiveRequest.parts_request_items.map((item) => {
                          const qtyReq = Number(item.quantity_requested);
                          const qtyIssued = Number(item.issued_quantity);
                          const qtyRemaining = Math.max(0, qtyReq - qtyIssued);
                          const done = qtyRemaining < 0.001;
                          const partRef =
                            (item.part_number as string | null) ??
                            (item.ss_rec_code as string | null) ??
                            "-";
                          return (
                            <tr
                              key={item.id}
                              className={
                                done ? "bg-gray-50 text-[#9CA3AF]" : undefined
                              }
                            >
                              <td className="px-3 py-2 font-semibold">
                                {item.description}
                              </td>
                              <td className="px-3 py-2">{partRef}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {qtyReq.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {qtyIssued.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                {qtyRemaining.toFixed(2)}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  name={`qty_${item.id}`}
                                  className="focus-ring w-24 rounded-md border border-[#DDE2EA] px-2 py-1 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-[#9CA3AF]"
                                  min="1"
                                  max={isManagerOrAdmin ? undefined : Math.floor(qtyRemaining)}
                                  step="1"
                                  placeholder="0"
                                  disabled={!isManagerOrAdmin && done}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  name={`unit_${item.id}`}
                                  className="focus-ring rounded-md border border-[#DDE2EA] px-2 py-1 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-[#9CA3AF]"
                                  defaultValue="PCS"
                                  disabled={!isManagerOrAdmin && done}
                                >
                                  {MATERIAL_UNITS.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Shared receipt fields */}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                      Received from
                    </label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                      name="received_from"
                      placeholder="Supplier / vendor (optional)"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                      Reference number
                    </label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                      name="reference_number"
                      placeholder="Invoice / delivery note (optional)"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                    Remarks
                  </label>
                  <textarea
                    className="focus-ring w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                    name="remarks"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>

                {/* Attachment / Photo (optional) */}
                <div className="mt-4 w-full max-w-full overflow-x-hidden rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Attachment / Photo — Optional</p>

                  <div className="mb-3 min-w-0 w-full">
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Document type</label>
                    <select
                      name="attachment_type"
                      className="focus-ring w-full min-w-0 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                    >
                      {[
                        "Received Material Photo",
                        "Delivery Note",
                        "Invoice",
                        "Supplier Document",
                        "Material Photo",
                        "Other Document",
                      ].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid w-full max-w-full grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="min-w-0 w-full">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Upload File</label>
                      <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                        <input
                          type="file"
                          name="attachment_file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                          className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#111827] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                        />
                      </div>
                    </div>
                    <div className="min-w-0 w-full">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Take Photo</label>
                      <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                        <input
                          type="file"
                          name="attachment_file"
                          accept="image/*"
                          capture="environment"
                          aria-label="Take photo with camera"
                          className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#4B5563] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-[#9CA3AF]">Use camera to capture received material photo.</p>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    Upload a delivery note, invoice, supporting file, or take a photo of the received materials.
                    <br />
                    Accepted: PDF, JPG, JPEG, PNG, WEBP, XLS, XLSX, DOC, DOCX
                  </p>
                </div>

                {/* Buttons */}
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Link
                    href={closeHref}
                    className="rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:bg-[#c9151c]"
                  >
                    Confirm Received
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Issue Material modal ───────────────────────────────────────
          Opens via ?issueMr=<prId>, only for requests that have been
          Received. Task 6/7.
      ────────────────────────────────────────────────────────────── */}
      {issueRequest && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto w-full max-w-[800px]">
            <div className="overflow-x-hidden rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between border-b border-[#E5E7EB] px-6 py-4">
                <div>
                  <h2 className="text-lg font-bold text-[#111827]">Issue Material</h2>
                  <p className="text-sm text-[#4B5563]">
                    {issueRequest.parts_request_number ?? "Materials Request"}
                  </p>
                </div>
                <Link
                  href={closeHref}
                  aria-label="Close"
                  className="rounded-md p-1 text-[#4B5563] hover:bg-gray-100 hover:text-[#111827]"
                >
                  <X className="h-5 w-5" />
                </Link>
              </div>

              {issueError && (
                <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {issueError}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-[#4B5563]">Materials Request</dt>
                  <dd className="font-semibold">
                    {issueRequest.parts_request_number ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Related Job Card</dt>
                  <dd className="font-semibold">
                    {issueRequest.work_orders?.work_order_number ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#4B5563]">Status</dt>
                  <dd>
                    <StatusBadge
                      label={displayPartsRequestStatus(issueRequest.status)}
                      tone={partsRequestStatusTone(issueRequest.status)}
                    />
                  </dd>
                </div>
              </dl>

              <form action={issueMaterialsForRequestAction} className="px-6 pb-6 pt-4">
                <input type="hidden" name="parts_request_id" value={issueRequest.id} />

                {issueLines.length === 0 ? (
                  <p className="py-4 text-sm text-[#4B5563]">
                    No received materials found for this request.
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-md border border-[#E5E7EB]">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                        <tr>
                          <th className="px-3 py-2 text-left">Material</th>
                          <th className="px-3 py-2 text-right">Available balance</th>
                          <th className="px-3 py-2 text-left">Quantity to Issue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {issueLines.map((line) => {
                          const noBalance = line.available <= 0;
                          return (
                            <tr key={line.key} className={noBalance ? "bg-gray-50 text-[#9CA3AF]" : undefined}>
                              <td className="px-3 py-2 font-semibold">
                                {line.materialName ?? line.partNumber ?? "-"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {line.available} {line.unit}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  name={`issueQty_${line.key}`}
                                  className="focus-ring w-24 rounded-md border border-[#DDE2EA] px-2 py-1 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-[#9CA3AF]"
                                  min="1"
                                  max={line.available}
                                  step="1"
                                  placeholder="0"
                                  disabled={noBalance}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4">
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                    Issued to
                  </label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                    name="issued_to"
                    placeholder="Technician / requester (optional)"
                  />
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                    Remarks
                  </label>
                  <textarea
                    className="focus-ring w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                    name="remarks"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>

                {/* Attachment / Photo (optional) */}
                <div className="mt-4 w-full max-w-full overflow-x-hidden rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Attachment / Photo — Optional</p>

                  <div className="mb-3 min-w-0 w-full">
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Document type</label>
                    <select
                      name="attachment_type"
                      className="focus-ring w-full min-w-0 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                    >
                      {[
                        "Material Issue Photo",
                        "Handover Note",
                        "Other Document",
                      ].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid w-full max-w-full grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="min-w-0 w-full">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Upload File</label>
                      <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                        <input
                          type="file"
                          name="attachment_file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                          className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#111827] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                        />
                      </div>
                    </div>
                    <div className="min-w-0 w-full">
                      <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Take Photo</label>
                      <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                        <input
                          type="file"
                          name="attachment_file"
                          accept="image/*"
                          capture="environment"
                          aria-label="Take photo with camera"
                          className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#4B5563] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-[#9CA3AF]">Use camera to capture issued material photo.</p>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    Upload a handover note, supporting file, or take a photo of the issued materials.
                    <br />
                    Accepted: PDF, JPG, JPEG, PNG, WEBP, XLS, XLSX, DOC, DOCX
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Link
                    href={closeHref}
                    className="rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    className="rounded-md bg-[#111827] px-4 py-2 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                  >
                    Confirm Issue
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
