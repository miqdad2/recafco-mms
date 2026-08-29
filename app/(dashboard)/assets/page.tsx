import Link from "next/link";
import { AlertTriangle, Boxes, Layers, PackageSearch, Plus, ShieldAlert, ShoppingCart, Upload, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { AssetTypeCards, type AssetTypeCardRow } from "@/components/assets/asset-type-cards";
import { SimpleAssetForm } from "@/components/assets/simple-asset-form";
import { AssetImportForm } from "@/components/assets/asset-import-form";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
// Categories loaded from DB — see asset_categories table

type AssetsPageProps = {
  searchParams?: Promise<{ page?: string; search?: string; status?: string; category?: string; due_soon?: string; new_asset?: string; import_assets?: string }>;
};

const pageSize = 25;

// Assets Dashboard Card Clarity Cleanup Task 4/6: a Job Card is "open" if it
// hasn't reached the one terminal status in the simplified workflow model
// ("Closed" — see lib/workflows/status-rules.ts); "Cancelled"/"Rejected" are
// kept in this exclusion list defensively for any legacy pre-Unit4 rows.
const OPEN_JOB_CARD_STATUSES_EXCLUDED = ["Closed", "Cancelled", "Rejected"];

// A Job Card counts as "active maintenance" once it's past Manager approval
// and is actually queued for/undergoing repair — matches the subtitle
// "Assets currently being repaired or waiting for materials" (Created/Under
// Review are deliberately excluded: nothing is being repaired yet).
const ACTIVE_MAINTENANCE_JOB_CARD_STATUSES = [
  "Approved",
  "Waiting Materials",
  "Partially Issued",
  "Materials Issued",
  "Assigned",
  "In Progress",
];

type AssetRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  status: string;
  location: string | null;
  plate_number: string | null;
  chassis_number: string | null;
  assigned_operator_driver: string | null;
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

// Assets Dashboard Card Clarity Cleanup Task 3: display label only — the
// stored status value ("Waiting for Parts") is unchanged so filtering,
// tone lookups, and existing records are unaffected.
function displayAssetStatus(status: string): string {
  return status === "Waiting for Parts" ? "Waiting for Materials" : status;
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

  // Asset Register Import Mapping and New Asset Form Update Unit 10G.34,
  // Task 9/10: "Asset Type" is now a flat, real-data-driven list (no main/
  // sub category split, no admin category tree query on this page at all —
  // that hierarchy still exists for /admin/settings/asset-categories, just
  // not consulted here). categoryChips (one row per Asset Type actually in
  // use, with its count) IS the "Asset Types" section directly — the exact
  // same query already ran on this page before this unit, so this removes
  // work rather than adding it (Task's "keep the page fast" instruction).
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
    // Task 9 — search covers asset code, asset type, make/name, model/year,
    // plate number, chassis number, location, responsible person/driver,
    // and remarks.
    ...(search
      ? {
          OR: [
            { asset_code:              { contains: search, mode: "insensitive" as const } },
            { category:                { contains: search, mode: "insensitive" as const } },
            { asset_name:              { contains: search, mode: "insensitive" as const } },
            { model:                   { contains: search, mode: "insensitive" as const } },
            { plate_number:            { contains: search, mode: "insensitive" as const } },
            { chassis_number:          { contains: search, mode: "insensitive" as const } },
            { location:                { contains: search, mode: "insensitive" as const } },
            { assigned_operator_driver:{ contains: search, mode: "insensitive" as const } },
            { remarks:                 { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [assets, count, categoryChips, needAttentionCount, activeMaintenanceCount, assetsForTypeCards] = await Promise.all([
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
        plate_number: true,
        chassis_number: true,
        assigned_operator_driver: true,
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
    // Assets Dashboard Card Clarity Cleanup Task 4/6: "Need Attention" — an
    // asset in a bad status (Breakdown/Out of Service) OR one with any open
    // (non-Closed) Job Card, same "open" definition already used for the
    // per-row "Open Job Card" badge below (OPEN_JOB_CARD_STATUSES).
    prisma.assets.count({
      where: {
        deleted_at: null,
        OR: [
          { status: { in: ["Breakdown", "Out of Service"] } },
          { work_orders: { some: { deleted_at: null, status: { notIn: OPEN_JOB_CARD_STATUSES_EXCLUDED } } } },
        ],
      },
    }),
    // "Active Maintenance" — an asset with a Job Card that has passed
    // approval and is actively being worked (queued for/awaiting materials,
    // assigned, or in progress). Deliberately narrower than "Need Attention"
    // (excludes Created/Under Review — those haven't started maintenance yet).
    prisma.assets.count({
      where: {
        deleted_at: null,
        work_orders: { some: { deleted_at: null, status: { in: ACTIVE_MAINTENANCE_JOB_CARD_STATUSES } } },
      },
    }),
    // Asset Types Card View and Popup Unit 10G.37: one lightweight query for
    // every registered asset (171 rows currently — a handful of columns
    // each), fetched once and handed to the client-side card grid so
    // opening a type's popup and searching inside it never triggers another
    // database call (Task's own "use already loaded asset list, avoid
    // extra database calls" instruction) — independent of the paginated,
    // filtered `assets` query above, which the main Asset Register still
    // uses unchanged.
    prisma.assets.findMany({
      where: { deleted_at: null },
      orderBy: { asset_code: "asc" },
      select: {
        id: true,
        asset_code: true,
        asset_name: true,
        category: true,
        status: true,
        location: true,
        plate_number: true,
        chassis_number: true,
        assigned_operator_driver: true,
        model: true,
        model_year: true,
        remarks: true,
      },
    }) as Promise<AssetTypeCardRow[]>,
  ]);

  const totalAssets = categoryChips.reduce((sum, item) => sum + Number(item.count), 0);
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  // Assets & Equipment Data Entry Access Alignment: this used to explicitly
  // exclude maintenance_data_entry even though the role already carries
  // assets.manage in the DB (route guards on /assets/new, /assets/import,
  // and /assets/[id]/edit all already require plain assets.manage with no
  // role-slug exception) — so Data Entry could reach every asset write
  // route by URL but never saw the New Asset / Import Excel buttons here.
  // Now purely permission-based, matching every other asset route/action in
  // the app and Data Entry's real, already-granted assets.manage permission.
  const canManage =
    context.role?.slug === "super_admin" || context.permissions.includes("assets.manage");
  // Task 10 — one simple view for every role now; no separate manager-only
  // columns/filters (there's nothing "technical" left to gate).
  const hasActiveFilters = !!(search || status || category || dueSoonFilter);

  // New Asset Popup and Add Asset Type Unit 10G.38, Task 1/2: "+ New Asset"
  // now opens this page's own LargeFormModal via ?new_asset=1 instead of
  // navigating to /assets/new (that route is untouched and still works
  // directly — Task 2). Task 8: only Super Admin / Maintenance Manager may
  // add new asset types from inside the popup's Asset Type field.
  const showNewAssetModal = canManage && params?.new_asset === "1";
  const canManageAssetTypes =
    context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  // categoryChips already is the exact "one row per real, in-use asset
  // type" list (Task's own "avoid extra database calls" instruction) — no
  // separate query needed for the popup's dropdown.
  const assetTypesForModal = categoryChips.map((c) => c.category);

  // Import Excel Popup Flow Unit 10G.40, Task 1/2/11: "Import Excel" now
  // opens this same LargeFormModal via ?import_assets=1 instead of
  // navigating to /assets/import — that route is untouched and still works
  // directly when opened on its own.
  const showImportModal = canManage && params?.import_assets === "1";

  return (
    <>
      <PageHeader
        title="Assets & Equipment"
        description="Manage machines, equipment, vehicles, condition, and repair history."
        actions={
          <>
            <PageNavigationActions />
            {canManage ? (
              <>
                <Link href="/assets?import_assets=1" title="Upload many assets or vehicles from Excel.">
                  <Button variant="secondary" className="gap-2">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Import Excel
                  </Button>
                </Link>
                <Link href="/assets?new_asset=1" title="Add one asset or vehicle manually.">
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New Asset
                  </Button>
                </Link>
              </>
            ) : null}
          </>
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
            title="Need Attention"
            value={needAttentionCount}
            detail="Assets with open Job Cards"
            icon={ShieldAlert}
            tone={needAttentionCount > 0 ? "red" : "gray"}
            href="/assets?status=Breakdown"
          />
          <SummaryCard
            title="Active Maintenance"
            value={activeMaintenanceCount}
            detail="Assets currently being repaired or waiting for materials"
            icon={Wrench}
            tone={activeMaintenanceCount > 0 ? "amber" : "gray"}
            href="/assets?status=Under+Maintenance"
          />
        </section>

        {/* Asset Types Card View and Popup Unit 10G.37, Task 1/2/8: the
            plain "Asset Types" table (from Unit 10G.34) replaced with a
            compact card grid — one card per real, in-use asset type,
            clicking one opens a search-and-browse popup instead of
            filtering via a link. The main Asset Type dropdown further down
            (Task 7) still does the classic same-page filter — the cards are
            a faster, more visual alternative, not a replacement for it. */}
        {totalAssets > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Asset Types</p>
              {canManage && (
                <Link
                  href="/admin/settings/asset-categories"
                  className="text-xs font-bold text-[#ED1C24] hover:underline"
                >
                  Manage Categories
                </Link>
              )}
            </div>
            <AssetTypeCards
              types={categoryChips.map((c) => ({ category: c.category, count: Number(c.count) }))}
              assets={assetsForTypeCards}
            />
            <p className="mt-2 text-xs text-[#9CA3AF]">
              Only categories with registered assets are shown.
            </p>
          </section>
        )}

        {totalAssets > 0 && (
        /* Task 9/10 — one simple filter bar for every role: search plus
           Status and Asset Type. */
        <form className="flex flex-wrap items-center gap-2 rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
          <input
            className="focus-ring h-9 min-w-[220px] flex-1 rounded-md border border-[#E5E7EB] px-3 text-sm"
            name="search"
            defaultValue={params?.search ?? ""}
            placeholder="Search asset, plate number, chassis number, location, or driver…"
          />
          <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="category" defaultValue={category}>
            <option value="">All asset types</option>
            {categoryChips.map((c) => (
              <option key={c.category} value={c.category}>{c.category}</option>
            ))}
          </select>
          <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="status" defaultValue={params?.status ?? ""}>
            <option value="">Status</option>
            {["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"].map((s) => (
              <option key={s} value={s}>{displayAssetStatus(s)}</option>
            ))}
          </select>
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
        )}

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
                    <Link href="/assets?import_assets=1" title="Upload many assets or vehicles from Excel.">
                      <Button variant="secondary" className="gap-2">
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Import Excel
                      </Button>
                    </Link>
                    <Link href="/assets?new_asset=1" title="Add one asset or vehicle manually.">
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
              {/* Asset Register Import Mapping and New Asset Form Update
                  Unit 10G.34, Task 9: simple useful columns only — Asset /
                  Equipment, Asset Type, Plate No., Chassis No., Location,
                  Responsible Person / Driver, Status, Action — the same for
                  every role now (no manager-only extra columns; a missing
                  value always reads "—", never blank). */}
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Asset / Equipment</th>
                    <th className="px-4 py-3">Asset Type</th>
                    <th className="px-4 py-3">Plate No.</th>
                    <th className="px-4 py-3">Chassis No.</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Responsible Person / Driver</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {assets.map((asset) => {
                    const isCritical = asset.status === "Breakdown" || asset.status === "Out of Service";
                    return (
                      <tr
                        key={asset.id}
                        className={`transition ${isCritical ? "bg-red-50" : "hover:bg-gray-50"}`}
                      >
                        <td className="px-4 py-2.5">
                          <Link href={`/assets/${asset.id}`} className="group/asset block">
                            <p className="font-bold text-[#111827] transition group-hover/asset:text-[#ED1C24]">
                              {asset.asset_code}
                            </p>
                            <p className="text-xs text-[#4B5563] transition group-hover/asset:text-[#ED1C24]">
                              {asset.asset_name}
                            </p>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">{asset.category}</td>
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                          {asset.plate_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                          {asset.chassis_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                          {asset.location ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#4B5563]">
                          {asset.assigned_operator_driver ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge label={displayAssetStatus(asset.status)} tone={assetStatusTone(asset.status)} />
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
                      <td className="px-4 py-10 text-center" colSpan={8}>
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
            category={params?.category}
            dueSoon={dueSoonFilter ? "1" : undefined}
          />
        )}

      </div>

      {showNewAssetModal && (
        <LargeFormModal
          title="New Asset"
          subtitle="Add a new asset to the maintenance register."
          closeHref="/assets"
        >
          <SimpleAssetForm
            assetTypes={assetTypesForModal}
            modalMode
            redirectTo="/assets"
            canAddAssetType={canManageAssetTypes}
          />
        </LargeFormModal>
      )}

      {showImportModal && (
        <LargeFormModal
          title="Import Assets from Excel"
          subtitle="Upload the maintenance asset Excel file and check the preview before saving."
          closeHref="/assets"
        >
          <AssetImportForm modalMode canReplace={context.role?.slug === "super_admin"} />
        </LargeFormModal>
      )}
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

function Pagination({
  page, totalPages, search, status, category, dueSoon,
}: {
  page: number;
  totalPages: number;
  search?: string;
  status?: string;
  category?: string;
  dueSoon?: string;
}) {
  const hrefFor = (nextPage: number) => {
    const p = new URLSearchParams();
    p.set("page", String(nextPage));
    if (search)   p.set("search", search);
    if (status)   p.set("status", status);
    if (category) p.set("category", category);
    if (dueSoon)  p.set("due_soon", dueSoon);
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
