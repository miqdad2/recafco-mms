"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { countAssetLocationUsage } from "@/lib/assets/asset-locations";
import type { AssetLocationOption } from "@/lib/assets/asset-location-types";
import { prisma } from "@/lib/db/prisma";
import { ASSET_LOCATION_DENIED_MESSAGE, canManageAssetLocations } from "@/lib/security/permissions";

// Site Locations (asset_locations) — every action here is Manager / Super Admin only
// (canManageAssetLocations) and answers an unauthorized caller with the
// same permission message instead of redirecting, so the calling modal can
// show it.

export type AssetLocationActionState =
  | { ok: true; location?: AssetLocationOption }
  | { ok: false; error: string }
  | null;

const PAGE = "/asset-locations";

// `type` is not part of the form any more: a new row takes the column's
// database default and an edit leaves the stored value alone.
type LocationInput = { name: string; code: string | null; remarks: string | null };

function readInput(formData: FormData): LocationInput | { error: string } {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const code = String(formData.get("code") ?? "").trim().replace(/\s+/g, " ") || null;
  const remarks = String(formData.get("remarks") ?? "").trim() || null;

  if (!name) return { error: "Location / Site Name is required." };
  if (name.length > 120) return { error: "Location / Site Name is too long (120 characters maximum)." };
  if (code && code.length > 40) return { error: "Location Code is too long (40 characters maximum)." };
  return { name, code, remarks };
}

// Friendly duplicate messages before the database's own unique indexes
// (which stay the real guarantee — see the P2002 catch in each action).
async function findDuplicate(input: LocationInput, exceptId: string | null): Promise<string | null> {
  const not = exceptId ? { id: { not: exceptId } } : {};
  const sameName = await prisma.asset_locations.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" }, ...not },
    select: { name: true, is_active: true },
  });
  if (sameName) {
    return `A location named "${sameName.name}" already exists${sameName.is_active ? "" : " (inactive — activate it instead)"}.`;
  }
  if (input.code) {
    const sameCode = await prisma.asset_locations.findFirst({
      where: { code: { equals: input.code, mode: "insensitive" }, ...not },
      select: { name: true, code: true },
    });
    if (sameCode) return `Location Code "${sameCode.code}" is already used by "${sameCode.name}".`;
  }
  return null;
}

function duplicateFromError(e: unknown): string | null {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
    ? "A location with this name or code already exists."
    : null;
}

export async function createAssetLocationAction(
  _prev: AssetLocationActionState,
  formData: FormData
): Promise<AssetLocationActionState> {
  const context = await requireUser();
  if (!canManageAssetLocations(context)) return { ok: false, error: ASSET_LOCATION_DENIED_MESSAGE };

  const input = readInput(formData);
  if ("error" in input) return { ok: false, error: input.error };

  try {
    const duplicate = await findDuplicate(input, null);
    if (duplicate) return { ok: false, error: duplicate };

    const location = await prisma.asset_locations.create({
      data: { ...input, created_by: context.userId, updated_by: context.userId },
      select: { id: true, name: true, code: true },
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "asset_location.created",
      entityType: "asset_location",
      entityId: location.id,
      summary: `Site location created: ${location.name}`,
      metadata: { name: location.name, code: location.code },
    });

    revalidatePath(PAGE);
    revalidatePath("/assets");
    return { ok: true, location };
  } catch (e) {
    return { ok: false, error: duplicateFromError(e) ?? "Could not save the location. Please try again." };
  }
}

// A rename only changes the master row: movements already recorded keep
// their own to_location snapshot.
export async function updateAssetLocationAction(
  _prev: AssetLocationActionState,
  formData: FormData
): Promise<AssetLocationActionState> {
  const context = await requireUser();
  if (!canManageAssetLocations(context)) return { ok: false, error: ASSET_LOCATION_DENIED_MESSAGE };

  const id = String(formData.get("id") ?? "");
  const input = readInput(formData);
  if ("error" in input) return { ok: false, error: input.error };

  try {
    const existing = await prisma.asset_locations.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return { ok: false, error: "Location not found." };

    const duplicate = await findDuplicate(input, id);
    if (duplicate) return { ok: false, error: duplicate };

    await prisma.asset_locations.update({
      where: { id },
      data: { ...input, updated_by: context.userId, updated_at: new Date() },
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "asset_location.updated",
      entityType: "asset_location",
      entityId: id,
      summary: `Site location updated: ${input.name}`,
      metadata: { previous_name: existing.name, name: input.name, code: input.code },
    });

    revalidatePath(PAGE);
    revalidatePath("/assets");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: duplicateFromError(e) ?? "Could not save the location. Please try again." };
  }
}

// Activate / Deactivate. An inactive location leaves the Send to Site
// dropdown; movements that used it are untouched.
export async function setAssetLocationActiveAction(id: string, isActive: boolean): Promise<AssetLocationActionState> {
  const context = await requireUser();
  if (!canManageAssetLocations(context)) return { ok: false, error: ASSET_LOCATION_DENIED_MESSAGE };

  try {
    const existing = await prisma.asset_locations.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return { ok: false, error: "Location not found." };

    await prisma.asset_locations.update({
      where: { id },
      data: { is_active: isActive, updated_by: context.userId, updated_at: new Date() },
    });

    await writeAuditLog({
      actorId: context.userId,
      action: isActive ? "asset_location.activated" : "asset_location.deactivated",
      entityType: "asset_location",
      entityId: id,
      summary: `Site location ${isActive ? "activated" : "deactivated"}: ${existing.name}`,
    });

    revalidatePath(PAGE);
    revalidatePath("/assets");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the location. Please try again." };
  }
}

// Delete is only for a location no movement ever used; a used one is
// refused here and deactivated instead.
export async function deleteAssetLocationAction(id: string): Promise<AssetLocationActionState> {
  const context = await requireUser();
  if (!canManageAssetLocations(context)) return { ok: false, error: ASSET_LOCATION_DENIED_MESSAGE };

  try {
    const existing = await prisma.asset_locations.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return { ok: false, error: "Location not found." };

    const usage = await countAssetLocationUsage(existing);
    if (usage > 0) {
      return {
        ok: false,
        error: `"${existing.name}" is used in ${usage} asset movement${usage === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead.`,
      };
    }

    await prisma.asset_locations.delete({ where: { id } });

    await writeAuditLog({
      actorId: context.userId,
      action: "asset_location.deleted",
      entityType: "asset_location",
      entityId: id,
      summary: `Site location deleted: ${existing.name}`,
    });

    revalidatePath(PAGE);
    revalidatePath("/assets");
    return { ok: true };
  } catch (e) {
    // A movement linked it between the check and the delete (FK).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { ok: false, error: "This location is used in asset movements and cannot be deleted. Deactivate it instead." };
    }
    return { ok: false, error: "Could not delete the location. Please try again." };
  }
}
