import "server-only";

import { z } from "zod";

import { parseKuwaitInputValue } from "@/lib/format/kuwait-time";
import { checkJobCardDateRange, isIsoDate, toIsoDateOnly } from "@/lib/work-orders/job-card-edit";
import {
  getMaterialUnitSetupByKey,
  getOfflineInventoryMaterialByKey,
  resolveMaterialMatchByKey,
} from "@/lib/store/offline-inventory-data";

// Job Card form parsing shared by the New Job Card create service
// (lib/backend/work-orders/job-card-creation.ts) and the Job Card edit
// action (upsertWorkOrderAction in app/actions/maintenance.ts). Moved here
// unchanged from that "use server" file so the create service can use it
// without these helpers becoming client-callable Server Actions.

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().optional());

const optionalUuid = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim().length ? value : undefined;
}, z.string().uuid().optional());

const optionalNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  return Number(value);
}, z.number().finite().nonnegative().optional());

const optionalDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}, z.date().optional());

// Final Integration Review: the typed Starting / Ending date-time fields are
// "YYYY-MM-DDTHH:mm" Kuwait wall-clock values from <input type=datetime-local>.
// They are parsed explicitly as Asia/Kuwait; previously new Date(value) read
// them in the server's own time zone, and because the edit form pre-filled
// the UTC wall-clock time, every save of an old Job Card moved them by the
// server's UTC offset. A full ISO string (with Z / offset) is still accepted.
const optionalKuwaitDateTime = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const kuwait = parseKuwaitInputValue(value);
  if (kuwait) return kuwait;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}, z.date().optional());

const requiredDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}, z.date());

// Job Card Start / End Date: YYYY-MM-DD from <input type="date">, stored as a
// plain @db.Date (UTC midnight) — no Kuwait shift, a calendar day has no time.
// Blank → not entered; anything else that is not a real date fails here.
const optionalJobCardDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim();
  return isIsoDate(v) ? new Date(`${v}T00:00:00.000Z`) : v;
}, z.date().optional());

export const workOrderSchema = z.object({
  id: optionalUuid,
  ordered_by: z.string().trim().min(2).max(160),
  requested_by_department_id: optionalUuid,
  asset_id: optionalUuid,
  asset_category: optionalString,
  serial_number: optionalString,
  plate_number: optionalString,
  date_of_order: requiredDate,
  job_card_start_date: optionalJobCardDate,
  job_card_end_date: optionalJobCardDate,
  job_location: optionalString,
  starting_datetime: optionalKuwaitDateTime,
  ending_datetime: optionalKuwaitDateTime,
  maintenance_type: z.string().trim().min(2),
  worker_type: z.string().trim().min(2),
  running_hours: optionalNumber,
  kilometers: optionalNumber,
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 1/14:
  // optional, >= 0 (optionalNumber already enforces .nonnegative()), never
  // required — an old Job Card or one Data Entry leaves blank saves and
  // continues working exactly as before.
  estimated_labor_hours: optionalNumber,
  operator_complaint: optionalString,
  description_of_work: optionalString,
  priority: z.string().trim().min(2),
  assigned_supervisor_id: optionalUuid,
  operator_requester_confirmation: optionalString,
  supervisor_verification: optionalString,
  maintenance_manager_closure: optionalString,
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString
}).superRefine((values, ctx) => {
  // Same rule as the wizard and the work_orders_job_card_dates_check constraint.
  const problem = checkJobCardDateRange(toIsoDateOnly(values.job_card_start_date), toIsoDateOnly(values.job_card_end_date));
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.field], message: problem.message });
});

