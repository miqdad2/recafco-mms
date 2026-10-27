"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Search } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

// Job Card Asset Picker UX Unit 1 — reusable searchable asset/vehicle/machine
// picker, replacing a plain <select> that becomes unusable once the fleet
// grows past a hundred-plus assets. Client-side filtering only (Task 7):
// with the whole non-deleted asset list already loaded once by the caller,
// filtering ~500 rows in memory is fast and needs no new backend endpoint.
// If the fleet grows into the thousands, this should move to a server-side
// search action instead (debounced query -> a scoped Prisma `findMany`) —
// left as a note for a future unit, not implemented here.

export type AssetPickerOption = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string | null;
  location: string | null;
  status: string;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  plate_number: string | null;
  serial_number: string | null;
  assigned_operator_driver: string | null;
};

type QuickFilterValue = "all" | string;

const INITIAL_SHOW_COUNT = 10;
const MAX_SEARCH_RESULTS = 50;

function statusTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Active" || status === "In Use") return "green";
  if (status === "Breakdown" || status === "Out of Service") return "red";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "amber";
  return "gray";
}

// Dynamic Job Card Asset Filters Unit 10G.50, Task 5: line 2 of a result row
// — asset type, plate number, current location, and responsible person/
// driver, each its own bullet segment, only when present. Brand/model/model
// year were dropped from this line (kept only on the post-selection summary
// card) so the row stays scannable rather than overloaded — asset type,
// plate, location, and driver are what a Data Entry user actually needs to
// tell two similar assets apart while picking one for a Job Card.
function detailLine(a: AssetPickerOption): string {
  return [
    a.category,
    a.plate_number ? `Plate ${a.plate_number}` : null,
    a.location,
    a.assigned_operator_driver ? `Driver: ${a.assigned_operator_driver}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" • ");
}

function matchesQuery(a: AssetPickerOption, q: string): boolean {
  return [a.asset_code, a.asset_name, a.plate_number, a.brand, a.model, a.category, a.location, a.assigned_operator_driver]
    .filter((field): field is string => Boolean(field))
    .some((field) => field.toLowerCase().includes(q));
}

export function AssetSearchPicker({
  assets,
  value,
  onChange,
  placeholder = "Type asset code, name, plate number, brand or model…",
  disabled = false,
  required = false,
}: {
  assets: AssetPickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuickFilterValue>("all");
  // Once an asset is selected, collapse to the summary card. Re-opens if the
  // user clicks "Change Asset" (handled by the parent clearing `value`, or
  // internally via `forceOpen`).
  const [forceOpen, setForceOpen] = useState(false);

  const selected = assets.find((a) => a.id === value) ?? null;
  const showPicker = forceOpen || !selected;

  // Dynamic Job Card Asset Filters Unit 10G.50, Task 2: quick filters are
  // now built from the asset types actually present in `assets` (the same
  // imported-from-Excel category values the Assets & Equipment page shows),
  // not a fixed pre-import list — "Vehicles & Mobile Equipment" / "Machines
  // / Equipment" / "Truck" only ever show up again if a real asset uses that
  // exact category value. Sorted by count descending (most common asset
  // type first), ties broken alphabetically for a stable, predictable order
  // — matches how the Assets page's own type counts naturally read. A
  // category with zero assets can never appear here since it's only ever
  // discovered by counting the assets that actually have it.
  const quickFilters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const category = (a.category ?? "").trim();
      if (!category) continue;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const sortedCategories = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category]) => category);
    return [{ value: "all" as QuickFilterValue, label: "All" }, ...sortedCategories.map((category) => ({ value: category as QuickFilterValue, label: category }))];
  }, [assets]);

  const filteredByCategory = useMemo(() => {
    if (filter === "all") return assets;
    return assets.filter((a) => a.category === filter);
  }, [assets, filter]);

  const q = query.trim().toLowerCase();
  const searched = q ? filteredByCategory.filter((a) => matchesQuery(a, q)) : filteredByCategory;
  const noQueryActive = !q;
  const noSearchActive = noQueryActive && filter === "all";

  // Don't show hundreds of assets by default — only once the user searches
  // does the list expand past the initial cap (rendering-performance cap;
  // filtering itself still runs over the full in-memory list). Picking a
  // quick filter alone (no typed search yet) still caps at
  // INITIAL_SHOW_COUNT — Task 4's "Showing first 10 Car assets" — the user
  // types to search further within that type.
  const displayList = noQueryActive ? searched.slice(0, INITIAL_SHOW_COUNT) : searched.slice(0, MAX_SEARCH_RESULTS);

  function handleSelect(id: string) {
    onChange(id);
    setForceOpen(false);
  }

  if (!showPicker && selected) {
    return <SelectedAssetSummary asset={selected} onChangeClick={() => setForceOpen(true)} disabled={disabled} />;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the search box never submits the surrounding form.
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white py-2 pl-9 pr-3 text-base sm:text-sm"
          aria-label="Search assets, vehicles, and machines"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {quickFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            disabled={disabled}
            className={cn(
              "focus-ring min-h-9 rounded-full border px-3 py-1 text-sm font-semibold transition",
              filter === f.value
                ? "border-[#111827] bg-[#111827] text-white"
                : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#111827]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Dynamic Job Card Asset Filters Unit 10G.50, Task 4: clearer,
          filter-aware helper text — "all assets" when browsing everything,
          the selected asset type's own name and count when a quick filter
          is active. */}
      {noSearchActive && (
        <p className="text-xs text-[#9CA3AF]">
          Showing the first {Math.min(INITIAL_SHOW_COUNT, assets.length)} of {assets.length} assets. Type to search all assets.
        </p>
      )}
      {noQueryActive && filter !== "all" && (
        <p className="text-xs text-[#9CA3AF]">
          Showing first {Math.min(INITIAL_SHOW_COUNT, filteredByCategory.length)} {filter} assets. Type to search within this asset type.
        </p>
      )}

      <div className="max-h-80 overflow-y-auto rounded-md border border-[#E5E7EB]">
        {displayList.length === 0 ? (
          <div className="p-4 text-center text-sm text-[#4B5563]" role="status">
            <p className="font-semibold text-[#111827]">
              {q ? `No asset matches "${query.trim()}"${filter !== "all" ? ` in ${filter}` : ""}.` : `No ${filter} assets.`}
            </p>
            <p className="mt-1">Check the spelling, or try the asset code or plate number{filter !== "all" ? `, or choose All above` : ""}.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-md border border-[#D1D5DB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50"
            >
              Clear search
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[#E5E7EB]">
            {displayList.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(a.id)}
                  disabled={disabled}
                  className="focus-ring flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-left hover:bg-[#FEF2F2] focus-visible:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] [overflow-wrap:anywhere]">
                      {a.asset_code} — {a.asset_name}
                    </p>
                    <p className="mt-0.5 text-sm text-[#4B5563]">{detailLine(a) || "No other details"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge label={a.status} tone={statusTone(a.status)} />
                    <span className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Select</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {required && !value && (
        <p className="text-sm text-[#6B7280]">No asset selected yet — press Select on one of the assets above.</p>
      )}
    </div>
  );
}

function SelectedAssetSummary({
  asset,
  onChangeClick,
  disabled,
}: {
  asset: AssetPickerOption;
  onChangeClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-black text-green-800">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          Selected asset
        </p>
        <button
          type="button"
          onClick={onChangeClick}
          disabled={disabled}
          className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-md border border-[#D1D5DB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Change Asset
        </button>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <SummaryRow label="Asset Code" value={asset.asset_code} />
        <SummaryRow label="Asset Name" value={asset.asset_name} />
        <SummaryRow label="Category" value={asset.category} />
        <SummaryRow label="Plate Number" value={asset.plate_number} />
        <SummaryRow label="Brand / Model" value={[asset.brand, asset.model].filter(Boolean).join(" / ") || null} />
        <SummaryRow label="Location" value={asset.location} />
        <SummaryRow label="Status" value={asset.status} />
      </dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[#4B5563]">{label}:</dt>
      <dd className="text-sm font-bold text-[#111827]">{value || <span className="font-normal text-[#9CA3AF]">—</span>}</dd>
    </div>
  );
}
