// Edit Material — pure rules (no "server-only", no database), shared by the
// service, the form and the unit tests.
//
// Name and Unit are a material's identity: movements, Job Card lines and
// requests match on them as text, and Unit gives every recorded quantity its
// meaning. They can change only while nothing depends on them. Everything
// else is master data held on the settings row and is always editable.

import { MATERIAL_DESCRIPTION_MAX_LENGTH, ITEM_CODE_MAX_LENGTH, importUnitProblem, normalizeDescription, normalizeImportUnit, normalizeItemCode } from "@/lib/store/material-master-import";
import { normalizeCategory } from "@/components/store/offline-inventory-types";

export const MATERIAL_TEXT_MAX_LENGTH = 120;
export const MATERIAL_NOTES_MAX_LENGTH = 1000;

// Quantities are strings exactly as the form holds them; "" = not set.
export type MaterialEditValues = {
  name: string;
  unit: string;
  itemCode: string;
  category: string;
  partNumber: string;
  ssRecCode: string;
  location: string;
  notes: string;
  minimumStock: string;
  reorderQuantity: string;
};

export const MATERIAL_EDIT_LABELS: Record<keyof MaterialEditValues, string> = {
  name: "Material Name / Description",
  unit: "Unit",
  itemCode: "Item Code",
  category: "Category",
  partNumber: "Part Number",
  ssRecCode: "SS Rec. Code",
  location: "Location / Bin",
  notes: "Material Notes",
  minimumStock: "Minimum Stock Level",
  reorderQuantity: "Reorder Quantity",
};

export type MaterialEditFieldErrors = Partial<Record<keyof MaterialEditValues, string[]>>;

function quantityText(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const n = Number(text);
  return Number.isFinite(n) ? String(n) : text;
}

export function normalizeMaterialEdit(input: MaterialEditValues): MaterialEditValues {
  return {
    name: normalizeDescription(input.name),
    unit: normalizeImportUnit(input.unit),
    itemCode: normalizeItemCode(input.itemCode),
    category: input.category.trim() ? normalizeCategory(input.category) : "",
    partNumber: input.partNumber.trim(),
    ssRecCode: input.ssRecCode.trim(),
    location: input.location.trim(),
    notes: input.notes.trim(),
    minimumStock: quantityText(input.minimumStock),
    reorderQuantity: quantityText(input.reorderQuantity),
  };
}

// Field-level problems in already normalized values; {} when all are fine.
export function validateMaterialEdit(v: MaterialEditValues): MaterialEditFieldErrors {
  const errors: MaterialEditFieldErrors = {};
  const add = (field: keyof MaterialEditValues, message: string) => {
    errors[field] = [message];
  };
  if (!v.name) add("name", "Material name is required.");
  else if (v.name.length > MATERIAL_DESCRIPTION_MAX_LENGTH) add("name", `Use at most ${MATERIAL_DESCRIPTION_MAX_LENGTH} characters.`);

  if (!v.unit) add("unit", "Unit is required.");
  else {
    const problem = importUnitProblem(v.unit);
    if (problem) add("unit", problem);
  }

  if (v.itemCode.length > ITEM_CODE_MAX_LENGTH) add("itemCode", `Use at most ${ITEM_CODE_MAX_LENGTH} characters.`);
  if (!v.category) add("category", "Category is required.");
  for (const field of ["category", "partNumber", "ssRecCode", "location"] as const) {
    if (v[field].length > MATERIAL_TEXT_MAX_LENGTH) add(field, `Use at most ${MATERIAL_TEXT_MAX_LENGTH} characters.`);
  }
  if (v.notes.length > MATERIAL_NOTES_MAX_LENGTH) add("notes", `Use at most ${MATERIAL_NOTES_MAX_LENGTH} characters.`);

  if (v.minimumStock && !(Number(v.minimumStock) >= 0)) add("minimumStock", "Enter 0 or greater.");
  if (v.reorderQuantity && !(Number(v.reorderQuantity) > 0)) add("reorderQuantity", "Enter a number greater than 0.");
  return errors;
}

export function changedMaterialFields(before: MaterialEditValues, after: MaterialEditValues): (keyof MaterialEditValues)[] {
  return (Object.keys(MATERIAL_EDIT_LABELS) as (keyof MaterialEditValues)[]).filter((field) => before[field] !== after[field]);
}

// The token a save must present: the values the form was opened with. Any
// change by someone else makes it stale, whether or not the material has a
// settings row yet.
export function materialEditVersion(values: MaterialEditValues): string {
  return JSON.stringify((Object.keys(MATERIAL_EDIT_LABELS) as (keyof MaterialEditValues)[]).map((field) => values[field]));
}

export type MaterialIdentityFacts = {
  isCatalogPart: boolean;
  balance: number;
  stockMovementCount: number;
  linkedMovementCount: number;
  referenceCount: number;
  hasUnitSetup: boolean;
};

// Why Name / Unit cannot change, or null when they can.
export function identityLockReason(facts: MaterialIdentityFacts): string | null {
  if (facts.isCatalogPart) return "This material comes from the parts catalog, so its name and unit cannot be changed here.";
  if (facts.balance !== 0 || facts.stockMovementCount > 0 || facts.linkedMovementCount > 0) {
    return "This material has stock movements, so its name and unit are locked to keep its history and balance correct.";
  }
  if (facts.referenceCount > 0) {
    return "This material is used on a Job Card or Materials Request, so its name and unit are locked to keep those records correct.";
  }
  return null;
}

// Why Unit alone cannot change, or null. A purchase-unit conversion is stated
// in the stock unit, so changing the unit would silently reinterpret it.
export function unitLockReason(facts: MaterialIdentityFacts): string | null {
  const identity = identityLockReason(facts);
  if (identity) return identity;
  return facts.hasUnitSetup ? "This material has a purchase unit setup based on its current unit. Remove that setup first, then change the unit." : null;
}
