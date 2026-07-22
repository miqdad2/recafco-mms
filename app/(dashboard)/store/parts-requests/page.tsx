import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Package, Plus, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/dashboard/stat-card";
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
  materialsRequestListGroup,
  materialsRequestListGroupTone,
  materialsRequestStoreFollowUpHint,
  OPEN_PR_STATUSES,
} from "@/lib/display/parts-request-labels";
import { displayStatus as displayJobCardStatus } from "@/lib/display/work-order-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getReviewedWorkOrderIds } from "@/lib/work-orders/review-status";
import { getPartsRequestVisibilityFilter } from "@/lib/parts-requests/visibility";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

// Materials Request list simplification: the list page groups the 5 real
// DB statuses into 4 simple buckets — Waiting Stock and Partially Issued are
// internal Store-side states normal users don't need to distinguish, so both
// fold into one "Store Follow-up" tab/card ("store-followup" bucket key in
// the URL). The individual statuses still exist in the database and are
// still filterable directly (e.g. an existing dashboard deep link to
// ?status=Waiting+Stock keeps working), they just aren't offered as their
// own tab/card here. Never uses old words (Draft/Submitted/Pending
// Approval/Waiting for Store/Waiting for Purchase/Rejected/Cancelled/Closed)
// as a tab.
const MATERIALS_REQUEST_TABS = [
  { label: "All",               key: "",              statuses: [] as string[] },
  { label: "Requested",         key: "Requested",      statuses: ["Requested"] },
  { label: "Approved",          key: "Approved",       statuses: ["Approved"] },
  { label: "Store Follow-up",   key: "store-followup", statuses: ["Waiting Stock", "Partially Issued"] },
  { label: "Issued",            key: "Issued",         statuses: ["Issued"] },
];

