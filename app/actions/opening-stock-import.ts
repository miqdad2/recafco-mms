"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import {
  canApproveOpeningStockDecisions,
  confirmOpeningStockImport,
  getOpeningStockBatch,
  previewOpeningStockImport,
  resolveHeldOpeningStockRows,
  type OpeningStockBatchView,
  type OpeningStockImportResult,
  type OpeningStockPreview,
  type OpeningStockResolveResult,
} from "@/lib/backend/store/opening-stock-import";
import { searchOfflineInventoryMaterials } from "@/lib/store/offline-inventory-data";
import type { RowDecision } from "@/lib/store/opening-stock-matching";

// Import Opening Stock (Offline Inventory Control). Check reads the file and
// writes nothing; Import re-reads the same file on the server, posts clear
// rows and holds uncertain ones, in one transaction; held rows are resolved
// later from the stored batch. Every service re-checks permissions.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(source: string, operation: (context: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> {
  const context = await requireUser();
  try {
    return { ok: true, data: await operation(context) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.safeMessage };
    await logSystemError(errorToLogInput(error, source, context.userId));
    return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
  }
}

function revalidateInventory() {
  revalidatePath("/store/offline-inventory");
  revalidatePath("/store/offline-inventory/movements");
  revalidatePath("/store/offline-inventory/import-opening-stock");
}

export async function previewOpeningStockImportAction(formData: FormData): Promise<Result<OpeningStockPreview>> {
  return run("opening_stock_import.preview", (context) => previewOpeningStockImport(context, formData.get("file")));
}

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_existing"), materialKey: z.string().min(3).max(500) }),
  z.object({ action: z.literal("register_new") }),
  z.object({ action: z.literal("hold") }),
  z.object({ action: z.literal("exclude"), reason: z.string().max(500) }),
]);
const decisionsSchema = z.record(z.string().regex(/^\d{1,6}$/), decisionSchema);

function readDecisions(raw: unknown): Record<number, RowDecision> {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
  } catch {
    throw new AppError("Request is not valid. Refresh the page and try again.", { code: "BAD_REQUEST" });
  }
  const parsed = decisionsSchema.safeParse(value);
  if (!parsed.success) throw new AppError("Request is not valid. Refresh the page and try again.", { code: "BAD_REQUEST" });
  const decisions: Record<number, RowDecision> = {};
  for (const [row, decision] of Object.entries(parsed.data)) decisions[Number(row)] = decision;
  return decisions;
}

export async function confirmOpeningStockImportAction(formData: FormData): Promise<Result<OpeningStockImportResult>> {
  return run("opening_stock_import.confirm", async (context) => {
    const result = await confirmOpeningStockImport(
      context,
      formData.get("file"),
      readDecisions(formData.get("decisions")),
      String(formData.get("client_submission_id") ?? ""),
      String(formData.get("fingerprint") ?? "")
    );
    revalidateInventory();
    return result;
  });
}

export async function getOpeningStockBatchAction(batchReference: string): Promise<Result<OpeningStockBatchView>> {
  return run("opening_stock_import.batch", (context) => getOpeningStockBatch(context, String(batchReference ?? "").slice(0, 80)));
}

export async function resolveHeldOpeningStockRowsAction(batchReference: string, decisions: unknown): Promise<Result<OpeningStockResolveResult>> {
  return run("opening_stock_import.resolve", async (context) => {
    const result = await resolveHeldOpeningStockRows(context, String(batchReference ?? "").slice(0, 80), readDecisions(decisions));
    revalidateInventory();
    return result;
  });
}

export type OpeningStockMaterialOption = { key: string; name: string; unit: string; itemCode: string | null; balance: number };

// For an approver choosing "Use existing" on a held row the engine had no (or
// the wrong) candidate for. Same search as Inventory Control's own pickers.
export async function searchOpeningStockMaterialsAction(query: string): Promise<OpeningStockMaterialOption[]> {
  const context = await requireUser();
  if (!canApproveOpeningStockDecisions(context)) return [];
  try {
    const matches = await searchOfflineInventoryMaterials({ query: String(query ?? "").slice(0, 100), limit: 10 });
    return matches.map((m) => ({ key: m.key, name: m.display_name, unit: m.unit, itemCode: m.item_code, balance: m.balance }));
  } catch {
    return [];
  }
}
