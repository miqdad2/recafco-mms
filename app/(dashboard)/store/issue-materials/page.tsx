import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { displayStatus as displayJobCardStatus } from "@/lib/display/work-order-labels";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
} from "@/lib/display/parts-request-labels";
import { getPartsRequestVisibilityFilter } from "@/lib/parts-requests/visibility";
import { getMaterialBalancesForItems } from "@/lib/store/offline-inventory-data";
import { StoreSendMaterialsPopup } from "@/components/store/store-send-materials-popup";

// Store Issue Materials + Offline Inventory Separation Unit Task 3: a
// Store-focused view containing only the requests Store can actually act on
// — Offline Inventory Control (the general balance/ledger page) is no longer
// Store's primary work page; this is. Excludes "Issued" entirely (that's
// Sent Materials / Issue History's job, not this action page's).
const ACTIONABLE_STATUSES = ["Approved", "Waiting Stock", "Partially Issued"];

type IssueMaterialsRow = {
  id: string;
  parts_request_number: string | null;
  status: string;
  created_at: Date;
  requested_by_name: string | null;
  work_order_number: string | null;
  work_order_status: string | null;
  asset_name: string | null;
  plate_number: string | null;
  items: { description: string; quantity_requested: number }[];
};

function formatDate(v: Date): string {
  return v.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function jobCardStatusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["Closed", "Approved", "Materials Issued"].includes(status)) return "green";
  if (status.includes("Waiting") || status === "Partially Issued" || status === "Under Review") return "amber";
  return "blue";
}

// Store Send Materials Approval Gate Unit Task 2/3: a Materials Request can
// say Approved/Waiting Stock/Partially Issued while the linked Job Card
// itself is still Created/Under Review — Store must not send in that state
// (matches the backend gate in issueMaterials).
function isJobCardBlocked(status: string | null): boolean {
  return status === "Created" || status === "Under Review";
}

function RequestCard({ row, actionable }: { row: IssueMaterialsRow; actionable: boolean }) {
  const itemSummary = row.items.length
    ? row.items.map((i) => `${i.description} x${i.quantity_requested}`).join(", ")
    : "No items listed";
  const followUpHint =
    row.status === "Waiting Stock" ? "Arranging materials" :
    row.status === "Partially Issued" ? "Updating materials" : null;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-black text-[#111827]">
            {row.parts_request_number ?? "Materials Request"}
            {row.work_order_number && (
              <span className="ml-2 text-xs font-normal text-[#6B7280]">· Job Card: {row.work_order_number}</span>
            )}
          </p>
          {row.work_order_status && (
            <p className="mt-1 text-xs text-[#4B5563]">
              Job Card status:{" "}
              <StatusBadge label={displayJobCardStatus(row.work_order_status)} tone={jobCardStatusTone(row.work_order_status)} />
            </p>
          )}
          {row.asset_name && (
            <p className="mt-1 text-sm text-[#111827]">
              Asset: {row.asset_name}
              {row.plate_number ? ` - Plate ${row.plate_number}` : ""}
            </p>
          )}
          <p className="mt-1 text-sm text-[#4B5563]">Materials: {itemSummary}</p>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Requested by {row.requested_by_name ?? "—"} · {formatDate(row.created_at)}
          </p>
          {row.status === "Requested" && (
            <p className="mt-1.5 text-xs font-semibold text-amber-700">Waiting Manager Approval</p>
          )}
          {row.status !== "Requested" && isJobCardBlocked(row.work_order_status) && (
            <p className="mt-1.5 text-xs font-semibold text-amber-700">
              Waiting Manager Approval — Store can send materials after the Job Card is approved.
            </p>
          )}
          {followUpHint && <p className="mt-1.5 text-xs font-semibold text-amber-700">{followUpHint}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge label={displayPartsRequestStatus(row.status)} tone={partsRequestStatusTone(row.status)} />
          {/* Store Guided Send Materials Popup Workflow Unit Task 9: an
              actionable row opens the same guided popup used on the Store
              dashboard, instead of navigating to the full Materials Request
              page. */}
          <Link
            href={actionable ? `?sendPreview=${row.id}` : `/store/parts-requests/${row.id}`}
            className={
              actionable
                ? "inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                : "inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
            }
          >
            {actionable ? "Send Materials" : "View"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Section({ title, rows, actionable, emptyText }: {
  title: string;
  rows: IssueMaterialsRow[];
  actionable: boolean;
  emptyText: string;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">{title} ({rows.length})</p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#E5E7EB] bg-white p-4 text-sm text-[#9CA3AF]">{emptyText}</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => <RequestCard key={row.id} row={row} actionable={actionable} />)}
        </div>
      )}
    </section>
  );
}

type IssueMaterialsPageProps = { searchParams?: Promise<{ sendPreview?: string }> };