// Wording for a status tab/deep-link that has zero matching Materials
// Requests. Raw "Waiting Stock" / "Partially Issued" deep links (e.g. from
// the dashboard) map to the same Store Follow-up wording as the
// "store-followup" bucket key, so no internal status word ever surfaces.
const TAB_EMPTY_STATE: Record<string, { title: string; message: string }> = {
  Requested: {
    title: "No Materials Requests found.",
    message: "New materials requests will appear here.",
  },
  Approved: {
    title: "No approved Materials Requests.",
    message: "Approved requests ready for Store issue will appear here.",
  },
  "store-followup": {
    title: "No Materials Requests need Store follow-up.",
    message: "Requests Store is arranging or updating materials for will appear here.",
  },
  "Waiting Stock": {
    title: "No Materials Requests need Store follow-up.",
    message: "Requests Store is arranging or updating materials for will appear here.",
  },
  "Partially Issued": {
    title: "No Materials Requests need Store follow-up.",
    message: "Requests Store is arranging or updating materials for will appear here.",
  },
  Issued: {
    title: "No Materials Requests issued yet.",
    message: "Fully issued requests will appear here.",
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Whole numbers render without decimals ("1" not "1.00"); fractional
// quantities still show up to 2 decimal places.
function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function listHref({ query, status, page }: { query: string; status: string; page: number }) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
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

  // Task 7's row quick-action gates: Approve (Requested) and Issue (Approved/
  // Waiting Stock/Partially Issued) — both link to the detail page rather than
  // acting inline (Task 4/7's "not fully safe from the list" rule).
  const canApprove =
    context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.approve");
  const canIssue =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.issue") ||
    context.permissions.includes("store.issue");

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
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
  if (status === "store-followup") {
    conditions.push({ status: { in: ["Waiting Stock", "Partially Issued"] } });
  } else if (status) {
    // Covers the 3 single-status tabs (Requested/Approved/Issued) plus
    // backward-compat direct deep links to a raw status the "store-followup"
    // bucket folds together (e.g. an existing dashboard link to
    // ?status=Waiting+Stock) — a literal match, which safely yields zero rows
    // for any value that isn't a real status.
    conditions.push({ status });
  }
  if (query) {
    conditions.push({
      OR: [
        { parts_request_number: { contains: query, mode: "insensitive" } },
        { work_orders: { work_order_number: { contains: query, mode: "insensitive" } } },
        { assets: { asset_code: { contains: query, mode: "insensitive" } } },
        { assets: { asset_name: { contains: query, mode: "insensitive" } } },
        { assets: { plate_number: { contains: query, mode: "insensitive" } } },
        { profiles_parts_requests_requested_byToprofiles: { full_name: { contains: query, mode: "insensitive" } } },
        // Task 8: also match by requested material name.
        { parts_request_items: { some: { description: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  const where: Prisma.parts_requestsWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [requests, total, statusSummaries] = await Promise.all([
    prisma.parts_requests.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        parts_request_number: true,
        status: true,
        work_orders: { select: { id: true, work_order_number: true, status: true } },
        assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
        profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
        parts_request_items: { select: { quantity_requested: true, issued_quantity: true } },
        _count: { select: { parts_request_items: true } },
      },
    }),
    prisma.parts_requests.count({ where }),
    // Task 6: bucket counters, scoped by the same visibility filter as the list.
    prisma.parts_requests.groupBy({
      by: ["status"],
      where: partsRequestVisibility,
      _count: { _all: true },
    }),
  ]);

  const totalRequests = statusSummaries.reduce((n, s) => n + s._count._all, 0);
  const countFor = (statuses: string[]) =>
    statusSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const requestedCount = countFor(["Requested"]);
  const approvedCount = countFor(["Approved"]);
  const storeFollowUpCount = countFor(["Waiting Stock", "Partially Issued"]);
  const issuedCount = countFor(["Issued"]);

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
  // Mutually exclusive with the created/received/issued success modals.
  const shouldFetchPreview =
    !showCreatedModal && !showReceivedModal && !showIssuedModal && validPreviewId !== null;
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
  // Only fetch when the issued-success modal isn't active (mutually exclusive modals)
  const shouldFetchJobPreview = !showIssuedModal && validJobPreviewId !== null;

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
                category: true,
                brand: true,
                model: true,
                plate_number: true,
                status: true,
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
          select: {
            id: true,
            parts_request_number: true,
            status: true,
            parts_request_items: { select: { id: true, description: true, quantity_requested: true, issued_quantity: true } },
          },
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
        [] as Array<{ id: string; parts_request_number: string | null; status: string; parts_request_items: { id: string; description: string; quantity_requested: unknown; issued_quantity: unknown }[] }>,
        [] as Array<{ id: string; full_name: string }>,
      ];

  const isAdmin = context.role?.slug === "super_admin";
  const jobPreviewCloseHref = listHref({ query, status, page });
  const previewReviewed =
    previewWO && previewWO.status === "Under Review"
      ? (await getReviewedWorkOrderIds([previewWO.id])).has(previewWO.id)
      : false;

  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displayJobCardStatus(previewWO.status),
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
              category: previewWO.assets.category,
              brand: previewWO.assets.brand,
              model: previewWO.assets.model,
              plate_number: previewWO.assets.plate_number,
              status: previewWO.assets.status,
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
        all_parts_requests: prDataForWO.map((pr) => ({
          id: pr.id,
          parts_request_number: pr.parts_request_number,
          status: pr.status,
          items: pr.parts_request_items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity_requested: Number(item.quantity_requested),
            issued_quantity: Number(item.issued_quantity),
          })),
        })),
        attachment_count: previewWO._count.work_order_attachments,
        roleSlug: context.role?.slug ?? "",
        canApprove: isAdmin || context.permissions.includes("work_orders.approve"),
        canAssign: isAdmin || context.permissions.includes("work_orders.assign"),
        canManage: isAdmin || context.permissions.includes("work_orders.manage"),
        canReview: isAdmin || context.permissions.includes("work_orders.review"),
        canRequestCorrection: isAdmin || context.permissions.includes("work_orders.request_correction"),
        canClose: isAdmin || context.permissions.includes("work_orders.close"),
        canUpdateProgress: isAdmin || context.permissions.includes("work_orders.update"),
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        reviewed: previewReviewed,
        closeHref: jobPreviewCloseHref,
      }
    : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
  // Unit 9: the list-page Issue popup was removed (incompatible with the
  // Unit 5 itemId-based issue engine — Task 7). This now links straight to
  // the Materials Request detail page's Store Issue panel instead.
  const receivedIssueHref = receivedRequest
    ? `/store/parts-requests/${receivedRequest.id}`
    : validReceivedId
      ? `/store/parts-requests/${validReceivedId}`
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
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["materials_request.", "store_materials.", "job_card.approved"]} />
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
        {/* ── Counters — simplified to 5 cards; Waiting Stock and Partially
              Issued are folded into one "Store Follow-up" card so daily
              users aren't shown internal Store states as top-level metrics. */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {([
            { label: "Total Materials Requests", value: totalRequests, icon: ClipboardList, tone: "blue" as const, status: "" },
            { label: "Requested",        value: requestedCount,        icon: ShoppingCart, tone: requestedCount > 0 ? "amber" : "gray", status: "Requested" },
            { label: "Approved",         value: approvedCount,         icon: CheckCircle2, tone: "blue" as const, status: "Approved" },
            { label: "Store Follow-up",  value: storeFollowUpCount,  icon: Package,      tone: storeFollowUpCount > 0 ? "amber" : "gray", status: "store-followup" },
            { label: "Issued",           value: issuedCount,           icon: CheckCircle2, tone: "green" as const, status: "Issued" },
          ] as { label: string; value: number; icon: LucideIcon; tone: "green" | "amber" | "blue" | "gray"; status: string }[]).map((c) => (
            <Link key={c.label} href={listHref({ query: "", status: c.status, page: 1 })} className="block">
              <StatCard label={c.label} value={c.value} icon={c.icon} tone={c.tone} compact />
            </Link>
          ))}
        </section>

        {/* ── Filter ───────────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-3 lg:grid-cols-[1fr_auto]">
            {status && <input type="hidden" name="status" value={status} />}
            <input
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="q"
              defaultValue={query}
              placeholder="Search request no., job card no., asset, plate, material, requester…"
            />
            <button
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
              type="submit"
            >
              Search
            </button>
          </form>
        </section>

        {/* ── Status tabs — grouped into 4 simple buckets (All/Requested/
              Approved/Store Follow-up/Issued); a raw ?status=Waiting+Stock
              or ?status=Partially+Issued deep link (e.g. from the dashboard)
              still filters correctly and highlights "Store Follow-up" as
              active, since both fold into that bucket's statuses list. ── */}
        <div className="overflow-x-auto rounded-t-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex min-w-max">
            {MATERIALS_REQUEST_TABS.map((tab) => {
              const isActive =
                tab.key === "" ? !status : status === tab.key || tab.statuses.includes(status);
              const itemCount = tab.statuses.length ? countFor(tab.statuses) : totalRequests;
              return (
                <Link
                  key={tab.key || "all"}
                  href={listHref({ query, status: tab.key, page: 1 })}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-bold transition ${
                    isActive
                      ? "border-[#ED1C24] bg-red-50/60 text-[#ED1C24]"
                      : "border-transparent text-[#111827] hover:bg-gray-50"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      isActive ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"
                    }`}
                  >
                    {itemCount}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-b-md border border-t-0 border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
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
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Request</th>
                    <th className="px-4 py-3">Job Card</th>
                    <th className="px-4 py-3">Asset / Equipment / Vehicle</th>
                    <th className="px-4 py-3">Requester</th>
                    <th className="px-4 py-3">Requested / Issued</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {requests.map((request) => {
                    const displaySt = displayPartsRequestStatus(request.status);
                    const listGroup = materialsRequestListGroup(displaySt);
                    const storeFollowUpHint = materialsRequestStoreFollowUpHint(request.status);
                    const woId = request.work_orders?.id ?? null;
                    const woNumber = request.work_orders?.work_order_number ?? null;
                    const woStatus = request.work_orders?.status ?? null;
                    const asset = request.assets;
                    const totals = request.parts_request_items.reduce(
                      (acc, item) => {
                        acc.requested += Number(item.quantity_requested);
                        acc.issued += Number(item.issued_quantity);
                        return acc;
                      },
                      { requested: 0, issued: 0 }
                    );
                    // Row-level helper text — derived from the backend status
                    // group (not quantities), per the simplified wording rules.
                    const rowHelperLabel =
                      listGroup === "Requested"
                        ? "Waiting approval"
                        : listGroup === "Approved"
                          ? "Ready for Store"
                          : listGroup === "Store Follow-up"
                            ? "Store follow-up"
                            : "Issued";
                    const rowHelperClass =
                      listGroup === "Requested"
                        ? "text-amber-700"
                        : listGroup === "Approved"
                          ? "text-blue-700"
                          : listGroup === "Store Follow-up"
                            ? "text-amber-700"
                            : "text-green-700";

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
                          <p className="text-xs text-[#9CA3AF]">{request._count.parts_request_items} item(s)</p>
                        </td>

                        {/* Job Card — clickable to open quick view, plus its own status (Task 7) */}
                        <td className="px-4 py-3">
                          {woId && woNumber ? (
                            <>
                              <Link
                                href={jobCardPreviewHref(woId, { query, status, page })}
                                scroll={false}
                                className="font-semibold text-[#ED1C24] hover:underline"
                              >
                                {woNumber}
                              </Link>
                              {woStatus && (
                                <p className="mt-0.5 text-xs text-[#4B5563]">{displayJobCardStatus(woStatus)}</p>
                              )}
                            </>
                          ) : (
                            <span className="text-[#9CA3AF]">-</span>
                          )}
                        </td>

                        {/* Asset / Equipment / Vehicle */}
                        <td className="px-4 py-3">
                          {asset ? (
                            <>
                              <p className="font-semibold text-[#111827]">{asset.asset_name}</p>
                              <p className="text-xs text-[#4B5563]">
                                {asset.asset_code}
                                {asset.plate_number ? ` · ${asset.plate_number}` : ""}
                              </p>
                            </>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">-</span>
                          )}
                        </td>

                        {/* Requester */}
                        <td className="px-4 py-3">
                          {request.profiles_parts_requests_requested_byToprofiles
                            ?.full_name ?? "-"}
                        </td>

                        {/* Requested / Issued quantity summary — simplified, no
                            "left"/remaining wording in the main list (Task 5). */}
                        <td className="px-4 py-3 text-xs text-[#111827]">
                          <p>Requested: <span className="font-semibold">{formatQty(totals.requested)}</span></p>
                          <p>Issued: <span className="font-semibold">{formatQty(totals.issued)}</span></p>
                          <p className={`mt-0.5 font-semibold ${rowHelperClass}`}>{rowHelperLabel}</p>
                        </td>

                        {/* Status — grouped label (Waiting Stock / Partially
                            Issued both show as "Store Follow-up" with a small
                            helper line explaining why). */}
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={listGroup}
                            tone={materialsRequestListGroupTone(listGroup)}
                          />
                          {storeFollowUpHint && (
                            <p className="mt-1 text-[11px] text-[#6B7280]">{storeFollowUpHint}</p>
                          )}
                        </td>

                        {/* Action — Task 7: Requested -> Approve if permission,
                            Approved/Waiting Stock/Partially Issued -> Issue (links
                            to the detail page's Store Issue panel — the list page
                            never performs the item-level issue inline), Issued ->
                            view only. Every row also gets a plain "Open" link. */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/store/parts-requests/${request.id}`}
                              className="inline-flex min-h-[30px] items-center rounded-md border border-[#E5E7EB] px-3 py-1 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                            >
                              Open
                            </Link>
                            {canApprove && displaySt === "Requested" ? (
                              <Link
                                href={`/store/parts-requests/${request.id}`}
                                className="inline-flex min-h-[30px] items-center rounded-md bg-[#ED1C24] px-3 py-1 text-xs font-semibold text-white hover:bg-[#c9151c]"
                              >
                                Approve
                              </Link>
                            ) : canIssue && ["Approved", "Waiting Stock", "Partially Issued"].includes(displaySt) ? (
                              <Link
                                href={`/store/parts-requests/${request.id}`}
                                className="inline-flex min-h-[30px] items-center rounded-md bg-[#111827] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                              >
                                {displaySt === "Partially Issued" ? "Continue Issue" : "Issue"}
                              </Link>
                            ) : null}
                          </div>
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
                  query
                    ? "No materials requests match the current filters."
                    : status && TAB_EMPTY_STATE[status]
                      ? TAB_EMPTY_STATE[status].title
                      : "No Materials Requests found."
                }
                message={
                  query
                    ? "Try clearing the search or status filter."
                    : status && TAB_EMPTY_STATE[status]
                      ? TAB_EMPTY_STATE[status].message
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
          Opens via ?jobPreview=<woId>.
          RepairOrderQuickView is a client component; it handles ESC, backdrop
          click, and body-scroll lock. closeHref returns to the list page.
      ────────────────────────────────────────────────────────────── */}
      {validJobPreviewId && (
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
          Mutually exclusive with the created-success modal.
      ────────────────────────────────────────────────────────────── */}
      {!showCreatedModal && validPreviewId && (
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

    </>
  );
}
