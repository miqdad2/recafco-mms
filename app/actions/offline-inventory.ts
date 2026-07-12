"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export type OfflineMovementState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

function parseQty(raw: string): number {
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) throw new Error("Quantity must be greater than 0.");
  return n;
}

function toNullable(s: string): string | null {
  const v = s.trim();
  return v === "" ? null : v;
}

// Compute available balance for a specific material (server-side, always fresh)
async function computeBalance(opts: {
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
    if (m.movement_type === "RECEIVED") balance += qty;
    else if (m.movement_type === "ISSUED") balance -= qty;
  }
  return balance;
}

// ── Receive Material ──────────────────────────────────────────────────────────

export async function receiveOfflineMaterialAction(
  _prev: OfflineMovementState,
  formData: FormData
): Promise<OfflineMovementState> {
  // requirePermission may call redirect() — must be outside try/catch
  const context = await requirePermission("parts.view");

  try {
    const movementDate  = toNullable(String(formData.get("movement_date") ?? ""));
    const partIdRaw     = String(formData.get("part_id") ?? "").trim();
    const isManual      = partIdRaw === "" || partIdRaw === "__manual__";
    const partId        = isManual ? null : partIdRaw;
    const manualName    = toNullable(String(formData.get("manual_material_name") ?? ""));
    const manualPartNum = toNullable(String(formData.get("manual_part_number") ?? ""));
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

    // Block exact duplicate when a reference number is provided
    if (refNum) {
      const matFilter = partId
        ? { part_id: partId }
        : {
            part_id: null as null,
            manual_material_name: {
              equals: manualName ?? "",
              mode: "insensitive" as const,
            },
          };

      const dupe = await prisma.offline_inventory_movements.findFirst({
        where: {
          movement_type:    "RECEIVED",
          reference_number: refNum,
          quantity:         qty,
          movement_date:    new Date(movementDate),
          deleted_at:       null,
          ...matFilter,
        },
        select: { id: true },
      });

      if (dupe) {
        return {
          ok: false,
          error:
            "This inventory movement already exists for the same reference number, material, quantity, and date.",
        };
      }
    }

    await prisma.offline_inventory_movements.create({
      data: {
        movement_type:         "RECEIVED",
        movement_date:         new Date(movementDate),
        part_id:               partId,
        manual_material_name:  isManual ? manualName : null,
        manual_part_number:    isManual ? manualPartNum : null,
        quantity:              qty,
        unit,
        counterparty,
        reference_number:      refNum,
        related_work_order_id: woIdRaw,
        remarks,
        created_by:            context.userId,
      },
    });
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
  const context = await requirePermission("parts.view");

  try {
    const movementDate = toNullable(String(formData.get("movement_date") ?? ""));
    const partIdRaw    = String(formData.get("part_id") ?? "").trim();
    const isManual     = partIdRaw === "" || partIdRaw === "__manual__";
    const partId       = isManual ? null : partIdRaw;
    const manualName   = toNullable(String(formData.get("manual_material_name") ?? ""));
    const qty          = parseQty(String(formData.get("quantity") ?? ""));
    const unit         = toNullable(String(formData.get("unit") ?? "")) ?? "PCS";
    const counterparty = toNullable(String(formData.get("counterparty") ?? ""));
    const purpose      = toNullable(String(formData.get("purpose") ?? ""));
    const receiverName = toNullable(String(formData.get("receiver_name") ?? ""));
    const woIdRaw      = toNullable(String(formData.get("related_work_order_id") ?? ""));
    const remarks      = toNullable(String(formData.get("remarks") ?? ""));

    if (!movementDate) {
      return { ok: false, error: "Movement date is required." };
    }
    if (!counterparty) {
      return { ok: false, error: '"Issued / Sent to" is required.' };
    }
    if (!partId && !manualName) {
      return { ok: false, error: "Select a material to issue." };
    }

    // Server-side balance check — prevents over-issue even under concurrent saves
    const available = await computeBalance({ partId, manualName, unit });
    if (available <= 0) {
      return { ok: false, error: "No available balance for this material." };
    }
    if (qty > available) {
      return {
        ok: false,
        error: `Cannot issue ${qty} ${unit}. Available balance is ${available} ${unit}.`,
      };
    }

    await prisma.offline_inventory_movements.create({
      data: {
        movement_type:         "ISSUED",
        movement_date:         new Date(movementDate),
        part_id:               partId,
        manual_material_name:  isManual ? manualName : null,
        quantity:              qty,
        unit,
        counterparty,
        purpose,
        receiver_name:         receiverName,
        related_work_order_id: woIdRaw,
        remarks,
        created_by:            context.userId,
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }

  revalidatePath("/store/offline-inventory");
  return { ok: true };
}
