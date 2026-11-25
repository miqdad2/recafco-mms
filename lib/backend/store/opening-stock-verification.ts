import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { searchOfflineInventoryMaterials } from "@/lib/store/offline-inventory-data";
import {
  DIFFERENT_REASON_MIN,
  buildMaterialIndex,
  classifyOpeningStockRows,
  exactMatchMaterials,
  registerDifferentBlock,
  resolveSourceUnit,
  sameReferenceMaterials,
  type CandidateMatch,
  type RowDecision,
} from "@/lib/store/opening-stock-matching";
import {
  PENDING_STATUSES,
  STATUS_LABELS,
  deriveVerificationStatus,
  effectiveSourceRow,
  hasCorrection,
  normalizeCorrection,
  validateCorrection,
  verificationIssue,
  verificationRolesFor,
  type CorrectionValues,
  type VerificationIssue,
  type VerificationRoles,
  type VerificationStatus,
} from "@/lib/store/opening-stock-verification-rules";
import { correctionOf, effectiveRowOf, loadInventory, resolveHeldOpeningStockRows, sourceRowOf } from "@/lib/backend/store/opening-stock-import";

// Needs Verification (Inventory Control): every held Opening Stock row, its
// plain-language problem, staff corrections and the approver's decision.
//
// Corrections never touch the original Excel values (a database trigger
// refuses that). Saving a draft or submitting never posts stock. Stock is
// posted only by an approver through resolveHeldOpeningStockRows — the same
// locked, idempotent, audited path as the import page — which re-matches the
// row with its corrected details first.

export function verificationRoles(context: CurrentUserContext): VerificationRoles {
  return verificationRolesFor(context.role?.slug, context.permissions);
}

function requireRole(roles: VerificationRoles, need: "canView" | "canEdit" | "canApprove") {
  if (roles[need]) return;
  throw new AppError(
    need === "canApprove"
      ? "Only the Maintenance Manager or System Administrator can do this."
      : need === "canEdit"
        ? "Only Maintenance Data Entry, the Maintenance Manager or the System Administrator can correct materials."
        : "You do not have access to Needs Verification.",
    { code: "FORBIDDEN" }
  );
}

// ── List ───────────────────────────────────────────────────────────────────

