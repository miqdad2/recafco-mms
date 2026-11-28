// Job Card Required Materials — manual materials and outside services.
//
// Pure rules shared by the New Job Card wizard, Edit Job Card and the server
// (no "server-only": the same checks run in the browser and again on save).
//
// A manual requirement is a description typed on the Job Card — an outside
// repair or service ("Starter Motor Repairing — 1 JOB") or a material that is
// not registered in Inventory — with a quantity and a unit. It is stored with
// entry_type 'manual' and never has an Inventory identity: it is not issued,
// received, requested or stock-checked, and it never creates an Inventory
// material or Item Code.

export const MANUAL_ENTRY_TYPE = "manual";
export const INVENTORY_ENTRY_TYPE = "inventory";
export type RequirementEntryType = typeof MANUAL_ENTRY_TYPE | typeof INVENTORY_ENTRY_TYPE;

// The Inventory unit spellings already used across MMS (UNITS in
// components/store/offline-inventory-types.ts), plus JOB and SERVICE for
// outside work, which Inventory has no unit for. Nothing here changes any
// Inventory material's unit.
export const MANUAL_REQUIREMENT_UNITS = ["JOB", "SERVICE", "PCS", "NOS", "SET", "PAIR", "BOX", "PACK", "LTR", "MTR", "KG", "ROLL", "DRUM", "BAG"] as const;

export const MANUAL_DESCRIPTION_MAX = 200;
export const MANUAL_NOTES_MAX = 500;
export const MANUAL_QUANTITY_MAX = 999_999;

// Status stored in availability_status for a manual row: it is not an
// Inventory item, so it is never "unchecked" (which the Inventory Check gate
// counts) or available / short.
export const MANUAL_AVAILABILITY_STATUS = "not_applicable";

export function isManualEntry(entryType: string | null | undefined): boolean {
  return entryType === MANUAL_ENTRY_TYPE;
}

export function normalizeManualDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeManualUnit(value: string): string {
  return value.trim().toUpperCase();
}

export function isManualUnit(unit: string): boolean {
  return (MANUAL_REQUIREMENT_UNITS as readonly string[]).includes(normalizeManualUnit(unit));
}

// A positive number with at most 2 decimal places (the column is
// numeric(12,2)): 1, 2.5 and 0.75 are fine; 0, -1, 1.234 and "1e3" are not.
export function parseManualQuantity(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= MANUAL_QUANTITY_MAX ? n : null;
}

export type ManualRequirementInput = { description: string; quantity: string; unit: string; notes: string };

// ── Edit Job Card: what a posted manual list changes ────────────────────────

export type ManualLine = { description: string; quantity_required: number; unit_of_measure: string; notes: string | null };

function sameLine(a: ManualLine, b: ManualLine): boolean {
  return (
    a.description === b.description &&
    Math.abs(a.quantity_required - b.quantity_required) < 1e-9 &&
    a.unit_of_measure === b.unit_of_measure &&
    (a.notes ?? null) === (b.notes ?? null)
  );
}

export type ManualEditPlan<T extends { id: string }> = {
  // Posted ids that are not manual lines of this Job Card (stale page or a
  // tampered form): the save is refused.
  unknownIds: string[];
  add: ManualLine[];
  update: Array<{ id: string; line: ManualLine; before: T }>;
  remove: T[];
  changed: boolean;
};

// The posted list is the whole desired state. A posted line with an id
// updates that line (only when something differs); a line without an id is
// new — unless an existing line nobody posted has exactly the same content,
// which it then simply keeps (so a repeated save of the same form never adds
// a second copy); existing lines that were not posted are removed.
export function planManualRequirementEdits<T extends ManualLine & { id: string }>(
  existing: T[],
  posted: Array<ManualLine & { id: string | null }>
): ManualEditPlan<T> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const referenced = new Set(posted.map((p) => p.id).filter((id): id is string => id !== null));
  const unknownIds = [...referenced].filter((id) => !byId.has(id));
  const unreferenced = existing.filter((e) => !referenced.has(e.id));
  const kept = new Set<string>();
  const add: ManualLine[] = [];
  const update: ManualEditPlan<T>["update"] = [];
  for (const p of posted) {
    const line: ManualLine = { description: p.description, quantity_required: p.quantity_required, unit_of_measure: p.unit_of_measure, notes: p.notes ?? null };
    if (p.id) {
      const before = byId.get(p.id);
      if (before && !sameLine(before, line)) update.push({ id: p.id, line, before });
      continue;
    }
    const twin = unreferenced.find((e) => !kept.has(e.id) && sameLine(e, line));
    if (twin) kept.add(twin.id);
    else add.push(line);
  }
  const remove = unreferenced.filter((e) => !kept.has(e.id));
  return { unknownIds, add, update, remove, changed: add.length + update.length + remove.length > 0 };
}

// The problem with a typed manual line, in plain words, or null when it can be
// saved.
export function manualRequirementProblem(input: ManualRequirementInput): string | null {
  const description = normalizeManualDescription(input.description);
  if (!description) return "Type the material, repair or service needed.";
  if (description.length > MANUAL_DESCRIPTION_MAX) return `Keep the description under ${MANUAL_DESCRIPTION_MAX} characters.`;
  if (!input.quantity.trim()) return `Enter the quantity needed for "${description}".`;
  if (parseManualQuantity(input.quantity) === null) {
    return `Please check the quantity for "${description}". Use a number greater than 0 — for example 1, 2 or 1.5.`;
  }
  if (!input.unit.trim()) return `Choose the unit for "${description}" — for example JOB, SERVICE or PCS.`;
  if (!isManualUnit(input.unit)) return `Choose one of the listed units for "${description}".`;
  if (input.notes.trim().length > MANUAL_NOTES_MAX) return `Keep the notes for "${description}" under ${MANUAL_NOTES_MAX} characters.`;
  return null;
}
