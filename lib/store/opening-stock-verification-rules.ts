// Needs Verification — pure rules (no database, no "server-only"), shared by
// the verification service, the page and the unit tests.
//
// A held Opening Stock row keeps its original Excel values untouched; staff
// corrections are stored beside them. These helpers decide what the row
// "is" now (original + corrections), what status it is in, and how to
// explain its problem in plain language.

import {
  OPENING_STOCK_NAME_MAX_LENGTH,
  OPENING_STOCK_QUANTITY_MAX,
  OPENING_STOCK_TEXT_MAX_LENGTH,
  identityName,
  type ClassifiedOpeningStockRow,
  type OpeningStockSourceRow,
} from "@/lib/store/opening-stock-matching";

// ── Corrections ─────────────────────────────────────────────────────────────

export type CorrectionValues = {
  materialName: string | null;
  partNumber: string | null;
  category: string | null;
  unit: string | null;
  quantity: number | null;
  remarks: string | null;
};

export const NO_CORRECTION: CorrectionValues = { materialName: null, partNumber: null, category: null, unit: null, quantity: null, remarks: null };

// The row as the importer should see it now: each corrected value replaces
// the original one; everything else stays as supplied.
export function effectiveSourceRow(source: OpeningStockSourceRow, c: CorrectionValues): OpeningStockSourceRow {
  return {
    ...source,
    materialName: c.materialName ?? source.materialName,
    partNumber: c.partNumber ?? source.partNumber,
    category: c.category ?? source.category,
    unit: c.unit ?? source.unit,
    quantityText: c.quantity !== null ? String(c.quantity) : source.quantityText,
  };
}

// Keeps only the values that really differ from the original (case and
// spacing aside for text), so "corrected" always means changed.
export function normalizeCorrection(source: OpeningStockSourceRow, input: CorrectionValues): CorrectionValues {
  const text = (v: string | null, original: string, max: number) => {
    if (v === null) return null;
    const t = identityName(v).slice(0, max);
    return t.toUpperCase() === identityName(original).toUpperCase() ? null : t;
  };
  const originalQty = Number(source.quantityText);
  return {
    materialName: text(input.materialName, source.materialName, OPENING_STOCK_NAME_MAX_LENGTH),
    partNumber: text(input.partNumber, source.partNumber, OPENING_STOCK_TEXT_MAX_LENGTH),
    category: text(input.category, source.category, OPENING_STOCK_TEXT_MAX_LENGTH),
    unit: input.unit === null || input.unit.trim().toUpperCase() === source.unit.trim().toUpperCase() ? null : input.unit.trim(),
    quantity: input.quantity === null || input.quantity === originalQty ? null : input.quantity,
    remarks: input.remarks?.trim() ? input.remarks.trim().slice(0, 1000) : null,
  };
}

export function hasCorrection(c: CorrectionValues): boolean {
  return c.materialName !== null || c.partNumber !== null || c.category !== null || c.unit !== null || c.quantity !== null;
}

export type CorrectionFieldErrors = Partial<Record<"materialName" | "unit" | "quantity" | "reason" | "partNumber" | "category", string>>;

export function validateCorrection(input: CorrectionValues, reason: string, submitting: boolean, source: OpeningStockSourceRow): CorrectionFieldErrors {
  const errors: CorrectionFieldErrors = {};
  if (input.materialName !== null) {
    const name = identityName(input.materialName);
    if (name.length < 2) errors.materialName = "Enter the material name (at least 2 characters).";
    else if (name.length > OPENING_STOCK_NAME_MAX_LENGTH) errors.materialName = `Material name can be at most ${OPENING_STOCK_NAME_MAX_LENGTH} characters.`;
    else if (name.includes("|")) errors.materialName = 'Material name cannot contain "|".';
  }
  if (input.partNumber !== null && input.partNumber.length > OPENING_STOCK_TEXT_MAX_LENGTH) errors.partNumber = "Part number is too long.";
  if (input.category !== null && input.category.length > OPENING_STOCK_TEXT_MAX_LENGTH) errors.category = "Category is too long.";
  if (input.unit !== null) {
    const u = input.unit.trim();
    if (!u || u.length > 32 || /[|<>]/.test(u) || !/[\p{L}\p{N}]/u.test(u)) errors.unit = "Enter a valid unit, for example PCS, SET or MTR.";
  }
  if (input.quantity !== null && !(Number.isInteger(input.quantity) && input.quantity > 0 && input.quantity <= OPENING_STOCK_QUANTITY_MAX)) {
    errors.quantity = "Quantity must be a whole number greater than 0.";
  }
  // A changed value always needs a reason before it goes to the Manager.
  if (submitting && hasCorrection(normalizeCorrection(source, input)) && reason.trim().length < 5) {
    errors.reason = "Explain why the details were changed (at least 5 characters).";
  }
  return errors;
}

