export type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
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
};

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

const CATEGORY_LOOKUP = new Map(MATERIAL_CATEGORIES.map((c) => [c.toLowerCase(), c]));

// Maps a raw category string (from a form field or an Excel cell) to one of the
// known categories, case-insensitively. Blank or unrecognized values fall back
// to "Other" — no material is ever blocked for missing/unknown category.
export function normalizeCategory(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return OTHER_CATEGORY;
  return CATEGORY_LOOKUP.get(trimmed.toLowerCase()) ?? OTHER_CATEGORY;
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

// Shared movement-type display logic — used by the Movement History page, the
// per-material detail modal, and the Offline Inventory Control Recent
// Movements section, so all three read the ledger the same way. Imports use
// the same OPENING_STOCK movement type as manual entries (no separate DB
// status), distinguished only by their `OPENING-IMPORT-...` batch reference.
export type MovementBadgeTone = "green" | "amber" | "red" | "blue" | "gray";

const IMPORT_REFERENCE_PREFIX = "OPENING-IMPORT-";

export function isImportedOpeningStock(movementType: string, referenceNumber: string | null | undefined): boolean {
  return movementType === "OPENING_STOCK" && !!referenceNumber?.startsWith(IMPORT_REFERENCE_PREFIX);
}

export function movementTypeLabel(movementType: string, referenceNumber: string | null | undefined): string {
  if (isImportedOpeningStock(movementType, referenceNumber)) return "Imported Opening Stock";
  const labels: Record<string, string> = {
    OPENING_STOCK: "Opening Stock",
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