export type VerificationHistoryItem = {
  action: string;
  fromStatus: string;
  toStatus: string;
  actorName: string;
  note: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type VerificationMaterialRef = { key: string; name: string; itemCode: string | null; unit: string };

export type VerificationEntry = {
  id: string;
  batchReference: string;
  rowNumber: number;
  version: number;
  status: VerificationStatus;
  statusLabel: string;
  original: { name: string; category: string; partNumber: string; quantity: string; unit: string; remarks: string };
  correction: (CorrectionValues & { reason: string | null; proposed: VerificationMaterialRef | null; byName: string | null; at: string | null }) | null;
  effective: { name: string; category: string; partNumber: string; quantity: string; unit: string };
  issue: VerificationIssue | null;
  suggested: (VerificationMaterialRef & { unitCompatibility: CandidateMatch["unitCompatibility"] }) | null;
  candidates: CandidateMatch[];
  final: { materialName: string | null; itemCode: string | null; unit: string | null; quantity: number | null; note: string | null } | null;
  reviewNote: string | null;
  // Register as Different Material: Data Entry's proposal, the existing
  // materials with the same exact part number (to compare with), and why the
  // exception is not possible (null when it is).
  differentProposal: { reason: string | null } | null;
  sameReference: CandidateMatch[];
  differentBlock: string | null;
  // Same-number materials this row matches exactly (unit, type, make,
  // equipment): the exception then needs a separate exceptional approval.
  exactMatch: CandidateMatch[];
  lastUpdatedBy: string | null;
  lastUpdatedAt: string;
  // Completed through the held-row resolution (import page or here), as
  // opposed to posted directly by the import.
  resolvedAfterImport: boolean;
  history: VerificationHistoryItem[];
};

export type VerificationList = {
  entries: VerificationEntry[];
  counts: Record<VerificationStatus, number>;
  pending: number;
  roles: VerificationRoles;
};

// Number of rows waiting for verification, for the Inventory Control button.
export async function countPendingVerification(): Promise<number> {
  return prisma.opening_stock_import_rows.count({ where: { outcome: "held" } });
}

export async function listVerificationEntries(context: CurrentUserContext): Promise<VerificationList> {
  const roles = verificationRoles(context);
  requireRole(roles, "canView");
  const [records, batches, inventory] = await Promise.all([
    prisma.opening_stock_import_rows.findMany({ orderBy: [{ created_at: "desc" }, { row_number: "asc" }] }),
    prisma.opening_stock_import_batches.findMany({ select: { id: true, batch_reference: true, created_by: true, created_at: true } }),
    loadInventory(prisma),
  ]);
  const index = buildMaterialIndex(inventory.materials, inventory.postedImportKeys);
  const byKey = new Map(inventory.materials.map((m) => [m.key, m]));
  const batchById = new Map(batches.map((b) => [b.id, b]));

  // Each batch is classified as a whole (with corrections applied), so rows
  // sharing a part reference inside the same file still show it.
  const classified = new Map<string, ReturnType<typeof classifyOpeningStockRows>[number]>();
  const recordsByBatch = new Map<string, typeof records>();
  for (const r of records) recordsByBatch.set(r.batch_id, [...(recordsByBatch.get(r.batch_id) ?? []), r]);
  for (const rows of recordsByBatch.values()) {
    const sorted = [...rows].sort((a, b) => a.row_number - b.row_number);
    const out = classifyOpeningStockRows(sorted.map(effectiveRowOf), index);
    sorted.forEach((r, i) => classified.set(r.id, out[i]));
  }

  const events = await prisma.opening_stock_row_events.findMany({
    where: { row_id: { in: records.map((r) => r.id) } },
    orderBy: { created_at: "asc" },
  });
  const actorIds = new Set<string>([...events.map((e) => e.actor_id), ...records.flatMap((r) => [r.corrected_by, r.decided_by].filter((x): x is string => Boolean(x))), ...batches.map((b) => b.created_by)]);
  const names = new Map(
    (await prisma.profiles.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, full_name: true } })).map((p) => [p.id, p.full_name])
  );
  const eventsByRow = new Map<string, typeof events>();
  for (const e of events) eventsByRow.set(e.row_id, [...(eventsByRow.get(e.row_id) ?? []), e]);

  const ref = (key: string | null): VerificationMaterialRef | null => {
    if (!key) return null;
    const m = byKey.get(key);
    return m ? { key, name: m.name, itemCode: m.itemCode, unit: m.unit } : null;
  };

  const counts = Object.fromEntries(Object.keys(STATUS_LABELS).map((k) => [k, 0])) as Record<VerificationStatus, number>;
  const entries: VerificationEntry[] = records.map((r) => {
    const status = deriveVerificationStatus(r.outcome, r.verification_status);
    counts[status] += 1;
    const source = sourceRowOf(r);
    const correction = correctionOf(r);
    const effective = effectiveSourceRow(source, correction);
    const pending = PENDING_STATUSES.includes(status);
    const c = classified.get(r.id)!;
    const top = pending ? c.candidates[0] ?? null : null;
    const rowEvents = eventsByRow.get(r.id) ?? [];
    const lastEvent = rowEvents[rowEvents.length - 1];
    const batch = batchById.get(r.batch_id);
    return {
      id: r.id,
      batchReference: batch?.batch_reference ?? "",
      rowNumber: r.row_number,
      version: r.row_version,
      status,
      statusLabel: STATUS_LABELS[status],
      original: { name: source.materialName, category: source.category, partNumber: source.partNumber, quantity: source.quantityText, unit: source.unit, remarks: source.remarks },
      correction:
        hasCorrection(correction) || correction.remarks || r.correction_reason || r.proposed_material_key
          ? {
              ...correction,
              reason: r.correction_reason,
              proposed: ref(r.proposed_material_key),
              byName: r.corrected_by ? names.get(r.corrected_by) ?? null : null,
              at: r.corrected_at?.toISOString() ?? null,
            }
          : null,
      effective: { name: effective.materialName, category: effective.category, partNumber: effective.partNumber, quantity: effective.quantityText, unit: effective.unit },
      issue: pending ? verificationIssue(c) : null,
      suggested: top ? { key: top.key, name: top.name, itemCode: top.itemCode, unit: top.unit, unitCompatibility: top.unitCompatibility } : null,
      candidates: pending ? c.candidates : [],
      final: pending
        ? null
        : { materialName: r.material_name, itemCode: r.item_code, unit: r.material_unit, quantity: r.quantity !== null ? Number(r.quantity) : null, note: r.resolution_note ?? r.message },
      reviewNote: r.review_note,
      differentProposal: pending && r.different_material_proposed ? { reason: r.different_material_reason } : null,
      sameReference: pending ? sameReferenceMaterials(c) : [],
      differentBlock: pending ? registerDifferentBlock(c, index) : null,
      exactMatch: pending ? exactMatchMaterials(c) : [],
      lastUpdatedBy: lastEvent
        ? names.get(lastEvent.actor_id) ?? null
        : r.decided_by
          ? names.get(r.decided_by) ?? null
          : batch
            ? names.get(batch.created_by) ?? null
            : null,
      lastUpdatedAt: (lastEvent?.created_at ?? r.resolved_at ?? r.updated_at).toISOString(),
      resolvedAfterImport: r.resolved_at !== null,
      history: rowEvents.map((e) => ({
        action: e.action,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        actorName: names.get(e.actor_id) ?? "Unknown",
        note: e.note,
        details: (e.details ?? {}) as Record<string, unknown>,
        createdAt: e.created_at.toISOString(),
      })),
    };
  });
  return { entries, counts, pending: PENDING_STATUSES.reduce((s, k) => s + counts[k], 0), roles };
}

