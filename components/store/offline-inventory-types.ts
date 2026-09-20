export type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
};

// Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63, Task
// 4/5/6/7 — defined here (a plain module, not "server-only" like
// lib/store/offline-inventory-data.ts) so client components can import
// these types directly, same as every other shape on this page.
export type CategoryCostSummary = {
  category: string;
  issuedThisMonth: number;
  issuedThisYear: number;
  receivedThisMonth: number;
  currentStockValue: number;
};

export type TopIssuedMaterial = {
  key: string;
  display_name: string;
  unit: string;
  issuedQuantity: number;
  issuedValue: number;
  lastIssuedDate: string;
};

export type InventorySpendingSummary = {
  issuedValueThisWeek: number;
  issuedValueThisMonth: number;
  issuedValueThisYear: number;
  receivedValueThisMonth: number;
  unpricedIssuedCount: number;
  categoryCostSummary: CategoryCostSummary[];
  topIssuedMaterials: TopIssuedMaterial[];
};

export type MovementRow = {
  id: string;
  movement_type: string;
  movement_date: string;
  part_name: string | null;
  part_number_display: string | null;
  ss_rec_code: string | null;
  category: string;
  manual_material_name: string | null;
  quantity: number;
  unit: string;
  counterparty: string | null;
  reference_number: string | null;
  related_work_order_id: string | null;
  work_order_number: string | null;
  remarks: string | null;
  created_by_name: string;
  // Store Issue Materials + Offline Inventory Separation Unit Task 6/9:
  // Data Entry/Engineer/Manager use this same page as their Material Ledger
  // and need the linked Materials Request + asset/vehicle visible without
  // opening the Job Card separately.
  parts_request_id: string | null;
  parts_request_number: string | null;
  asset_name: string | null;
  plate_number: string | null;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 8 — null on
  // any movement with no known price (issues, and receives/opening-stock
  // entries where cost wasn't provided); the caller strips these two fields
  // entirely for a viewer without cost permission (see canViewCosts).
  unit_cost: number | null;
  total_cost: number | null;
};

export type RecentMovementRow = {
  id: string;
  movement_type: string;
  movement_date: string;
  material_name: string;
  category: string;
  quantity: number;
  unit: string;
  related_work_order_id: string | null;
  work_order_number: string | null;
  reference_number: string | null;
  created_by_name: string;
  remarks: string | null;
  unit_cost: number | null;
  total_cost: number | null;
};

export type BalanceItem = {
  key: string;
  part_id: string | null;
  display_name: string;
  part_number: string | null;
  ss_rec_code: string | null;
  category: string;
  location: string | null;
  manual_material_name: string | null;
  unit: string;
  total_opening_stock: number;
  total_received: number;
  total_issued: number;
  balance: number;
  last_movement_date: string;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 2/9 — the
  // "simple last unit cost method": last_unit_cost is the unit_cost of the
  // most recent movement (by movement_date, then created_at) for this
  // material that actually recorded one; null if no movement ever did.
  // stock_value = balance * last_unit_cost, except a negative balance is
  // always shown as 0 (Task 10 — "Review required" is shown by the UI
  // instead of a negative/nonsensical value). received_value/issued_value
  // are the sums of total_cost across this material's RECEIVED/ISSUED
  // movements (only those that recorded a cost).
  last_unit_cost: number | null;
  stock_value: number;
  received_value: number;
  issued_value: number;
  // Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task
  // 2/4 — minimum_stock_quantity/reorder_quantity come from an optional
  // inventory_material_settings row for this identity (null when never
  // configured, meaning "no minimum set" per Task 4's OK-status rule).
  // stock_status is always one of the 5 values Task 5's badge list names;
  // visible to every role (it's a quantity signal, not a cost figure), so
  // it is never stripped for a non-cost viewer.
  minimum_stock_quantity: number | null;
  reorder_quantity: number | null;
  stock_status: StockStatus;
};

// Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task 4/5
// — priority order (computed in getOfflineInventoryBalance()): negative
// balance always wins ("Negative Stock"); otherwise a detected unit
// mismatch for the same manual material name wins ("Review Required");
// otherwise balance = 0 is "Out of Stock"; otherwise a configured minimum
// that the balance has reached or fallen under is "Low Stock"; otherwise
// "OK". Never relies on color alone — every badge always shows its text
// label (Task 5).
export type StockStatus = "ok" | "low_stock" | "out_of_stock" | "negative" | "review_required";

