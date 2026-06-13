import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Plus } from "lucide-react";

import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  "Pending Approval",
  "Waiting for Store",
  "Partially Issued",
  "Issued",
  "Waiting for Purchase",
  "Rejected",
  "Cancelled",
  "Closed"
];

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Rejected" || status === "Cancelled") return "red";
  if (status === "Issued") return "green";
  if (status.includes("Waiting")) return "amber";
  if (status.includes("Pending")) return "blue";
  return "gray";
}

function listHref({ query, status, page }: { query: string; status: string; page: number }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/store/parts-requests?${qs}` : "/store/parts-requests";
}

function paginationClass(disabled: boolean) {
  return cn(
    "rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold",
    disabled ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50"
  );
}

export default async function PartsRequestsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const context = await requirePermission("parts_requests.view");
  const canCreate =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage");

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);

  const where: Prisma.parts_requestsWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { parts_request_number: { contains: query, mode: "insensitive" } },
            { work_orders: { work_order_number: { contains: query, mode: "insensitive" } } },
            { departments: { name: { contains: query, mode: "insensitive" } } }
          ]
        }
      : {})
  };

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
        total_price: true,
        work_orders: { select: { work_order_number: true } },
        departments: { select: { name: true } },
        profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } }
      }
    }),
    prisma.parts_requests.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Parts Requests"
        description="Maintenance parts request queue for approval, store issue, and purchase follow-up."
        actions={
          canCreate ? (
            <Link
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c9151c]"
              href="/store/parts-requests/new"
            >
              <Plus className="h-4 w-4" />
              New parts request
            </Link>
          ) : null
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-3 lg:grid-cols-[1fr_240px_auto]">
            <input
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="q"
              defaultValue={query}
              placeholder="Search request number, work order, department"
            />
            <select
              className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
              name="status"
              defaultValue={status}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
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

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Parts requests</p>
              <p className="text-sm font-semibold text-[#111827]">{total} matching requests</p>
            </div>
            <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
          </div>
          {requests.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Request</th>
                    <th className="px-4 py-3">WO</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Requester</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {requests.map((request) => (
                    <tr key={request.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link className="font-bold hover:text-[#ED1C24]" href={`/store/parts-requests/${request.id}`}>
                          {request.parts_request_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{request.work_orders?.work_order_number ?? "-"}</td>
                      <td className="px-4 py-3">{request.departments?.name ?? "-"}</td>
                      <td className="px-4 py-3">
                        {request.profiles_parts_requests_requested_byToprofiles?.full_name ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <CostVisibilityGuard context={context}>{String(request.total_price)}</CostVisibilityGuard>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={request.status} tone={statusTone(request.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState title="No parts requests found" message="Try changing the search or status filter." />
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <Link
            className={paginationClass(page <= 1)}
            href={listHref({ query, status, page: Math.max(1, page - 1) })}
            aria-disabled={page <= 1}
          >
            Previous
          </Link>
          <span className="text-sm font-semibold text-[#4B5563]">
            Showing {requests.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}
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
    </>
  );
}
