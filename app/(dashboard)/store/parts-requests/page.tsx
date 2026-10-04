import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Boxes, CheckCircle2, ClipboardList, Plus, Printer, ShoppingCart, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";
import { JobCardOpenedModal } from "@/components/work-orders/job-card-opened-modal";
import { JobCardSubmittedModal } from "@/components/work-orders/job-card-submitted-modal";
import { MaterialsRequestCreatedModal } from "@/components/store/materials-request-created-modal";
import { MaterialsReceivedModal } from "@/components/store/materials-received-modal";
import {
  MaterialsRequestQuickView,
  type MaterialsRequestQuickViewData,
} from "@/components/store/materials-request-quick-view";
import { StoreSendMaterialsPopup, type StoreSendMaterialsData } from "@/components/store/store-send-materials-popup";
import { PartsRequestWizard, type WorkOrderOption as PRWorkOrderOption } from "@/components/store/parts-request-wizard";
import { GeneralInventoryRequestForm } from "@/components/store/general-inventory-request-form";
import {
  GeneralInventoryRequestQuickView,
  type GeneralInventoryRequestQuickViewData,
} from "@/components/store/general-inventory-request-quick-view";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canManageOfflineInventory, resolveMaterialMatchByKey } from "@/lib/store/offline-inventory-data";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
  materialsRequestListGroup,
  materialsRequestJobCardHelper,
  materialsReceiptStatus,
  materialsReceiptStatusTone,
  OPEN_PR_STATUSES,
} from "@/lib/display/parts-request-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { canEnterMaterialRequestPrice, canViewCosts, isManagerRole } from "@/lib/security/permissions";
import { isPriceBasis } from "@/lib/materials/request-pricing";
import { getReviewedWorkOrderIds } from "@/lib/work-orders/review-status";
import { getMaterialFulfillmentForWorkOrder, summarizeMaterialAvailability } from "@/lib/work-orders/material-fulfillment";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import {
  getPendingCorrectionWorkOrderIds,
  displaySimplifiedStatus,
  OPEN_JOB_CARD_STATUSES,
  NEEDS_UPDATE_LABEL,
} from "@/lib/work-orders/simplified-status";
import { getPartsRequestVisibilityFilter, canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import { getTechnicianPickerOptions } from "@/lib/technicians/picker-options";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { cn, formatDate, formatExactDateTime } from "@/lib/utils";

// Materials Requests One-Page Control Center: 10 rows per page, one
// pagination control for whichever tab is active.
const PAGE_SIZE = 10;

// The page's primary navigation. "pending" = Pending Receive: a Job Card
// request whose Job Card is Open and that is not received yet (the
// existing "Awaiting Receipt" rule), or a General request still Pending.
// Older ?status=AwaitingReceipt / ?status=Received / ?kind= links are
// mapped onto these tabs.
type ListTab = "pending" | "all" | "job_card" | "general" | "completed";

const LIST_TABS: { key: ListTab; label: string }[] = [
  { key: "pending", label: "Pending Receive" },
  { key: "all", label: "All Requests" },
  { key: "job_card", label: "Job Card Requests" },
  { key: "general", label: "General Inventory / Stock Requests" },
  { key: "completed", label: "Completed" },
];

const LIST_TAB_EMPTY: Record<ListTab, string> = {
  pending: "No pending material requests.",
  all: "No material requests found.",
  job_card: "No Job Card material requests found.",
  general: "No general inventory requests found.",
  completed: "No completed material requests.",
};

function isListTab(value: string): value is ListTab {
  return LIST_TABS.some((t) => t.key === value);
}

// Where the list currently is (tab, search, page) — carried through every
// open/close link so closing a popup returns to the same view.
type ListState = { query: string; tab: string; page: number };

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

function listParams({ query, tab, page }: ListState) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (tab) p.set("tab", tab);
  if (page > 1) p.set("page", String(page));
  return p;
}

function listHref(state: ListState) {
  const qs = listParams(state).toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
}

