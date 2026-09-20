"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts } from "@/lib/security/permissions";
import { normalizeCategory, ADD_NEW_CATEGORY_VALUE } from "@/components/store/offline-inventory-types";
import { CUSTOM_UNIT_VALUE, DEFAULT_UNIT } from "@/components/store/general-inventory-units";
import { pickUploadedFile, validatePrivateFileWithOptions } from "@/lib/files/validation";
import { getFileSecuritySettings } from "@/lib/files/settings";
import { savePrivateFile } from "@/lib/files/local-storage";
import { writeAuditLog } from "@/lib/audit/log";
import {
  requireOfflineInventoryManage,
  findExistingCategoryMatch,
  findExistingMaterialByNormalizedName,
  buildBalanceKey,
  searchOfflineInventoryMaterials,
  upsertInventoryMaterialSettings,
  type OfflineInventorySearchMatch,
} from "@/lib/store/offline-inventory-data";
import { emitOfflineInventoryRealtimeEvent, emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { syncPartsRequestStatusAfterFullIssueInTx } from "@/lib/backend/parts-requests/service";

export type OfflineMovementState =
  // Add New Material Category Flexibility Cleanup Task 7: `category` is only
  // ever set by addNewMaterialAction, carrying the final resolved category
  // name (which may differ in casing/spelling from what the user typed, if
  // it matched an existing category) back to the client for the success
  // message — every other action leaves it undefined, which is a no-op here
  // since the field is optional.
  | { ok: true; category?: string }
  // Required Materials Inventory Matching Unit 5, Task 8: `existingMaterialKey`
  // is set only for the duplicate-material error on Add New Material / Add
  // Opening Stock, so the form can offer "View Existing" / "Receive More"
  // instead of a dead-end error message.
  | { ok: false; error: string; existingMaterialKey?: string }
  | null;

function parseQty(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("Quantity must be a whole number greater than 0.");
  }
  return n;
}

function parseOpeningQty(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("Initial quantity must be a whole number greater than 0.");
  }
  return n;
}

