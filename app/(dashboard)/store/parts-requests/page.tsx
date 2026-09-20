import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Plus, Printer, ShoppingCart } from "lucide-react";
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
import { MaterialsRequestTypeSelector } from "@/components/store/materials-request-type-selector";
import { GeneralInventoryRequestForm } from "@/components/store/general-inventory-request-form";
import {
  GeneralInventoryRequestQuickView,
  type GeneralInventoryRequestQuickViewData,
} from "@/components/store/general-inventory-request-quick-view";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
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

const PAGE_SIZE = 25;

// Manager Approval Success Popup and Materials Awaiting Receipt Flow Task 5:
// the list page's primary job is daily receipt follow-up, so its tabs now
// center on the same 3-value materialsReceiptStatus mapping the badge/KPI
// cards use — "Awaiting Receipt" (approved, Job Card Open, not yet received)
// replaces the old plain "Requested" tab. A request whose Job Card isn't
// Open yet only shows under "All" — it's genuinely not a receipt-followup
// item yet, so it doesn't need its own tab. The individual raw DB statuses
// still exist and are still filterable directly by an existing deep link
// (e.g. ?status=Approved). Never uses Store-specific wording (Store
// Follow-up/Waiting Store/Send Materials/Issue by Store) as a tab.
// Materials Requests Status Wording Simplification: labels changed from
// "To Receive"/"Received" to plain request-completion wording, "Pending"/
// "Completed" — the `key` (URL routing value used by ?status=AwaitingReceipt/
// ?status=Received links elsewhere, e.g. the dashboard cards) is left
// unchanged since it's an internal filter key, not user-facing text.
const MATERIALS_REQUEST_TABS = [
  { label: "All",       key: "",               statuses: [] as string[] },
  { label: "Pending",   key: "AwaitingReceipt", statuses: ["Requested", "Approved", "Waiting Stock", "Partially Issued"] },
  { label: "Completed", key: "Received",        statuses: ["Issued"] },
];

// Materials Request Type Selection Flow Unit 10G.58, Task 9 — a second,
// orthogonal filter row (Type) alongside the existing status tabs above.
// Deliberately a separate ?kind= query param rather than folding into
// MATERIALS_REQUEST_TABS: the Job Card table's status tabs are entangled
// with work_orders.status (see the bucket-priority-sort block below) and
// are left completely untouched; this only controls which of the two
// tables render.
const REQUEST_KIND_FILTERS = [
  { label: "All", key: "all" },
  { label: "Job Card Requests", key: "job_card" },
  { label: "General Inventory Requests", key: "general" },
];

