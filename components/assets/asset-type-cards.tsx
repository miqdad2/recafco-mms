"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { getMovementBadge, ALL_ASSET_TYPES_KEY, type ActiveMovementInfo } from "@/lib/assets/movement-status";

// Asset Types Card View and Popup Unit 10G.37; rebuilt into the page's only
// asset register in Assets Page Card-First Register UI Unit 10G.67.
//
// The main page no longer renders its own Asset Register table, search bar,
// or Status/Site Movement filter row (Task 1) — everything that table used
// to do now lives inside this popup, opened either from an Asset Type card
// or from "View All Assets" (Task 3/4). The popup itself is still a plain
// hand-built overlay (not the shared LargeFormModal shell — that shell's
// dirty-tracking would treat typing into the search box as "unsaved
// changes"), and still filters entirely in memory over the same one
// already-loaded `assets` list this page has fetched since Unit 10G.37 —
// adding Status/Site Movement filtering here is new client-side logic, not
// a new query (Task 10).

export type AssetTypeCardRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  status: string;
  location: string | null;
  plate_number: string | null;
  chassis_number: string | null;
  assigned_operator_driver: string | null;
  model: string | null;
  model_year: number | null;
  remarks: string | null;
};

export type AssetTypeChip = { category: string; count: number };

export type AssetTypeMovementCounts = { atSite: number; overdue: number; activeMaintenance: number };

const STATUS_OPTIONS = ["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"];

// Same status wording/tone rules as the rest of this page — kept as local
// copies (small, presentational, no shared state) rather than importing
// from the page module, matching this codebase's existing convention for
// small per-file label helpers.
function displayAssetStatus(status: string): string {
  return status === "Waiting for Parts" ? "Waiting for Materials" : status;
}
function assetStatusTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Breakdown" || status === "Out of Service") return "red";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "amber";
  if (status === "Retired") return "gray";
  return "green";
}

// Task 6 — the same short "Expected return: Sep 25, 2026" line shown under
// Current Location.
function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function matchesSearch(a: AssetTypeCardRow, q: string): boolean {
  return [
    a.asset_code,
    a.asset_name,
    a.model,
    a.model_year ? String(a.model_year) : null,
    a.plate_number,
    a.chassis_number,
    a.location,
    a.assigned_operator_driver,
    a.remarks,
  ]
    .filter((field): field is string => Boolean(field))
    .some((field) => field.toLowerCase().includes(q));
}

// Task 6 — "Available"/"At Site"/"Overdue Return" bucket for one asset,
// mirroring the exact same rule the main page's server-side movement filter
// used before this unit (an overdue asset still counts under "At Site" too,
// it's just also flagged "overdue").
function movementBucket(assetId: string, activeMovements: Record<string, ActiveMovementInfo>): "available" | "deployed" | "overdue" {
  const active = activeMovements[assetId];
  if (!active) return "available";
  return getMovementBadge(active)?.label === "Overdue" ? "overdue" : "deployed";
}