function todayDateOnly(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function toNullable(s: string): string | null {
  const v = s.trim();
  return v === "" ? null : v;
}

// Compute available balance for a specific material (server-side, always fresh).
// Exported for reuse by app/actions/phase4.ts's Materials-Request issue flow,
// which must check the same Maintenance Store ledger balance before issuing.
export async function computeBalance(opts: {
  partId: string | null;
  manualName: string | null;
  unit: string;
}): Promise<number> {
  const movements = await prisma.offline_inventory_movements.findMany({
    where: opts.partId
      ? { part_id: opts.partId, deleted_at: null }
      : {
          part_id: null,
          manual_material_name: {
            equals: opts.manualName ?? "",
            mode: "insensitive",
          },
          unit: { equals: opts.unit, mode: "insensitive" },
          deleted_at: null,
        },
    select: { movement_type: true, quantity: true },
  });

  let balance = 0;
  for (const m of movements) {
    const qty = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += qty;
    else if (m.movement_type === "ISSUED") balance -= qty;
  }
  return balance;
}

// Task 11 — exact-duplicate guard, only when a reference number is supplied.
// Matches on movement type, material identity (part or manual name+part
// number+SS Rec. Code), quantity, unit, reference number, and movement date.
async function findDuplicateMovement(opts: {
  movementType: "RECEIVED" | "ISSUED";
  partId: string | null;
  manualName: string | null;
  manualPartNumber: string | null;
  ssRecCode: string | null;
  qty: number;
  unit: string;
  refNum: string;
  movementDate: string;
}) {
  const matFilter = opts.partId
    ? { part_id: opts.partId }
    : {
        part_id: null as null,
        manual_material_name: { equals: opts.manualName ?? "", mode: "insensitive" as const },
        manual_part_number: opts.manualPartNumber,
        ss_rec_code: opts.ssRecCode,
      };

  return prisma.offline_inventory_movements.findFirst({
    where: {
      movement_type: opts.movementType,
      reference_number: opts.refNum,
      quantity: opts.qty,
      unit: opts.unit,
      movement_date: new Date(opts.movementDate),
      deleted_at: null,
      ...matFilter,
    },
    select: { id: true },
  });
}

// Task 6 — block a duplicate Opening Stock entry for the same material identity
// (name + part number + SS Rec. Code + unit), regardless of quantity/date, unless
// the current user is Super Admin.
async function findDuplicateOpeningStock(opts: {
  manualName: string;
  manualPartNumber: string | null;
  ssRecCode: string | null;
  unit: string;
}) {
  return prisma.offline_inventory_movements.findFirst({
    where: {
      movement_type: "OPENING_STOCK",
      manual_material_name: { equals: opts.manualName, mode: "insensitive" },
      manual_part_number: opts.manualPartNumber,
      ss_rec_code: opts.ssRecCode,
      unit: { equals: opts.unit, mode: "insensitive" },
      deleted_at: null,
    },
    select: { id: true },
  });
}

// ── Add Opening Stock ─────────────────────────────────────────────────────────

export async function addOpeningStockAction(
  _prev: OfflineMovementState,
  formData: FormData
): Promise<OfflineMovementState> {
  const context = await requireOfflineInventoryManage();

  try {
    const manualName    = toNullable(String(formData.get("manual_material_name") ?? ""));
    const category      = toNullable(String(formData.get("category") ?? ""));
    const manualPartNum = toNullable(String(formData.get("manual_part_number") ?? ""));
    const ssRecCode     = toNullable(String(formData.get("ss_rec_code") ?? ""));
    const qty           = parseOpeningQty(String(formData.get("quantity") ?? ""));
    const unit          = toNullable(String(formData.get("unit") ?? "")) ?? "PCS";
    const location      = toNullable(String(formData.get("location") ?? ""));
    const referenceNote = toNullable(String(formData.get("reference_note") ?? ""));
    const remarks       = toNullable(String(formData.get("remarks") ?? ""));

    if (!manualName) {
      return { ok: false, error: "Material Name is required." };
    }
    if (!category) {
      return { ok: false, error: "Category is required." };
    }

    const isSuperAdmin = context.role?.slug === "super_admin";
    if (!isSuperAdmin) {
      const dupe = await findDuplicateOpeningStock({
        manualName,
        manualPartNumber: manualPartNum,
        ssRecCode,
        unit,
      });
      if (dupe) {
        return {
          ok: false,
          error:
            "This material already has an initial stock entry. Use Receive Material to increase balance, or edit the existing record if allowed.",
        };
      }
      // Task 8 — space/case-collapsing fallback: catches " oil   filter "
      // when "Oil Filter" already exists, which the exact check above misses.
      const normalizedDupe = await findExistingMaterialByNormalizedName({ manualName, unit });
      if (normalizedDupe) {
        return {
          ok: false,
          error: "This material already exists in Offline Inventory.",
          existingMaterialKey: normalizedDupe.key,
        };
      }
    }

    const created = await prisma.offline_inventory_movements.create({
      data: {
        movement_type:         "OPENING_STOCK",
        movement_date:         todayDateOnly(),
        part_id:               null,
        manual_material_name:  manualName,
        manual_part_number:    manualPartNum,
        ss_rec_code:           ssRecCode,
        category:              normalizeCategory(category),
        quantity:              qty,
        unit,
        counterparty:          location,
        reference_number:      referenceNote,
        remarks,
        created_by:            context.userId,
      },
    });

    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_OPENING_STOCK_ADDED, created.id, context.userId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }

  revalidatePath("/store/offline-inventory");
  revalidatePath("/store/offline-inventory/movements");
  return { ok: true };
}

// ── Add New Material ──────────────────────────────────────────────────────────
// Daily Actions Cleanup Task 3: registers a material in Offline Inventory
// Control directly from the daily workflow (distinct from the one-time,
// pre-go-live "Add Opening Stock" setup action above — same underlying
// OPENING_STOCK movement type, since the current model has no separate
// material-master table and balances are derived purely from movements).
// Unlike Add Opening Stock, a starting quantity of 0 is allowed here: the
// business flow is "register the material now, receive real quantity later
// with Receive Material", so a 0-quantity movement just establishes the
// material's identity (name/category/unit/part no.) without affecting balance.

// Inventory Add New Material Cost and Unit Conversion UI Unit 10G.73, Task
// 7 — Purchase Quantity itself may legitimately be fractional (e.g. "2.5
// DRUM"), and a bulk conversion (Purchase Quantity × Conversion Quantity)
// can produce a fractional Opening Inventory Quantity even from a whole
// Purchase Quantity (e.g. a conversion factor of 158.99). Replaces the
// former parseNonNegativeQty (which required a whole number) — only a
// finite, non-negative value, matching the offline_inventory_movements.
// quantity column's own Decimal(12,3) precision.
function parseNonNegativeDecimal(raw: string, label: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }
  return n;
}

