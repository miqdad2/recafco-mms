"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import {
  confirmMaterialMasterImport,
  executeMaterialRemoval,
  getMaterialForEdit,
  previewMaterialMasterImport,
  previewMaterialRemoval,
  restoreArchivedMaterial,
  saveMaterialEdit,
  setMaterialItemCode,
  type MaterialEditData,
  type MaterialEditResult,
  type MaterialImportOptions,
  type MaterialImportPreview,
  type MaterialImportResult,
  type MaterialRemovalPreview,
  type MaterialRemovalResult,
} from "@/lib/backend/store/material-master";

// Super Admin Inventory Control actions: Material Master Excel import,
// Item Code edit, individual/bulk delete-or-archive, restore. Each action
// authenticates here and the service re-checks Super Admin itself, so a
// direct call from any other role is refused.

type Result<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type Context = Awaited<ReturnType<typeof requireUser>>;

async function run<T>(source: string, operation: (context: Context) => Promise<T>): Promise<Result<T>> {
  const context = await requireUser();
  try {
    return { ok: true, data: await operation(context) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.safeMessage, fieldErrors: error.fieldErrors };
    await logSystemError(errorToLogInput(error, source, context.userId));
    return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
  }
}

function revalidateInventory() {
  revalidatePath("/store/offline-inventory");
  revalidatePath("/store/offline-inventory/movements");
  revalidatePath("/store/offline-inventory/archived");
  revalidatePath("/store/offline-inventory/import-materials");
}

const columnSchema = z.number().int().min(1).max(50).nullable();
const mappingSchema = z.object({
  serial: columnSchema,
  itemCode: columnSchema,
  description: columnSchema,
  unit: columnSchema,
  category: columnSchema,
  partNumber: columnSchema,
  ssRecCode: columnSchema,
  location: columnSchema,
  minimumStock: columnSchema,
  reorderQuantity: columnSchema,
  notes: columnSchema,
});

const categoryResolutionsSchema = z.record(
  z.string(),
  z.union([z.object({ action: z.literal("create") }), z.object({ action: z.literal("map"), category: z.string().min(1).max(120) })])
);

function readImportOptions(formData: FormData): MaterialImportOptions {
  const sheetName = String(formData.get("sheet_name") ?? "").trim() || null;
  const header = String(formData.get("header_row") ?? "auto");
  const mappingRaw = String(formData.get("mapping") ?? "").trim();
  let mapping: MaterialImportOptions["mapping"] = null;
  if (mappingRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingRaw);
    } catch {
      throw new AppError("Column mapping is not valid.", { code: "VALIDATION_ERROR" });
    }
    const result = mappingSchema.safeParse(parsed);
    if (!result.success) throw new AppError("Column mapping is not valid.", { code: "VALIDATION_ERROR" });
    mapping = result.data;
  }
  let categoryResolutions: MaterialImportOptions["categoryResolutions"] = {};
  const resolutionsRaw = String(formData.get("category_resolutions") ?? "").trim();
  if (resolutionsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(resolutionsRaw);
    } catch {
      throw new AppError("Category choices are not valid.", { code: "VALIDATION_ERROR" });
    }
    const result = categoryResolutionsSchema.safeParse(parsed);
    if (!result.success) throw new AppError("Category choices are not valid.", { code: "VALIDATION_ERROR" });
    categoryResolutions = result.data;
  }
  return {
    sheetName,
    hasHeaderRow: header === "yes" ? true : header === "no" ? false : null,
    mapping,
    mappingConfirmed: formData.get("mapping_confirmed") === "1",
    categoryResolutions,
  };
}

export async function previewMaterialImportAction(formData: FormData): Promise<Result<MaterialImportPreview>> {
  return run("material_master.import_preview", async (context) => {
    return previewMaterialMasterImport(context, formData.get("file"), readImportOptions(formData));
  });
}

export async function confirmMaterialImportAction(formData: FormData): Promise<Result<MaterialImportResult>> {
  const result = await run("material_master.import_confirm", async (context) => {
    let confirmedRows: unknown;
    try {
      confirmedRows = JSON.parse(String(formData.get("confirmed_rows") ?? "[]"));
    } catch {
      confirmedRows = null;
    }
    const rowsParsed = z.array(z.number().int().positive()).max(5000).safeParse(confirmedRows);
    if (!rowsParsed.success) throw new AppError("Confirmed rows are not valid. Preview the file again.", { code: "VALIDATION_ERROR" });
    return confirmMaterialMasterImport(
      context,
      formData.get("file"),
      readImportOptions(formData),
      rowsParsed.data,
      String(formData.get("client_submission_id") ?? "")
    );
  });
  if (result.ok) revalidateInventory();
  return result;
}

export async function setMaterialItemCodeAction(key: string, itemCode: string): Promise<Result<null>> {
  const result = await run("material_master.item_code", async (context) => {
    await setMaterialItemCode(context, String(key ?? ""), String(itemCode ?? ""));
    return null;
  });
  if (result.ok) revalidateInventory();
  return result;
}

export async function previewMaterialRemovalAction(keys: string[]): Promise<Result<MaterialRemovalPreview[]>> {
  return run("material_master.removal_preview", async (context) => {
    return previewMaterialRemoval(context, keys);
  });
}

export async function getMaterialForEditAction(key: string): Promise<Result<MaterialEditData>> {
  return run("material_master.edit_load", (context) => getMaterialForEdit(context, String(key ?? "")));
}

const editSchema = z.object({
  key: z.string().min(1).max(600),
  version: z.string().max(5000),
  values: z.object({
    name: z.string().max(2000),
    unit: z.string().max(2000),
    itemCode: z.string().max(2000),
    category: z.string().max(2000),
    partNumber: z.string().max(2000),
    ssRecCode: z.string().max(2000),
    location: z.string().max(2000),
    notes: z.string().max(5000),
    minimumStock: z.string().max(100),
    reorderQuantity: z.string().max(100),
  }),
});

export async function saveMaterialEditAction(input: unknown): Promise<Result<MaterialEditResult>> {
  const result = await run("material_master.edit_save", async (context) => {
    const parsed = editSchema.safeParse(input);
    if (!parsed.success) throw new AppError("The form could not be read. Close it and try again.", { code: "VALIDATION_ERROR" });
    return saveMaterialEdit(context, parsed.data);
  });
  if (result.ok) revalidateInventory();
  return result;
}

const removalSchema = z.object({
  requests: z
    .array(z.object({ key: z.string().min(1).max(600), expectedOutcome: z.enum(["delete", "archive"]) }))
    .min(1)
    .max(100),
  reason: z.string().max(500).nullable(),
  confirmed: z.literal(true),
});

export async function executeMaterialRemovalAction(input: unknown): Promise<Result<MaterialRemovalResult[]>> {
  const result = await run("material_master.removal_execute", async (context) => {
    const parsed = removalSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Review and confirm the selected materials first.", { code: "VALIDATION_ERROR" });
    return executeMaterialRemoval(context, parsed.data.requests, parsed.data.reason);
  });
  if (result.ok) revalidateInventory();
  return result;
}

export async function restoreArchivedMaterialAction(key: string): Promise<Result<{ display_name: string }>> {
  const result = await run("material_master.restore", async (context) => {
    return restoreArchivedMaterial(context, String(key ?? ""));
  });
  if (result.ok) revalidateInventory();
  return result;
}
