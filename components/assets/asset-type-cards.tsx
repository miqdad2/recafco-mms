"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

// Asset Types Card View and Popup Unit 10G.37.
//
// Replaces the plain "Asset Types" table with a compact card grid (Task 1)
// — one card per real, in-use asset type, each opening a lightweight
// browse-and-search popup (Task 2/3) instead of navigating anywhere. The
// popup is a plain hand-built overlay (matching the read-only browse
// pattern already used by components/store/material-detail-modal.tsx and
// the Closure/Closed-Jobs modals elsewhere in this app), not the shared
// LargeFormModal shell — that shell's dirty-tracking would otherwise treat
// typing into the search box as "unsaved changes" and prompt a confusing
// "Discard changes?" dialog on close, which makes no sense for a read-only
// search view.
//
// Performance (Task, "avoid extra database calls"): the full, already-
// loaded `assets` list for every currently-registered asset (171 rows, a
// handful of columns each) is passed in once from the server component and
// filtered entirely in memory here — opening a card's popup or typing in
// its search box never triggers a new request.

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

// Same status wording/tone rules as the main Asset Register table on this
// page — kept as local copies (small, presentational, no shared state)
// rather than importing from the page module, matching this codebase's
// existing convention for small per-file label helpers.
function displayAssetStatus(status: string): string {
  return status === "Waiting for Parts" ? "Waiting for Materials" : status;
}
function assetStatusTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Breakdown" || status === "Out of Service") return "red";
  if (status === "Under Maintenance" || status === "Waiting for Parts") return "amber";
  if (status === "Retired") return "gray";
  return "green";
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

export function AssetTypeCards({
  types,
  assets,
}: {
  types: AssetTypeChip[];
  assets: AssetTypeCardRow[];
}) {
  const [openType, setOpenType] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {types.map((t) => (
          <button
            key={t.category}
            type="button"
            onClick={() => setOpenType(t.category)}
            className="group rounded-md border border-[#E5E7EB] bg-white p-4 text-left shadow-sm transition hover:border-[#ED1C24]/50 hover:shadow-md"
          >
            <p className="truncate text-sm font-bold text-[#111827]">{t.category}</p>
            <p className="mt-2 text-2xl font-black leading-none text-[#111827]">{t.count}</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">{t.count === 1 ? "asset" : "assets"}</p>
            <p className="mt-2.5 text-xs font-bold text-[#ED1C24] group-hover:underline">
              View assets
            </p>
          </button>
        ))}
      </div>

      {openType && (
        <AssetTypePopup
          type={openType}
          assets={assets.filter((a) => a.category === openType)}
          onClose={() => setOpenType(null)}
        />
      )}
    </>
  );
}

function AssetTypePopup({
  type,
  assets,
  onClose,
}: {
  type: string;
  assets: AssetTypeCardRow[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => matchesSearch(a, q));
  }, [assets, search]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          className="flex max-h-[85vh] w-[min(90vw,1000px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling */}
          <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-5">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-[#111827]">{type} Assets</h2>
              <p className="mt-1 text-sm text-[#4B5563]">Showing assets under this type.</p>
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
            <div className="relative mb-4">
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

            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-[#4B5563]">No assets found.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-black uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-2.5">Asset / Equipment</th>
                        <th className="px-4 py-2.5">Plate No.</th>
                        <th className="px-4 py-2.5">Chassis No.</th>
                        <th className="px-4 py-2.5">Location</th>
                        <th className="px-4 py-2.5">Responsible Person / Driver</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filtered.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <p className="font-bold text-[#111827]">{a.asset_code}</p>
                            <p className="text-xs text-[#4B5563]">{a.asset_name}</p>
                          </td>
                          <td className="px-4 py-2.5 text-[#4B5563]">{a.plate_number ?? "—"}</td>
                          <td className="px-4 py-2.5 text-[#4B5563]">{a.chassis_number ?? "—"}</td>
                          <td className="px-4 py-2.5 text-[#4B5563]">{a.location ?? "—"}</td>
                          <td className="px-4 py-2.5 text-[#4B5563]">{a.assigned_operator_driver ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge label={displayAssetStatus(a.status)} tone={assetStatusTone(a.status)} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            <Link
                              href={`/assets/${a.id}`}
                              className="inline-block rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
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
