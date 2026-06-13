import type { Prisma } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";

import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const statusOptions = [
  "Submitted",
  "Pending Purchase",
  "Pending Finance Approval",
  "Pending CEO Approval",
  "Approved",
  "Ordered",
  "Received",
  "Rejected",
  "Cancelled"
];

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PurchaseRequestsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const context = await requirePermission("purchase_requests.view");
  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);

  const where: Prisma.purchase_requestsWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { purchase_request_number: { contains: query, mode: "insensitive" } },
            { supplier: { contains: query, mode: "insensitive" } },
            { purchase_officer_notes: { contains: query, mode: "insensitive" } },
            { work_orders: { work_order_number: { contains: query, mode: "insensitive" } } },
            { parts_requests: { parts_request_number: { contains: query, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [purchases, total, statusCounts, totalPendingValue] = await Promise.all([
    prisma.purchase_requests.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        purchase_request_number: true,
        supplier: true,
        status: true,
        estimated_total: true,
        created_at: true,
        parts_requests: { select: { parts_request_number: true } },
        work_orders: { select: { work_order_number: true, priority: true, status: true } }
      }
    }),
    prisma.purchase_requests.count({ where }),
    prisma.purchase_requests.groupBy({
      by: ["status"],
      _count: { _all: true }
    }),
    prisma.purchase_requests.aggregate({
      where: { status: { in: ["Pending Finance Approval", "Pending CEO Approval", "Pending Purchase", "Approved", "Ordered"] } },
      _sum: { estimated_total: true }
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pendingFinance = countStatus(statusCounts, "Pending Finance Approval");
  const pendingCeo = countStatus(statusCounts, "Pending CEO Approval");
  const ordered = countStatus(statusCounts, "Ordered");

  return (
    <>
      <PageHeader title="Purchase Requests" description="Purchase queue for unavailable parts, supplier updates, approvals, ordered items, and receiving." />
      <div className="space-y-4 p-4 lg:p-6">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Finance approval" value={pendingFinance} tone={pendingFinance ? "amber" : "green"} />
          <SummaryCard label="CEO approval" value={pendingCeo} tone={pendingCeo ? "red" : "green"} />
          <SummaryCard label="Ordered" value={ordered} tone={ordered ? "blue" : "gray"} />
          <SummaryCard label="Open value" value={<CostVisibilityGuard context={context}>{formatMoney(Number(totalPendingValue._sum.estimated_total ?? 0))}</CostVisibilityGuard>} tone="gray" />
        </section>

        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-3 lg:grid-cols-[1fr_240px_auto]">
            <input
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="q"
              defaultValue={query}
              placeholder="Search purchase, supplier, work order, parts request"
            />
            <select className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50" type="submit">
              Filter
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Purchase records</p>
              <p className="text-sm font-semibold text-[#111827]">{total} matching requests</p>
            </div>
            <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
          </div>
          {purchases.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Purchase</th>
                    <th className="px-4 py-3">Parts Request</th>
                    <th className="px-4 py-3">Work Order</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Estimate</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/purchase/requests/${purchase.id}`} className="font-black text-[#111827] hover:text-[#ED1C24]">
                          {purchase.purchase_request_number ?? "Purchase request"}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{purchase.parts_requests?.parts_request_number ?? "-"}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#111827]">{purchase.work_orders?.work_order_number ?? "-"}</p>
                        {purchase.work_orders?.priority ? <p className="text-xs text-[#4B5563]">{purchase.work_orders.priority} priority</p> : null}
                      </td>
                      <td className="px-4 py-3">{purchase.supplier ?? "-"}</td>
                      <td className="px-4 py-3">
                        <CostVisibilityGuard context={context}>{formatMoney(Number(purchase.estimated_total ?? 0))}</CostVisibilityGuard>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={purchase.status} tone={statusTone(purchase.status)} />
                      </td>
                      <td className="px-4 py-3">{formatDate(purchase.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState title="No purchase requests found" message="Try changing the search or status filter." />
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <Link className={paginationClass(page <= 1)} href={purchaseListHref({ query, status, page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>
            Previous
          </Link>
          <span className="text-sm font-semibold text-[#4B5563]">
            Showing {purchases.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <Link className={paginationClass(page >= totalPages)} href={purchaseListHref({ query, status, page: Math.min(totalPages, page + 1) })} aria-disabled={page >= totalPages}>
            Next
          </Link>
        </div>
      </div>
    </>
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function countStatus(rows: Array<{ status: string; _count: { _all: number } }>, status: string) {
  return rows.find((row) => row.status === status)?._count._all ?? 0;
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} KWD`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

function statusTone(status: string) {
  if (status === "Rejected" || status === "Cancelled") return "red";
  if (status === "Received" || status === "Approved") return "green";
  if (status.includes("Pending")) return "amber";
  if (status === "Ordered") return "blue";
  return "gray";
}

function purchaseListHref({ query, status, page }: { query: string; status: string; page: number }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/purchase/requests?${qs}` : "/purchase/requests";
}

function paginationClass(disabled: boolean) {
  return cn(
    "rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold",
    disabled ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50"
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: ReactNode; tone: "green" | "amber" | "red" | "blue" | "gray" }) {
  return (
    <div className={cn("rounded-md border bg-white p-4 shadow-sm", tone === "green" && "border-green-200", tone === "amber" && "border-amber-200", tone === "red" && "border-red-200", tone === "blue" && "border-blue-200", tone === "gray" && "border-[#E5E7EB]")}>
      <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#111827]">{value}</p>
    </div>
  );
}
