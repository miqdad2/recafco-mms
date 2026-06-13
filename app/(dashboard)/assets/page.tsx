import Link from "next/link";
import { AlertTriangle, Boxes, CalendarClock, Component, Factory, Forklift, PackageSearch, Plus, ShieldAlert, ShoppingCart, Truck, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

type AssetsPageProps = {
  searchParams?: Promise<{ page?: string; search?: string; status?: string; category?: string; due_soon?: string }>;
};

const pageSize = 25;

type AssetRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  status: string;
  location: string | null;
  current_kilometer_reading: string | number | null;
  current_running_hours: string | number | null;
  next_service_date: Date | string | null;
};

type CategorySummary = {
  category: string;
  count: bigint;
  breakdown_count: bigint;
  maintenance_count: bigint;
  waiting_parts_count: bigint;
  due_soon_count: bigint;
};

type StatusSummary = {
  status: string;
  count: bigint;
};

type PartInventorySummary = {
  total_parts: bigint;
  low_stock_parts: bigint;
  unavailable_parts: bigint;
  active_parts: bigint;
};

const categoryIconMap: Record<string, LucideIcon> = {
  Bus: Truck,
  Car: Truck,
  Crane: Wrench,
  Forklift,
  Generator: Component,
  Truck,
  Vehicle: Truck,
  "Factory Machine": Factory,
  "Electrical Equipment": Component,
  "Building/Facility": Factory
};

type UrgencyLevel = "breakdown" | "waiting" | "due" | "none";

function categoryUrgency(item: CategorySummary): UrgencyLevel {
  if (Number(item.breakdown_count) > 0) return "breakdown";
  if (Number(item.waiting_parts_count) > 0) return "waiting";
  if (Number(item.due_soon_count) > 0) return "due";
  return "none";
}

function categoryCardClass(urgency: UrgencyLevel, active: boolean) {
  if (active) return "border-[#ED1C24] bg-red-50";
  if (urgency === "breakdown") return "border-red-300 bg-red-50";
  if (urgency === "waiting") return "border-amber-300 bg-amber-50";
  if (urgency === "due") return "border-blue-200 bg-blue-50";
  return "border-[#E5E7EB] bg-white";
}

function categoryIconClass(urgency: UrgencyLevel) {
  if (urgency === "breakdown") return "bg-[#ED1C24] text-white";
  if (urgency === "waiting") return "bg-[#F59E0B] text-white";
  if (urgency === "due") return "bg-[#2563EB] text-white";
  return "bg-[#111827] text-white";
}

function assetStatusTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Breakdown" || status === "Out of Service") return "red";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "amber";
  if (status === "Retired") return "gray";
  return "green";
}

function statusDotClass(status: string) {
  if (status === "Breakdown" || status === "Out of Service") return "bg-[#ED1C24]";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "bg-[#F59E0B]";
  if (status === "Active" || status === "In Use") return "bg-[#16A34A]";
  return "bg-[#9CA3AF]";
}

function isOverdue(value: Date | string | null) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date < new Date();
}

type CeoAssetWO = { id: string; status: string; priority: string; work_order_number: string | null };
type CeoAsset = {
  id: string; asset_code: string; asset_name: string; category: string;
  status: string; location: string | null; next_service_date: Date | string | null;
  departments: { name: string } | null;
  work_orders: CeoAssetWO[];
};