// Wording for a status tab/deep-link that has zero matching Materials
// Requests.
const TAB_EMPTY_STATE: Record<string, { title: string; message: string }> = {
  AwaitingReceipt: {
    title: "Nothing pending.",
    message: "Approved materials waiting to be received will appear here once a linked Job Card is approved.",
  },
  Requested: {
    title: "No Materials Requests found.",
    message: "New materials requests will appear here.",
  },
  Approved: {
    title: "No Materials Requests found.",
    message: "New materials requests will appear here.",
  },
  "Waiting Stock": {
    title: "No Materials Requests found.",
    message: "New materials requests will appear here.",
  },
  "Partially Issued": {
    title: "No Materials Requests found.",
    message: "New materials requests will appear here.",
  },
  Received: {
    title: "No Materials Requests completed yet.",
    message: "Completed requests will appear here.",
  },
  Issued: {
    title: "No Materials Requests completed yet.",
    message: "Completed requests will appear here.",
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

function listHref({ query, status, page, kind }: { query: string; status: string; page: number; kind?: string }) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  if (kind && kind !== "all") p.set("kind", kind);
  const qs = p.toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
}

function genPageHref(
  genPage: number,
  { query, status, page, kind }: { query: string; status: string; page: number; kind: string }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  if (kind && kind !== "all") p.set("kind", kind);
  if (genPage > 1) p.set("genPage", String(genPage));
  const qs = p.toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
}

function genPreviewHref(
  requestId: string,
  { query, status, page, kind }: { query: string; status: string; page: number; kind: string }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  if (kind && kind !== "all") p.set("kind", kind);
  p.set("genPreview", requestId);
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

function sendPreviewHref(
  requestId: string,
  { query, status, page }: { query: string; status: string; page: number }
) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  p.set("sendPreview", requestId);
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

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
  // Materials Request Type Selection Flow Unit 10G.58, Task 9 — which
  // table(s) render below; does not affect the existing Job Card
  // status-tab logic at all.
  const kind = (single(params.kind)?.trim() || "all") as "all" | "job_card" | "general";
  const showJobCardTable = kind !== "general";
  const showGeneralTable = kind !== "job_card";
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
  const newRequestType = single(params.type)?.trim() ?? "";
  const effectiveNewRequestType: "" | "job_card" | "general" =
    newRequestType === "job_card" || newRequestType === "general"
      ? newRequestType
      : newRequestJobCardId
        ? "job_card"
        : "";
  const newRequestError = single(params.error)?.trim() ?? null;

  // ── General Inventory / Stock Request detail/receive popup ───────────────
  const genPreviewId = single(params.genPreview)?.trim() ?? null;
  const validGenPreviewId = genPreviewId && UUID_RE.test(genPreviewId) ? genPreviewId : null;
  const genPreviewError = single(params.error)?.trim() ?? null;

  // ── Visibility: a user can always see requests they created/requested ────
  const partsRequestVisibility = getPartsRequestVisibilityFilter(context);

  // ── List query ───────────────────────────────────────────────────────────
  const NOT_YET_RECEIVED_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];
  const conditions: Prisma.parts_requestsWhereInput[] = [partsRequestVisibility];
  if (status === "AwaitingReceipt") {
    conditions.push({ status: { in: NOT_YET_RECEIVED_STATUSES } });
    conditions.push({ work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } } });
  } else if (status === "Received") {
    conditions.push({ status: "Issued" });
  } else if (status) {
    // Backward-compat direct deep link to a raw status (e.g. an existing
    // dashboard link to ?status=Approved, or the old ?status=Requested) — a
    // literal match, which safely yields zero rows for any value that isn't
    // a real status.
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

  const requestRowSelect = {
    id: true,
    parts_request_number: true,
    status: true,
    created_at: true,
    work_orders: { select: { id: true, work_order_number: true, status: true } },
    assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
    profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
    parts_request_items: { select: { description: true, quantity_requested: true, issued_quantity: true } },
    _count: { select: { parts_request_items: true } },
  } as const;

  type RequestRow = {
    id: string;
    parts_request_number: string | null;
    status: string;
    created_at: Date;
    work_orders: { id: string; work_order_number: string | null; status: string } | null;
    assets: { asset_code: string; asset_name: string; plate_number: string | null } | null;
    profiles_parts_requests_requested_byToprofiles: { full_name: string } | null;
    parts_request_items: { description: string; quantity_requested: unknown; issued_quantity: unknown }[];
    _count: { parts_request_items: number };
  };

  let requests: RequestRow[];
  let total: number;

  // Manager Approval Success Popup and Materials Awaiting Receipt Flow Task
  // 5: default sort is "Awaiting Receipt first, oldest first within Awaiting
  // Receipt" — a priority that depends on the linked Job Card's status, not
  // a raw column, so it can't be expressed as a single Prisma `orderBy`.
  // Only applied on views where the mix of buckets is actually meaningful
  // (All / Awaiting Receipt / any raw not-yet-received deep link); the
  // Received tab keeps the existing newest-first order, matching a normal
  // "recent activity" list.
  //
  // Performance Optimization Unit 3, Task 2: previously fetched every
  // matching row (unbounded — grows with total history) just to compute this
  // priority order in JS, then re-fetched the current page's slice by id.
  // Since the 3 priority buckets are each expressible as a normal Prisma
  // `where` (status === "Issued" is bucket 2; linked Job Card status is one
  // of OPEN_JOB_CARD_STATUSES is bucket 0; everything else is bucket 1 — see
  // displayPartsRequestStatus()/OPEN_JOB_CARD_STATUSES), the page can instead
  // be assembled from 3 cheap `count()` calls plus at most 2 bounded
  // `findMany` calls (a page only ever straddles one bucket boundary), with
  // the exact same bucket-then-oldest-first ordering as before.
  const useReceiptPrioritySort = status !== "Received";

  if (useReceiptPrioritySort) {
    // parts_requests.work_order_id is a required (non-nullable) FK — every
    // request has exactly one linked work order — so bucket 1 is simply "not
    // Issued, and not in bucket 0"; there's no "no linked work order" case to
    // account for (the original JS priority() function's `r.work_orders ?`
    // null-check was defensive-only, matching this).
    const notIssued = { status: { not: "Issued" } };
    const bucketWheres: Prisma.parts_requestsWhereInput[] = [
      { AND: [...conditions, notIssued, { work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } } }] },
      { AND: [...conditions, notIssued, { work_orders: { status: { notIn: OPEN_JOB_CARD_STATUSES } } }] },
      { AND: [...conditions, { status: "Issued" }] },
    ];

    const bucketCounts = await Promise.all(bucketWheres.map((w) => prisma.parts_requests.count({ where: w })));
    total = bucketCounts.reduce((sum, c) => sum + c, 0);

    // Figure out which bucket(s) the current page's row range falls into.
    let remainingSkip = (page - 1) * PAGE_SIZE;
    let remainingTake = PAGE_SIZE;
    const slices: { bucketIndex: number; skip: number; take: number }[] = [];
    for (let i = 0; i < bucketCounts.length && remainingTake > 0; i++) {
      const bucketSize = bucketCounts[i];
      if (remainingSkip >= bucketSize) {
        remainingSkip -= bucketSize;
        continue;
      }
      const takeHere = Math.min(bucketSize - remainingSkip, remainingTake);
      slices.push({ bucketIndex: i, skip: remainingSkip, take: takeHere });
      remainingSkip = 0;
      remainingTake -= takeHere;
    }

    const sliceResults = await Promise.all(
      slices.map((s) =>
        prisma.parts_requests.findMany({
          where: bucketWheres[s.bucketIndex],
          orderBy: { created_at: "asc" }, // oldest first within a bucket
          skip: s.skip,
          take: s.take,
          select: requestRowSelect,
        })
      )
    );
    requests = sliceResults.flat();
  } else {
    [requests, total] = await Promise.all([
      prisma.parts_requests.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: requestRowSelect,
      }),
      prisma.parts_requests.count({ where }),
    ]);
  }

  // Task 6: bucket counters, scoped by the same visibility filter as the
  // list — Awaiting Receipt needs its own join-aware count since it isn't a
  // single raw status value.
  const [statusSummaries, awaitingReceiptCount] = await Promise.all([
    prisma.parts_requests.groupBy({
      by: ["status"],
      where: partsRequestVisibility,
      _count: { _all: true },
    }),
    prisma.parts_requests.count({
      where: {
        AND: [
          partsRequestVisibility,
          { status: { in: NOT_YET_RECEIVED_STATUSES } },
          { work_orders: { status: { in: OPEN_JOB_CARD_STATUSES } } },
        ],
      },
    }),
  ]);

  // Simplified Workflow UI Consistency Cleanup Task 4: each row's helper
  // text/action depends on whether its linked Job Card has a pending
  // correction, looked up once for every Job Card referenced on this page.
  const rowJobCardIds = [...new Set(requests.map((r) => r.work_orders?.id).filter((id): id is string => Boolean(id)))];
  const rowCorrectionIds = await getPendingCorrectionWorkOrderIds(rowJobCardIds);

  const totalRequests = statusSummaries.reduce((n, s) => n + s._count._all, 0);
  const countFor = (statuses: string[]) =>
    statusSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const receivedCount = countFor(["Issued"]);

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

  // ── General Inventory / Stock Requests — list data (Task 9) ──────────────
  // Fully separate query from the Job Card table above — its own simple
  // Pending/Completed/Cancelled status, no Job-Card-status bucket sort.
  // "Manager/Super Admin can view all" (Task 11): mirrors
  // getPartsRequestVisibilityFilter's own canSeeAll logic exactly, else a
  // user only sees requests they made.
  const canSeeAllGeneral =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.approve") ||
    context.permissions.includes("work_orders.manage");
  const generalVisibility: Prisma.general_inventory_requestsWhereInput = canSeeAllGeneral
    ? {}
    : { requested_by_id: context.userId };
  const generalStatusFilter = status === "AwaitingReceipt" ? "Pending" : status === "Received" ? "Completed" : null;
  const generalWhere: Prisma.general_inventory_requestsWhereInput = {
    AND: [generalVisibility, generalStatusFilter ? { status: generalStatusFilter } : {}],
  };
  const GENERAL_PAGE_SIZE = 25;
  const genPage = Math.max(1, Number(single(params.genPage) ?? 1) || 1);

  const [generalRequests, generalTotal, generalStatusSummaries] = showGeneralTable
    ? await Promise.all([
        prisma.general_inventory_requests.findMany({
          where: generalWhere,
          orderBy: { created_at: "desc" },
          skip: (genPage - 1) * GENERAL_PAGE_SIZE,
          take: GENERAL_PAGE_SIZE,
          include: { items: { select: { material_name: true }, orderBy: { created_at: "asc" }, take: 1 } },
        }),
        prisma.general_inventory_requests.count({ where: generalWhere }),
        prisma.general_inventory_requests.groupBy({ by: ["status"], where: generalVisibility, _count: { _all: true } }),
      ])
    : [[], 0, []];
  const generalTotalRequests = generalStatusSummaries.reduce((n, s) => n + s._count._all, 0);
  const generalPendingCount = generalStatusSummaries.find((s) => s.status === "Pending")?._count._all ?? 0;
  const generalCompletedCount = generalStatusSummaries.find((s) => s.status === "Completed")?._count._all ?? 0;
  const generalTotalPages = Math.max(1, Math.ceil(generalTotal / GENERAL_PAGE_SIZE));

  // ── General Inventory / Stock Request detail/receive popup data ──────────
  const genPreviewRequest = validGenPreviewId
    ? await prisma.general_inventory_requests.findFirst({
        where: { AND: [{ id: validGenPreviewId }, generalVisibility] },
        include: { items: { orderBy: { created_at: "asc" } } },
      })
    : null;

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
  const jobPreviewCloseHref = listHref({ query, status, page });
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Created-success modal props ───────────────────────────────────────────
  const createdDismissHref = listHref({ query: "", status: "", page: 1 });
  const createdJobCardHref = createdRequest?.work_orders
    ? jobCardPreviewHref(createdRequest.work_orders.id, { query: "", status: "", page: 1 })
    : null;
  const createdJobCardHasPendingCorrection = createdRequest?.work_orders
    ? (await getPendingCorrectionWorkOrderIds([createdRequest.work_orders.id])).has(createdRequest.work_orders.id)
    : false;

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

  // ── General Inventory / Stock Request quick view props (Task 10) ─────────
  const genPreviewCloseHref = listHref({ query, status, page, kind });
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
          unitPrice: item.unit_price !== null ? Number(item.unit_price) : null,
          totalPrice: item.total_price !== null ? Number(item.total_price) : null,
          supplier: item.supplier,
          receivedQuantity: Number(item.received_quantity),
          inventoryUnit: item.inventory_unit,
          conversionQuantity: item.conversion_quantity !== null ? Number(item.conversion_quantity) : null,
          inventoryQuantity: item.inventory_quantity_to_add !== null ? Number(item.inventory_quantity_to_add) : null,
          unitCost: item.unit_cost !== null ? Number(item.unit_cost) : null,
        })),
        closeHref: genPreviewCloseHref,
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

      <div className="space-y-4 p-4 lg:p-6">
        {/* ── Counters — Total / Pending / Completed. ── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([
            { label: "Total Materials Requests", value: totalRequests, icon: ClipboardList, tone: "blue" as const, status: "" },
            { label: "Pending", value: awaitingReceiptCount, icon: ShoppingCart, tone: awaitingReceiptCount > 0 ? "amber" : "gray", status: "AwaitingReceipt" },
            { label: "Completed",  value: receivedCount,  icon: CheckCircle2, tone: "green" as const, status: "Received" },
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

        {/* ── Type filter — All / Job Card Requests / General Inventory
              Requests (Task 9). Purely which table(s) below render; the
              existing Job Card status tabs/bucket-sort underneath are
              completely untouched. ── */}
        <div className="flex flex-wrap gap-2">
          {REQUEST_KIND_FILTERS.map((f) => {
            const isActive = kind === f.key;
            return (
              <Link
                key={f.key}
                href={listHref({ query, status, page: 1, kind: f.key })}
                className={`inline-flex min-h-9 items-center rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                  isActive
                    ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                    : "border-[#DDE2EA] bg-white text-[#4B5563] hover:bg-gray-50"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {showJobCardTable && (
        <>
        {/* ── Status tabs — All / Pending / Completed; a raw
              ?status=Approved or ?status=Waiting+Stock deep link still
              filters correctly and highlights "Pending" as active,
              since all four pre-receive statuses fold into that bucket. ── */}
        <div className="overflow-x-auto rounded-t-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex min-w-max">
            {MATERIALS_REQUEST_TABS.map((tab) => {
              const isActive =
                tab.key === "" ? !status : status === tab.key || tab.statuses.includes(status);
              const itemCount =
                tab.key === "AwaitingReceipt" ? awaitingReceiptCount
                : tab.statuses.length ? countFor(tab.statuses)
                : totalRequests;
              return (
                <Link
                  key={tab.key || "all"}
                  href={listHref({ query, status: tab.key, page: 1, kind })}
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

        {/* ── Job Card Requests table ─────────────────────────────── */}
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
                    <th className="px-4 py-3">Requested / Received</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Requested Date &amp; Time</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {requests.map((request) => {
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
                    // Row-level helper text — driven by the LINKED JOB CARD's
                    // status/correction state (Task 4), not by any Materials-
                    // Request-side "approval" concept.
                    const jobCardHelper = materialsRequestJobCardHelper(
                      woStatus,
                      woId ? rowCorrectionIds.has(woId) : false,
                      listGroup === "Received"
                    );
                    const rowHelperLabel = jobCardHelper.label;
                    const rowHelperClass =
                      listGroup === "Received" ? "text-green-700" : jobCardHelper.canReceive ? "text-blue-700" : "text-amber-700";
                    // Task 4/5: the 3-value Requested / Awaiting Receipt /
                    // Received badge — distinct from the 2-value `listGroup`
                    // above, which still drives jobCardHelper's isReceived
                    // input unchanged.
                    const receiptStatus = materialsReceiptStatus(
                      request.status,
                      woStatus,
                      woId ? rowCorrectionIds.has(woId) : false
                    );
                    const materialNames = request.parts_request_items.map((i) => i.description);
                    // Materials Requests Requested Date & Time Column
                    // Cleanup: exact "DD MMM YYYY, hh:mm AM/PM" timestamp —
                    // relative wording ("Today", "2 days ago") was confusing
                    // during tracking/reporting.
                    const requestedDateTime = formatExactDateTime(request.created_at);

                    return (
                      <tr key={request.id} className="hover:bg-gray-50">
                        {/* Request number — opens the quick view (Task 7) */}
                        <td className="px-4 py-3">
                          <span className="mb-0.5 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                            Job Card Request
                          </span>
                          <br />
                          <Link
                            className="font-bold hover:text-[#ED1C24]"
                            href={previewHref(request.id, { query, status, page })}
                            scroll={false}
                          >
                            {request.parts_request_number}
                          </Link>
                          <p className="text-xs text-[#9CA3AF]">
                            {materialNames.length > 0 ? materialNames[0] : "—"}
                            {materialNames.length > 1 ? ` +${materialNames.length - 1} more` : ""}
                          </p>
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
                                <p className="mt-0.5 text-xs text-[#4B5563]">
                                  {displaySimplifiedStatus(woStatus)}
                                  {woId && rowCorrectionIds.has(woId) && ` · ${NEEDS_UPDATE_LABEL}`}
                                </p>
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

                        {/* Requested / Received quantity summary. */}
                        <td className="px-4 py-3 text-xs text-[#111827]">
                          <p>Requested: <span className="font-semibold">{formatQty(totals.requested)}</span></p>
                          <p>Received: <span className="font-semibold">{formatQty(totals.issued)}</span></p>
                          <p className={`mt-0.5 font-semibold ${rowHelperClass}`}>{rowHelperLabel}</p>
                        </td>

                        {/* Status — Requested / Pending / Completed. */}
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={receiptStatus}
                            tone={materialsReceiptStatusTone(receiptStatus)}
                          />
                        </td>

                        {/* Requested date & time — exact timestamp, not
                            relative wording (Materials Requests Requested
                            Date & Time Column Cleanup). */}
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-[#4B5563]">
                          {requestedDateTime}
                        </td>

                        {/* Action — Job Card Open -> Receive Materials (opens
                            the guided popup); Job Card not yet Open -> Open
                            Job Card is the Manager's primary action (no
                            separate Materials Request approval button —
                            Materials Requests are approved together with
                            their Job Card); Received -> view only. Every row
                            also gets a plain "Open" link to the request itself. */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/store/parts-requests/${request.id}`}
                              className="inline-flex min-h-[30px] items-center rounded-md border border-[#E5E7EB] px-3 py-1 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                            >
                              Open
                            </Link>
                            {canReceive && jobCardHelper.canReceive ? (
                              <Link
                                href={sendPreviewHref(request.id, { query, status, page })}
                                scroll={false}
                                className="inline-flex min-h-[30px] items-center rounded-md bg-[#111827] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                              >
                                Receive Materials
                              </Link>
                            ) : canApprove && woId && listGroup !== "Received" && !jobCardHelper.canReceive && woStatus !== "Closed" ? (
                              <Link
                                href={jobCardPreviewHref(woId, { query, status, page })}
                                scroll={false}
                                className="inline-flex min-h-[30px] items-center rounded-md bg-[#ED1C24] px-3 py-1 text-xs font-semibold text-white hover:bg-[#c9151c]"
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
            href={listHref({ query, status, page: Math.max(1, page - 1), kind })}
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
            href={listHref({ query, status, page: Math.min(totalPages, page + 1), kind })}
            aria-disabled={page >= totalPages}
          >
            Next
          </Link>
        </div>
        </>
        )}

        {/* ── General Inventory / Stock Requests table (Task 9) ────────
            Fully separate table/query from the Job Card one above — own
            simple Pending/Completed status, own pagination (?genPage=). */}
        {showGeneralTable && (
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase text-[#4B5563]">General Inventory / Stock Requests</p>
                <p className="text-sm font-semibold text-[#111827]">{generalTotal} matching requests</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={`Total ${generalTotalRequests}`} tone="blue" />
                <StatusBadge label={`Pending ${generalPendingCount}`} tone="amber" />
                <StatusBadge label={`Completed ${generalCompletedCount}`} tone="green" />
              </div>
            </div>
            {generalRequests.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-4 py-3">Request</th>
                      <th className="px-4 py-3">Job Card</th>
                      <th className="px-4 py-3">Purpose / Materials</th>
                      <th className="px-4 py-3">Requested Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {generalRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="mb-0.5 inline-block rounded-full bg-[#111827] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                            General Inventory Request
                          </span>
                          <br />
                          <Link
                            className="font-bold hover:text-[#ED1C24]"
                            href={genPreviewHref(req.id, { query, status, page, kind })}
                            scroll={false}
                          >
                            {req.request_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[#9CA3AF]">-</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#111827]">{req.purpose}</p>
                          <p className="text-xs text-[#9CA3AF]">{req.items[0]?.material_name ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-[#4B5563]">
                          {formatExactDateTime(req.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={req.status}
                            tone={req.status === "Completed" ? "green" : req.status === "Cancelled" ? "gray" : "amber"}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={genPreviewHref(req.id, { query, status, page, kind })}
                              scroll={false}
                              className="inline-flex min-h-[30px] items-center rounded-md border border-[#E5E7EB] px-3 py-1 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                            >
                              Open
                            </Link>
                            {canReceiveGeneral && req.status === "Pending" ? (
                              <Link
                                href={genPreviewHref(req.id, { query, status, page, kind })}
                                scroll={false}
                                className="inline-flex min-h-[30px] items-center rounded-md bg-[#111827] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2b2b2b]"
                              >
                                Receive Materials
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="No General Inventory Requests found."
                  message="Requests for store stock or general inventory (no Job Card) will appear here."
                />
              </div>
            )}
            {generalTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] p-3">
                <Link
                  className={paginationClass(genPage <= 1)}
                  href={genPageHref(Math.max(1, genPage - 1), { query, status, page, kind })}
                  aria-disabled={genPage <= 1}
                >
                  Previous
                </Link>
                <span className="text-sm font-semibold text-[#4B5563]">
                  Page {genPage} of {generalTotalPages}
                </span>
                <Link
                  className={paginationClass(genPage >= generalTotalPages)}
                  href={genPageHref(Math.min(generalTotalPages, genPage + 1), { query, status, page, kind })}
                  aria-disabled={genPage >= generalTotalPages}
                >
                  Next
                </Link>
              </div>
            )}
          </section>
        )}
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
            closeHref={listHref({ query, status, page })}
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
                    href={listHref({ query, status, page })}
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
          Opens via ?newRequest=1 (optionally ?jobCardId=<id> to preselect a
          Job Card — that case skips the type selector below and goes
          straight to the existing wizard, since the type is already
          implied). Materials Request Type Selection Flow Unit 10G.58, Task
          1: with no &type= yet, shows the new Request Type step first;
          &type=job_card renders the existing PartsRequestWizard completely
          unchanged (Task 2); &type=general renders the new, separate
          GeneralInventoryRequestForm (Task 3). The standalone
          /store/parts-requests/new page mirrors the same &type= gate.
          Submitting either flow redirects to this same page on success,
          which naturally closes the modal.
      ────────────────────────────────────────────────────────────── */}
      {showNewRequest && (
        <LargeFormModal
          title="New Materials Request"
          subtitle={
            effectiveNewRequestType === "job_card"
              ? "Request materials linked to a Job Card."
              : effectiveNewRequestType === "general"
                ? "Request materials for store stock or general inventory. No Job Card required."
                : "Choose how this material request will be used."
          }
          closeHref={listHref({ query, status, page, kind })}
        >
          {effectiveNewRequestType === "job_card" ? (
            <PartsRequestWizard
              modalMode
              workOrders={newRequestWorkOrders}
              preselectedWorkOrderId={newRequestJobCardId || undefined}
              preselectedWorkOrder={newRequestPreselectedWo}
            />
          ) : effectiveNewRequestType === "general" ? (
            <GeneralInventoryRequestForm
              modalMode
              requesterName={currentProfile?.full_name ?? null}
              requestedDateLabel={generalRequestDateLabel}
              errorMessage={newRequestError}
            />
          ) : (
            <MaterialsRequestTypeSelector baseHref="/store/parts-requests?newRequest=1" />
          )}
        </LargeFormModal>
      )}
    </>
  );
}
