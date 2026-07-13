import Link from "next/link";
import { AlertTriangle, Boxes, Layers, PackageSearch, Plus, ShieldAlert, ShoppingCart, Upload, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
// Categories loaded from DB — see asset_categories table

type AssetsPageProps = {
  searchParams?: Promise<{ page?: string; search?: string; status?: string; category?: string; main_category?: string; location?: string; due_soon?: string }>;
};

const pageSize = 25;

type AssetRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  status: string;
  location: string | null;
  serial_number: string | null;
  model: string | null;
};

type CategoryChip = {
  category: string;
  count: bigint;
};

type CeoAssetWO = { id: string; status: string; priority: string; work_order_number: string | null };
type CeoAsset = {
  id: string; asset_code: string; asset_name: string; category: string;
  status: string; location: string | null; next_service_date: Date | string | null;
  departments: { name: string } | null;
  work_orders: CeoAssetWO[];
};

function getCeoAssetReason(asset: CeoAsset, serviceDueSoon: Date): { label: string; tone: "red" | "amber" | "blue" | "gray" } {
  if (asset.status === "Breakdown")         return { label: "Breakdown",            tone: "red"   };
  if (asset.status === "Out of Service")    return { label: "Out of service",        tone: "red"   };
  if (asset.status === "Waiting for Parts") return { label: "Waiting for parts",     tone: "amber" };
  if (asset.status === "Under Maintenance") return { label: "Under maintenance",     tone: "amber" };
  const now = new Date();
  const sd = asset.next_service_date
    ? (asset.next_service_date instanceof Date ? asset.next_service_date : new Date(String(asset.next_service_date)))
    : null;
  if (sd && sd < now)             return { label: "Service overdue",          tone: "red"   };
  if (sd && sd <= serviceDueSoon) return { label: "Service due soon",         tone: "blue"  };
  const hasHighPrio = asset.work_orders.some((w) => ["High", "Urgent"].includes(w.priority));
  if (hasHighPrio)                return { label: "High-priority open work",  tone: "amber" };
  return { label: "Executive visibility", tone: "gray" };
}

function assetStatusTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Breakdown" || status === "Out of Service") return "red";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "amber";
  if (status === "Retired") return "gray";
  return "green";
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const context = await requirePermission("assets.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page ?? 1) || 1);
  const search = String(params?.search ?? "").replace(/[%,()]/g, " ").trim().slice(0, 80);
  const status = String(params?.status ?? "").trim();
  const category = String(params?.category ?? "").trim();
  const location = String(params?.location ?? "").replace(/[%,()]/g, " ").trim().slice(0, 80);
  const dueSoonFilter = params?.due_soon === "1";
  const mainCategory = String(params?.main_category ?? "").trim();

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
        href: `/store/offline-inventory`,
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

  // ── Load active categories from DB ────────────────────────────────────────
  const dbCategories = await prisma.asset_categories.findMany({
    where: { is_active: true },
    select: { id: true, name: true, parent_id: true, sort_order: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });

  const dbMainCats = dbCategories.filter((c) => c.parent_id === null);
  const dbSubcats  = dbCategories.filter((c) => c.parent_id !== null);

  // Map: subcategory name (lower) → main category name
  const subcatToMain = new Map<string, string>();
  for (const sub of dbSubcats) {
    const parent = dbMainCats.find((m) => m.id === sub.parent_id);
    if (parent) subcatToMain.set(sub.name.toLowerCase(), parent.name);
  }
  // Also map main category name → itself (handles legacy assets stored with main cat name)
  for (const m of dbMainCats) subcatToMain.set(m.name.toLowerCase(), m.name);

  function getMainCategoryName(catValue: string): string {
    return subcatToMain.get(catValue.toLowerCase()) ?? "Other";
  }

  // All subcategory names that belong to a given main category (for WHERE filtering)
  function subcatNamesForMain(mainName: string): string[] {
    const main = dbMainCats.find((m) => m.name === mainName);
    if (!main) return [];
    // Include the main category name itself to catch legacy assets
    return [mainName, ...dbSubcats.filter((s) => s.parent_id === main.id).map((s) => s.name)];
  }

  // All known category names (subcats + mains) — for "Other" filter
  const allKnownNames = new Set([
    ...dbMainCats.map((m) => m.name),
    ...dbSubcats.map((s) => s.name),
  ]);

  const statusFilter = status
    ? { status }
    : dueSoonFilter
      ? { status: { notIn: ["Retired"] } }
      : {};

  const where = {
    deleted_at: null,
    ...statusFilter,
    ...(category
      ? { category }
      : mainCategory
        ? mainCategory === "Other"
          ? { category: { notIn: [...allKnownNames] } }
          : { category: { in: subcatNamesForMain(mainCategory) } }
        : {}),
    ...(location ? { location: { contains: location, mode: "insensitive" as const } } : {}),
    ...(dueSoonFilter ? { next_service_date: { lte: dueSoon } } : {}),
    ...(search
      ? (() => {
          // Expand search to include subcategories of any matching main category
          const lc = search.toLowerCase();
          const matchingSubcats = dbMainCats
            .filter((mc) => mc.name.toLowerCase().includes(lc))
            .flatMap((mc) => dbSubcats.filter((s) => s.parent_id === mc.id).map((s) => s.name));
          return {
            OR: [
              { asset_code:    { contains: search, mode: "insensitive" as const } },
              { asset_name:    { contains: search, mode: "insensitive" as const } },
              { serial_number: { contains: search, mode: "insensitive" as const } },
              { plate_number:  { contains: search, mode: "insensitive" as const } },
              { model:         { contains: search, mode: "insensitive" as const } },
              { category:      { contains: search, mode: "insensitive" as const } },
              { location:      { contains: search, mode: "insensitive" as const } },
              ...(matchingSubcats.length > 0 ? [{ category: { in: matchingSubcats } }] : []),
            ],
          };
        })()
      : {}),
  };

  const [assets, count, categoryChips, criticalStatusCount, waitingCount] = await Promise.all([
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
        serial_number: true,
        model: true,
      },
    }) as Promise<AssetRow[]>,
    prisma.assets.count({ where }),
    prisma.$queryRaw<CategoryChip[]>`
      select category, count(*)::bigint as count
      from public.assets
      where deleted_at is null
      group by category
      order by count(*) desc, category asc
    `,
    prisma.assets.count({ where: { deleted_at: null, status: { in: ["Breakdown", "Out of Service"] } } }),
    prisma.assets.count({ where: { deleted_at: null, status: { in: ["Waiting for Parts", "Under Maintenance"] } } }),
  ]);

  // Last repair date per asset on this page (most recent closed work order)
  const assetIds = (assets as AssetRow[]).map((a) => a.id);
  const lastRepairData = assetIds.length > 0
    ? await prisma.work_orders.groupBy({
        by: ["asset_id"],
        where: { asset_id: { in: assetIds }, deleted_at: null, status: "Closed" },
        _max: { date_of_order: true },
      })
    : [];
  const lastRepairMap = new Map<string, Date | null>();
  for (const row of lastRepairData) {
    if (row.asset_id) lastRepairMap.set(row.asset_id, row._max.date_of_order);
  }

  // Open (non-closed) work orders per asset on this page — for Last Repair column display
  const openRepairData = assetIds.length > 0
    ? await prisma.work_orders.findMany({
        where: {
          asset_id: { in: assetIds },
          deleted_at: null,
          status: { notIn: ["Closed", "Cancelled", "Rejected"] },
        },
        select: { asset_id: true },
      })
    : [];
  const openRepairSet = new Set(
    openRepairData.map((r) => r.asset_id).filter((id): id is string => id !== null)
  );

  const totalAssets = categoryChips.reduce((sum, item) => sum + Number(item.count), 0);
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  // Per-main-category total counts for the overview — derived from existing categoryChips, no extra query
  const catOverviewMap = new Map<string, number>();
  for (const chip of categoryChips) {
    const mainName = getMainCategoryName(chip.category);
    catOverviewMap.set(mainName, (catOverviewMap.get(mainName) ?? 0) + Number(chip.count));
  }
  // Admin actions only for super_admin and managers with explicit assets.manage permission.
  // maintenance_data_entry is excluded even if the role carries assets.manage in DB.
  const canManage =
    context.role?.slug === "super_admin" ||
    (context.role?.slug === "maintenance_manager" && (context.permissions as string[]).includes("assets.manage"));
  // Normal users (maintenance_data_entry, viewer, etc.) get a simplified filter set.
  const isFullFilterUser =
    context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  const hasActiveFilters = !!(search || status || category || mainCategory || location || dueSoonFilter);

  // Subcategory filter options: if a main category is active, show its DB subcats; else show all DB subcats found in assets
  const activeMainCat = dbMainCats.find((m) => m.name === mainCategory);
  const subcategoryOptions: string[] = activeMainCat
    ? dbSubcats.filter((s) => s.parent_id === activeMainCat.id).map((s) => s.name)
    : categoryChips.map((c) => c.category);

  return (
    <>
      <PageHeader
        title="Assets & Equipment"
        description="Manage machines, equipment, vehicles, condition, and repair history."
        actions={
          canManage ? (
            <>
              <Link href="/assets/import">
                <Button variant="secondary" className="gap-2">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Import Excel
                </Button>
              </Link>
              <Link href="/assets/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Asset
                </Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="p-4 lg:p-6 space-y-4">

        {/* KPI cards */}
        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            title="Total Assets & Equipment"
            value={totalAssets}
            detail="All registered machines and equipment"
            icon={Boxes}
            href="/assets"
          />
          <SummaryCard
            title="Critical Assets"
            value={criticalStatusCount}
            detail="Breakdown or out of service"
            icon={ShieldAlert}
            tone={criticalStatusCount > 0 ? "red" : "gray"}
            href="/assets?status=Breakdown"
          />
          <SummaryCard
            title="Under Maintenance"
            value={waitingCount}
            detail="Waiting for parts or under maintenance"
            icon={Wrench}
            tone={waitingCount > 0 ? "amber" : "gray"}
            href="/assets?status=Waiting+for+Parts"
          />
        </section>

        {/* ── Category Overview — always visible ──────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Asset Categories</p>
            {canManage && (
              <Link
                href="/admin/settings/asset-categories"
                className="text-xs font-bold text-[#ED1C24] hover:underline"
              >
                Manage Categories
              </Link>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {dbMainCats.map((cat) => {
              const catCount = catOverviewMap.get(cat.name) ?? 0;
              const isSelected = mainCategory === cat.name;
              return (
                <Link
                  key={cat.id}
                  href={filterHref({ mainCategory: cat.name })}
                  className={`group flex items-center justify-between rounded-md border px-4 py-3 shadow-sm transition hover:border-[#ED1C24] hover:shadow-md ${
                    isSelected ? "border-[#ED1C24] bg-red-50" : "border-[#E5E7EB] bg-white"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-bold truncate ${isSelected ? "text-[#ED1C24]" : "text-[#111827]"}`}>
                      {cat.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[#9CA3AF]">
                      {catCount === 0 ? "No assets yet" : `${catCount} asset${catCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <span className={`ml-3 shrink-0 text-xl font-black ${catCount > 0 ? "text-[#111827]" : "text-[#D1D5DB]"}`}>
                    {catCount}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {totalAssets > 0 && (<>

        {/* Main category pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={filterHref({ status, search, location })}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              !mainCategory && !category
                ? "border-[#111827] bg-[#111827] text-white"
                : "border-[#E5E7EB] bg-white text-[#111827] hover:border-[#111827]"
            }`}
          >
            All
          </Link>
          {dbMainCats.map((topLevel) => {
            // Sum counts for all subcategories + legacy assets stored under the main cat name itself
            const names = new Set(subcatNamesForMain(topLevel.name).map((n) => n.toLowerCase()));
            const subcats = categoryChips.filter((c) => names.has(c.category.toLowerCase()));
            if (!subcats.length) return null;
            const totalCount = subcats.reduce((s, c) => s + Number(c.count), 0);
            const isActive = mainCategory === topLevel.name || subcats.some((c) => c.category === category);
            return (
              <Link
                key={topLevel.id}
                href={topLevelChipHref({ mainCategory: topLevel.name, status, search, location })}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  isActive
                    ? "border-[#111827] bg-[#111827] text-white"
                    : "border-[#E5E7EB] bg-white text-[#111827] hover:border-[#111827]"
                }`}
              >
                {topLevel.name}
                <span className={`ml-1.5 text-[10px] font-normal ${isActive ? "text-gray-300" : "text-[#9CA3AF]"}`}>
                  {totalCount}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Filter bar — simplified for normal users, full for managers and admins */}
        <form className="flex flex-wrap items-center gap-2 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <input
            className="focus-ring h-9 min-w-[180px] flex-1 rounded-md border border-[#E5E7EB] px-3 text-sm"
            name="search"
            defaultValue={params?.search ?? ""}
            placeholder="Search asset code, name, model, or serial…"
          />
          <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="main_category" defaultValue={mainCategory}>
            <option value="">Main Category</option>
            {dbMainCats.map((mc) => (
              <option key={mc.id} value={mc.name}>{mc.name}</option>
            ))}
          </select>
          <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="status" defaultValue={params?.status ?? ""}>
            <option value="">Status</option>
            {["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {isFullFilterUser && (<>
            <input
              className="focus-ring h-9 w-32 rounded-md border border-[#E5E7EB] px-3 text-sm"
              name="location"
              defaultValue={params?.location ?? ""}
              placeholder="Location"
            />
            <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="category" defaultValue={params?.category ?? ""}>
              <option value="">Subcategory</option>
              {subcategoryOptions.map((sub) => (
                <option key={sub} value={sub}>{sub}</option>
              ))}
            </select>
          </>)}
          <Button type="submit" className="h-9 shrink-0">Apply</Button>
          {hasActiveFilters && (
            <Link
              href="/assets"
              className="inline-flex h-9 items-center rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold text-[#4B5563] hover:bg-gray-50"
            >
              Reset
            </Link>
          )}
        </form>
        </>)}

        {/* Asset register table */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Asset Register</p>
            {totalAssets > 0 && (
              <p className="mt-1 text-sm font-semibold text-[#111827]">
                {count.toLocaleString("en-US")} {count === 1 ? "asset" : "assets"}
                {hasActiveFilters && " matching filters"}
              </p>
            )}
          </div>
          {totalAssets === 0 ? (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <Boxes className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
              </div>
              <p className="text-base font-bold text-[#111827]">No assets or equipment found</p>
              {canManage ? (
                <>
                  <p className="mt-2 mx-auto max-w-sm text-sm text-[#4B5563]">
                    Import assets from Excel or create the first asset.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link href="/assets/import">
                      <Button variant="secondary" className="gap-2">
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Import Excel
                      </Button>
                    </Link>
                    <Link href="/assets/new">
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        New Asset
                      </Button>
                    </Link>
                    <Link href="/admin/settings/asset-categories">
                      <Button variant="secondary" className="gap-2">
                        <Layers className="h-4 w-4" aria-hidden="true" />
                        Manage Categories
                      </Button>
                    </Link>
                  </div>
                </>
              ) : (
                <p className="mt-2 mx-auto max-w-sm text-sm text-[#4B5563]">
                  Please contact the maintenance manager or administrator if an asset is missing.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm ${isFullFilterUser ? "min-w-[900px]" : "min-w-[600px]"}`}>
                <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Asset / Equipment</th>
                    {isFullFilterUser && <th className="px-4 py-3">Main Category</th>}
                    {isFullFilterUser && <th className="px-4 py-3">Subcategory</th>}
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Repair</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {assets.map((asset) => {
                    const isCritical = asset.status === "Breakdown" || asset.status === "Out of Service";
                    const lastRepair = lastRepairMap.get(asset.id) ?? null;
                    const hasOpenRepair = openRepairSet.has(asset.id);
                    return (
                      <tr
                        key={asset.id}
                        className={`transition ${isCritical ? "bg-red-50" : "hover:bg-gray-50"}`}
                      >
                        {/* First column: clickable identity block */}
                        <td className="px-4 py-2.5">
                          <Link href={`/assets/${asset.id}`} className="group/asset block">
                            <p className="font-bold text-[#111827] transition group-hover/asset:text-[#ED1C24]">
                              {asset.asset_code}
                            </p>
                            <p className="text-xs text-[#4B5563] transition group-hover/asset:text-[#ED1C24]">
                              {asset.asset_name}
                            </p>
                            <p className="text-[10px] text-[#9CA3AF]">
                              {getMainCategoryName(asset.category)} / {asset.category}
                            </p>
                            {(asset.model || asset.serial_number) && (
                              <p className="text-[10px] text-[#9CA3AF]">
                                {[
                                  asset.model         ? `Model: ${asset.model}`          : null,
                                  asset.serial_number ? `Serial: ${asset.serial_number}` : null,
                                ].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </Link>
                        </td>
                        {isFullFilterUser && (
                          <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                            {getMainCategoryName(asset.category)}
                          </td>
                        )}
                        {isFullFilterUser && (
                          <td className="px-4 py-2.5 text-sm text-[#4B5563]">{asset.category}</td>
                        )}
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                          {asset.location ?? <span className="text-[#9CA3AF]">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge label={asset.status} tone={assetStatusTone(asset.status)} />
                        </td>
                        <td className="px-4 py-2.5">
                          {hasOpenRepair ? (
                            <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Open repair order
                            </span>
                          ) : lastRepair ? (
                            <span className="text-xs text-[#4B5563]">
                              Last repaired: {formatDate(lastRepair)}
                            </span>
                          ) : (
                            <span className="text-xs text-[#9CA3AF]">No repairs yet</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <Link
                            href={`/assets/${asset.id}`}
                            className="inline-block rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {!assets.length && (
                    <tr>
                      <td className="px-4 py-10 text-center" colSpan={isFullFilterUser ? 7 : 5}>
                        <p className="text-sm font-semibold text-[#4B5563]">No assets match the current filters.</p>
                        <Link href="/assets" className="mt-2 inline-block text-xs text-[#ED1C24] hover:underline">
                          Clear filters
                        </Link>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {totalAssets > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            search={params?.search}
            status={params?.status}
            mainCategory={params?.main_category}
            category={params?.category}
            location={params?.location}
            dueSoon={dueSoonFilter ? "1" : undefined}
          />
        )}

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

function filterHref({
  category, mainCategory, status, search, location,
}: {
  category?: string; mainCategory?: string; status?: string; search?: string;
  location?: string;
}) {
  const p = new URLSearchParams();
  if (mainCategory) p.set("main_category", mainCategory);
  if (category)     p.set("category", category);
  if (status)       p.set("status", status);
  if (search)       p.set("search", search);
  if (location)     p.set("location", location);
  const q = p.toString();
  return q ? `/assets?${q}` : "/assets";
}

function topLevelChipHref({
  mainCategory, status, search, location,
}: {
  mainCategory: string; status?: string; search?: string;
  location?: string;
}) {
  return filterHref({ mainCategory, status, search, location });
}

function SummaryCard({
  title, value, detail, icon: Icon, tone = "gray", href, active = false,
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
    gray:  "bg-[#111827] text-white",
    amber: "bg-[#F59E0B] text-white",
    blue:  "bg-[#2563EB] text-white",
    red:   "bg-[#ED1C24] text-white",
  }[tone];

  const borderClass = active ? "border-amber-300 ring-1 ring-amber-300" : "border-[#E5E7EB]";

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

function formatDate(value: Date | string | null) {
  if (!value) return "Not scheduled";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Pagination({
  page, totalPages, search, status, mainCategory, category, location, dueSoon,
}: {
  page: number;
  totalPages: number;
  search?: string;
  status?: string;
  mainCategory?: string;
  category?: string;
  location?: string;
  dueSoon?: string;
}) {
  const hrefFor = (nextPage: number) => {
    const p = new URLSearchParams();
    p.set("page", String(nextPage));
    if (search)        p.set("search", search);
    if (status)        p.set("status", status);
    if (mainCategory)  p.set("main_category", mainCategory);
    if (category)      p.set("category", category);
    if (location)      p.set("location", location);
    if (dueSoon)       p.set("due_soon", dueSoon);
    return `/assets?${p.toString()}`;
  };

  return (
    <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50" href={hrefFor(page - 1)}>
            Previous
          </Link>
        )}
        {page < totalPages && (
          <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50" href={hrefFor(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