export function AssetTypeCards({
  types,
  assets,
  activeMovements = {},
  movementCounts = {},
  canManage,
  initialOpenType = null,
}: {
  types: AssetTypeChip[];
  assets: AssetTypeCardRow[];
  /** asset_id -> its active deployment, keyed as a plain object (not a Map) so it serializes cleanly across the server/client boundary. */
  activeMovements?: Record<string, ActiveMovementInfo>;
  /** category -> at-site/overdue/active-maintenance counts. */
  movementCounts?: Record<string, AssetTypeMovementCounts>;
  /** Task 9 — whether this viewer may Send to Site / Receive Back inside the popup. */
  canManage: boolean;
  /**
   * Task 3/4 — the category (or ALL_ASSET_TYPES_KEY) to auto-open on load,
   * driven by the page's own `?asset_type=` query param. Set once per full
   * navigation (View All Assets, or the redirect back from a Send to
   * Site / Receive Back action) — not kept in sync afterward, so manually
   * closing the popup via its own X button is never overridden.
   */
  initialOpenType?: string | null;
}) {
  const [openType, setOpenType] = useState<string | null>(initialOpenType);

  // React "adjust state during render" pattern — reopens the popup only
  // when `initialOpenType` itself changes (a real navigation), never on a
  // plain re-render, and never fights a manual close.
  const [lastInitialOpenType, setLastInitialOpenType] = useState(initialOpenType);
  if (initialOpenType !== lastInitialOpenType) {
    setLastInitialOpenType(initialOpenType);
    setOpenType(initialOpenType);
  }

  const isAll = openType === ALL_ASSET_TYPES_KEY;
  const popupAssets = isAll ? assets : assets.filter((a) => a.category === openType);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {types.map((t) => {
          const counts = movementCounts[t.category];
          return (
            <button
              key={t.category}
              type="button"
              onClick={() => setOpenType(t.category)}
              className="group rounded-md border border-[#E5E7EB] bg-white p-4 text-left shadow-sm transition hover:border-[#ED1C24]/50 hover:shadow-md"
            >
              <p className="truncate text-sm font-bold text-[#111827]">{t.category}</p>
              <p className="mt-2 text-2xl font-black leading-none text-[#111827]">{t.count}</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">{t.count === 1 ? "asset" : "assets"}</p>
              {/* Task 2 — only shown when there's something to say, so a
                  category with nothing deployed/under repair stays exactly
                  as short as before ("Do not make cards too tall"). */}
              {!!counts?.atSite && (
                <p className="mt-1.5 text-xs font-bold text-blue-700">{counts.atSite} at site</p>
              )}
              {!!counts?.overdue && (
                <p className="text-xs font-bold text-[#ED1C24]">{counts.overdue} overdue</p>
              )}
              {!!counts?.activeMaintenance && (
                <p className="text-xs font-bold text-amber-700">{counts.activeMaintenance} active maintenance</p>
              )}
              <p className="mt-2.5 text-xs font-bold text-[#ED1C24] group-hover:underline">
                View assets
              </p>
            </button>
          );
        })}
      </div>

      {openType && (
        <AssetTypePopup
          title={isAll ? "All Assets" : `${openType} Assets`}
          subtitle={isAll ? "Showing all registered assets." : "Showing assets under this type."}
          typeKey={openType}
          assets={popupAssets}
          activeMovements={activeMovements}
          canManage={canManage}
          onClose={() => setOpenType(null)}
        />
      )}
    </>
  );
}