export function stockStatusLabel(status: StockStatus): string {
  const labels: Record<StockStatus, string> = {
    ok: "OK",
    low_stock: "Low Stock",
    out_of_stock: "Out of Stock",
    negative: "Negative Stock",
    review_required: "Review Required",
  };
  return labels[status];
}

export function stockStatusTone(status: StockStatus): MovementBadgeTone {
  const tones: Record<StockStatus, MovementBadgeTone> = {
    ok: "green",
    low_stock: "amber",
    out_of_stock: "gray",
    negative: "red",
    review_required: "red",
  };
  return tones[status];
}

export const UNITS = ["PCS", "SET", "BOX", "PACK", "MTR", "ROLL", "KG", "LTR", "DRUM", "BAG", "PAIR", "NOS"] as const;

export const MATERIAL_CATEGORIES = [
  "Mechanical Materials",
  "Electrical Materials",
  "Plumbing Materials",
  "AC Materials",
  "Lubricants / Oils",
  "Hardware / Fasteners",
  "Tools / Consumables",
  "Safety Materials",
  "General Materials",
  "Other",
] as const;

export const OTHER_CATEGORY = "Other";

// Add New Material Category Flexibility Cleanup: the sentinel <select> value
// that means "user wants to type a brand-new category name" — never saved to
// the database itself, only ever resolved server-side into a real category
// string before the record is created.
export const ADD_NEW_CATEGORY_VALUE = "__add_new_category__";

const CATEGORY_LOOKUP = new Map(MATERIAL_CATEGORIES.map((c) => [c.toLowerCase(), c]));

// Maps a raw category string (from a form field or an Excel cell) to one of the
// known categories, case-insensitively, preserving its canonical spelling.
// Blank values fall back to "Other" — no material is ever blocked for missing
// category. Add New Material Category Flexibility Cleanup: a non-blank value
// that isn't one of the known categories is no longer forced to "Other" —
// it's returned as-is (trimmed), since it may be a legitimate custom category
// a user just added. This never loses information (previously such values were
// silently discarded into "Other"); it only affects categories outside the
// original fixed list, so every existing recognized category still normalizes
// exactly as before.
export function normalizeCategory(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return OTHER_CATEGORY;
  return CATEGORY_LOOKUP.get(trimmed.toLowerCase()) ?? trimmed;
}

export const inputCls =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";

export const labelCls = "block text-xs font-bold text-[#4B5563] mb-1";

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

// Shared movement-type display logic — used by the Movement History page and
// the per-material detail modal, so both read the ledger the same way.
// Imports use the same OPENING_STOCK movement type as manual entries (no
// separate DB status), distinguished only by their `OPENING-IMPORT-...`
// batch reference.
export type MovementBadgeTone = "green" | "amber" | "red" | "blue" | "gray";

const IMPORT_REFERENCE_PREFIX = "OPENING-IMPORT-";

export function isImportedOpeningStock(movementType: string, referenceNumber: string | null | undefined): boolean {
  return movementType === "OPENING_STOCK" && !!referenceNumber?.startsWith(IMPORT_REFERENCE_PREFIX);
}

export function movementTypeLabel(movementType: string, referenceNumber: string | null | undefined): string {
  // Simple Wording Cleanup: "Initial Stock" is display wording only — the
  // underlying movement_type value is still literally "OPENING_STOCK".
  if (isImportedOpeningStock(movementType, referenceNumber)) return "Imported Initial Stock";
  const labels: Record<string, string> = {
    OPENING_STOCK: "Initial Stock",
    RECEIVED: "Received",
    ISSUED: "Issued",
    RETURNED: "Returned",
    ADJUSTMENT: "Adjustment",
  };
  return labels[movementType] ?? movementType;
}

export function movementTypeTone(movementType: string): MovementBadgeTone {
  const tones: Record<string, MovementBadgeTone> = {
    OPENING_STOCK: "blue",
    RECEIVED: "green",
    ISSUED: "red",
    RETURNED: "blue",
    ADJUSTMENT: "amber",
  };
  return tones[movementType] ?? "gray";
}