export async function addNewMaterialAction(
  _prev: OfflineMovementState,
  formData: FormData
): Promise<OfflineMovementState> {
  const context = await requireOfflineInventoryManage();

  try {
    const manualName     = toNullable(String(formData.get("manual_material_name") ?? ""));
    const categoryField  = toNullable(String(formData.get("category") ?? "")) ?? "Other";
    const newCategoryRaw = String(formData.get("new_category_name") ?? "");
    const manualPartNum  = toNullable(String(formData.get("manual_part_number") ?? ""));
    const ssRecCode      = toNullable(String(formData.get("ss_rec_code") ?? ""));
    const location       = toNullable(String(formData.get("location") ?? ""));
    const userRemarks    = toNullable(String(formData.get("remarks") ?? ""));

    // Inventory Add New Material Cost and Unit Conversion UI Unit 10G.73,
    // Task 1/4 — Purchase Unit/Purchase Quantity/Purchase Unit Cost are the
    // "how it was bought" side; Inventory Unit is the "how it is tracked/
    // issued" side. Resolves each unit's own OTHER/CUSTOM sentinel to the
    // typed custom text, same convention as the General Inventory Request
    // form's existing GENERAL_INVENTORY_UNIT_OPTIONS/CUSTOM_UNIT_VALUE
    // pattern (reused here, not duplicated).
    const purchaseUnitField = toNullable(String(formData.get("purchase_unit") ?? "")) ?? DEFAULT_UNIT;
    const purchaseUnit =
      purchaseUnitField === CUSTOM_UNIT_VALUE
        ? toNullable(String(formData.get("custom_purchase_unit") ?? ""))
        : purchaseUnitField;
    if (!purchaseUnit) {
      return { ok: false, error: "Purchase unit is required." };
    }

    const useConversion = String(formData.get("use_conversion") ?? "") === "on";

    // Task 3/4 — when NOT using a different inventory unit, Inventory Unit
    // is simply the (already custom-resolved) Purchase Unit — the "normal
    // item" case, no separate inventory-unit input is even submitted then.
    let inventoryUnit: string | null;
    if (!useConversion) {
      inventoryUnit = purchaseUnit;
    } else {
      const inventoryUnitField = toNullable(String(formData.get("inventory_unit") ?? ""));
      inventoryUnit =
        inventoryUnitField === CUSTOM_UNIT_VALUE
          ? toNullable(String(formData.get("custom_inventory_unit") ?? ""))
          : (inventoryUnitField ?? DEFAULT_UNIT);
    }
    if (!inventoryUnit) {
      return { ok: false, error: "Inventory unit is required." };
    }

    // Task 7 — Purchase Quantity >= 0, no whole-number requirement (a
    // fractional purchase quantity, e.g. 2.5 DRUM, is legitimate).
    const purchaseQty = parseNonNegativeDecimal(String(formData.get("purchase_quantity") ?? ""), "Purchase quantity");

    // Task 7 — Conversion Quantity > 0 only required when units genuinely
    // differ AND a quantity is actually being added; a conversion factor
    // has no meaning to validate for a quantity-less "register the material
    // now" save (Task 6).
    let conversionQty = 1;
    if (useConversion) {
      const conversionRaw = toNullable(String(formData.get("conversion_quantity") ?? ""));
      conversionQty = conversionRaw !== null ? Number(conversionRaw) : NaN;
      if (purchaseQty > 0 && (!Number.isFinite(conversionQty) || conversionQty <= 0)) {
        return { ok: false, error: "Conversion quantity must be greater than 0 when using a different inventory unit." };
      }
      if (!(conversionQty > 0)) conversionQty = 1;
    }

    // Task 4 — the three formulas this whole unit is about: Opening
    // Inventory Quantity = Purchase Quantity × Conversion Quantity (Task 3's
    // "same unit" case is simply conversionQty === 1, so this one formula
    // covers both cases without a separate code path).
    const qty = Math.round(purchaseQty * conversionQty * 1000) / 1000;

    // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 3,
    // extended by Unit 10G.73, Task 4/6 — optional; only rendered on the
    // form for a viewer with cost permission, but re-validated here
    // regardless of who submits it. Opening Stock Value = Purchase Quantity
    // × Purchase Unit Cost (Task 4's own formula) — 0 when purchase
    // quantity is 0, even if a unit cost was still entered "as a default
    // for later" (Task 6's explicit "allow cost to be saved" behavior).
    const purchaseUnitCostRaw = toNullable(String(formData.get("purchase_unit_cost") ?? ""));
    const purchaseUnitCost = purchaseUnitCostRaw !== null ? Number(purchaseUnitCostRaw) : null;
    if (purchaseUnitCost !== null && (!Number.isFinite(purchaseUnitCost) || purchaseUnitCost < 0)) {
      return { ok: false, error: "Purchase unit cost must be 0 or greater." };
    }
    const inventoryUnitCost = purchaseUnitCost !== null ? Math.round((purchaseUnitCost / conversionQty) * 1000000) / 1000000 : null;
    const openingStockValue = purchaseUnitCost !== null ? Math.round(purchaseQty * purchaseUnitCost * 1000) / 1000 : null;

    // Task 4 — a clear, human-readable audit note on the movement itself
    // ("Opening stock — 1 BARREL converted to 200 LITER"), only when a real
    // conversion actually applies (different units AND an actual quantity
    // was converted) — a plain same-unit save gets no such note, matching
    // this form's existing plain-remarks behavior.
    const conversionNote =
      useConversion && purchaseQty > 0 && conversionQty !== 1
        ? `Opening stock — ${purchaseQty} ${purchaseUnit} converted to ${qty} ${inventoryUnit}`
        : null;
    const remarks = conversionNote ? (userRemarks ? `${conversionNote} · ${userRemarks}` : conversionNote) : userRemarks;

    // Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task
    // 3 — optional, visible to every role (not gated on cost permission —
    // these are quantity/planning fields, not cost). Neither is required;
    // an empty field simply means "no minimum/reorder configured."
    const minimumStockRaw = toNullable(String(formData.get("minimum_stock_quantity") ?? ""));
    const minimumStock = minimumStockRaw !== null ? Number(minimumStockRaw) : null;
    if (minimumStock !== null && (!Number.isFinite(minimumStock) || minimumStock < 0)) {
      return { ok: false, error: "Minimum stock level must be 0 or greater." };
    }
    const reorderQtyRaw = toNullable(String(formData.get("reorder_quantity") ?? ""));
    const reorderQty = reorderQtyRaw !== null ? Number(reorderQtyRaw) : null;
    if (reorderQty !== null && (!Number.isFinite(reorderQty) || reorderQty <= 0)) {
      return { ok: false, error: "Reorder quantity must be greater than 0." };
    }

    if (!manualName) {
      return { ok: false, error: "Material name is required." };
    }

    // Add New Material Category Flexibility Cleanup Task 2/3: resolve the
    // final category — either the dropdown's existing selection, or (when
    // "+ Add New Category" was chosen) a validated, trimmed new name, reusing
    // an existing category's exact spelling if one matches case-insensitively
    // rather than creating a near-duplicate.
    let resolvedCategory: string;
    if (categoryField === ADD_NEW_CATEGORY_VALUE) {
      const trimmedNew = newCategoryRaw.trim();
      if (!trimmedNew) {
        return { ok: false, error: "New category name is required." };
      }
      resolvedCategory = (await findExistingCategoryMatch(trimmedNew)) ?? trimmedNew;
    } else {
      resolvedCategory = normalizeCategory(categoryField);
    }

    // Task 8/9 — a material's real identity (for duplicate-checking, the
    // saved movement, and Inventory Material Settings) is always its
    // INVENTORY unit, never the purchase unit — the purchase side is only a
    // costing input, exactly as it already was before this unit when
    // Purchase Unit didn't exist as a separate concept from Unit.
    const isSuperAdmin = context.role?.slug === "super_admin";
    if (!isSuperAdmin) {
      const dupe = await findDuplicateOpeningStock({
        manualName,
        manualPartNumber: manualPartNum,
        ssRecCode,
        unit: inventoryUnit,
      });
      if (dupe) {
        return {
          ok: false,
          error: "This material already exists in Offline Inventory.",
          existingMaterialKey: buildBalanceKey({ part_id: null, manual_material_name: manualName, unit: inventoryUnit }),
        };
      }
      // Task 8 — space/case-collapsing fallback: catches "OIL FILTER" / " oil
      // filter " typed against an existing "Oil Filter" that the exact check
      // above (different spacing) would miss.
      const normalizedDupe = await findExistingMaterialByNormalizedName({ manualName, unit: inventoryUnit });
      if (normalizedDupe) {
        return {
          ok: false,
          error: "This material already exists in Offline Inventory.",
          existingMaterialKey: normalizedDupe.key,
        };
      }
    }

    const created = await prisma.offline_inventory_movements.create({
      data: {
        movement_type:         "OPENING_STOCK",
        movement_date:         todayDateOnly(),
        part_id:               null,
        manual_material_name:  manualName,
        manual_part_number:    manualPartNum,
        ss_rec_code:           ssRecCode,
        category:              resolvedCategory,
        quantity:              qty,
        unit:                  inventoryUnit,
        counterparty:          location,
        remarks,
        unit_cost:             inventoryUnitCost,
        total_cost:            openingStockValue,
        created_by:            context.userId,
      },
    });

    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_OPENING_STOCK_ADDED, created.id, context.userId);

    // Task 2/3 — only ever writes a settings row when the user actually
    // configured one of the two fields; never creates an empty row just
    // because a material was added.
    if (minimumStock !== null || reorderQty !== null) {
      await upsertInventoryMaterialSettings({
        partId: null,
        manualMaterialName: manualName,
        unit: inventoryUnit,
        minimumStockQuantity: minimumStock,
        reorderQuantity: reorderQty,
        createdBy: context.userId,
      });
    }

    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");
    return { ok: true, category: resolvedCategory };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }
}