function rowValue(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseLaborRows(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((index) => {
      const labor_name = rowValue(formData, "labor_name", index);
      if (!labor_name) return null;
      return {
        labor_name,
        employee_number: rowValue(formData, "labor_employee_number", index) || null,
        hours: numberValue(rowValue(formData, "labor_hours", index)),
        rate: numberValue(rowValue(formData, "labor_rate", index))
      };
    })
    .filter(Boolean);
}

export function parseMaterialRows(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((index) => {
      const material_name = rowValue(formData, "material_name", index);
      if (!material_name) return null;
      return {
        material_name,
        part_number: rowValue(formData, "material_part_number", index) || null,
        ss_rec_code: rowValue(formData, "material_ss_rec_code", index) || null,
        quantity: numberValue(rowValue(formData, "material_quantity", index)),
        unit_price: numberValue(rowValue(formData, "material_unit_price", index))
      };
    })
    .filter(Boolean);
}

// Required Materials Inventory Matching Unit 5, Task 6: re-verifies each
// row's client-side Offline Inventory match at save time instead of trusting
// it blindly — the balance may have moved since the wizard fetched it, or
// (rarely) the match may no longer exist. Only rows the user actually
// selected from the autocomplete dropdown carry a `req_part_material_key_i`
// value; a row with no key (hand-typed, never matched, or edited after
// matching — the wizard clears the key on every name edit) is saved as plain
// manual text with availability_status "unchecked" ("New Material") and is
// never independently re-searched by name here, so this can never silently
// re-link a row to a different material than the one the user picked.
//
// New Job Card Required Materials Inventory Selection and Smart Unit UX:
// the New Job Card wizard posts req_parts_inventory_first=1. Its rows must
// be selected from Inventory (an unlinked row is refused), and are saved
// from the Inventory record itself — the material's own name, part number
// and Stock Unit, with quantity_required converted to stock units when the
// row was planned in the material's Purchase Unit — so material issue and
// closure tracking keep matching the Inventory identity. The quantity and
// unit as entered, plus the unit setup used, are kept as a snapshot. The
// older Job Card edit form does not post the marker and is parsed exactly
// as before. Nothing here writes an inventory movement or a material.
export type ParsedRequiredPartRow = {
  description: string;
  part_number: string | null;
  quantity_required: number;
  unit_of_measure: string;
  notes: string | null;
  availability_status: string;
  part_id: string | null;
  inventory_material_key?: string | null;
  ss_rec_code?: string | null;
  entered_quantity?: number | null;
  entered_unit?: string | null;
  purchase_unit?: string | null;
  conversion_quantity?: number | null;
};

export class RequiredPartRowError extends Error {}

async function parseInventoryFirstRequiredPartRow(formData: FormData, index: number): Promise<ParsedRequiredPartRow | null> {
  const typedName = rowValue(formData, "req_part_description", index);
  if (!typedName) return null;
  const matchedKey = rowValue(formData, "req_part_material_key", index) || null;
  const material = matchedKey ? await getOfflineInventoryMaterialByKey(matchedKey) : null;
  if (!material) {
    throw new RequiredPartRowError(
      `"${typedName}" is not in Inventory. Add this material in Inventory first, then select it in Required Materials.`
    );
  }
  const setup = await getMaterialUnitSetupByKey(material.key);
  const enteredQty = numberValue(rowValue(formData, "req_part_quantity", index));
  const enteredUnit = rowValue(formData, "req_part_entered_unit", index) || material.unit;
  const isPurchaseUnit =
    setup.purchase_unit !== null &&
    setup.conversion_quantity !== null &&
    enteredUnit.toLowerCase() === setup.purchase_unit.toLowerCase() &&
    enteredUnit.toLowerCase() !== material.unit.toLowerCase();
  if (!isPurchaseUnit && enteredUnit.toLowerCase() !== material.unit.toLowerCase()) {
    throw new RequiredPartRowError(`Choose ${material.unit}${setup.purchase_unit ? ` or ${setup.purchase_unit}` : ""} for "${material.display_name}".`);
  }
  const stockQty = Math.round(enteredQty * (isPurchaseUnit ? setup.conversion_quantity! : 1) * 1e6) / 1e6;

  const resolution = await resolveMaterialMatchByKey(material.key);
  let availability_status = "unchecked";
  if (resolution.matched) {
    if (resolution.balance <= 0) availability_status = "unavailable";
    else if (stockQty <= resolution.balance) availability_status = "available";
    else availability_status = "partial";
  }

  return {
    description: material.display_name,
    part_number: material.manual_part_number ?? (rowValue(formData, "req_part_part_number", index) || null),
    quantity_required: stockQty,
    unit_of_measure: material.unit,
    notes: rowValue(formData, "req_part_notes", index) || null,
    availability_status,
    part_id: material.part_id,
    inventory_material_key: material.key,
    ss_rec_code: material.ss_rec_code,
    entered_quantity: enteredQty,
    entered_unit: isPurchaseUnit ? setup.purchase_unit : material.unit,
    purchase_unit: setup.purchase_unit,
    conversion_quantity: setup.conversion_quantity,
  };
}

export async function parseRequiredPartRows(formData: FormData): Promise<ParsedRequiredPartRow[]> {
  if (formData.get("req_parts_inventory_first") === "1") {
    const rows = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((index) => parseInventoryFirstRequiredPartRow(formData, index)));
    return rows.filter((row): row is ParsedRequiredPartRow => row !== null);
  }
  const rows = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7].map(async (index) => {
      const description = rowValue(formData, "req_part_description", index);
      if (!description) return null;
      const qty = numberValue(rowValue(formData, "req_part_quantity", index));
      const unit = rowValue(formData, "req_part_uom", index) || "PCS";
      const matchedKey = rowValue(formData, "req_part_material_key", index) || null;

      let availability_status = "unchecked";
      let part_id: string | null = null;
      if (matchedKey) {
        const resolution = await resolveMaterialMatchByKey(matchedKey);
        if (resolution.matched) {
          part_id = resolution.part_id;
          if (resolution.balance <= 0) availability_status = "unavailable";
          else if (qty <= resolution.balance) availability_status = "available";
          else availability_status = "partial";
        }
      }

      return {
        description,
        part_number: rowValue(formData, "req_part_part_number", index) || null,
        quantity_required: qty,
        unit_of_measure: unit,
        notes: rowValue(formData, "req_part_notes", index) || null,
        availability_status,
        part_id
      };
    })
  );
  return rows.filter((row): row is ParsedRequiredPartRow => row !== null);
}

