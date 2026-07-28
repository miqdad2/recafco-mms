import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Plus, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
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
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
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
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import {
  getPendingCorrectionWorkOrderIds,
  displaySimplifiedStatus,
  OPEN_JOB_CARD_STATUSES,
  NEEDS_UPDATE_LABEL,
} from "@/lib/work-orders/simplified-status";
import { getPartsRequestVisibilityFilter, canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { cn } from "@/lib/utils";

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
// Materials Receive Wording Simplification Task 3: label changed from
// "Awaiting Receipt" to "To Receive" — the `key` (URL routing value used by
// ?status=AwaitingReceipt links elsewhere, e.g. the dashboard cards) is left
// unchanged since it's an internal filter key, not user-facing text.
const MATERIALS_REQUEST_TABS = [
  { label: "All",        key: "",               statuses: [] as string[] },
  { label: "To Receive", key: "AwaitingReceipt", statuses: ["Requested", "Approved", "Waiting Stock", "Partially Issued"] },
  { label: "Received",   key: "Received",        statuses: ["Issued"] },
];

// Wording for a status tab/deep-link that has zero matching Materials
// Requests.
const TAB_EMPTY_STATE: Record<string, { title: string; message: string }> = {
  AwaitingReceipt: {
    title: "Nothing to receive.",
    message: "Approved materials not received yet will appear here once a linked Job Card is approved.",
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
    title: "No Materials Requests received yet.",
    message: "Fully received requests will appear here.",
  },
  Issued: {
    title: "No Materials Requests received yet.",
    message: "Fully received requests will appear here.",
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
  // Computed once per request, not per row — matches the established
  // new Date() (not Date.now()) convention used elsewhere on this page.
  const nowMs = new Date().getTime();

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

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
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

  // Manager Approval Success Popup and Materials Awaiting Receipt Flow Task
  // 5: default sort is "Awaiting Receipt first, oldest first within Awaiting
  // Receipt" — a priority that depends on the linked Job Card's status, not
  // a raw column, so it can't be expressed as a single Prisma `orderBy`.
  // Only applied on views where the mix of buckets is actually meaningful
  // (All / Awaiting Receipt / any raw not-yet-received deep link); the
  // Received tab keeps the existing newest-first order, matching a normal
  // "recent activity" list. Fetches a lightweight id/status/job-status/date
  // projection first (cheap at this system's scale), sorts in memory, then
  // fetches full row data for just the current page's slice.
  const useReceiptPrioritySort = status !== "Received";

  let requests: Array<{
    id: string;
    parts_request_number: string | null;
    status: string;
    created_at: Date;
    work_orders: { id: string; work_order_number: string | null; status: string } | null;
    assets: { asset_code: string; asset_name: string; plate_number: string | null } | null;
    profiles_parts_requests_requested_byToprofiles: { full_name: string } | null;
    parts_request_items: { description: string; quantity_requested: unknown; issued_quantity: unknown }[];
    _count: { parts_request_items: number };
  }>;
  let total: number;

  if (useReceiptPrioritySort) {
    const sortable = await prisma.parts_requests.findMany({
      where,
      select: { id: true, status: true, created_at: true, work_orders: { select: { status: true } } },
    });
    total = sortable.length;
    const priority = (r: (typeof sortable)[number]) => {
      if (displayPartsRequestStatus(r.status) === "Issued") return 2;
      const isOpen = r.work_orders ? OPEN_JOB_CARD_STATUSES.includes(r.work_orders.status) : false;
      return isOpen ? 0 : 1;
    };
    const orderedIds = sortable
      .slice()
      .sort((a, b) => {
        const pa = priority(a);
        const pb = priority(b);
        if (pa !== pb) return pa - pb;
        return a.created_at.getTime() - b.created_at.getTime(); // oldest first within a bucket
      })
      .map((r) => r.id)
      .slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);

    const rows = await prisma.parts_requests.findMany({
      where: { id: { in: orderedIds } },
      select: {
        id: true,
        parts_request_number: true,
        status: true,
        created_at: true,
        work_orders: { select: { id: true, work_order_number: true, status: true } },
        assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
        profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
        parts_request_items: { select: { description: true, quantity_requested: true, issued_quantity: true } },
        _count: { select: { parts_request_items: true } },
      },
    });
    const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
    requests = rows.slice().sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  } else {
    [requests, total] = await Promise.all([
      prisma.parts_requests.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          created_at: true,
          work_orders: { select: { id: true, work_order_number: true, status: true } },
          assets: { select: { asset_code: true, asset_name: true, plate_number: true } },
          profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
          parts_request_items: { select: { description: true, quantity_requested: true, issued_quantity: true } },
          _count: { select: { parts_request_items: true } },
        },
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
        description="Materials requested for Job Cards — track and receive them here."
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
        {/* ── Counters — Total / To Receive / Received (Task 5). ── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([
            { label: "Total Materials Requests", value: totalRequests, icon: ClipboardList, tone: "blue" as const, status: "" },
            { label: "To Receive", value: awaitingReceiptCount, icon: ShoppingCart, tone: awaitingReceiptCount > 0 ? "amber" : "gray", status: "AwaitingReceipt" },
            { label: "Received",  value: receivedCount,  icon: CheckCircle2, tone: "green" as const, status: "Received" },
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

        {/* ── Status tabs — All / To Receive / Received; a raw
              ?status=Approved or ?status=Waiting+Stock deep link still
              filters correctly and highlights "To Receive" as active,
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
                    <th className="px-4 py-3">Requested / Received</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Requested</th>
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
                    const ageDays = Math.floor((nowMs - request.created_at.getTime()) / 86_400_000);
                    const ageLabel = ageDays <= 0 ? "Today" : ageDays === 1 ? "1 day ago" : `${ageDays} days ago`;

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

                        {/* Status — Requested / To Receive / Received (Task 4). */}
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={receiptStatus}
                            tone={materialsReceiptStatusTone(receiptStatus)}
                          />
                        </td>

                        {/* Requested date / age — oldest-first sort makes
                            this the natural "how long has this been
                            waiting" cue (Task 5). */}
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-[#4B5563]">
                          {ageLabel}
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

    </>
  );
}
