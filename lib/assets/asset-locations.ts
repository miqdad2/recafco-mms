import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { AssetLocationOption, AssetLocationRow } from "@/lib/assets/asset-location-types";

// Active locations for the Send to Site dropdown, by name.
export async function getActiveAssetLocationOptions(): Promise<AssetLocationOption[]> {
  return prisma.asset_locations.findMany({
    where: { is_active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

// How many asset movements used a location: linked by id, or — for
// movements typed before the master existed — carrying the same name.
export async function countAssetLocationUsage(location: { id: string; name: string }): Promise<number> {
  return prisma.asset_movements.count({
    where: {
      OR: [{ asset_location_id: location.id }, { to_location: { equals: location.name, mode: "insensitive" } }],
    },
  });
}

// Every location (active first, then by name) with its usage count, for
// the Site Locations page.
export async function getAssetLocationRows(): Promise<AssetLocationRow[]> {
  const [locations, movements] = await Promise.all([
    prisma.asset_locations.findMany({ orderBy: [{ is_active: "desc" }, { name: "asc" }] }),
    prisma.asset_movements.findMany({ select: { asset_location_id: true, to_location: true } }),
  ]);

  return locations.map((location) => {
    const nameLower = location.name.toLowerCase();
    const usage = movements.filter(
      (m) => m.asset_location_id === location.id || m.to_location.trim().toLowerCase() === nameLower
    ).length;
    return {
      id: location.id,
      name: location.name,
      code: location.code,
      remarks: location.remarks,
      is_active: location.is_active,
      created_at: location.created_at.toISOString(),
      updated_at: location.updated_at.toISOString(),
      usage_count: usage,
    };
  });
}