export default async function IssueMaterialsPage({ searchParams }: IssueMaterialsPageProps) {
  const context = await requirePermission("store.issue");
  const visibilityFilter = getPartsRequestVisibilityFilter(context);

  // Store Guided Send Materials Popup Workflow Unit Task 9: same guided
  // popup used on the Store dashboard, opened via ?sendPreview instead of
  // navigating to the full Materials Request page. The top-level
  // requirePermission("store.issue") call above already gates this whole
  // page, so no extra permission check is needed here.
  const sp = (await searchParams) ?? {};
  const rawSendPreview = sp.sendPreview ?? null;
  const sendPreviewId =
    rawSendPreview && /^[0-9a-f-]{36}$/i.test(rawSendPreview) ? rawSendPreview : null;

  const sendPreviewRequest = sendPreviewId
    ? await prisma.parts_requests.findFirst({
        where: { id: sendPreviewId },
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
              assets: { select: { asset_name: true, plate_number: true } }
            }
          },
          parts_request_items: {
            select: { id: true, description: true, quantity_requested: true, issued_quantity: true }
          }
        }
      })
    : null;

  const sendPreviewBalances = sendPreviewRequest
    ? await getMaterialBalancesForItems(
        sendPreviewRequest.parts_request_items.map((item) => ({ part_id: null, description: item.description }))
      )
    : null;

  const requests = await prisma.parts_requests.findMany({
    where: {
      AND: [
        visibilityFilter,
        { status: { in: [...ACTIONABLE_STATUSES, "Requested"] } },
      ],
    },
    select: {
      id: true,
      parts_request_number: true,
      status: true,
      created_at: true,
      profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
      work_orders: {
        select: {
          work_order_number: true,
          status: true,
          assets: { select: { asset_name: true, plate_number: true } },
        },
      },
      parts_request_items: { select: { description: true, quantity_requested: true }, take: 5 },
    },
    orderBy: { created_at: "asc" },
  });

  const rows: IssueMaterialsRow[] = requests.map((r) => ({
    id: r.id,
    parts_request_number: r.parts_request_number,
    status: r.status,
    created_at: r.created_at,
    requested_by_name: r.profiles_parts_requests_requested_byToprofiles?.full_name ?? null,
    work_order_number: r.work_orders?.work_order_number ?? null,
    work_order_status: r.work_orders?.status ?? null,
    asset_name: r.work_orders?.assets?.asset_name ?? null,
    plate_number: r.work_orders?.assets?.plate_number ?? null,
    items: r.parts_request_items.map((i) => ({ description: i.description, quantity_requested: Number(i.quantity_requested) })),
  }));

  const readyForIssue = rows.filter((r) => r.status === "Approved" && !isJobCardBlocked(r.work_order_status));
  const storeFollowUp = rows.filter(
    (r) => (r.status === "Waiting Stock" || r.status === "Partially Issued") && !isJobCardBlocked(r.work_order_status)
  );
  const waitingApproval = rows.filter((r) => r.status === "Requested");
  // Store Send Materials Approval Gate Unit Task 3: Approved/Waiting Stock/
  // Partially Issued Materials Requests whose Job Card hasn't been Manager-
  // approved yet — View Only, never counted as "Ready for Issue".
  const waitingJobCardApproval = rows.filter(
    (r) => r.status !== "Requested" && isJobCardBlocked(r.work_order_status)
  );

  return (
    <>
      {/* Store Issue Materials + Offline Inventory Separation Unit Task 11 */}
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["materials_request.approved", "materials_request.updated"]} />
      <PageHeader
        title="Send Materials"
        description="Approved Materials Requests ready to send, plus Store follow-up items. Sending records the material against the Job Card automatically."
      />
      <div className="space-y-6 p-4 lg:p-6">
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to send right now."
            message="Approved Materials Requests ready for Store to send will appear here."
          />
        ) : (
          <>
            <Section
              title="Ready for Issue"
              rows={readyForIssue}
              actionable
              emptyText="No approved requests are waiting to be issued."
            />
            <Section
              title="Store Follow-up"
              rows={storeFollowUp}
              actionable
              emptyText="No requests need Store follow-up right now."
            />
            <Section
              title="Waiting Manager Approval — Job Card"
              rows={waitingJobCardApproval}
              actionable={false}
              emptyText="No requests are waiting on Job Card approval."
            />
            <Section
              title="Waiting Manager Approval — Materials Request"
              rows={waitingApproval}
              actionable={false}
              emptyText="No requests are waiting on Manager approval."
            />
          </>
        )}
      </div>

      {/* Store Guided Send Materials Popup Workflow Unit Task 9: falls back to
          a plain not-found card for a stale/invalid id, same convention as
          the dashboard's guided popup. */}
      {sendPreviewId && (
        sendPreviewRequest ? (
          <StoreSendMaterialsPopup
            closeHref="/store/issue-materials"
            data={{
              id: sendPreviewRequest.id,
              parts_request_number: sendPreviewRequest.parts_request_number,
              status: sendPreviewRequest.status,
              work_order_id: sendPreviewRequest.work_orders?.id ?? null,
              work_order_number: sendPreviewRequest.work_orders?.work_order_number ?? null,
              work_order_status: sendPreviewRequest.work_orders?.status ?? null,
              problem_summary:
                sendPreviewRequest.work_orders?.operator_complaint ||
                sendPreviewRequest.work_orders?.description_of_work ||
                null,
              asset_name: sendPreviewRequest.work_orders?.assets?.asset_name ?? null,
              plate_number: sendPreviewRequest.work_orders?.assets?.plate_number ?? null,
              items: sendPreviewRequest.parts_request_items.map((item) => ({
                id: item.id,
                description: item.description,
                quantity_requested: Number(item.quantity_requested),
                issued_quantity: Number(item.issued_quantity),
                balance: sendPreviewBalances?.get(item.description)
              }))
            }}
          />
        ) : (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <p className="font-bold text-[#111827]">Materials Request not found or no longer available.</p>
                <div className="mt-4">
                  <Link
                    href="/store/issue-materials"
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
