import Link from "next/link";
import { AlertTriangle, Boxes, Layers, MapPin, PackageSearch, Plus, ShieldAlert, ShoppingCart, Upload, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { AssetTypeCards, type AssetTypeCardRow, type AssetTypeMovementCounts } from "@/components/assets/asset-type-cards";
import { SimpleAssetForm } from "@/components/assets/simple-asset-form";
import { AssetImportForm } from "@/components/assets/asset-import-form";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { SendToSiteForm, ReceiveBackForm } from "@/components/assets/asset-movement-forms";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getActiveMovementsByAsset } from "@/lib/assets/movements-data";
import { getMovementBadge, ALL_ASSET_TYPES_KEY } from "@/lib/assets/movement-status";
// Categories loaded from DB — see asset_categories table

type AssetsPageProps = {
  searchParams?: Promise<{
    new_asset?: string; import_assets?: string;
    // Assets Page Card-First Register UI Unit 10G.67, Task 3/4 — which
    // Asset Type popup (a real category, or ALL_ASSET_TYPES_KEY for "View
    // All Assets") should be open on load: set by clicking a card/"View All
    // Assets", and carried through Send to Site / Receive Back links so the
    // redirect after either action reopens the same popup.
    asset_type?: string;
    send_to_site?: string; receive_back?: string;
  }>;
};

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

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const context = await requirePermission("assets.view");
  const params = await searchParams;

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

  // Assets Page Card-First Register UI Unit 10G.67, Task 1/2: this page no
  // longer runs a paginated/filtered `assets` query at all — the only asset
  // register left is the Asset Type popup, which filters entirely in
  // memory over the same full `assetsForTypeCards` list already loaded for
  // the card grid since Unit 10G.37 (Task 10: no new/unnecessary queries).
  const [
    categoryChips,
    activeMaintenanceRows,
    assetsForTypeCards,
    activeMovementsByAsset,
  ] = await Promise.all([
    prisma.$queryRaw<CategoryChip[]>`
      select category, count(*)::bigint as count
      from public.assets
      where deleted_at is null
      group by category
      order by count(*) desc, category asc
    `,
    // "Active Maintenance" — an asset with a Job Card that has passed
    // approval and is actively being worked (queued for/awaiting materials,
    // assigned, or in progress). Replaces the previous separate count()
    // query: the row list itself gives both the page-wide total (its
    // length) and, grouped by category, each Asset Type card's own count
    // (Task 2's "if available/easy") from one query instead of two.
    prisma.assets.findMany({
      where: {
        deleted_at: null,
        work_orders: { some: { deleted_at: null, status: { in: ACTIVE_MAINTENANCE_JOB_CARD_STATUSES } } },
      },
      select: { id: true, category: true },
    }),
    // Asset Types Card View and Popup Unit 10G.37: one lightweight query for
    // every registered asset (171 rows currently — a handful of columns
    // each), fetched once and handed to the client-side card grid/popup so
    // opening a type (or "View All Assets") and searching/filtering inside
    // it never triggers another database call.
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
    // One lightweight query for every currently-active deployment; the KPI
    // cards, Asset Type cards, and popup all read from this same in-memory
    // map instead of a per-row query.
    getActiveMovementsByAsset(),
  ]);

  const totalAssets = categoryChips.reduce((sum, item) => sum + Number(item.count), 0);
  const activeMaintenanceCount = activeMaintenanceRows.length;

  // Task 1 — both site-movement KPI counts are derived in memory from the
  // same `activeMovementsByAsset` map already loaded above; no extra query.
  const atSiteCount = activeMovementsByAsset.size;
  const overdueReturnCount = [...activeMovementsByAsset.values()].filter(
    (m) => getMovementBadge(m)?.label === "Overdue"
  ).length;

  // Task 2 — per-Asset-Type at-site/overdue/active-maintenance counts for
  // the Asset Type cards, built from data already loaded above — no extra
  // query.
  const movementCountsByCategory: Record<string, AssetTypeMovementCounts> = {};
  function categoryBucket(category: string): AssetTypeMovementCounts {
    return (movementCountsByCategory[category] ??= { atSite: 0, overdue: 0, activeMaintenance: 0 });
  }
  for (const a of assetsForTypeCards) {
    const active = activeMovementsByAsset.get(a.id);
    if (!active) continue;
    const bucket = categoryBucket(a.category);
    bucket.atSite += 1;
    if (getMovementBadge(active)?.label === "Overdue") bucket.overdue += 1;
  }
  for (const row of activeMaintenanceRows) {
    categoryBucket(row.category).activeMaintenance += 1;
  }

  // Assets & Equipment Data Entry Access Alignment: purely permission-based
  // (assets.manage), matching every other asset route/action in the app.
  const canManage =
    context.role?.slug === "super_admin" || context.permissions.includes("assets.manage");

  // New Asset Popup and Add Asset Type Unit 10G.38: "+ New Asset" opens this
  // page's own LargeFormModal via ?new_asset=1 instead of navigating to
  // /assets/new (that route is untouched and still works directly).
  const showNewAssetModal = canManage && params?.new_asset === "1";
  const canManageAssetTypes =
    context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  // categoryChips already is the exact "one row per real, in-use asset
  // type" list — no separate query needed for the popup's dropdown.
  const assetTypesForModal = categoryChips.map((c) => c.category);

  // Import Excel Popup Flow Unit 10G.40: "Import Excel" opens this same
  // LargeFormModal via ?import_assets=1 instead of navigating to
  // /assets/import — that route is untouched and still works directly.
  const showImportModal = canManage && params?.import_assets === "1";

  // Task 3/4 — validate the requested popup against the real category list
  // (or the "View All Assets" sentinel) so a stale/invalid `asset_type`
  // value never silently opens the wrong thing.
  const requestedType = params?.asset_type ?? null;
  const initialOpenType =
    requestedType === ALL_ASSET_TYPES_KEY || categoryChips.some((c) => c.category === requestedType)
      ? requestedType
      : null;

  // Task 4 — the target asset is always present in `assetsForTypeCards`:
  // the link that opens either modal is only ever rendered from inside a
  // popup built from that same already-loaded full asset list.
  const sendToSiteTarget =
    canManage && params?.send_to_site ? assetsForTypeCards.find((a) => a.id === params.send_to_site) ?? null : null;
  const showSendToSiteModal = !!sendToSiteTarget && !activeMovementsByAsset.has(sendToSiteTarget.id);

  const receiveBackTarget =
    canManage && params?.receive_back ? assetsForTypeCards.find((a) => a.id === params.receive_back) ?? null : null;
  const receiveBackMovement = receiveBackTarget ? activeMovementsByAsset.get(receiveBackTarget.id) ?? null : null;
  const showReceiveBackModal = !!receiveBackTarget && !!receiveBackMovement;

  // Dismissing/completing either modal returns to the same popup the action
  // was started from (Task 3/4) — never a bare, popup-less main page.
  const movementModalDismissHref = initialOpenType
    ? `/assets?asset_type=${encodeURIComponent(initialOpenType)}`
    : "/assets";

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

        {/* Task 2 — Total Assets | At Site | Overdue Return | Active
            Maintenance. Only "Total Assets" links anywhere (to View All
            Assets) — the other three are informational only now that there
            is no more page-level Status/Site Movement filter for them to
            jump to; a manager wanting to act on one drills in through the
            relevant Asset Type card's own popup instead, which now carries
            all of the same filtering. */}
        <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Total Assets"
            value={totalAssets}
            detail="All registered machines and equipment"
            icon={Boxes}
            href={`/assets?asset_type=${ALL_ASSET_TYPES_KEY}`}
          />
          <SummaryCard
            title="At Site"
            value={atSiteCount}
            detail="Assets currently sent to a site or project"
            icon={MapPin}
            tone={atSiteCount > 0 ? "blue" : "gray"}
          />
          <SummaryCard
            title="Overdue Return"
            value={overdueReturnCount}
            detail="At site past the expected return date"
            icon={AlertTriangle}
            tone={overdueReturnCount > 0 ? "red" : "gray"}
          />
          <SummaryCard
            title="Active Maintenance"
            value={activeMaintenanceCount}
            detail="Assets currently being repaired or waiting for materials"
            icon={Wrench}
            tone={activeMaintenanceCount > 0 ? "amber" : "gray"}
          />
        </section>

        {/* Task 1/2/7 — Asset Type cards are now the entire register surface
            on this page: no global search bar, no Status/Site Movement
            filter row, and no full Asset Register table sit below them
            anymore. Everything those used to do now lives inside the
            popup opened from a card or "View All Assets" (Task 3/4). */}
        {totalAssets > 0 ? (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Asset Types</p>
              <div className="flex items-center gap-3">
                {/* Task 3 — opens the same popup component, unscoped. */}
                <Link
                  href={`/assets?asset_type=${ALL_ASSET_TYPES_KEY}`}
                  className="text-xs font-bold text-[#ED1C24] hover:underline"
                >
                  View All Assets
                </Link>
                {canManage && (
                  <Link
                    href="/admin/settings/asset-categories"
                    className="text-xs font-bold text-[#ED1C24] hover:underline"
                  >
                    Manage Categories
                  </Link>
                )}
              </div>
            </div>
            <AssetTypeCards
              types={categoryChips.map((c) => ({ category: c.category, count: Number(c.count) }))}
              assets={assetsForTypeCards}
              activeMovements={Object.fromEntries(activeMovementsByAsset)}
              movementCounts={movementCountsByCategory}
              canManage={canManage}
              initialOpenType={initialOpenType}
            />
            {/* Task 7 — no empty table box left below the cards. */}
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">
              Select an asset type to view its register.
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
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
          </section>
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

      {/* Task 4 — same Send to Site / Receive Back forms the asset's own
          detail page uses (Unit 10G.65), opened here without navigating
          away from whichever Asset Type popup they were triggered from. */}
      {showSendToSiteModal && sendToSiteTarget && (
        <LargeFormModal
          title="Send to Site"
          subtitle={`Record ${sendToSiteTarget.asset_name} being sent to a work site or project location.`}
          closeHref={movementModalDismissHref}
        >
          <SendToSiteForm assetId={sendToSiteTarget.id} dismissHref={movementModalDismissHref} />
        </LargeFormModal>
      )}
      {showReceiveBackModal && receiveBackTarget && receiveBackMovement && (
        <LargeFormModal
          title="Receive Back"
          subtitle={`Record ${receiveBackTarget.asset_name} being received back from ${receiveBackMovement.to_location}.`}
          closeHref={movementModalDismissHref}
        >
          <ReceiveBackForm
            assetId={receiveBackTarget.id}
            movementId={receiveBackMovement.id}
            defaultReturnLocation={receiveBackMovement.from_location ?? "Factory"}
            dismissHref={movementModalDismissHref}
          />
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