// ── Receive Material ──────────────────────────────────────────────────────────

export async function receiveOfflineMaterialAction(
  _prev: OfflineMovementState,
  formData: FormData
): Promise<OfflineMovementState> {
  // requireOfflineInventoryManage may call redirect() — must be outside try/catch
  const context = await requireOfflineInventoryManage();

  try {
    const movementDate  = toNullable(String(formData.get("movement_date") ?? ""));
    const partIdRaw     = String(formData.get("part_id") ?? "").trim();
    const isManual      = partIdRaw === "" || partIdRaw === "__manual__";
    const partId        = isManual ? null : partIdRaw;
    const manualName    = toNullable(String(formData.get("manual_material_name") ?? ""));
    const category      = toNullable(String(formData.get("category") ?? ""));
    const manualPartNum = toNullable(String(formData.get("manual_part_number") ?? ""));
    const ssRecCode     = toNullable(String(formData.get("ss_rec_code") ?? ""));
    const qty           = parseQty(String(formData.get("quantity") ?? ""));
    const unit          = toNullable(String(formData.get("unit") ?? "")) ?? "PCS";
    const counterparty  = toNullable(String(formData.get("counterparty") ?? ""));
    const refNum        = toNullable(String(formData.get("reference_number") ?? ""));
    const woIdRaw       = toNullable(String(formData.get("related_work_order_id") ?? ""));
    const remarks       = toNullable(String(formData.get("remarks") ?? ""));

    if (!movementDate) {
      return { ok: false, error: "Movement date is required." };
    }
    if (!partId && !manualName) {
      return { ok: false, error: "Select an existing material or enter a material name." };
    }
    if (!category) {
      return { ok: false, error: "Category is required." };
    }

    if (refNum) {
      const dupe = await findDuplicateMovement({
        movementType: "RECEIVED",
        partId,
        manualName,
        manualPartNumber: isManual ? manualPartNum : null,
        ssRecCode,
        qty,
        unit,
        refNum,
        movementDate,
      });
      if (dupe) {
        return {
          ok: false,
          error: "This store movement already exists for the same reference number.",
        };
      }
    }

    const created = await prisma.offline_inventory_movements.create({
      data: {
        movement_type:         "RECEIVED",
        movement_date:         new Date(movementDate),
        part_id:               partId,
        manual_material_name:  isManual ? manualName : null,
        manual_part_number:    isManual ? manualPartNum : null,
        ss_rec_code:           ssRecCode,
        category:              normalizeCategory(category),
        quantity:              qty,
        unit,
        counterparty,
        reference_number:      refNum,
        related_work_order_id: woIdRaw,
        remarks,
        created_by:            context.userId,
      },
    });

    await Promise.all([
      emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_RECEIVED, created.id, context.userId),
      woIdRaw ? emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, woIdRaw, context.userId) : Promise.resolve(),
    ]);

    // Optional attachment — only linkable when a Related Job Card was selected,
    // since there is no attachments table for offline_inventory_movements itself
    // (no DB schema changes in this phase). Failure here never loses the receipt.
    if (woIdRaw) {
      const attachmentFile = pickUploadedFile(formData, "attachment_file");
      if (attachmentFile) {
        const attachmentType =
          toNullable(String(formData.get("attachment_type") ?? "")) ?? "Received Material Photo";
        const settings = await getFileSecuritySettings();
        const validationError = validatePrivateFileWithOptions(attachmentFile, {
          maxSizeBytes: settings.maxUploadSizeBytes,
          allowedTypes: settings.allowedFileTypes,
        });
        if (!validationError) {
          try {
            const filePath = await savePrivateFile("work-order-files", woIdRaw, attachmentFile);
            await prisma.work_order_attachments.create({
              data: {
                work_order_id: woIdRaw,
                attachment_type: attachmentType,
                file_name: attachmentFile.name,
                file_path: filePath,
                content_type: attachmentFile.type,
                file_size: attachmentFile.size,
                uploaded_by: context.userId,
              },
            });
            await writeAuditLog({
              actorId: context.userId,
              action: "file.upload",
              entityType: "work_order",
              entityId: woIdRaw,
              summary: `Uploaded ${attachmentType} proof on offline inventory receipt`,
              metadata: { fileName: attachmentFile.name, bucket: "work-order-files" },
            });
            revalidatePath(`/maintenance/work-orders/${woIdRaw}`);
          } catch {
            // Non-fatal — the material receipt above is already saved.
          }
        }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }

  revalidatePath("/store/offline-inventory");
  return { ok: true };
}