// ── Status ─────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | "needs_verification"
  | "correction_in_progress"
  | "waiting_for_manager"
  | "returned"
  | "completed"
  | "excluded";

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  needs_verification: "Needs Verification",
  correction_in_progress: "Correction in Progress",
  waiting_for_manager: "Waiting for Manager",
  returned: "Returned for Correction",
  completed: "Completed",
  excluded: "Excluded",
};

export const PENDING_STATUSES: readonly VerificationStatus[] = ["needs_verification", "correction_in_progress", "waiting_for_manager", "returned"];

export function deriveVerificationStatus(outcome: string, verificationStatus: string | null): VerificationStatus {
  if (outcome === "posted_existing" || outcome === "registered_new") return "completed";
  if (outcome === "excluded" || outcome === "not_imported") return "excluded";
  if (verificationStatus === "draft") return "correction_in_progress";
  if (verificationStatus === "submitted") return "waiting_for_manager";
  if (verificationStatus === "returned") return "returned";
  return "needs_verification";
}

// ── Plain-language issue ────────────────────────────────────────────────────

export type VerificationIssueCode = "unit_mismatch" | "same_part_reference" | "multiple_matches" | "details_need_checking" | "possible_existing" | "ready";

export type VerificationIssue = { code: VerificationIssueCode; label: string; explanation: string; action: string };

export function verificationIssue(row: ClassifiedOpeningStockRow): VerificationIssue {
  const top = row.candidates[0] ?? null;
  if (row.classification === "existing" || row.classification === "new") {
    return {
      code: "ready",
      label: row.classification === "existing" ? "Ready — matches an existing material" : "Ready — no existing material found",
      explanation:
        row.classification === "existing"
          ? `With the current details this row matches ${top?.itemCode ?? row.match?.itemCode ?? "an existing material"} exactly.`
          : "With the current details nothing in Inventory resembles this material.",
      action: row.classification === "existing" ? "Manager: choose Use Existing to post the stock." : "Manager: choose Register New to create it with a new Item Code.",
    };
  }
  if (top && top.unitCompatibility === "incompatible") {
    return {
      code: "unit_mismatch",
      label: "Unit Mismatch",
      explanation: `The Excel says ${row.unit.trim()}, but MMS has ${top.itemCode ?? top.name} in ${top.unit}. Units are never converted automatically.`,
      action: `Check the real unit. If the Excel unit is wrong, correct the unit here. If MMS is wrong, a System Administrator or Data Entry corrects ${top.itemCode ?? "the material"} with Edit Material (only while it has no stock movements).`,
    };
  }
  if (row.classification === "duplicate_in_file" || row.relatedRows.length > 0) {
    return {
      code: "same_part_reference",
      label: "Same Part Reference",
      explanation: `Row ${row.relatedRows.join(", ")} in the same Excel file has the same ${row.classification === "duplicate_in_file" ? "name" : "part reference"}.`,
      action: "Check whether both rows are the same physical material. If they are, keep one and do not import the other; if not, correct the name or part number so they can be told apart.",
    };
  }
  if (row.candidates.length > 1) {
    return {
      code: "multiple_matches",
      label: "Multiple Matching Materials",
      explanation: `${row.candidates.length} existing materials may match.`,
      action: "Select the correct Item Code, or correct the details if none of them is right.",
    };
  }
  if (top && (top.typeConflict || top.makeConflict || top.specConflict || top.strength === "weak" || (top.strength === "reference" && !top.exactReference))) {
    return {
      code: "details_need_checking",
      label: "Material Details Need Checking",
      explanation: `${top.itemCode ?? top.name} looks related (${top.reasons.join(", ")}), but the name, equipment, specification or part reference does not fully agree.`,
      action: "Check the part number and description. Select the existing material if it is the same item, or correct the details if they are wrong.",
    };
  }
  return {
    code: "possible_existing",
    label: "Possible Existing Material",
    explanation: top ? `A similar material already exists in MMS: ${top.itemCode ?? ""} ${top.name}.` : "This row needs checking before posting.",
    action: "Check whether both refer to the same physical item, then select it or correct the details.",
  };
}

// ── Roles (existing MMS role slugs) ─────────────────────────────────────────

export type VerificationRoles = { canView: boolean; canEdit: boolean; canApprove: boolean };

export function verificationRolesFor(roleSlug: string | null | undefined, permissions: readonly string[]): VerificationRoles {
  const slug = roleSlug ?? "";
  const canApprove = slug === "super_admin" || slug === "maintenance_manager";
  const canEdit = canApprove || slug === "maintenance_data_entry";
  return { canView: slug === "super_admin" || permissions.includes("parts.view") || canEdit, canEdit, canApprove };
}
