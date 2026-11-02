"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Package, Search, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { INVENTORY_PICKER_PAGE_SIZE, type InventoryPickerItem, type InventoryPickerPage, type InventoryPickerQuery, type InventoryStockFilter } from "@/lib/store/inventory-picker";
import type { OfflineInventorySearchMatch } from "@/lib/store/offline-inventory-data";

// Select Material from Inventory. Reusable: the caller passes how to load a
// page (an authorized server action) and what to do with the chosen material.
// Choosing only fills the caller's row; nothing here changes stock.

const field =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF]";

function qty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function StockCell({ item }: { item: InventoryPickerItem }) {
  const out = item.balance <= 0;
  const low = !out && item.match.stock_status === "low_stock";
  return (
    <div className="text-right">
      <p className={`text-sm font-bold ${out ? "text-[#B91C1C]" : "text-[#111827]"}`}>
        {qty(item.balance)} {item.unit}
      </p>
      {out ? <StatusBadge label="Out of Stock" tone="red" /> : low ? <StatusBadge label="Low Stock" tone="amber" /> : null}
      {item.minimumStock !== null ? <p className="mt-0.5 text-xs text-[#6B7280]">Min {qty(item.minimumStock)}</p> : null}
    </div>
  );
}

export function InventoryPickerModal({
  loadPage,
  onSelect,
  onClose,
}: {
  loadPage: (query: InventoryPickerQuery) => Promise<InventoryPickerPage>;
  onSelect: (match: OfflineInventorySearchMatch) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState<InventoryPickerQuery>({ search: "", category: "", location: "", stock: "all", page: 1 });
  const [result, setResult] = useState<InventoryPickerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Escape closes only this popup: caught before the page behind it sees it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Typing waits a moment; a late answer for older text is ignored.
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      loadPage(query)
        .then((page) => {
          if (seq.current !== mine) return;
          setResult(page);
          setFailed(false);
        })
        .catch(() => {
          if (seq.current === mine) setFailed(true);
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, query.search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, loadPage]);

  const change = (patch: Partial<InventoryPickerQuery>) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const first = result && result.total ? (result.page - 1) * INVENTORY_PICKER_PAGE_SIZE + 1 : 0;
  const last = result ? Math.min(result.page * INVENTORY_PICKER_PAGE_SIZE, result.total) : 0;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="inventory-picker-heading" className="flex max-h-[92vh] w-[min(96vw,1180px)] flex-col rounded-xl bg-white shadow-2xl">
          <div className="border-b border-[#E5E7EB] px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="inventory-picker-heading" className="text-xl font-black text-[#111827]">Select Material from Inventory</h2>
                <p className="mt-1 text-sm text-[#4B5563]">Find and select the correct material for this Job Card.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="focus-ring shrink-0 rounded-md p-2 text-[#4B5563] hover:bg-gray-100">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <label className="relative block">
                <span className="sr-only">Search Inventory</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query.search}
                  onChange={(e) => change({ search: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  placeholder="Name, Item Code, part number, SS Rec. Code or category"
                  className={`${field} pl-9`}
                />
              </label>
              <label className="block">
                <span className="sr-only">Category</span>
                <select value={query.category} onChange={(e) => change({ category: e.target.value })} className={field}>
                  <option value="">All categories</option>
                  {result?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Stock</span>
                <select value={query.stock} onChange={(e) => change({ stock: e.target.value as InventoryStockFilter })} className={field}>
                  <option value="all">All stock</option>
                  <option value="in_stock">In stock</option>
                  <option value="out_of_stock">Out of stock</option>
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Location</span>
                <select value={query.location} onChange={(e) => change({ location: e.target.value })} className={field}>
                  <option value="">All locations</option>
                  {result?.locations.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs font-semibold text-[#6B7280]" aria-live="polite">
              {loading && !result ? "Loading Inventory…" : result ? (result.total ? `Showing ${first}–${last} of ${result.total.toLocaleString()} materials` : "No materials match") : ""}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-4">
            {failed ? (
              <p role="alert" className="m-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Inventory could not be loaded. Please try again.
              </p>
            ) : null}
            {result && result.items.length === 0 && !loading ? (
              <p className="px-3 py-10 text-center text-sm text-[#6B7280]">No Inventory material matches this search. Try fewer words or clear a filter.</p>
            ) : null}
            <ul className={`divide-y divide-[#F3F4F6] ${loading && result ? "opacity-60" : ""}`} aria-busy={loading}>
              {result?.items.map((item) => (
                <li key={item.key} className="grid items-center gap-3 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                  <span className="hidden h-10 w-10 items-center justify-center rounded-md bg-[#F3F4F6] text-[#6B7280] sm:flex" aria-hidden="true">
                    <Package className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-[#111827]">{item.name}</p>
                    <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[#4B5563]">
                      {item.itemCode ? <div className="flex gap-1"><dt className="text-[#6B7280]">Item Code</dt><dd className="font-semibold text-[#111827]">{item.itemCode}</dd></div> : null}
                      {item.partNumber ? <div className="flex gap-1"><dt className="text-[#6B7280]">Part No.</dt><dd className="font-semibold text-[#111827]">{item.partNumber}</dd></div> : null}
                      {item.ssRecCode ? <div className="flex gap-1"><dt className="text-[#6B7280]">SS Rec.</dt><dd>{item.ssRecCode}</dd></div> : null}
                      <div className="flex gap-1"><dt className="text-[#6B7280]">Category</dt><dd>{item.category}</dd></div>
                      <div className="flex gap-1"><dt className="text-[#6B7280]">Unit</dt><dd>{item.unit}</dd></div>
                      {item.location ? <div className="flex gap-1"><dt className="text-[#6B7280]">Location</dt><dd>{item.location}</dd></div> : null}
                    </dl>
                    {item.notes ? <p className="mt-0.5 text-xs text-[#6B7280]">{item.notes}</p> : null}
                  </div>
                  <StockCell item={item} />
                  <button
                    type="button"
                    onClick={() => onSelect(item.match)}
                    aria-label={`Select ${item.name}, ${item.unit}`}
                    className="focus-ring min-h-11 rounded-md bg-[#ED1C24] px-5 text-sm font-bold text-white hover:bg-red-700"
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] px-5 py-3 sm:px-6">
            <p className="text-xs text-[#6B7280]">Selecting a material does not issue stock.</p>
            <div className="flex items-center gap-2">
              {loading && result ? <Loader2 className="h-4 w-4 animate-spin text-[#6B7280] motion-reduce:animate-none" aria-hidden="true" /> : null}
              <button
                type="button"
                disabled={!result || result.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
                className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#374151] disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </button>
              <span className="text-sm text-[#4B5563]">{result ? `Page ${result.page} of ${result.pageCount}` : ""}</span>
              <button
                type="button"
                disabled={!result || result.page >= result.pageCount}
                onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
                className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#374151] disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