// ── Issue Material ────────────────────────────────────────────────────────────

export async function issueOfflineMaterialAction(
  _prev: OfflineMovementState,
  formData: FormData
): Promise<OfflineMovementState> {
  const context = await requireOfflineInventoryManage();

  try {
    const movementDate = toNullable(String(formData.get("movement_date") ?? ""));
    const partIdRaw    = String(formData.get("part_id") ?? "").trim();
    const isManual     = partIdRaw === "" || partIdRaw === "__manual__";
    const partId       = isManual ? null : partIdRaw;
    const manualName   = toNullable(String(formData.get("manual_material_name") ?? ""));
    const manualPartNum = toNullable(String(formData.get("manual_part_number") ?? ""));
    const ssRecCode    = toNullable(String(formData.get("ss_rec_code") ?? ""));
    const category     = toNullable(String(formData.get("category") ?? ""));
    const qty          = parseQty(String(formData.get("quantity") ?? ""));
    const unit         = toNullable(String(formData.get("unit") ?? "")) ?? "PCS";
    const counterparty = toNullable(String(formData.get("counterparty") ?? ""));
    const purpose      = toNullable(String(formData.get("purpose") ?? ""));
    const receiverName = toNullable(String(formData.get("receiver_name") ?? ""));
    const refNum        = toNullable(String(formData.get("reference_number") ?? ""));
    const woIdRaw       = toNullable(String(formData.get("related_work_order_id") ?? ""));
    const remarks       = toNullable(String(formData.get("remarks") ?? ""));

    if (!movementDate) {
      return { ok: false, error: "Movement date is required." };
    }
    if (!counterparty) {
      return { ok: false, error: '"Used by / Sent to" is required.' };
    }
    if (!partId && !manualName) {
      return { ok: false, error: "Select a material to issue." };
    }

    // Backend Reliability Fix Unit 1, Task 1: balance-check + insert now run
    // inside a single transaction, serialized per material identity with a
    // Postgres advisory transaction lock (`pg_advisory_xact_lock`, auto-released
    // on commit/rollback) — the same "lock, then re-read, then write" shape as
    // `lockPartsRequestForUpdate()` in lib/backend/parts-requests/repository.ts,
    // adapted for a table with no single per-material row to SELECT ... FOR
    // UPDATE on (balance here is derived by summing movements, not stored).
    // `buildBalanceKey()` (shared with the read-side balance aggregation in
    // lib/store/offline-inventory-data.ts) guarantees two concurrent Issue
    // Material submissions for the SAME material serialize on the same lock key
    // instead of both reading the same stale balance and both passing the
    // qty <= available check — which could previously drive the derived
    // balance negative.
    const lockKey = buildBalanceKey({ part_id: partId, manual_material_name: manualName, unit });

    const created = await withBackendTransaction(context.userId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const movements = await tx.offline_inventory_movements.findMany({
        where: partId
          ? { part_id: partId, deleted_at: null }
          : {
              part_id: null,
              manual_material_name: { equals: manualName ?? "", mode: "insensitive" },
              unit: { equals: unit, mode: "insensitive" },
              deleted_at: null,
            },
        select: { movement_type: true, quantity: true },
      });

      let available = 0;
      for (const m of movements) {
        const q = Number(m.quantity);
        if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") available += q;
        else if (m.movement_type === "ISSUED") available -= q;
      }

      if (available <= 0) {
        throw new Error("No available balance for this material.");
      }
      if (qty > available) {
        throw new Error("Issued quantity cannot be greater than current balance.");
      }

      const movement = await tx.offline_inventory_movements.create({
        data: {
          movement_type:         "ISSUED",
          movement_date:         new Date(movementDate),
          part_id:               partId,
          manual_material_name:  isManual ? manualName : null,
          manual_part_number:    isManual ? manualPartNum : null,
          ss_rec_code:           ssRecCode,
          category:              normalizeCategory(category),
          quantity:              qty,
          unit,
          counterparty,
          purpose,
          receiver_name:         receiverName,
          reference_number:      refNum,
          related_work_order_id: woIdRaw,
          remarks,
          created_by:            context.userId,
        },
      });

      // Material Fulfillment Status and Inventory Reservation Clarity Fix
      // Unit 10F.3, Task 5: if this Issue just fully satisfied the linked
      // Job Card's Required Materials, sync its Materials Request off
      // Requested/Approved/Waiting Stock/Partially Issued to Issued — see
      // syncPartsRequestStatusAfterFullIssueInTx for why that sync doesn't
      // already happen anywhere else. No-op when there's nothing to sync.
      if (woIdRaw) {
        await syncPartsRequestStatusAfterFullIssueInTx(tx, context, woIdRaw);
      }

      return movement;
    });

    await Promise.all([
      emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_USED, created.id, context.userId),
      woIdRaw ? emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, woIdRaw, context.userId) : Promise.resolve(),
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }

  revalidatePath("/store/offline-inventory");
  return { ok: true };
}