function genPreviewHref(requestId: string, state: ListState) {
  const p = listParams(state);
  p.set("genPreview", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

function jobCardPreviewHref(woId: string, state: ListState) {
  const p = listParams(state);
  p.set("jobPreview", woId);
  return `/store/parts-requests?${p.toString()}`;
}

function previewHref(requestId: string, state: ListState) {
  const p = listParams(state);
  p.set("preview", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

function sendPreviewHref(requestId: string, state: ListState) {
  const p = listParams(state);
  p.set("sendPreview", requestId);
  return `/store/parts-requests?${p.toString()}`;
}

// "03 Oct 2026, 10:15 AM" -> date line + time line, so the column stays narrow.
function RequestedAt({ value }: { value: Date | string | null | undefined }) {
  const [date, time] = formatExactDateTime(value).split(", ");
  return (
    <>
      <p className="whitespace-nowrap">{date}</p>
      {time && <p className="whitespace-nowrap">{time}</p>}
    </>
  );
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

  // Row quick-action gates: Approve (Requested, still needs a Manager
  // decision — e.g. materials added after the Job Card was already Open) and
  // Receive Materials (Approved/Waiting Stock/Partially Issued).
  const canApprove =
    context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.approve");
  const canReceive = canReceiveIssueMaterials(context);
  // Task 11: "Receiving into inventory should follow the existing
  // inventory receive permission" — General Inventory Requests' Receive
  // action writes offline_inventory_movements rows exactly like Offline
  // Inventory Control's own Receive Material action, so it reuses that
  // action's gate rather than a new permission.
  const canReceiveGeneral = canManageOfflineInventory(context);
  // General Inventory Request figures are stripped here, server-side — the
  // form and quick view never receive what the viewer may not see. Two
  // separate gates: the request's own ESTIMATED price/total (Manager, Super
  // Admin, Data Entry — canEnterMaterialRequestPrice) and the receive-side
  // unit price / inventory unit cost (full cost visibility only).
  const showGeneralPrices = canEnterMaterialRequestPrice(context);
  const showGeneralCosts = canViewCosts(context);

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
  // ?tab= picks the view; ?status= / ?kind= are only read to map older
  // links onto a tab (see the list data block below).
  const requestedTab = single(params.tab)?.trim() ?? "";
  const kind = single(params.kind)?.trim() ?? "";
  const jobPreviewId = single(params.jobPreview)?.trim() ?? null;
  const validJobPreviewId =
    jobPreviewId && UUID_RE.test(jobPreviewId) ? jobPreviewId : null;
  const sendPreviewId = single(params.sendPreview)?.trim() ?? null;
  const validSendPreviewId =
    sendPreviewId && UUID_RE.test(sendPreviewId) ? sendPreviewId : null;
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
  // Large Popup Conversion: New Materials Request opens as a modal from this
  // page via ?newRequest=1 (optionally with ?jobCardId=<id> to preselect a
  // Job Card, same as the standalone /new page's ?repair_order_id=). The
  // standalone page itself is untouched and still works for direct URL access.
  const showNewRequest = canCreate && single(params.newRequest) !== undefined;
  const newRequestJobCardId = single(params.jobCardId)?.trim() ?? "";
  // Materials Request Type Selection Flow Unit 10G.58, Task 1/2 — the new
  // first step. A deep link that already names a Job Card (?jobCardId=,
  // e.g. "Request Materials" clicked from inside a specific Job Card) skips
  // the type selector entirely and goes straight to the existing wizard —
  // the type is already implied, so showing the selector there would only
  // be a regression in that flow's existing UX, not a genuine choice.
  //
  // Remove Job Card Option from New Materials Request Type Selector: the
  // generic "New materials request" entry no longer offers "For Job Card" —
  // with only one option left, it opens the General Inventory / Stock
  // Request form directly (no selector step). The Job Card wizard is still
  // reached the way the Job Card flows already link to it (?jobCardId=, or
  // an explicit &type=job_card), so those flows and existing Job Card
  // requests are unaffected.
  const newRequestType = single(params.type)?.trim() ?? "";
  const effectiveNewRequestType: "job_card" | "general" =
    newRequestType === "job_card" || newRequestJobCardId ? "job_card" : "general";
  const newRequestError = single(params.error)?.trim() ?? null;

  // ── General Inventory / Stock Request detail/receive popup ───────────────
  const genPreviewId = single(params.genPreview)?.trim() ?? null;
  const validGenPreviewId = genPreviewId && UUID_RE.test(genPreviewId) ? genPreviewId : null;
  const genPreviewError = single(params.error)?.trim() ?? null;
  // Set only by createGeneralInventoryRequestAction's success redirect.
  const genPreviewJustSubmitted = single(params.submitted) === "1";

  // ── Visibility: a user can always see requests they created/requested ────
  const partsRequestVisibility = getPartsRequestVisibilityFilter(context);

  // ── List data — Materials Requests One-Page Control Center ───────────────
  // One table for both request types (Job Card Materials Requests in
  // parts_requests, General Inventory / Stock Requests in
  // general_inventory_requests), switched by tabs: Pending Receive / All /
  // Job Card / General Inventory / Completed. Ordering is the same "needs
  // action first" rule the Job Card list already used, applied to both:
  //   0. pending receive (Job Card request on an Open Job Card and not yet
  //      received; General request Pending) — oldest first
  //   1. Job Card request waiting on its Job Card (not Open yet) — oldest first
  //   2. completed (Issued / Completed / Cancelled) — newest first
  // Both sources are listed as lightweight (id, created_at, status) keys,
  // merged and sorted here, and only the current page's rows are then
  // fetched in full — so the two types can share one pagination control.
  const NOT_YET_RECEIVED_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];
  const canSeeAllGeneral =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.approve") ||
    context.permissions.includes("work_orders.manage");
  const generalVisibility: Prisma.general_inventory_requestsWhereInput = canSeeAllGeneral
    ? {}
    : { requested_by_id: context.userId };

  // Counts for the summary cards and tab badges (not narrowed by search).
  const [statusSummaries, awaitingReceiptCount, generalStatusSummaries] = await Promise.all([
    prisma.parts_requests.groupBy({ by: ["status"], where: partsRequestVisibility, _count: { _all: true } }),
    prisma.parts_requests.count({
      where: {
        AND: [
          partsRequestVisibility,
          { status: { in: NOT_YET_RECEIVED_STATUSES } },
          { work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } } },
        ],
      },
    }),
    prisma.general_inventory_requests.groupBy({ by: ["status"], where: generalVisibility, _count: { _all: true } }),
  ]);
  const totalRequests = statusSummaries.reduce((n, s) => n + s._count._all, 0);
  const countFor = (statuses: string[]) =>
    statusSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const receivedCount = countFor(["Issued"]);
  const generalTotalRequests = generalStatusSummaries.reduce((n, s) => n + s._count._all, 0);
  const generalPendingCount = generalStatusSummaries.find((s) => s.status === "Pending")?._count._all ?? 0;
  const generalCompletedCount = generalStatusSummaries.find((s) => s.status === "Completed")?._count._all ?? 0;
  const tabCounts: Record<ListTab, number> = {
    pending: awaitingReceiptCount + generalPendingCount,
    all: totalRequests + generalTotalRequests,
    job_card: totalRequests,
    general: generalTotalRequests,
    completed: receivedCount + generalCompletedCount,
  };

  // Active tab: ?tab=, else an older ?status= / ?kind= link mapped onto a
  // tab, else Pending Receive when anything is pending (what daily staff
  // act on), otherwise All.
  const legacyTab: ListTab | null =
    status === "AwaitingReceipt" ? "pending"
    : status === "Received" ? "completed"
    : kind === "job_card" ? "job_card"
    : kind === "general" ? "general"
    : null;
  const tab: ListTab = isListTab(requestedTab) ? requestedTab : legacyTab ?? (tabCounts.pending > 0 ? "pending" : "all");
  const listState: ListState = { query, tab, page };

  // Search — the same fields for both types (request no., Job Card no.,
  // asset, plate, material, purpose, requester).
  const jobConditions: Prisma.parts_requestsWhereInput[] = [partsRequestVisibility];
  if (query) {
    jobConditions.push({
      OR: [
        { parts_request_number: { contains: query, mode: "insensitive" } },
        { work_orders: { work_order_number: { contains: query, mode: "insensitive" } } },
        { assets: { asset_code: { contains: query, mode: "insensitive" } } },
        { assets: { asset_name: { contains: query, mode: "insensitive" } } },
        { assets: { plate_number: { contains: query, mode: "insensitive" } } },
        { profiles_parts_requests_requested_byToprofiles: { full_name: { contains: query, mode: "insensitive" } } },
        { parts_request_items: { some: { description: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  if (tab === "pending") {
    jobConditions.push({ status: { in: NOT_YET_RECEIVED_STATUSES } });
    jobConditions.push({ work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } } });
  } else if (tab === "completed") {
    jobConditions.push({ status: "Issued" });
  }
  const generalConditions: Prisma.general_inventory_requestsWhereInput[] = [generalVisibility];
  if (query) {
    generalConditions.push({
      OR: [
        { request_number: { contains: query, mode: "insensitive" } },
        { purpose: { contains: query, mode: "insensitive" } },
        { requested_by_name: { contains: query, mode: "insensitive" } },
        { location: { contains: query, mode: "insensitive" } },
        { department: { contains: query, mode: "insensitive" } },
        { items: { some: { material_name: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  if (tab === "pending") generalConditions.push({ status: "Pending" });
  else if (tab === "completed") generalConditions.push({ status: { in: ["Completed", "Cancelled"] } });

  const [jobKeys, generalKeys] = await Promise.all([
    tab === "general"
      ? Promise.resolve([])
      : prisma.parts_requests.findMany({
          where: { AND: jobConditions },
          select: { id: true, created_at: true, status: true, work_orders: { select: { status: true } } },
        }),
    tab === "job_card"
      ? Promise.resolve([])
      : prisma.general_inventory_requests.findMany({
          where: { AND: generalConditions },
          select: { id: true, created_at: true, status: true },
        }),
  ]);
  type ListKey = { kind: "job_card" | "general"; id: string; createdAt: Date; bucket: 0 | 1 | 2 };
  const listKeys: ListKey[] = [
    ...jobKeys.map((r): ListKey => ({
      kind: "job_card",
      id: r.id,
      createdAt: r.created_at,
      bucket: r.status === "Issued" ? 2 : OPEN_JOB_CARD_STATUSES.includes(r.work_orders?.status ?? "") ? 0 : 1,
    })),
    ...generalKeys.map((r): ListKey => ({
      kind: "general",
      id: r.id,
      createdAt: r.created_at,
      bucket: r.status === "Pending" ? 0 : 2,
    })),
  ].sort((a, b) =>
    a.bucket !== b.bucket
      ? a.bucket - b.bucket
      : a.bucket === 2
        ? b.createdAt.getTime() - a.createdAt.getTime()
        : a.createdAt.getTime() - b.createdAt.getTime()
  );
  const total = listKeys.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageKeys = listKeys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const requestRowSelect = {
    id: true,
    parts_request_number: true,
    status: true,
    created_at: true,
    work_orders: { select: { id: true, work_order_number: true, status: true } },
    assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
    profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
    parts_request_items: { select: { description: true, quantity_requested: true, issued_quantity: true } },
  } as const;
  const pageJobIds = pageKeys.filter((k) => k.kind === "job_card").map((k) => k.id);
  const pageGeneralIds = pageKeys.filter((k) => k.kind === "general").map((k) => k.id);
  const [pageJobRows, pageGeneralRows] = await Promise.all([
    pageJobIds.length
      ? prisma.parts_requests.findMany({ where: { id: { in: pageJobIds } }, select: requestRowSelect })
      : Promise.resolve([]),
    pageGeneralIds.length
      ? prisma.general_inventory_requests.findMany({
          where: { id: { in: pageGeneralIds } },
          include: {
            items: {
              select: { material_name: true, quantity_requested: true, received_quantity: true },
              orderBy: { created_at: "asc" },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const jobRowById = new Map(pageJobRows.map((r) => [r.id, r]));
  const generalRowById = new Map(pageGeneralRows.map((r) => [r.id, r]));

  // Simplified Workflow UI Consistency Cleanup Task 4: each Job Card row's
  // helper text/action depends on whether its linked Job Card has a pending
  // correction, looked up once for every Job Card referenced on this page.
  const rowJobCardIds = [...new Set(pageJobRows.map((r) => r.work_orders?.id).filter((id): id is string => Boolean(id)))];
  const rowCorrectionIds = await getPendingCorrectionWorkOrderIds(rowJobCardIds);

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
            work_orders: { select: { id: true, work_order_number: true, status: true } },
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

  // ── Receive Materials guided popup data ───────────────────────────────────
  // Opens via ?sendPreview=<id> from the Action column's "Receive Materials"
  // button. Same permission check the action itself enforces
  // (assertCanIssueMaterials/canReceiveIssueMaterials) — a user without it
  // crafting this URL directly sees nothing, matching the popup's own gated
  // action underneath.
  const sendPreviewRequest = validSendPreviewId && canReceive
    ? await prisma.parts_requests.findFirst({
        where: { AND: [{ id: validSendPreviewId }, partsRequestVisibility] },
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          work_orders: {
            select: {
              id: true,
              work_order_number: true,
              status: true,
              operator_complaint: true,
              description_of_work: true,
              assets: { select: { asset_name: true, plate_number: true } },
            },
          },
          parts_request_items: {
            select: { id: true, description: true, quantity_requested: true, issued_quantity: true },
          },
        },
      })
    : null;

  // ── Materials Request quick view data ──────────────────────────────────────
  // Opens via ?preview=<id> when a request number is clicked — Task 7.
  // Mutually exclusive with the created/received success modals.
  const shouldFetchPreview =
    !showCreatedModal && !showReceivedModal && validPreviewId !== null;
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
  const shouldFetchJobPreview = validJobPreviewId !== null;

  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  // ── New Materials Request modal data — same query shape as the standalone
  // /store/parts-requests/new page, only run when that modal is actually open. ──
  const newRequestWoSelect = {
    id: true,
    work_order_number: true,
    ordered_by: true,
    worker_type: true,
    maintenance_type: true,
    operator_complaint: true,
    created_at: true,
    assets: {
      select: { asset_code: true, asset_name: true, location: true, category: true, status: true },
    },
  } as const;

  function mapNewRequestWo(w: {
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
  }): PRWorkOrderOption {
    return { ...w, created_at: w.created_at.toISOString() };
  }

  const showJobCardWizardData = showNewRequest && effectiveNewRequestType === "job_card";
  const [newRequestWorkOrdersRaw, newRequestPreselectedRaw] = showJobCardWizardData
    ? await Promise.all([
        prisma.work_orders.findMany({
          where: { AND: [{ deleted_at: null }, visibilityFilter] },
          select: newRequestWoSelect,
          orderBy: { created_at: "desc" },
          take: 100,
        }),
        newRequestJobCardId
          ? prisma.work_orders.findFirst({
              where: { id: newRequestJobCardId, deleted_at: null, ...visibilityFilter },
              select: newRequestWoSelect,
            })
          : Promise.resolve(null),
      ])
    : [[], null];

  const newRequestWorkOrders: PRWorkOrderOption[] = newRequestWorkOrdersRaw.map(mapNewRequestWo);
  const newRequestPreselectedWo: PRWorkOrderOption | null = newRequestPreselectedRaw
    ? mapNewRequestWo(newRequestPreselectedRaw)
    : null;

  // ── General Inventory / Stock Request — new-request form data ────────────
  const showGeneralFormData = showNewRequest && effectiveNewRequestType === "general";
  const currentProfile = showGeneralFormData
    ? await prisma.profiles.findUnique({ where: { id: context.userId }, select: { full_name: true } })
    : null;
  const generalRequestDateLabel = formatDate(new Date());

  // ── General Inventory / Stock Request detail/receive popup data ──────────
  const genPreviewRequest = validGenPreviewId
    ? await prisma.general_inventory_requests.findFirst({
        where: { AND: [{ id: validGenPreviewId }, generalVisibility] },
        include: { items: { orderBy: { created_at: "asc" } } },
      })
    : null;
  // Current Offline Inventory balance for each row linked to an existing
  // material (read-only; a quantity, not a cost, so shown to every viewer).
  const genPreviewBalanceByItemId = new Map<string, number>();
  if (genPreviewRequest) {
    await Promise.all(
      genPreviewRequest.items
        .filter((item) => item.inventory_material_key)
        .map(async (item) => {
          const resolved = await resolveMaterialMatchByKey(item.inventory_material_key);
          if (resolved.matched) genPreviewBalanceByItemId.set(item.id, resolved.balance);
        })
    );
  }

  const canAssignModal =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("work_orders.assign") ||
    context.permissions.includes("work_orders.approve");

  const [previewWO, prDataForWO, techsForModal, previewMaterialFulfillment] = shouldFetchJobPreview
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
            created_by: true,
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
          ? getTechnicianPickerOptions()
          : Promise.resolve([] as Array<{ id: string; full_name: string }>),
        // Job Card Action Clarity Fix Task 3/5: same single-Job-Card
        // fulfillment read as the Job Cards list/dashboard preview queries —
        // gated behind shouldFetchJobPreview (a single row), never per row.
        getMaterialFulfillmentForWorkOrder(prisma, validJobPreviewId!),
      ])
    : [
        null,
        [] as Array<{ id: string; parts_request_number: string | null; status: string; parts_request_items: { id: string; description: string; quantity_requested: unknown; issued_quantity: unknown }[] }>,
        [] as Array<{ id: string; full_name: string }>,
        [] as Awaited<ReturnType<typeof getMaterialFulfillmentForWorkOrder>>,
      ];

  const isAdmin = context.role?.slug === "super_admin";
  const jobPreviewCloseHref = listHref(listState);
  const previewReviewed =
    previewWO && previewWO.status === "Under Review"
      ? (await getReviewedWorkOrderIds([previewWO.id])).has(previewWO.id)
      : false;
  // Data Entry Correction Note Visibility Cleanup Task 1/6: same single-record
  // query the Job Card detail page's correction banner uses, so this Job
  // Card preview drawer (opened from a linked Materials Request) matches too.
  const previewPendingClarification = previewWO
    ? await getPendingClarificationForWorkOrder(previewWO.id)
    : null;
  const previewHasPendingCorrection = previewPendingClarification !== null;
  const previewCorrectionRequester = previewPendingClarification?.requested_by
    ? await prisma.profiles.findUnique({
        where: { id: previewPendingClarification.requested_by },
        select: { full_name: true },
      })
    : null;

  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displaySimplifiedStatus(previewWO.status),
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
        // Job Card Action Clarity Fix Task 3.
        materialsAvailability: summarizeMaterialAvailability(previewMaterialFulfillment),
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
        // Approval Workflow Unit 4: direct "Close Job Card" is now
        // Manager-only (matches closeWorkOrder()'s own role check) — Data
        // Entry uses Request Closure instead (full detail page).
        canClose: isAdmin || context.role?.slug === "maintenance_manager",
        canUpdateProgress: isAdmin || context.permissions.includes("work_orders.update"),
        canReceiveMaterials: canReceive,
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        reviewed: previewReviewed,
        hasPendingCorrection: previewHasPendingCorrection,
        pendingCorrectionNote: previewPendingClarification
          ? {
              question: previewPendingClarification.question,
              requestedByName: previewCorrectionRequester?.full_name ?? null,
              requestedAt: previewPendingClarification.requested_at.toISOString(),
            }
          : null,
        isCreator: previewWO.created_by === context.userId,
        closeHref: jobPreviewCloseHref,
        previewParamName: "jobPreview",
      }
    : null;

  // ── Created-success modal props ───────────────────────────────────────────
  const createdDismissHref = listHref({ query: "", tab: "", page: 1 });
  const createdJobCardHref = createdRequest?.work_orders
    ? jobCardPreviewHref(createdRequest.work_orders.id, { query: "", tab: "", page: 1 })
    : null;
  const createdJobCardHasPendingCorrection = createdRequest?.work_orders
    ? (await getPendingCorrectionWorkOrderIds([createdRequest.work_orders.id])).has(createdRequest.work_orders.id)
    : false;

  // ── Received-success modal props ──────────────────────────────────────────
  const receivedDismissHref = listHref({ query: "", tab: "", page: 1 });
  const receivedJobCardHref = receivedRequest?.work_orders
    ? jobCardPreviewHref(receivedRequest.work_orders.id, { query: "", tab: "", page: 1 })
    : null;
  // Unit 9: the list-page Issue popup was removed (incompatible with the
  // Unit 5 itemId-based issue engine — Task 7). This now links straight to
  // the Materials Request detail page's Store Issue panel instead.
  const receivedIssueHref = receivedRequest
    ? `/store/parts-requests/${receivedRequest.id}`
    : validReceivedId
      ? `/store/parts-requests/${validReceivedId}`
      : null;

  // ── Materials Request quick view props ────────────────────────────────────
  const previewCloseHref = listHref(listState);
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
          ? jobCardPreviewHref(previewRequest.work_orders.id, listState)
          : null,
        detailHref: `/store/parts-requests/${previewRequest.id}`,
      }
    : null;

  // ── General Inventory / Stock Request quick view props (Task 10) ─────────
  const genPreviewCloseHref = listHref(listState);
  const genPreviewQuickViewData: GeneralInventoryRequestQuickViewData | null = genPreviewRequest
    ? {
        id: genPreviewRequest.id,
        requestNumber: genPreviewRequest.request_number,
        purpose: genPreviewRequest.purpose,
        remarks: genPreviewRequest.remarks,
        department: genPreviewRequest.department,
        location: genPreviewRequest.location,
        requestedByName: genPreviewRequest.requested_by_name,
        requestedDateLabel: formatDate(genPreviewRequest.created_at),
        status: genPreviewRequest.status,
        items: genPreviewRequest.items.map((item) => ({
          id: item.id,
          materialName: item.material_name,
          description: item.description,
          quantityRequested: Number(item.quantity_requested),
          unit: item.unit,
          unitPrice: showGeneralPrices && item.unit_price !== null ? Number(item.unit_price) : null,
          totalPrice: showGeneralPrices && item.total_price !== null ? Number(item.total_price) : null,
          enteredUnitPrice: showGeneralPrices && item.entered_unit_price !== null ? Number(item.entered_unit_price) : null,
          priceBasis: showGeneralPrices && isPriceBasis(item.price_basis) ? item.price_basis : null,
          supplier: item.supplier,
          receivedQuantity: Number(item.received_quantity),
          inventoryUnit: item.inventory_unit,
          conversionQuantity: item.conversion_quantity !== null ? Number(item.conversion_quantity) : null,
          inventoryQuantity: item.inventory_quantity_to_add !== null ? Number(item.inventory_quantity_to_add) : null,
          unitCost: showGeneralCosts && item.unit_cost !== null ? Number(item.unit_cost) : null,
          requestUnit: item.request_unit,
          requestQuantity: item.request_quantity !== null ? Number(item.request_quantity) : null,
          // Rows saved before the existing-vs-new link existed have no
          // request_unit and carry no badge at all.
          isExistingMaterial: item.request_unit === null ? null : item.inventory_material_key !== null,
          currentBalance: genPreviewBalanceByItemId.get(item.id) ?? null,
          remarks: item.remarks,
        })),
        closeHref: genPreviewCloseHref,
        // The submitted state only ever applies to a request that is still
        // Pending and has no error to show — a completed/cancelled request
        // opened with a stale ?submitted=1 URL shows the normal detail view.
        justSubmitted: genPreviewJustSubmitted && genPreviewRequest.status === "Pending" && !genPreviewError,
        viewHref: genPreviewHref(genPreviewRequest.id, listState),
        canViewPrices: showGeneralPrices,
        canViewCosts: showGeneralCosts,
        canReceive: canReceiveGeneral,
        inventoryReference: genPreviewRequest.status === "Completed" ? genPreviewRequest.request_number : null,
        errorMessage: genPreviewError,
      }
    : null;

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      {/* Enterprise-Wide Real-Time Update Verification Task 8: widened from
          the single "job_card.approved" event to the full "job_card." prefix
          (a linked Job Card's correction-requested/responded/closed state
          also changes what this list's "waiting on..." helper text should
          say) plus "work_order."/"offline_inventory."/"material_ledger." per
          the recommended Materials Requests watch list. */}
      <RealtimeRefresh watch={["materials_request.", "store_materials.", "job_card.", "work_order.", "offline_inventory.", "material_ledger."]} />
      {showCreatedModal && (
        <MaterialsRequestCreatedModal
          requestId={createdRequest?.id ?? null}
          requestNumber={createdRequest?.parts_request_number ?? mrNumber}
          jobCardNumber={createdRequest?.work_orders?.work_order_number ?? null}
          jobCardPreviewHref={createdJobCardHref}
          assetName={createdRequest?.assets?.asset_name ?? null}
          itemCount={createdRequest ? createdRequest._count.parts_request_items : null}
          attachmentWarning={attachmentWarning}
          jobCardHasPendingCorrection={createdJobCardHasPendingCorrection}
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
      <PageHeader
        title="Materials Requests"
        description="Materials requested for Job Cards or for general inventory / stock — track and receive them here."
        actions={
          <>
            <PageNavigationActions />
            {/* Printable Asset Register, Materials Requests, and Service
                Contracts Reports Unit 10G.71, Task 5. */}
            <Link
              href="/reports/materials-requests/print"
              className="focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Report
            </Link>
            {canCreate ? (
              <Link
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c9151c]"
                href="?newRequest=1"
                scroll={false}
              >
                <Plus className="h-4 w-4" />
                New materials request
              </Link>
            ) : null}
          </>
        }
      />

      <div className="space-y-3 p-3 lg:p-4">
        {/* ── Summary cards — compact; each one opens its tab. ── */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {([
            { label: "Total Requests", value: tabCounts.all, icon: ClipboardList, tone: "blue", tab: "all" },
            { label: "Pending Receive", value: tabCounts.pending, icon: ShoppingCart, tone: tabCounts.pending > 0 ? "amber" : "gray", tab: "pending" },
            { label: "Completed", value: tabCounts.completed, icon: CheckCircle2, tone: "green", tab: "completed" },
            { label: "Job Card Requests", value: tabCounts.job_card, icon: Wrench, tone: "gray", tab: "job_card" },
            { label: "General Inventory Requests", value: tabCounts.general, icon: Boxes, tone: "gray", tab: "general" },
          ] as { label: string; value: number; icon: LucideIcon; tone: "green" | "amber" | "blue" | "gray"; tab: ListTab }[]).map((c) => (
            <Link
              key={c.tab}
              href={listHref({ query, tab: c.tab, page: 1 })}
              className={cn("block rounded-md", tab === c.tab && "ring-2 ring-[#ED1C24]")}
            >
              <StatCard label={c.label} value={c.value} icon={c.icon} tone={c.tone} compact />
            </Link>
          ))}
        </section>

        {/* ── Tabs (primary navigation) + search, one compact bar ── */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-2">
            <div className="flex min-w-0 overflow-x-auto" role="tablist" aria-label="Materials request views">
              {LIST_TABS.map((t) => {
                const isActive = tab === t.key;
                return (
                  <Link
                    key={t.key}
                    role="tab"
                    aria-selected={isActive}
                    href={listHref({ query, tab: t.key, page: 1 })}
                    className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-bold transition ${
                      isActive ? "border-[#ED1C24] text-[#ED1C24]" : "border-transparent text-[#111827] hover:bg-gray-50"
                    }`}
                  >
                    {t.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        isActive ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"
                      }`}
                    >
                      {tabCounts[t.key]}
                    </span>
                  </Link>
                );
              })}
            </div>
            <form className="flex min-w-[260px] flex-1 items-center gap-2 py-1.5 sm:max-w-md">
              <input type="hidden" name="tab" value={tab} />
              <input
                className="focus-ring min-h-9 w-full rounded-md border border-[#DDE2EA] px-3 py-1.5 text-sm"
                name="q"
                defaultValue={query}
                placeholder="Search request no., Job Card, asset, plate, material, purpose, requester…"
                aria-label="Search materials requests"
              />
              <button
                className="focus-ring min-h-9 rounded-md border border-[#DDE2EA] bg-white px-3 py-1.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
                type="submit"
              >
                Search
              </button>
              {query && (
                <Link href={listHref({ query: "", tab, page: 1 })} className="whitespace-nowrap text-xs font-semibold text-[#4B5563] hover:underline">
                  Clear
                </Link>
              )}
            </form>
          </div>

          {/* ── One unified table for the active tab ── */}
          {pageKeys.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[150px]" />
                  <col className="w-[86px]" />
                  <col />
                  <col />
                  <col />
                  <col className="w-[104px]" />
                  <col className="w-[132px]" />
                  <col className="w-[104px]" />
                  <col className="w-[136px]" />
                </colgroup>
                <thead className="bg-gray-50 text-[11px] uppercase leading-tight text-[#4B5563]">
                  <tr>
                    <th className="px-2.5 py-2">Request No.</th>
                    <th className="px-2.5 py-2">Type</th>
                    <th className="px-2.5 py-2">Job Card / Purpose</th>
                    <th className="px-2.5 py-2">Asset / Location</th>
                    <th className="px-2.5 py-2">Materials</th>
                    <th className="px-2.5 py-2">Requested / Received</th>
                    <th className="px-2.5 py-2">Status</th>
                    <th className="px-2.5 py-2">Requested Date &amp; Time</th>
                    <th className="px-2.5 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {pageKeys.map((key) => {
                    if (key.kind === "general") {
                      const req = generalRowById.get(key.id);
                      if (!req) return null;
                      const names = req.items.map((i) => i.material_name);
                      const requested = req.items.reduce((n, i) => n + Number(i.quantity_requested), 0);
                      const received = req.items.reduce((n, i) => n + Number(i.received_quantity), 0);
                      const openHref = genPreviewHref(req.id, listState);
                      return (
                        <tr key={`g-${req.id}`} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-2.5 py-1.5">
                            <Link className="text-[13px] font-bold hover:text-[#ED1C24]" href={openHref} scroll={false}>
                              {req.request_number}
                            </Link>
                          </td>
                          <td className="px-2.5 py-1.5">
                            <span className="inline-block whitespace-nowrap rounded-full bg-[#111827] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              General
                            </span>
                          </td>
                          <td className="px-2.5 py-1.5">
                            <p className="font-semibold text-[#111827]">{req.purpose}</p>
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-[#4B5563]">
                            {req.location || req.department ? (
                              <>
                                {req.location && <p className="font-semibold text-[#111827]">{req.location}</p>}
                                {req.department && <p>{req.department}</p>}
                              </>
                            ) : (
                              <span className="text-[#9CA3AF]">—</span>
                            )}
                          </td>
                          <td className="break-words px-2.5 py-1.5 text-xs text-[#111827]">
                            {names[0] ?? "—"}
                            {names.length > 1 && <span className="text-[#9CA3AF]"> +{names.length - 1} more</span>}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-[#111827]">
                            <p className="whitespace-nowrap">Requested <span className="font-semibold">{formatQty(requested)}</span></p>
                            <p className="whitespace-nowrap">Received <span className="font-semibold">{formatQty(received)}</span></p>
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5">
                            <StatusBadge
                              label={req.status}
                              tone={req.status === "Completed" ? "green" : req.status === "Cancelled" ? "gray" : "amber"}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-[#4B5563]">
                            <RequestedAt value={req.created_at} />
                            {req.requested_by_name && <p className="text-[#9CA3AF]">by {req.requested_by_name}</p>}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <div className="flex flex-col items-stretch gap-1 whitespace-nowrap">
                              <Link
                                href={openHref}
                                scroll={false}
                                className="inline-flex min-h-[28px] items-center justify-center rounded-md border border-[#E5E7EB] px-2.5 py-1 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                              >
                                Open
                              </Link>
                              {canReceiveGeneral && req.status === "Pending" ? (
                                <Link
                                  href={openHref}
                                  scroll={false}
                                  className="inline-flex min-h-[28px] items-center justify-center whitespace-nowrap rounded-md bg-[#111827] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                                >
                                  Receive Materials
                                </Link>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const request = jobRowById.get(key.id);
                    if (!request) return null;
                    const displaySt = displayPartsRequestStatus(request.status);
                    const listGroup = materialsRequestListGroup(displaySt);
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
                    // Row helper text — driven by the LINKED JOB CARD's
                    // status/correction state, not by any Materials-
                    // Request-side "approval" concept.
                    const hasCorrection = woId ? rowCorrectionIds.has(woId) : false;
                    const jobCardHelper = materialsRequestJobCardHelper(woStatus, hasCorrection, listGroup === "Received");
                    const rowHelperClass =
                      listGroup === "Received" ? "text-green-700" : jobCardHelper.canReceive ? "text-blue-700" : "text-amber-700";
                    const receiptStatus = materialsReceiptStatus(request.status, woStatus, hasCorrection);
                    const materialNames = request.parts_request_items.map((i) => i.description);
                    return (
                      <tr key={`j-${request.id}`} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-2.5 py-1.5">
                          <Link className="text-[13px] font-bold hover:text-[#ED1C24]" href={previewHref(request.id, listState)} scroll={false}>
                            {request.parts_request_number}
                          </Link>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <span className="inline-block whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#4B5563]">
                            Job Card
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          {woId && woNumber ? (
                            <>
                              <Link
                                href={jobCardPreviewHref(woId, listState)}
                                scroll={false}
                                className="font-semibold text-[#ED1C24] hover:underline"
                              >
                                {woNumber}
                              </Link>
                              {woStatus && (
                                <p className="text-xs text-[#4B5563]">
                                  {displaySimplifiedStatus(woStatus)}
                                  {hasCorrection && ` · ${NEEDS_UPDATE_LABEL}`}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-xs">
                          {asset ? (
                            <>
                              <p className="font-semibold text-[#111827]">{asset.asset_name}</p>
                              <p className="text-[#4B5563]">
                                {asset.asset_code}
                                {asset.plate_number ? ` · ${asset.plate_number}` : ""}
                              </p>
                            </>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>
                        <td className="break-words px-2.5 py-1.5 text-xs text-[#111827]">
                          {materialNames[0] ?? "—"}
                          {materialNames.length > 1 && <span className="text-[#9CA3AF]"> +{materialNames.length - 1} more</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-xs text-[#111827]">
                          <p className="whitespace-nowrap">Requested <span className="font-semibold">{formatQty(totals.requested)}</span></p>
                          <p className="whitespace-nowrap">Received <span className="font-semibold">{formatQty(totals.issued)}</span></p>
                          <p className={`font-semibold ${rowHelperClass}`}>{jobCardHelper.label}</p>
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">
                          <StatusBadge label={receiptStatus} tone={materialsReceiptStatusTone(receiptStatus)} />
                        </td>
                        <td className="px-2.5 py-1.5 text-xs text-[#4B5563]">
                          <RequestedAt value={request.created_at} />
                          {request.profiles_parts_requests_requested_byToprofiles?.full_name && (
                            <p className="text-[#9CA3AF]">by {request.profiles_parts_requests_requested_byToprofiles.full_name}</p>
                          )}
                        </td>
                        {/* Action — Job Card Open -> Receive Materials (guided
                            popup); Job Card not yet Open -> Open Job Card for
                            an approver; completed -> Open only. */}
                        <td className="px-2.5 py-1.5">
                          <div className="flex flex-col items-stretch gap-1 whitespace-nowrap">
                            <Link
                              href={`/store/parts-requests/${request.id}`}
                              className="inline-flex min-h-[28px] items-center justify-center rounded-md border border-[#E5E7EB] px-2.5 py-1 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                            >
                              Open
                            </Link>
                            {canReceive && jobCardHelper.canReceive ? (
                              <Link
                                href={sendPreviewHref(request.id, listState)}
                                scroll={false}
                                className="inline-flex min-h-[28px] items-center justify-center whitespace-nowrap rounded-md bg-[#111827] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                              >
                                Receive Materials
                              </Link>
                            ) : canApprove && woId && listGroup !== "Received" && !jobCardHelper.canReceive && woStatus !== "Closed" ? (
                              <Link
                                href={jobCardPreviewHref(woId, listState)}
                                scroll={false}
                                className="inline-flex min-h-[28px] items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#c9151c]"
                              >
                                Open Job Card
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
                title={query ? "No materials requests match the search." : LIST_TAB_EMPTY[tab]}
                message={query ? "Try a different search, or clear it." : "Nothing to show in this view right now."}
              />
            </div>
          )}

          {/* ── One pagination control for the active tab ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] px-3 py-2">
            <span className="text-xs font-semibold text-[#4B5563]">
              Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Link
                className={paginationClass(page <= 1)}
                href={listHref({ query, tab, page: Math.max(1, page - 1) })}
                aria-disabled={page <= 1}
              >
                Previous
              </Link>
              <span className="text-xs text-[#4B5563]">
                Page {Math.min(page, totalPages)} of {totalPages}
              </span>
              <Link
                className={paginationClass(page >= totalPages)}
                href={listHref({ query, tab, page: Math.min(totalPages, page + 1) })}
                aria-disabled={page >= totalPages}
              >
                Next
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ── Job Card quick view modal ────────────────────────────────
          Opens via ?jobPreview=<woId>.
          RepairOrderQuickView is a client component; it handles ESC, backdrop
          click, and body-scroll lock. closeHref returns to the list page.
      ────────────────────────────────────────────────────────────── */}
      {validJobPreviewId && (
        drawerData ? (
          successCode === "job-card-opened" ? (
            <JobCardOpenedModal data={drawerData} dismissHref={jobPreviewCloseHref} />
          ) : successCode === "job-card-submitted" ? (
            <JobCardSubmittedModal data={drawerData} dismissHref={jobPreviewCloseHref} />
          ) : (
            <RepairOrderQuickView data={drawerData} />
          )
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

      {/* ── General Inventory / Stock Request quick view / receive
          modal (Task 10) ────────────────────────────────────────────
          Opens via ?genPreview=<id>. Entirely separate from the Job
          Card-linked MaterialsRequestQuickView/StoreSendMaterialsPopup
          above — never touches parts_requests/work_orders. */}
      {validGenPreviewId && (
        genPreviewQuickViewData ? (
          <GeneralInventoryRequestQuickView data={genPreviewQuickViewData} />
        ) : (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">General Inventory Request not found</p>
                <p className="mt-1 text-sm text-[#4B5563]">
                  This request is not available or you do not have access to it.
                </p>
                <div className="mt-4">
                  <Link
                    href={genPreviewCloseHref}
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

      {/* ── Receive Materials guided popup ───────────────────────────
          Opens via ?sendPreview=<id> from the Action column. */}
      {validSendPreviewId && canReceive && (
        sendPreviewRequest ? (
          <StoreSendMaterialsPopup
            data={{
              id: sendPreviewRequest.id,
              parts_request_number: sendPreviewRequest.parts_request_number,
              status: sendPreviewRequest.status,
              work_order_id: sendPreviewRequest.work_orders?.id ?? null,
              work_order_number: sendPreviewRequest.work_orders?.work_order_number ?? null,
              work_order_status: sendPreviewRequest.work_orders?.status ?? null,
              problem_summary: sendPreviewRequest.work_orders?.operator_complaint || sendPreviewRequest.work_orders?.description_of_work || null,
              asset_name: sendPreviewRequest.work_orders?.assets?.asset_name ?? null,
              plate_number: sendPreviewRequest.work_orders?.assets?.plate_number ?? null,
              items: sendPreviewRequest.parts_request_items.map((item) => ({
                id: item.id,
                description: item.description,
                quantity_requested: Number(item.quantity_requested),
                issued_quantity: Number(item.issued_quantity),
                balance: undefined,
              })),
            } satisfies StoreSendMaterialsData}
            closeHref={listHref(listState)}
          />
        ) : (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Materials Request not found</p>
                <p className="mt-1 text-sm text-[#4B5563]">
                  This request is not available, cannot be received yet, or you do not have access to it.
                </p>
                <div className="mt-4">
                  <Link
                    href={listHref(listState)}
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

      {/* ── New Materials Request modal ───────────────────────────────
          Opens via ?newRequest=1 and shows the General Inventory / Stock
          Request form directly (the "For Job Card" type selector was
          removed from this entry point). ?jobCardId=<id> or an explicit
          &type=job_card still renders the existing PartsRequestWizard for
          the Job Card flows. The standalone /store/parts-requests/new page
          follows the same rule (?repair_order_id= for the wizard).
          Submitting either flow redirects to this same page on success,
          which naturally closes the modal.
      ────────────────────────────────────────────────────────────── */}
      {showNewRequest && (
        <LargeFormModal
          size="wide"
          title="New Materials Request"
          subtitle={
            effectiveNewRequestType === "job_card"
              ? "Request materials linked to a Job Card."
              : "Request materials for store stock or general inventory. No Job Card required."
          }
          closeHref={listHref(listState)}
        >
          {effectiveNewRequestType === "job_card" ? (
            <PartsRequestWizard
              modalMode
              workOrders={newRequestWorkOrders}
              preselectedWorkOrderId={newRequestJobCardId || undefined}
              preselectedWorkOrder={newRequestPreselectedWo}
            />
          ) : (
            <GeneralInventoryRequestForm
              modalMode
              requesterName={currentProfile?.full_name ?? null}
              requestedDateLabel={generalRequestDateLabel}
              canEnterPrices={showGeneralPrices}
              canRequestUnlinked={isManagerRole(context)}
              errorMessage={newRequestError}
            />
          )}
        </LargeFormModal>
      )}
    </>
  );
}
