"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import {
  keepVerificationOnHold,
  resolveVerificationEntry,
  returnVerificationForCorrection,
  saveVerificationCorrection,
  searchVerificationMaterials,
  type VerificationMaterialRef,
} from "@/lib/backend/store/opening-stock-verification";

// Needs Verification actions. Every one re-checks the role in the service;
// none of them trusts the page.

type Result<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function run<T>(source: string, operation: (context: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> {
  const context = await requireUser();
  try {
    const data = await operation(context);
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/needs-verification");
    revalidatePath("/store/offline-inventory/import-opening-stock");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.safeMessage, fieldErrors: error.fieldErrors };
    await logSystemError(errorToLogInput(error, source, context.userId));
    return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
  }
}

const bad = () => new AppError("Request is not valid. Refresh the page and try again.", { code: "BAD_REQUEST" });
const uuid = z.string().uuid();
const version = z.number().int().min(0);
const optionalText = (max: number) => z.string().max(max).nullable();

const correctionSchema = z.object({
  rowId: uuid,
  version,
  values: z.object({
    materialName: optionalText(400),
    partNumber: optionalText(200),
    category: optionalText(200),
    unit: optionalText(64),
    quantity: z.number().nullable(),
    remarks: optionalText(1200),
  }),
  proposedMaterialKey: z.string().max(500).nullable(),
  reason: z.string().max(1200),
  submit: z.boolean(),
  proposeDifferent: z.boolean().optional(),
  differentReason: z.string().max(1200).optional(),
});

export async function saveVerificationCorrectionAction(input: unknown) {
  return run("opening_stock_verification.save", (context) => {
    const parsed = correctionSchema.safeParse(input);
    if (!parsed.success) throw bad();
    return saveVerificationCorrection(context, parsed.data);
  });
}

const reviewSchema = z.object({ rowId: uuid, version, note: z.string().max(1200) });

export async function returnVerificationAction(input: unknown) {
  return run("opening_stock_verification.return", (context) => {
    const parsed = reviewSchema.safeParse(input);
    if (!parsed.success) throw bad();
    return returnVerificationForCorrection(context, parsed.data);
  });
}

export async function keepVerificationOnHoldAction(input: unknown) {
  return run("opening_stock_verification.hold", (context) => {
    const parsed = reviewSchema.safeParse(input);
    if (!parsed.success) throw bad();
    return keepVerificationOnHold(context, parsed.data);
  });
}

const resolveSchema = z.object({
  rowId: uuid,
  version,
  decision: z.discriminatedUnion("action", [
    z.object({ action: z.literal("use_existing"), materialKey: z.string().min(3).max(500) }),
    z.object({ action: z.literal("register_new") }),
    z.object({
      action: z.literal("register_different"),
      confirmedDifferent: z.boolean(),
      reason: z.string().max(1200),
      comparedKeys: z.array(z.string().min(3).max(500)).max(20),
      exactMatchOverride: z
        .object({ confirmed: z.boolean(), evidenceType: z.enum(["specification", "physical_evidence"]), evidence: z.string().max(1200) })
        .optional(),
    }),
    z.object({ action: z.literal("exclude"), reason: z.string().max(500) }),
  ]),
  note: z.string().max(1000).optional(),
});

export async function resolveVerificationAction(input: unknown) {
  return run("opening_stock_verification.resolve", (context) => {
    const parsed = resolveSchema.safeParse(input);
    if (!parsed.success) throw bad();
    return resolveVerificationEntry(context, parsed.data);
  });
}

export async function searchVerificationMaterialsAction(query: string): Promise<VerificationMaterialRef[]> {
  const context = await requireUser();
  try {
    return await searchVerificationMaterials(context, String(query ?? ""));
  } catch {
    return [];
  }
}