// ── Material detail — recent movements for the View modal ─────────────────────

export type MaterialMovementRow = {
  id: string;
  movement_type: string;
  movement_date: string;
  quantity: number;
  unit: string;
  counterparty: string | null;
  reference_number: string | null;
  work_order_number: string | null;
  created_by_name: string;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 7/8 — both
  // always null for a viewer without cost permission (stripped below
  // before this ever reaches the client), not just hidden in the UI.
  unit_cost: number | null;
  total_cost: number | null;
};

// `key` is the same BalanceItem.key produced by buildBalanceKey() in
// lib/store/offline-inventory-data.ts — "part:<id>" or "manual:<name>|<unit>".
// Shared by both the recent-movements action and (Inventory Dashboard
// Spending and Simple Low Stock Rules Unit 10G.63, Task 10) the per-
// material cost summary action below — same identity parsing, one place.
function buildMovementIdentityWhere(key: string) {
  return key.startsWith("part:")
    ? { part_id: key.slice("part:".length), deleted_at: null }
    : (() => {
        const rest = key.slice("manual:".length);
        const sepIndex = rest.lastIndexOf("|");
        const name = sepIndex === -1 ? rest : rest.slice(0, sepIndex);
        const unit = sepIndex === -1 ? "" : rest.slice(sepIndex + 1);
        return {
          part_id: null,
          manual_material_name: { equals: name, mode: "insensitive" as const },
          unit: { equals: unit, mode: "insensitive" as const },
          deleted_at: null,
        };
      })();
}