function AssetTypePopup({
  title,
  subtitle,
  typeKey,
  assets,
  activeMovements,
  canManage,
  onClose,
}: {
  title: string;
  subtitle: string;
  /** Real category name, or ALL_ASSET_TYPES_KEY — carried on Send to Site / Receive Back links so the redirect back reopens this same popup (Task 3/4). */
  typeKey: string;
  assets: AssetTypeCardRow[];
  activeMovements: Record<string, ActiveMovementInfo>;
  canManage: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [movementFilter, setMovementFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (q && !matchesSearch(a, q)) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (movementFilter) {
        const bucket = movementBucket(a.id, activeMovements);
        if (movementFilter === "available" && bucket !== "available") return false;
        if (movementFilter === "deployed" && bucket === "available") return false;
        if (movementFilter === "overdue" && bucket !== "overdue") return false;
      }
      return true;
    });
  }, [assets, search, statusFilter, movementFilter, activeMovements]);

  const hasFilters = !!(search || statusFilter || movementFilter);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          // Asset Register Popup UI Width Polish Unit 10G.67A, Task 1 — wider
          // on desktop so the register table's columns (Status/Action in
          // particular) get room to breathe; `min()` still caps it on
          // narrower viewports and max-h/overflow-y-auto below keep the
          // scroll behavior unchanged.
          className="flex max-h-[90vh] w-[min(95vw,1500px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling */}
          <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-5">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-[#111827]">{title}</h2>
              <p className="mt-1 text-sm text-[#4B5563]">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body — the only scrolling region */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* Task 6 — Search / Status / Site Movement, scoped to whatever
                this popup is currently showing (one type, or all assets). */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by asset, plate number, chassis number, location, or driver…"
                  className="focus-ring w-full rounded-md border border-[#E5E7EB] py-2 pl-9 pr-3 text-sm"
                  autoFocus
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="focus-ring h-9 min-w-[150px] rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold"
              >
                <option value="">Status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{displayAssetStatus(s)}</option>
                ))}
              </select>
              <select
                value={movementFilter}
                onChange={(e) => setMovementFilter(e.target.value)}
                className="focus-ring h-9 min-w-[160px] rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold"
                title="Filter by site movement status"
              >
                <option value="">Site Movement</option>
                <option value="available">Available</option>
                <option value="deployed">At Site</option>
                <option value="overdue">Overdue Return</option>
              </select>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setStatusFilter(""); setMovementFilter(""); }}
                  className="inline-flex h-9 items-center rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold text-[#4B5563] hover:bg-gray-50"
                >
                  Reset
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-[#4B5563]">No assets found.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
                <div className="overflow-x-auto">
                  {/* Task 3 — table-auto (not table-fixed): every column
                      still sizes to its own content/min-width, but the
                      wider min-w below gives the browser enough room that
                      Status/Action no longer have to squeeze. Plate/Chassis
                      are short enough to stay on one line at this width
                      without forcing `whitespace-nowrap` everywhere and
                      risking overflow on genuinely long values. */}
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-2.5 min-w-[220px]">Asset / Equipment</th>
                        <th className="px-4 py-2.5 whitespace-nowrap">Plate No.</th>
                        <th className="px-4 py-2.5 whitespace-nowrap">Chassis No.</th>
                        <th className="px-4 py-2.5 min-w-[190px]">Current Location</th>
                        <th className="px-4 py-2.5 min-w-[160px]">Responsible Person / Driver</th>
                        {/* Task 4 — fixed, non-wrapping width so the badge
                            never breaks mid-word (e.g. "Acti" / "ve"). */}
                        <th className="px-4 py-2.5 min-w-[130px] whitespace-nowrap">Status</th>
                        {/* Task 5 — enough width for View + one compact
                            action side by side without wrapping. */}
                        <th className="px-4 py-2.5 min-w-[200px] whitespace-nowrap text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filtered.map((a) => {
                        const activeMovement = activeMovements[a.id] ?? null;
                        const movementBadge = getMovementBadge(activeMovement);
                        return (
                          <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-[#111827]">{a.asset_code}</p>
                              <p className="text-xs text-[#4B5563]">{a.asset_name}</p>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-[#4B5563]">{a.plate_number ?? "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-[#4B5563]">{a.chassis_number ?? "—"}</td>
                            <td className="px-4 py-2.5 text-[#4B5563]">
                              <div className="flex items-center gap-1.5">
                                <span>{activeMovement?.to_location ?? a.location ?? "—"}</span>
                                {/* Task 4/7 — At Site/Overdue badge kept
                                    exactly as-is, just never allowed to
                                    wrap mid-word now (see the Status cell
                                    below for the same fix). */}
                                {movementBadge && (
                                  <span className="whitespace-nowrap">
                                    <StatusBadge label={movementBadge.label} tone={movementBadge.tone} />
                                  </span>
                                )}
                              </div>
                              {activeMovement?.expected_return_date && (
                                <p className="mt-0.5 whitespace-nowrap text-[11px] text-[#9CA3AF]">
                                  Expected return: {shortDate(activeMovement.expected_return_date)}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-[#4B5563]">{a.assigned_operator_driver ?? "—"}</td>
                            {/* Task 4 — whitespace-nowrap on the cell itself
                                (not just the badge) is what actually stops
                                "Active" from breaking into "Acti"/"ve": the
                                badge component has no nowrap of its own, so
                                a cramped column could still force-wrap its
                                text regardless of the badge's own padding. */}
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <StatusBadge label={displayAssetStatus(a.status)} tone={assetStatusTone(a.status)} />
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Link
                                  href={`/assets/${a.id}`}
                                  className="inline-block whitespace-nowrap rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                                >
                                  View
                                </Link>
                                {/* Task 4/9 — action depends on this row's own
                                    movement state, gated on assets.manage.
                                    `asset_type` carries this popup's own
                                    context (one type, or "all") so the
                                    redirect after the action reopens the
                                    same popup instead of landing on a bare
                                    main page. */}
                                {canManage && !activeMovement && (
                                  <Link
                                    href={`/assets?asset_type=${encodeURIComponent(typeKey)}&send_to_site=${a.id}`}
                                    className="inline-block whitespace-nowrap rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                                  >
                                    Send to Site
                                  </Link>
                                )}
                                {canManage && activeMovement && (
                                  <Link
                                    href={`/assets?asset_type=${encodeURIComponent(typeKey)}&receive_back=${a.id}`}
                                    className="inline-block whitespace-nowrap rounded-md bg-[#ED1C24] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#c8181e]"
                                  >
                                    Receive Back
                                  </Link>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
