// Inventory Material Selection popup (client-safe, pure).
//
// The popup lists Inventory Control materials page by page; the server
// filters and pages them (browseInventoryForJobCardAction), so the browser
// only ever holds one page. Each item carries the same OfflineInventorySearchMatch
// the autocomplete returns, so choosing from either fills a row the same way.

import type { OfflineInventorySearchMatch } from "@/lib/store/offline-inventory-data";

/** Typed (or pasted) as the whole search text, opens the popup. */
export const INVENTORY_PICKER_SHORTCUT = "*/";
export const INVENTORY_PICKER_PAGE_SIZE = 25;

export function isInventoryPickerShortcut(value: string): boolean {
  return value.trim() === INVENTORY_PICKER_SHORTCUT;
}

export type InventoryStockFilter = "all" | "in_stock" | "out_of_stock";

export type InventoryPickerQuery = {
  search: string;
  category: string;
  location: string;
  stock: InventoryStockFilter;
  page: number;
};

// Only what the popup shows. No cost: match.last_unit_cost is filled only for
// viewers who may see costs, exactly as in the autocomplete.
export type InventoryPickerItem = {
  key: string;
  name: string;
  itemCode: string | null;
  partNumber: string | null;
  ssRecCode: string | null;
  category: string;
  location: string | null;
  unit: string;
  balance: number;
  minimumStock: number | null;
  notes: string | null;
  match: OfflineInventorySearchMatch;
};

export type InventoryPickerPage = {
  items: InventoryPickerItem[];
  total: number;
  page: number;
  pageCount: number;
  categories: string[];
  locations: string[];
};

/** Every typed word must appear in one of the searchable fields; case is ignored. */
export function matchesInventorySearch(item: InventoryPickerItem, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.name, item.itemCode, item.partNumber, item.ssRecCode, item.category].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function pickInventoryPage(all: InventoryPickerItem[], query: InventoryPickerQuery): InventoryPickerPage {
  const filtered = all
    .filter((item) => matchesInventorySearch(item, query.search))
    .filter((item) => !query.category || item.category === query.category)
    .filter((item) => !query.location || item.location === query.location)
    .filter((item) => (query.stock === "in_stock" ? item.balance > 0 : query.stock === "out_of_stock" ? item.balance <= 0 : true))
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  const pageCount = Math.max(1, Math.ceil(filtered.length / INVENTORY_PICKER_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pageCount);
  const start = (page - 1) * INVENTORY_PICKER_PAGE_SIZE;
  const sortedUnique = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
  return {
    items: filtered.slice(start, start + INVENTORY_PICKER_PAGE_SIZE),
    total: filtered.length,
    page,
    pageCount,
    categories: sortedUnique(all.map((i) => i.category)),
    locations: sortedUnique(all.map((i) => i.location)),
  };
}