export async function getMaterialRecentMovementsAction(key: string): Promise<MaterialMovementRow[]> {
  const context = await requirePermission("parts.view");
  const showCosts = canViewCosts(context);

  const where = buildMovementIdentityWhere(key);

  const rows = await prisma.offline_inventory_movements.findMany({
    where,
    include: {
      work_orders: { select: { work_order_number: true } },
      profiles: { select: { full_name: true } },
    },
    orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
    take: 5,
  });

  return rows.map((r) => ({
    id: r.id,
    movement_type: r.movement_type,
    movement_date: r.movement_date.toISOString(),
    quantity: Number(r.quantity),
    unit: r.unit,
    counterparty: r.counterparty,
    reference_number: r.reference_number,
    work_order_number: r.work_orders?.work_order_number ?? null,
    created_by_name: r.profiles.full_name,
    unit_cost: showCosts && r.unit_cost !== null ? Number(r.unit_cost) : null,
    total_cost: showCosts && r.total_cost !== null ? Number(r.total_cost) : null,
  }));
}

// ── Material detail — per-material cost summary for the View modal ──────────
// Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63, Task
// 10 — the page-level spendingSummary (lib/store/offline-inventory-data.ts's
// getInventorySpendingSummary) aggregates by category and by top material,
// not by this ONE material's own week/month/year issued totals, so the
// Material Details modal needs its own small, identity-scoped query. Same
// "This Week = rolling last 7 days, This Month/Year = calendar to date"
// definitions as the page-level summary, same total_cost-or-quantity*
// unit_cost fallback.
export type MaterialCostSummary = {
  issuedValueThisWeek: number;
  issuedValueThisMonth: number;
  issuedValueThisYear: number;
  receivedValueThisMonth: number;
};

