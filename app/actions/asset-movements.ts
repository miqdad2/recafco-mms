"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { writeAuditLog } from "@/lib/audit/log";
import { computeMovementDayInfo } from "@/lib/assets/movement-status";

export type AssetMovementActionState = { ok: true } | { ok: false; error: string } | null;

function toNullable(s: FormDataEntryValue | null): string | null {
  const v = String(s ?? "").trim();
  return v === "" ? null : v;
}

function parseRequiredDate(raw: FormDataEntryValue | null, label: string): Date {
  const v = String(raw ?? "").trim();
  if (!v) throw new Error(`${label} is required.`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`${label} is not a valid date.`);
  return d;
}

function parseOptionalDate(raw: FormDataEntryValue | null): Date | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Task 2 — creates the single ACTIVE movement record for this deployment
// and moves the asset's current location to the site. Does not touch
// asset.status (Task 7/9's own "do not break existing status values" — the
// deployment state is shown as a separate movement badge, never mixed into
// the asset's own status enum used by Job Card/CEO risk logic elsewhere).
export async function sendAssetToSiteAction(
  _prev: AssetMovementActionState,
  formData: FormData
): Promise<AssetMovementActionState> {
  const context = await requirePermission("assets.manage");

  try {
    const assetId = String(formData.get("asset_id") ?? "");
    if (!assetId) return { ok: false, error: "Missing asset." };

    const toLocation = toNullable(formData.get("to_location"));
    if (!toLocation) return { ok: false, error: "To Location / Site is required." };

    const sentDate = parseRequiredDate(formData.get("sent_date"), "Sent Date");
    const expectedReturnDate = parseOptionalDate(formData.get("expected_return_date"));
    const responsiblePerson = toNullable(formData.get("responsible_person"));
    const purpose = toNullable(formData.get("purpose"));
    const remarks = toNullable(formData.get("remarks"));

    const existingActive = await prisma.asset_movements.findFirst({
      where: { asset_id: assetId, status: "ACTIVE" },
      select: { id: true },
    });
    if (existingActive) {
      return { ok: false, error: "This asset is already sent to a site. Receive it back first." };
    }

    const asset = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true, location: true } });
    if (!asset) return { ok: false, error: "Asset not found." };

    await withBackendTransaction(context.userId, async (tx) => {
      await tx.asset_movements.create({
        data: {
          asset_id: assetId,
          status: "ACTIVE",
          from_location: asset.location,
          to_location: toLocation,
          sent_date: sentDate,
          expected_return_date: expectedReturnDate,
          responsible_person: responsiblePerson,
          purpose,
          remarks,
          sent_by_user_id: context.userId,
        },
      });
      await tx.assets.update({ where: { id: assetId }, data: { location: toLocation, updated_by: context.userId } });
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "asset.sent_to_site",
      entityType: "asset",
      entityId: assetId,
      summary: `Asset sent to site: ${toLocation}`,
      metadata: { to_location: toLocation, sent_date: sentDate.toISOString(), expected_return_date: expectedReturnDate?.toISOString() ?? null },
    });

    revalidatePath(`/assets/${assetId}`);
    revalidatePath("/assets");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "This asset is already sent to a site. Receive it back first." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send asset to site." };
  }
}

// Task 3 — closes out the active movement and moves the asset's current
// location back. Received by is always the current user (Task 3's own
// "Received by optional/current user" — attribution should not be
// spoofable via a free-text field, so it is never a form input).
export async function receiveAssetBackAction(
  _prev: AssetMovementActionState,
  formData: FormData
): Promise<AssetMovementActionState> {
  const context = await requirePermission("assets.manage");

  try {
    const assetId = String(formData.get("asset_id") ?? "");
    const movementId = String(formData.get("movement_id") ?? "");
    if (!assetId || !movementId) return { ok: false, error: "Missing asset or movement." };

    const returnLocation = toNullable(formData.get("return_location"));
    if (!returnLocation) return { ok: false, error: "Return Location is required." };

    const returnDate = parseRequiredDate(formData.get("return_date"), "Return Date");
    const returnRemarks = toNullable(formData.get("remarks"));

    const movement = await prisma.asset_movements.findFirst({
      where: { id: movementId, asset_id: assetId, status: "ACTIVE" },
    });
    if (!movement) return { ok: false, error: "No active deployment found for this asset." };

    if (returnDate.getTime() < movement.sent_date.getTime()) {
      return { ok: false, error: "Return Date cannot be before the Sent Date." };
    }

    const combinedRemarks = returnRemarks
      ? movement.remarks
        ? `${movement.remarks} | Return: ${returnRemarks}`
        : returnRemarks
      : movement.remarks;

    await withBackendTransaction(context.userId, async (tx) => {
      await tx.asset_movements.update({
        where: { id: movementId },
        data: {
          status: "RETURNED",
          actual_return_date: returnDate,
          received_by_user_id: context.userId,
          remarks: combinedRemarks,
          updated_at: new Date(),
        },
      });
      await tx.assets.update({ where: { id: assetId }, data: { location: returnLocation, updated_by: context.userId } });
    });

    const dayInfo = computeMovementDayInfo(
      { status: "RETURNED", sent_date: movement.sent_date, expected_return_date: movement.expected_return_date, actual_return_date: returnDate },
      returnDate
    );

    await writeAuditLog({
      actorId: context.userId,
      action: "asset.received_back",
      entityType: "asset",
      entityId: assetId,
      summary: `Asset received back to ${returnLocation} (outside ${dayInfo.daysOutside} day${dayInfo.daysOutside === 1 ? "" : "s"})`,
      metadata: { return_location: returnLocation, actual_return_date: returnDate.toISOString(), days_outside: dayInfo.daysOutside },
    });

    revalidatePath(`/assets/${assetId}`);
    revalidatePath("/assets");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to receive asset back." };
  }
}