function getCeoAssetReason(asset: CeoAsset, serviceDueSoon: Date): { label: string; tone: "red" | "amber" | "blue" | "gray" } {
  if (asset.status === "Breakdown")        return { label: "Breakdown",          tone: "red"   };
  if (asset.status === "Out of Service")   return { label: "Out of service",      tone: "red"   };
  if (asset.status === "Waiting for Parts")return { label: "Waiting for parts",   tone: "amber" };
  if (asset.status === "Under Maintenance")return { label: "Under maintenance",   tone: "amber" };
  const now = new Date();
  const sd = asset.next_service_date ? (asset.next_service_date instanceof Date ? asset.next_service_date : new Date(String(asset.next_service_date))) : null;
  if (sd && sd < now)              return { label: "Service overdue",        tone: "red"   };
  if (sd && sd <= serviceDueSoon)  return { label: "Service due soon",       tone: "blue"  };
  const hasHighPrio = asset.work_orders.some((w) => ["High", "Urgent"].includes(w.priority));
  if (hasHighPrio) return { label: "High-priority open work", tone: "amber" };
  return { label: "Executive visibility", tone: "gray" };
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const context = await requirePermission("assets.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page ?? 1) || 1);
  const search = String(params?.search ?? "").replace(/[%,()]/g, " ").trim().slice(0, 80);
  const status = String(params?.status ?? "").trim();
  const category = String(params?.category ?? "").trim();
  const dueSoonFilter = params?.due_soon === "1";

  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 30);

  // ── CEO / Management: combined asset & parts risk early return ──────────────
  if (context.role?.slug === "ceo_management") {
    const ceoAssetWhere = {
      deleted_at: null,
      OR: [
        { status: { in: ["Breakdown", "Out of Service", "Waiting for Parts", "Under Maintenance"] } },
        { next_service_date: { lte: dueSoon }, status: { notIn: ["Retired"] } },
        { work_orders: { some: { status: { notIn: ["Closed", "Cancelled"] }, priority: { in: ["High", "Urgent"] }, deleted_at: null } } },
      ],
    };

    const [
      ceoAssets,
      criticalCount, waitingPartsCount,
      repeatedBreakdownRows,
      ceoParts,
      lowStockCount, unavailableCount, blockedWOCount, waitingPurchaseCount,
    ] = await Promise.all([
      prisma.assets.findMany({
        where: ceoAssetWhere,
        orderBy: { updated_at: "desc" },
        take: 20,
        select: {
          id: true, asset_code: true, asset_name: true, category: true,
          status: true, location: true, next_service_date: true,
          departments: { select: { name: true } },
          work_orders: {
            where: { status: { notIn: ["Closed", "Cancelled"] }, deleted_at: null },
            select: { id: true, status: true, priority: true, work_order_number: true },
          },
        },
      }) as Promise<CeoAsset[]>,
      prisma.assets.count({ where: { deleted_at: null, status: { in: ["Breakdown", "Out of Service"] } } }),
      prisma.assets.count({ where: { deleted_at: null, status: "Waiting for Parts" } }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT asset_id FROM public.work_orders
          WHERE deleted_at IS NULL AND maintenance_type = 'Breakdown'
            AND status NOT IN ('Cancelled','Rejected') AND asset_id IS NOT NULL
          GROUP BY asset_id HAVING COUNT(*) > 1
        ) sub
      `,
      prisma.parts.findMany({
        where: {
          deleted_at: null,
          OR: [
            { status: { in: ["Unavailable", "Discontinued"] } },
            { current_stock: { lte: prisma.parts.fields.minimum_stock } },
          ],
        },
        orderBy: { status: "asc" },
        take: 15,
        select: {
          id: true, part_code: true, part_name: true, category: true,
          current_stock: true, minimum_stock: true, status: true, unit_of_measure: true,
        },
      }),
      prisma.parts.count({ where: { deleted_at: null, current_stock: { lte: prisma.parts.fields.minimum_stock } } }),
      prisma.parts.count({ where: { deleted_at: null, status: { in: ["Unavailable", "Discontinued"] } } }),
      prisma.work_orders.count({ where: { deleted_at: null, status: "Waiting for Parts" } }),
      prisma.work_orders.count({ where: { deleted_at: null, status: "Waiting for Purchase" } }),
    ]);

    const repeatedBreakdownCount = Number(repeatedBreakdownRows[0]?.count ?? BigInt(0));

    type RiskRow = {
      kind: "Asset" | "Part";
      id: string;
      code: string;
      name: string;
      detail: string;
      tone: "red" | "amber" | "blue" | "gray";
      reason: string;
      location: string | null;
      stage: string;
      href: string;
    };

    const assetRows: RiskRow[] = ceoAssets.map((a) => {
      const r = getCeoAssetReason(a, dueSoon);
      return {
        kind: "Asset",
        id: a.id,
        code: a.asset_code,
        name: a.asset_name,
        detail: a.category,
        tone: r.tone,
        reason: r.label,
        location: a.departments?.name ?? a.location ?? null,
        stage: a.status,
        href: `/assets/${a.id}`,
      };
    });

    const partRows: RiskRow[] = (ceoParts as Array<{
      id: string; part_code: string; part_name: string; category: string | null;
      current_stock: unknown; minimum_stock: unknown; status: string; unit_of_measure: string | null;
    }>).map((p) => {
      const isUnavailable = ["Unavailable", "Discontinued"].includes(p.status);
      return {
        kind: "Part",
        id: p.id,
        code: p.part_code,
        name: p.part_name,
        detail: p.category ?? "—",
        tone: isUnavailable ? "red" : "amber",
        reason: isUnavailable ? "Unavailable" : "Low Stock",
        location: null,
        stage: isUnavailable ? "Purchase / Procurement" : "Store Keeper / Purchase",
        href: `/store/parts`,
      };
    });

    const toneOrder = { red: 0, amber: 1, blue: 2, gray: 3 } as const;
    const riskRows = [...assetRows, ...partRows].sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

    return (
      <>
        <PageHeader
          title="Asset & Parts Risk"
          description="Critical assets, repeated breakdowns, critical stock shortages, and operations blocked by missing parts."
        />
        <div className="p-4 lg:p-6 space-y-4">

          {/* Asset risk KPIs */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Asset Risk</p>
            <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <CeoAssetKpi title="Critical Assets at Risk" value={criticalCount} tone={criticalCount > 0 ? "red" : "gray"} icon={ShieldAlert} detail="Breakdown or out of service" href="/maintenance/work-orders?ceo_tab=high_risk" urgent={criticalCount > 0} />
              <CeoAssetKpi title="Repeated Breakdowns" value={repeatedBreakdownCount} tone={repeatedBreakdownCount > 0 ? "red" : "gray"} icon={AlertTriangle} detail="Assets with 2+ breakdown work orders" href="/maintenance/work-orders?ceo_tab=high_risk" urgent={repeatedBreakdownCount > 0} />
              <CeoAssetKpi title="Assets Waiting Parts" value={waitingPartsCount} tone={waitingPartsCount > 0 ? "amber" : "gray"} icon={PackageSearch} detail="Parts supply needed to resume work" href="/maintenance/work-orders?ceo_tab=blocked" urgent={waitingPartsCount > 0} />
            </section>
          </div>

          {/* Parts & supply risk KPIs */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Parts & Supply Risk</p>
            <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <CeoAssetKpi title="Critical Low Stock" value={lowStockCount} tone={lowStockCount > 0 ? "amber" : "gray"} icon={AlertTriangle} detail="Stock at or below minimum level" href="/maintenance/work-orders?ceo_tab=blocked" urgent={lowStockCount > 0} />
              <CeoAssetKpi title="Unavailable Parts" value={unavailableCount} tone={unavailableCount > 0 ? "red" : "gray"} icon={ShieldAlert} detail="Unavailable or discontinued parts" href="/ceo/approvals" urgent={unavailableCount > 0} />
              <CeoAssetKpi title="Purchase Delays" value={waitingPurchaseCount} tone={waitingPurchaseCount > 0 ? "amber" : "gray"} icon={ShoppingCart} detail="Work orders waiting on purchase" href="/ceo/approvals" />
            </section>
          </div>

          {/* Combined risk register */}
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase text-[#4B5563]">Combined Asset & Parts Risk Register</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                  {riskRows.length.toLocaleString()} items requiring executive attention
                  {blockedWOCount > 0 && (
                    <span className="ml-2 text-xs text-[#ED1C24]">&nbsp;·&nbsp; {blockedWOCount} WOs blocked</span>
                  )}
                </p>
              </div>
              {criticalCount > 0 && <StatusBadge label={`${criticalCount} critical`} tone="red" />}
            </div>

            {riskRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Risk Reason</th>
                      <th className="px-4 py-3">Department / Location</th>
                      <th className="px-4 py-3">Responsible Stage</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {riskRows.map((row) => (
                      <tr
                        key={`${row.kind}-${row.id}`}
                        className={`transition hover:bg-gray-50 ${row.tone === "red" ? "border-l-4 border-l-[#ED1C24]" : ""}`}
                      >
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                            row.kind === "Asset" ? "bg-blue-100 text-[#2563EB]" : "bg-purple-100 text-purple-800"
                          }`}>
                            {row.kind}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <Link href={row.href} className="block font-bold text-[#111827] hover:text-[#ED1C24]">
                            {row.code}
                          </Link>
                          <p className="text-xs text-[#4B5563]">{row.name}</p>
                          <p className="text-xs text-[#9CA3AF]">{row.detail}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                            row.tone === "red"    ? "bg-red-100 text-[#DC2626]"
                            : row.tone === "amber" ? "bg-amber-100 text-amber-800"
                            : row.tone === "blue"  ? "bg-blue-100 text-[#2563EB]"
                            : "bg-gray-100 text-[#4B5563]"
                          }`}>
                            {row.reason}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-sm text-[#111827]">{row.location ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-xs font-semibold text-[#4B5563]">{row.stage}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right">
                          <Link
                            href={row.href}
                            className="inline-block rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-bold text-[#111827] hover:bg-gray-50 hover:border-[#ED1C24] hover:text-[#ED1C24]"
                          >
                            View Details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-10">
                <EmptyState
                  title="No asset or parts risks need executive attention right now."
                  message="All tracked assets are within normal parameters and parts stock levels are healthy."
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-6 border-t border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <Link href="/maintenance/work-orders?ceo_tab=blocked" className="text-xs font-bold text-[#4B5563] underline hover:text-[#ED1C24]">
                View blocked work orders
              </Link>
              <Link href="/ceo/approvals" className="text-xs font-bold text-[#4B5563] underline hover:text-[#ED1C24]">
                CEO Approvals
              </Link>
            </div>
          </section>

        </div>
      </>
    );
  }
  // ── End CEO early-return ──────────────────────────────────────────────────

  const statusFilter = status
    ? { status }
    : dueSoonFilter
      ? { status: { notIn: ["Retired"] } }
      : {};

  const where = {
    deleted_at: null,
    ...statusFilter,
    ...(category ? { category } : {}),
    ...(dueSoonFilter ? { next_service_date: { lte: dueSoon } } : {}),
    ...(search
      ? {
          OR: [
            { asset_code: { contains: search, mode: "insensitive" as const } },
            { asset_name: { contains: search, mode: "insensitive" as const } },
            { serial_number: { contains: search, mode: "insensitive" as const } },
            { plate_number: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  const [assets, count, categorySummaries, statusSummaries, partSummaryRows, dueSoonCount] = await Promise.all([
    prisma.assets.findMany({
      where,
      orderBy: dueSoonFilter ? { next_service_date: "asc" } : { asset_code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        asset_code: true,
        asset_name: true,
        category: true,
        status: true,
        location: true,
        current_kilometer_reading: true,
        current_running_hours: true,
        next_service_date: true
      }
    }) as Promise<AssetRow[]>,
    prisma.assets.count({ where }),
    prisma.$queryRaw<CategorySummary[]>`
      select
        category,
        count(*)::bigint as count,
        count(*) filter (where status = 'Breakdown')::bigint as breakdown_count,
        count(*) filter (where status = 'Under Maintenance')::bigint as maintenance_count,
        count(*) filter (where status = 'Waiting for Parts')::bigint as waiting_parts_count,
        count(*) filter (where next_service_date is not null and next_service_date <= ${dueSoon})::bigint as due_soon_count
      from public.assets
      where deleted_at is null
      group by category
      order by count(*) desc, category asc
    `,
    prisma.$queryRaw<StatusSummary[]>`
      select status, count(*)::bigint as count
      from public.assets
      where deleted_at is null
      group by status
      order by count(*) desc, status asc
    `,
    prisma.$queryRaw<PartInventorySummary[]>`
      select
        count(*)::bigint as total_parts,
        count(*) filter (where current_stock <= minimum_stock)::bigint as low_stock_parts,
        count(*) filter (where status in ('Unavailable', 'Discontinued'))::bigint as unavailable_parts,
        count(*) filter (where status = 'Active')::bigint as active_parts
      from public.parts
      where deleted_at is null
    `,
    prisma.assets.count({
      where: {
        deleted_at: null,
        next_service_date: { lte: dueSoon },
        status: { notIn: ["Retired"] }
      }
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const totalAssets = categorySummaries.reduce((sum, item) => sum + Number(item.count), 0);
  const zeroBigInt = BigInt(0);
  const partSummary = partSummaryRows[0] ?? { total_parts: zeroBigInt, low_stock_parts: zeroBigInt, unavailable_parts: zeroBigInt, active_parts: zeroBigInt };

  const totalBreakdowns = categorySummaries.reduce((sum, item) => sum + Number(item.breakdown_count), 0);
  const totalWaitingParts = categorySummaries.reduce((sum, item) => sum + Number(item.waiting_parts_count), 0);

  return (
    <>
      <PageHeader
        title="Assets"
        description="Asset, vehicle, equipment, facility, and support inventory control with category grouping and service tracking."
        actions={
          <Link href="/assets/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New asset
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">

        {/* Top KPI strip */}
        <section className="mb-4 grid gap-3 md:grid-cols-4">
          <SummaryCard title="Total assets" value={totalAssets} detail="Equipment, vehicles, and facilities" icon={Boxes} />
          <SummaryCard
            title="Due in 30 days"
            value={dueSoonCount}
            detail="Click to view assets needing service"
            icon={CalendarClock}
            tone="amber"
            href="/assets?due_soon=1"
            active={dueSoonFilter}
          />
          <SummaryCard title="Spare parts" value={Number(partSummary.total_parts)} detail={`${Number(partSummary.low_stock_parts)} low stock / ${Number(partSummary.active_parts)} active`} icon={PackageSearch} tone="blue" href="/store/parts" />
          <SummaryCard title="Unavailable parts" value={Number(partSummary.unavailable_parts)} detail="May affect asset repair planning" icon={AlertTriangle} tone="red" href="/store/low-stock" />
        </section>

        {/* Operational risk banner — only shown when there are breakdowns or waiting parts */}
        {(totalBreakdowns > 0 || totalWaitingParts > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
            <span className="text-sm font-bold text-[#ED1C24]">Operational risk</span>
            {totalBreakdowns > 0 && (
              <Link href={filterHref({ status: "Breakdown", category: "", search: "" })} className="text-sm font-semibold text-[#111827] underline underline-offset-2 hover:text-[#ED1C24]">
                {totalBreakdowns} breakdown{totalBreakdowns !== 1 ? "s" : ""}
              </Link>
            )}
            {totalWaitingParts > 0 && (
              <Link href={filterHref({ status: "Waiting for Parts", category: "", search: "" })} className="text-sm font-semibold text-[#111827] underline underline-offset-2 hover:text-[#ED1C24]">
                {totalWaitingParts} waiting for parts
              </Link>
            )}
          </div>
        )}

        {/* Active due-soon filter indicator */}
        {dueSoonFilter && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <CalendarClock className="h-4 w-4 shrink-0 text-[#F59E0B]" aria-hidden="true" />
            <span className="text-sm font-bold text-[#92400E]">Showing assets due for service within 30 days</span>
            <Link href="/assets" className="ml-auto text-xs font-bold text-[#4B5563] underline underline-offset-2 hover:text-[#111827]">
              Clear filter
            </Link>
          </div>
        )}

        {/* Category cards */}
        <section className="mb-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#ED1C24]">Asset categories</p>
              <h2 className="text-lg font-black text-[#111827]">Grouped Asset Register</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className={`rounded-md border px-3 py-2 text-xs font-bold ${category || dueSoonFilter ? "border-[#E5E7EB] bg-white text-[#111827]" : "border-[#ED1C24] bg-red-50 text-[#ED1C24]"}`}
                href={filterHref({ category: "", status, search })}
              >
                All categories
              </Link>
              <Link className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827]" href="/store/parts">
                Spare parts inventory
              </Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {categorySummaries.map((item) => {
              const Icon = categoryIconMap[item.category] ?? Boxes;
              const active = category === item.category;
              const urgency = categoryUrgency(item);
              const breakdownN = Number(item.breakdown_count);
              const waitingN = Number(item.waiting_parts_count);
              const dueN = Number(item.due_soon_count);
              return (
                <Link
                  key={item.category}
                  href={filterHref({ category: item.category, status, search })}
                  className={`rounded-md border p-4 shadow-sm transition hover:border-[#ED1C24] ${categoryCardClass(urgency, active)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={`rounded-md p-2 ${categoryIconClass(urgency)}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <span className="text-2xl font-black text-[#111827]">{Number(item.count).toLocaleString("en-US")}</span>
                  </div>
                  <h3 className="mt-3 font-black text-[#111827]">{item.category}</h3>
                  <p className="mt-1 text-xs leading-5">
                    <span className={dueN > 0 ? "font-bold text-[#2563EB]" : "text-[#4B5563]"}>{dueN} due soon</span>
                    <span className="text-[#4B5563]"> / </span>
                    <span className={breakdownN > 0 ? "font-bold text-[#ED1C24]" : "text-[#4B5563]"}>{breakdownN} breakdown</span>
                    <span className="text-[#4B5563]"> / </span>
                    <span className={waitingN > 0 ? "font-bold text-[#F59E0B]" : "text-[#4B5563]"}>{waitingN} waiting parts</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Search / Status Mix row */}
        <section className="mb-4 grid gap-3 xl:grid-cols-[1fr_22rem]">
          <form className="grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm md:grid-cols-[1fr_14rem_14rem_auto]">
            <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="search" defaultValue={params?.search ?? ""} placeholder="Search asset, serial, plate" />
            <select className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-semibold" name="category" defaultValue={params?.category ?? ""}>
              <option value="">All categories</option>
              {categorySummaries.map((item) => <option key={item.category} value={item.category}>{item.category}</option>)}
            </select>
            <select className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-semibold" name="status" defaultValue={params?.status ?? ""}>
              <option value="">All statuses</option>
              {["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button type="submit" variant="secondary">Filter</Button>
          </form>

          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase text-[#4B5563]">Status mix</p>
            <div className="mt-3 space-y-2">
              {statusSummaries.map((item) => (
                <Link
                  key={item.status}
                  href={filterHref({ category, status: item.status, search })}
                  className="flex items-center gap-3 rounded-md border border-[#E5E7EB] px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(item.status)}`} aria-hidden="true" />
                  <span className="flex-1 font-bold text-[#111827]">{item.status}</span>
                  <span className="font-black text-[#4B5563]">{Number(item.count).toLocaleString("en-US")}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Asset list table */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Asset records</p>
            <p className="mt-1 text-sm font-semibold text-[#111827]">{count.toLocaleString("en-US")} matching assets</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">KM</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">Next service</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {assets.map((asset) => {
                  const overdue = isOverdue(asset.next_service_date);
                  const rowBreakdown = asset.status === "Breakdown";
                  return (
                    <tr
                      key={asset.id}
                      className={rowBreakdown ? "bg-red-50" : "hover:bg-gray-50"}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/assets/${asset.id}`} className="font-bold text-[#111827] hover:text-[#ED1C24]">
                          {asset.asset_code}
                        </Link>
                        <p className="text-[#4B5563]">{asset.asset_name}</p>
                      </td>
                      <td className="px-4 py-3">{asset.category}</td>
                      <td className="px-4 py-3">{asset.location ?? "Not recorded"}</td>
                      <td className="px-4 py-3">{formatValue(asset.current_kilometer_reading)}</td>
                      <td className="px-4 py-3">{formatValue(asset.current_running_hours)}</td>
                      <td className="px-4 py-3">
                        {asset.next_service_date ? (
                          <span className={overdue ? "font-bold text-[#ED1C24]" : ""}>
                            {overdue && <span className="mr-1 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-[#ED1C24]">Overdue</span>}
                            {formatDate(asset.next_service_date)}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]">Not scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={asset.status} tone={assetStatusTone(asset.status)} />
                      </td>
                    </tr>
                  );
                })}
                {!assets.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm font-semibold text-[#4B5563]" colSpan={7}>
                      No assets match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <Pagination page={page} totalPages={totalPages} search={params?.search} status={params?.status} category={params?.category} dueSoon={dueSoonFilter ? "1" : undefined} />
      </div>
    </>
  );
}

function CeoAssetKpi({
  title, value, href, tone, icon: Icon, detail, urgent,
}: {
  title: string; value: number; href: string;
  tone: "red" | "amber" | "blue" | "gray";
  icon: LucideIcon; detail: string; urgent?: boolean;
}) {
  const iconBg = { red: "bg-[#ED1C24]", amber: "bg-[#F59E0B]", blue: "bg-[#2563EB]", gray: "bg-[#111827]" }[tone];
  return (
    <Link href={href} className={`rounded-md border bg-white p-4 shadow-sm transition hover:border-[#ED1C24] hover:shadow-md ${urgent && value > 0 ? "border-amber-300" : "border-[#E5E7EB]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${iconBg}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`text-2xl font-black ${urgent && value > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>
          {value.toLocaleString("en-US")}
        </span>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-[#4B5563]">{detail}</p>
    </Link>
  );
}

function filterHref({ category, status, search }: { category?: string; status?: string; search?: string }) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const query = params.toString();
  return query ? `/assets?${query}` : "/assets";
}

function SummaryCard({
  title, value, detail, icon: Icon, tone = "gray", href, active = false
}: {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone?: "gray" | "amber" | "blue" | "red";
  href?: string;
  active?: boolean;
}) {
  const toneClass = {
    gray: "bg-[#111827] text-white",
    amber: "bg-[#F59E0B] text-white",
    blue: "bg-[#2563EB] text-white",
    red: "bg-[#ED1C24] text-white"
  }[tone];

  const borderClass = active
    ? "border-amber-300 ring-1 ring-amber-300"
    : "border-[#E5E7EB]";

  const content = (
    <div className={`rounded-md border bg-white p-4 shadow-sm ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className="text-2xl font-black text-[#111827]">{value.toLocaleString("en-US")}</span>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{title}</p>
      <p className="mt-1 text-sm leading-5 text-[#4B5563]">{detail}</p>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function formatValue(value: string | number | null) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatDate(value: Date | string | null) {
  if (!value) return "Not scheduled";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Pagination({
  page, totalPages, search, status, category, dueSoon
}: {
  page: number;
  totalPages: number;
  search?: string;
  status?: string;
  category?: string;
  dueSoon?: string;
}) {
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (dueSoon) params.set("due_soon", dueSoon);
    return `/assets?${params.toString()}`;
  };

  return (
    <div className="mt-4 flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827]" href={hrefFor(page - 1)}>Previous</Link> : null}
        {page < totalPages ? <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827]" href={hrefFor(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}