const ZERO_MATERIAL_COST_SUMMARY: MaterialCostSummary = {
  issuedValueThisWeek: 0,
  issuedValueThisMonth: 0,
  issuedValueThisYear: 0,
  receivedValueThisMonth: 0,
};

export async function getMaterialCostSummaryAction(key: string): Promise<MaterialCostSummary> {
  const context = await requirePermission("parts.view");
  // Task 11 — a non-cost viewer gets an already-zeroed summary, not just a
  // UI that chooses not to render it.
  if (!canViewCosts(context)) return ZERO_MATERIAL_COST_SUMMARY;

  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));

  const where = buildMovementIdentityWhere(key);
  const rows = await prisma.offline_inventory_movements.findMany({
    where: { ...where, movement_type: { in: ["ISSUED", "RECEIVED"] }, movement_date: { gte: startOfYear } },
    select: { movement_type: true, movement_date: true, quantity: true, unit_cost: true, total_cost: true },
  });

  const summary = { ...ZERO_MATERIAL_COST_SUMMARY };
  for (const r of rows) {
    const qty = Number(r.quantity);
    const cost = r.total_cost !== null ? Number(r.total_cost) : r.unit_cost !== null ? qty * Number(r.unit_cost) : 0;
    if (r.movement_type === "ISSUED") {
      summary.issuedValueThisYear += cost;
      if (r.movement_date >= startOfMonth) summary.issuedValueThisMonth += cost;
      if (r.movement_date >= startOfWeek) summary.issuedValueThisWeek += cost;
    } else if (r.movement_type === "RECEIVED" && r.movement_date >= startOfMonth) {
      summary.receivedValueThisMonth += cost;
    }
  }
  return summary;
}

// ── Required Materials autocomplete search ─────────────────────────────────
// Required Materials Inventory Matching Unit 5, Task 2. Called directly
// (not as a <form action>) from the New Job Card wizard's Required Materials
// step while Data Entry types, so it can be debounced client-side and show
// per-row suggestions without a full page navigation. Gated on the same
// permission as the wizard page itself (work_orders.manage) rather than
// offline_inventory.issue — Data Entry does not necessarily have Store
// permissions, but does always have work_orders.manage to have reached this
// step at all.
export async function searchOfflineInventoryMaterialsAction(
  query: string,
  opts?: { unit?: string; partNumber?: string }
): Promise<OfflineInventorySearchMatch[]> {
  const context = await requirePermission("work_orders.manage");
  try {
    return await searchOfflineInventoryMaterials({
      query,
      unit: opts?.unit ?? null,
      partNumber: opts?.partNumber ?? null,
      limit: 10,
      // Job Card Required Materials Estimated Cost Visibility Unit 10G.73
      // (second unit of this name), Task 1/5 — last_unit_cost is computed
      // (and only computed) for a cost-permitted caller; the New Job Card
      // wizard's own autocomplete never receives it otherwise.
      canViewCosts: canViewCosts(context),
    });
  } catch {
    return [];
  }
}

// Job Card Required Materials Estimated Cost Visibility Unit 10G.73 (second
// unit of this name), Task 5 — the New Job Card wizard needs to know its own
// viewer's cost-view permission BEFORE any material search happens (e.g. to
// decide whether a brand-new, unmatched material row should even show an
// "Estimated Unit Cost" input), so this is fetched once on the wizard's own
// mount rather than piggy-backing on a per-row search result. Same
// `work_orders.manage` gate as the search action above (this wizard step
// can't be reached without it) and the same `canViewCosts()` function every
// other cost-gated surface in this app already uses.
export async function getCostViewPermissionAction(): Promise<boolean> {
  const context = await requirePermission("work_orders.manage");
  return canViewCosts(context);
}