// Optional Work Assignment During Job Card Creation Unit 7C, Task 2/6.
// Returns null when "Assign work now" was off, or when the selected type's
// required field was left blank (nothing to save) — the caller treats null
// as "no assignment to create", the same as if the checkbox were never shown.
export type WizardAssignment =
  | {
      kind: "INTERNAL_TEAM";
      supervisorId?: string;
      technicianIds: string[];
      helperIds: string[];
      notes?: string;
      // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task
      // 2/4: keyed by worker_profiles.id, same convention
      // internalTeamRosterSchema.estimatedHoursByWorkerId uses.
      estimatedHoursByWorkerId: Record<string, number>;
    }
  | { kind: "FREELANCER"; name: string; phone?: string; trade?: string; amount?: number; notes?: string }
  | { kind: "EXTERNAL_COMPANY"; company: string; contact?: string; phone?: string; trade?: string; amount?: number; notes?: string };

// Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 2: the
// wizard encodes the per-worker estimate map as one JSON hidden field
// (`assign_worker_estimates`) rather than one input per worker id, since
// worker ids aren't known ahead of render — simplest reliable way to carry
// an arbitrary { workerId: hours } map through a plain FormData submission.
// Malformed/missing JSON degrades to "no estimates" rather than failing the
// whole Job Card save.
function parseWorkerEstimates(formData: FormData): Record<string, number> {
  const raw = String(formData.get("assign_worker_estimates") ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

// Job Card Estimated Hours UX Simplification Unit 10G.22, Task 4: the Job
// Card-level estimated_labor_hours total, wherever it's saved from the
// wizard, is always this sum — never a separately-typed value. Returns
// undefined (not 0) when nothing was entered, matching optionalNumber's own
// "blank stays blank" convention elsewhere in this schema.
export function sumWorkerEstimates(estimatesByWorkerId: Record<string, number>): number | undefined {
  const entered = Object.values(estimatesByWorkerId);
  if (entered.length === 0) return undefined;
  return Math.round(entered.reduce((sum, h) => sum + h, 0) * 100) / 100;
}

export function parseWizardAssignment(formData: FormData): WizardAssignment | null {
  if (String(formData.get("assign_now") ?? "") !== "on") return null;
  const notes = String(formData.get("assign_notes") ?? "").trim() || undefined;
  const type = String(formData.get("assignment_type") ?? "INTERNAL_TEAM");

  if (type === "INTERNAL_TEAM") {
    const supervisorId = String(formData.get("assign_supervisor_id") ?? "").trim() || undefined;
    const technicianIds = formData.getAll("assign_technician_ids").map(String).filter(Boolean);
    const helperIds = formData.getAll("assign_helper_ids").map(String).filter(Boolean);
    if (!supervisorId && technicianIds.length === 0 && helperIds.length === 0) return null;
    return { kind: "INTERNAL_TEAM", supervisorId, technicianIds, helperIds, notes, estimatedHoursByWorkerId: parseWorkerEstimates(formData) };
  }

  if (type === "FREELANCER") {
    const name = String(formData.get("assign_freelancer_name") ?? "").trim();
    if (!name) return null;
    const amountRaw = String(formData.get("assign_freelancer_amount") ?? "").trim();
    return {
      kind: "FREELANCER",
      name,
      phone: String(formData.get("assign_freelancer_phone") ?? "").trim() || undefined,
      trade: String(formData.get("assign_freelancer_trade") ?? "").trim() || undefined,
      amount: amountRaw ? Number(amountRaw) : undefined,
      notes,
    };
  }

  // EXTERNAL_COMPANY
  const company = String(formData.get("assign_company_name") ?? "").trim();
  if (!company) return null;
  const amountRaw = String(formData.get("assign_company_amount") ?? "").trim();
  return {
    kind: "EXTERNAL_COMPANY",
    company,
    contact: String(formData.get("assign_company_contact") ?? "").trim() || undefined,
    phone: String(formData.get("assign_company_phone") ?? "").trim() || undefined,
    trade: String(formData.get("assign_company_trade") ?? "").trim() || undefined,
    amount: amountRaw ? Number(amountRaw) : undefined,
    notes,
  };
}

export function parseAttachmentRows(formData: FormData) {
  return [0, 1]
    .map((index) => {
      const file_name = rowValue(formData, "attachment_file_name", index);
      const file_path = rowValue(formData, "attachment_file_path", index);
      if (!file_name || !file_path) return null;
      return {
        attachment_type: rowValue(formData, "attachment_type", index) || "Photo",
        file_name,
        file_path
      };
    })
    .filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cleanPayload<T extends Record<string, unknown>>(input: T): any {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined ? null : value]));
}