// ── Corrections (draft / submit) ────────────────────────────────────────────

export type SaveCorrectionInput = {
  rowId: string;
  version: number;
  values: CorrectionValues;
  proposedMaterialKey: string | null;
  reason: string;
  submit: boolean;
  // Data Entry may PROPOSE "Register as Different Material"; only an
  // approver can decide it.
  proposeDifferent?: boolean;
  differentReason?: string;
};

type LockedRow = Prisma.opening_stock_import_rowsGetPayload<object>;

async function lockRow(tx: Prisma.TransactionClient, rowId: string, version: number): Promise<LockedRow> {
  await tx.$queryRaw`SELECT id FROM opening_stock_import_rows WHERE id = ${rowId}::uuid FOR UPDATE`;
  const row = await tx.opening_stock_import_rows.findUnique({ where: { id: rowId } });
  if (!row) throw new AppError("This material is no longer in the verification list.", { code: "NOT_FOUND" });
  if (row.outcome !== "held") throw new AppError("This material has already been completed — nothing was changed.", { code: "CONFLICT" });
  if (row.row_version !== version) throw new AppError("Someone else changed this material meanwhile. Close it, check the latest details and try again.", { code: "CONFLICT" });
  return row;
}

// Saving a draft or submitting for review never posts stock.
export async function saveVerificationCorrection(context: CurrentUserContext, input: SaveCorrectionInput) {
  const roles = verificationRoles(context);
  requireRole(roles, "canEdit");
  return withBackendTransaction(context.userId, async (tx) => {
    const row = await lockRow(tx, input.rowId, input.version);
    const from = deriveVerificationStatus(row.outcome, row.verification_status);
    if (from === "waiting_for_manager" && !roles.canApprove) {
      throw new AppError("This material is waiting for the Manager. Ask the Manager to return it if it needs more changes.", { code: "CONFLICT" });
    }
    const source = sourceRowOf(row);
    const errors = validateCorrection(input.values, input.reason, input.submit, source);
    const normalized = normalizeCorrection(source, input.values);
    const inventory = await loadInventory(tx);
    const index = buildMaterialIndex(inventory.materials, inventory.postedImportKeys);
    const unit = normalized.unit ?? source.unit;
    if (!errors.unit && !resolveSourceUnit(unit, index)) errors.unit = `"${unit}" is not a unit used in MMS. Use PCS, SET, BOX, PACK, MTR, ROLL, KG, LTR, DRUM, BAG, PAIR, NOS or a unit already used in Inventory.`;
    if (input.proposedMaterialKey) {
      const m = inventory.materials.find((x) => x.key === input.proposedMaterialKey);
      if (!m) throw new AppError("The selected existing material was not found in Inventory.", { code: "VALIDATION_ERROR" });
      if (m.archived) throw new AppError(`${m.name} is archived and cannot be selected.`, { code: "VALIDATION_ERROR" });
    }
    const proposeDifferent = input.proposeDifferent === true;
    const differentReason = (input.differentReason ?? "").trim();
    if (proposeDifferent) {
      const [effectiveRow] = classifyOpeningStockRows([{ ...source, ...effectiveSourceRow(source, normalized) }], index);
      const block = registerDifferentBlock(effectiveRow, index);
      if (block) (errors as Record<string, string>).differentReason = block;
      else if (input.submit && differentReason.length < DIFFERENT_REASON_MIN) {
        (errors as Record<string, string>).differentReason = `Explain how this material differs from the existing one (at least ${DIFFERENT_REASON_MIN} characters).`;
      }
    }
    if (Object.keys(errors).length > 0) {
      throw new AppError("Please correct the highlighted fields.", { code: "VALIDATION_ERROR", fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v as string]])) });
    }
    const to = input.submit ? "submitted" : "draft";
    const now = new Date();
    await tx.opening_stock_import_rows.update({
      where: { id: row.id },
      data: {
        corrected_material_name: normalized.materialName,
        corrected_part_number: normalized.partNumber,
        corrected_category: normalized.category,
        corrected_unit: normalized.unit,
        corrected_quantity: normalized.quantity,
        correction_remarks: normalized.remarks,
        proposed_material_key: input.proposedMaterialKey || null,
        correction_reason: input.reason.trim() ? input.reason.trim().slice(0, 1000) : null,
        different_material_proposed: proposeDifferent,
        different_material_reason: proposeDifferent && differentReason ? differentReason.slice(0, 1000) : null,
        corrected_by: context.userId,
        corrected_at: now,
        verification_status: to,
        ...(input.submit ? { submitted_by: context.userId, submitted_at: now } : {}),
        row_version: { increment: 1 },
        updated_at: now,
      },
    });
    const toStatus = deriveVerificationStatus("held", to);
    const details = {
      original: { name: source.materialName, partNumber: source.partNumber, category: source.category, unit: source.unit, quantity: source.quantityText },
      corrected: normalized,
      proposedMaterialKey: input.proposedMaterialKey || null,
      quantityDifference: normalized.quantity !== null ? normalized.quantity - Number(source.quantityText) : 0,
      ...(proposeDifferent ? { proposedRegisterAsDifferent: true, differentReason: differentReason || null } : {}),
    };
    await tx.opening_stock_row_events.create({
      data: {
        row_id: row.id,
        batch_id: row.batch_id,
        action: input.submit ? "submitted" : "draft_saved",
        from_status: from,
        to_status: toStatus,
        actor_id: context.userId,
        note: input.reason.trim() || null,
        details: details as Prisma.InputJsonValue,
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: context.userId,
        action: input.submit ? "offline_inventory.opening_stock_correction_submitted" : "offline_inventory.opening_stock_correction_saved",
        entity_type: "opening_stock_import_row",
        entity_id: row.id,
        summary: `Opening stock row ${row.row_number}: correction ${input.submit ? "submitted for Manager review" : "saved as draft"}`,
        metadata: { rowNumber: row.row_number, batchId: row.batch_id, ...details } as Prisma.InputJsonValue,
      },
    });
    return { status: toStatus };
  });
}

