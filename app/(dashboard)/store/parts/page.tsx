import type { Prisma } from "@prisma/client";
import { Package, Plus, Search, TriangleAlert, Warehouse } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const statusOptions = ["Active", "Inactive", "Low Stock", "Unavailable", "Discontinued"];

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PartsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const context = await requirePermission("parts.view");
  const params = (await searchParams) ?? {};
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
  const search = (single(params.search) ?? "").trim().slice(0, 80);
  const status = (single(params.status) ?? "").trim();

  const where: Prisma.partsWhereInput = {
    deleted_at: null,
    ...(status && status !== "Low Stock" ? { status } : {}),
    ...(status === "Low Stock" ? { current_stock: { lte: prisma.parts.fields.minimum_stock } } : {}),
    ...(search
      ? {
          OR: [
            { part_code: { contains: search, mode: "insensitive" } },
            { part_name: { contains: search, mode: "insensitive" } },
            { part_number: { contains: search, mode: "insensitive" } },
            { ss_rec_code: { contains: search, mode: "insensitive" } },
            { supplier: { contains: search, mode: "insensitive" } },
            { store_location_bin: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };

  // ── CEO / Management: combined view is at /assets ────────────────────────
  if (context.role?.slug === "ceo_management") {
    redirect("/assets");
  }
  // ── End CEO early-return ──────────────────────────────────────────────────

  const [parts, total, totalParts, activeParts, unavailableParts, lowStockParts] = await Promise.all([
    prisma.parts.findMany({
      where,
      orderBy: { part_code: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        part_code: true,
        part_name: true,
        category: true,
        part_number: true,
        ss_rec_code: true,
        current_stock: true,
        minimum_stock: true,
        unit_price: true,
        supplier: true,
        store_location_bin: true,
        status: true,
        unit_of_measure: true
      }
    }),
    prisma.parts.count({ where }),
    prisma.parts.count({ where: { deleted_at: null } }),
    prisma.parts.count({ where: { deleted_at: null, status: "Active" } }),
    prisma.parts.count({ where: { deleted_at: null, status: "Unavailable" } }),
    prisma.parts.count({ where: { deleted_at: null, current_stock: { lte: prisma.parts.fields.minimum_stock } } })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Spare Parts Inventory"
        description="Store inventory master with stock health, supplier, bin, part number, SS rec code, and low-stock tracking."
        actions={
          <Link href="/store/parts/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New part
            </Button>
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InventoryStat icon={Package} label="Total parts" value={totalParts} tone="gray" />
          <InventoryStat icon={Warehouse} label="Active stock" value={activeParts} tone="green" />
          <InventoryStat icon={TriangleAlert} label="Low stock" value={lowStockParts} tone={lowStockParts ? "amber" : "green"} />
          <InventoryStat icon={TriangleAlert} label="Unavailable" value={unavailableParts} tone={unavailableParts ? "red" : "green"} />
        </section>

        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4B5563]" aria-hidden="true" />
              <input
                className="focus-ring min-h-10 w-full rounded-md border border-[#DDE2EA] pl-9 pr-3 text-sm"
                name="search"
                defaultValue={search}
                placeholder="Search part, part no., SS rec, supplier, bin"
              />
            </label>
            <select className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm font-semibold" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </section>

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Inventory records</p>
              <p className="text-sm font-semibold text-[#111827]">{total} matching parts</p>
            </div>
            <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
          </div>
          {parts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Part</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Part No.</th>
                    <th className="px-4 py-3">SS rec</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Minimum</th>
                    <th className="px-4 py-3">Unit price</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Bin</th>
                    <th className="px-4 py-3">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {parts.map((part) => {
                    const currentStock = Number(part.current_stock ?? 0);
                    const minimumStock = Number(part.minimum_stock ?? 0);
                    const isLow = currentStock <= minimumStock;

                    return (
                      <tr key={part.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-black text-[#111827]">{part.part_code}</p>
                          <p className="text-[#4B5563]">{part.part_name}</p>
                        </td>
                        <td className="px-4 py-3">{part.category ?? "-"}</td>
                        <td className="px-4 py-3">{part.part_number ?? "-"}</td>
                        <td className="px-4 py-3">{part.ss_rec_code ?? "-"}</td>
                        <td className="px-4 py-3 font-semibold">
                          {formatQty(currentStock)} {part.unit_of_measure}
                        </td>
                        <td className="px-4 py-3">{formatQty(minimumStock)}</td>
                        <td className="px-4 py-3">
                          <CostVisibilityGuard context={context}>{formatMoney(Number(part.unit_price ?? 0))}</CostVisibilityGuard>
                        </td>
                        <td className="px-4 py-3">{part.supplier ?? "Not recorded"}</td>
                        <td className="px-4 py-3">{part.store_location_bin ?? "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge label={part.status} tone={part.status === "Active" ? "green" : part.status === "Unavailable" ? "red" : "gray"} />
                            <StatusBadge label={isLow ? "Low Stock" : "Stock OK"} tone={isLow ? "amber" : "green"} />
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
              <EmptyState title="No spare parts found" message="Try changing the search or status filter." />
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <Link className={paginationClass(page <= 1)} href={partsHref({ search, status, page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>
            Previous
          </Link>
          <span className="text-sm font-semibold text-[#4B5563]">
            Showing {parts.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <Link className={paginationClass(page >= totalPages)} href={partsHref({ search, status, page: Math.min(totalPages, page + 1) })} aria-disabled={page >= totalPages}>
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

function formatQty(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} KWD`;
}

function partsHref({ search, status, page }: { search: string; status: string; page: number }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/store/parts?${qs}` : "/store/parts";
}

function paginationClass(disabled: boolean) {
  return cn(
    "rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold",
    disabled ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50"
  );
}

function InventoryStat({ icon: Icon, label, value, tone }: { icon: typeof Package; label: string; value: ReactNode; tone: "green" | "amber" | "red" | "gray" }) {
  return (
    <div className={cn("rounded-md border bg-white p-4 shadow-sm", tone === "green" && "border-green-200", tone === "amber" && "border-amber-200", tone === "red" && "border-red-200", tone === "gray" && "border-[#E5E7EB]")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
          <p className="mt-2 text-2xl font-black text-[#111827]">{value}</p>
        </div>
        <span className={cn("rounded-md p-2", tone === "green" && "bg-green-50 text-green-600", tone === "amber" && "bg-amber-50 text-amber-600", tone === "red" && "bg-red-50 text-red-600", tone === "gray" && "bg-gray-50 text-gray-600")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