// ── Manager: return / keep on hold ─────────────────────────────────────────

async function setReviewStatus(context: CurrentUserContext, input: { rowId: string; version: number; note: string }, kind: "returned" | "on_hold") {
  requireRole(verificationRoles(context), "canApprove");
  if (kind === "returned" && input.note.trim().length < 5) {
    throw new AppError("Explain what needs correcting (at least 5 characters).", { code: "VALIDATION_ERROR", fieldErrors: { note: ["Explain what needs correcting."] } });
  }
  return withBackendTransaction(context.userId, async (tx) => {
    const row = await lockRow(tx, input.rowId, input.version);
    const from = deriveVerificationStatus(row.outcome, row.verification_status);
    const now = new Date();
    await tx.opening_stock_import_rows.update({
      where: { id: row.id },
      data: { verification_status: kind, review_note: input.note.trim() || null, reviewed_by: context.userId, reviewed_at: now, row_version: { increment: 1 }, updated_at: now },
    });
    const to = deriveVerificationStatus("held", kind);
    await tx.opening_stock_row_events.create({
      data: { row_id: row.id, batch_id: row.batch_id, action: kind === "returned" ? "returned" : "kept_on_hold", from_status: from, to_status: to, actor_id: context.userId, note: input.note.trim() || null },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: context.userId,
        action: kind === "returned" ? "offline_inventory.opening_stock_correction_returned" : "offline_inventory.opening_stock_row_kept_on_hold",
        entity_type: "opening_stock_import_row",
        entity_id: row.id,
        summary: `Opening stock row ${row.row_number}: ${kind === "returned" ? "returned for correction" : "kept on hold"}`,
        metadata: { rowNumber: row.row_number, batchId: row.batch_id, note: input.note.trim() } as Prisma.InputJsonValue,
      },
    });
    return { status: to };
  });
}

export function returnVerificationForCorrection(context: CurrentUserContext, input: { rowId: string; version: number; note: string }) {
  return setReviewStatus(context, input, "returned");
}

export function keepVerificationOnHold(context: CurrentUserContext, input: { rowId: string; version: number; note: string }) {
  return setReviewStatus(context, input, "on_hold");
}

// ── Manager: Use Existing / Register New / Do Not Import ───────────────────

// Posts through the existing safe resolution path: import locks, the
// batch rows locked, re-matching with the corrected details, duplicate and
// unit checks, AMSOS allocation, events and audit — one transaction.
export async function resolveVerificationEntry(context: CurrentUserContext, input: { rowId: string; version: number; decision: RowDecision; note?: string }) {
  requireRole(verificationRoles(context), "canApprove");
  if (input.decision.action === "hold") throw new AppError("Use Keep on Hold for this.", { code: "VALIDATION_ERROR" });
  const row = await prisma.opening_stock_import_rows.findUnique({ where: { id: input.rowId }, select: { batch_id: true, row_number: true } });
  if (!row) throw new AppError("This material is no longer in the verification list.", { code: "NOT_FOUND" });
  const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { id: row.batch_id }, select: { batch_reference: true } });
  const result = await resolveHeldOpeningStockRows(context, batch.batch_reference, { [row.row_number]: input.decision }, {
    expectedVersions: { [row.row_number]: input.version },
    note: input.note,
  });
  if (result.alreadyResolved.includes(row.row_number)) {
    throw new AppError("This material was already completed by someone else — nothing was posted again.", { code: "CONFLICT" });
  }
  return result.resolved[0];
}

// For Data Entry and approvers choosing the correct existing material.
export async function searchVerificationMaterials(context: CurrentUserContext, query: string): Promise<VerificationMaterialRef[]> {
  requireRole(verificationRoles(context), "canEdit");
  const matches = await searchOfflineInventoryMaterials({ query: query.slice(0, 100), limit: 10 });
  return matches.map((m) => ({ key: m.key, name: m.display_name, itemCode: m.item_code, unit: m.unit }));
}
