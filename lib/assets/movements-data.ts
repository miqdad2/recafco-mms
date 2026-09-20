import "server-only";

import { prisma } from "@/lib/db/prisma";

export type AssetMovementRow = {
  id: string;
  asset_id: string;
  status: string;
  from_location: string | null;
  to_location: string;
  sent_date: string;
  expected_return_date: string | null;
  actual_return_date: string | null;
  sent_by_user_id: string | null;
  received_by_user_id: string | null;
  responsible_person: string | null;
  purpose: string | null;
  remarks: string | null;
  created_at: string;
};

function serialize(m: {
  id: string;
  asset_id: string;
  status: string;
  from_location: string | null;
  to_location: string;
  sent_date: Date;
  expected_return_date: Date | null;
  actual_return_date: Date | null;
  sent_by_user_id: string | null;
  received_by_user_id: string | null;
  responsible_person: string | null;
  purpose: string | null;
  remarks: string | null;
  created_at: Date;
}): AssetMovementRow {
  return {
    id: m.id,
    asset_id: m.asset_id,
    status: m.status,
    from_location: m.from_location,
    to_location: m.to_location,
    sent_date: m.sent_date.toISOString(),
    expected_return_date: m.expected_return_date?.toISOString() ?? null,
    actual_return_date: m.actual_return_date?.toISOString() ?? null,
    sent_by_user_id: m.sent_by_user_id,
    received_by_user_id: m.received_by_user_id,
    responsible_person: m.responsible_person,
    purpose: m.purpose,
    remarks: m.remarks,
    created_at: m.created_at.toISOString(),
  };
}

/** The single ACTIVE movement for this asset, or null when not deployed. Enforced unique by a partial DB index, so `findFirst` is always at most one row. */
export async function getActiveAssetMovement(assetId: string): Promise<AssetMovementRow | null> {
  const row = await prisma.asset_movements.findFirst({
    where: { asset_id: assetId, status: "ACTIVE" },
  });
  return row ? serialize(row) : null;
}

/** Full movement history for this asset (active + returned + cancelled), most recent first. */
export async function getAssetMovementHistory(assetId: string): Promise<AssetMovementRow[]> {
  const rows = await prisma.asset_movements.findMany({
    where: { asset_id: assetId },
    orderBy: { sent_date: "desc" },
  });
  return rows.map(serialize);
}

/** Task 7/8 — one lightweight query for every currently-active deployment, used by the Assets list and Asset Type popup so opening either never needs a per-asset query. `id`/`from_location` are included (Unit 10G.66) so the Assets list can open a Receive Back modal (defaulting Return Location to the movement's own origin) for a specific movement without a per-row query. */
export async function getActiveMovementsByAsset(): Promise<
  Map<string, { id: string; from_location: string | null; to_location: string; sent_date: string; expected_return_date: string | null }>
> {
  const rows = await prisma.asset_movements.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, asset_id: true, from_location: true, to_location: true, sent_date: true, expected_return_date: true },
  });
  const map = new Map<
    string,
    { id: string; from_location: string | null; to_location: string; sent_date: string; expected_return_date: string | null }
  >();
  for (const row of rows) {
    map.set(row.asset_id, {
      id: row.id,
      from_location: row.from_location,
      to_location: row.to_location,
      sent_date: row.sent_date.toISOString(),
      expected_return_date: row.expected_return_date?.toISOString() ?? null,
    });
  }
  return map;
}

/** Resolves sent_by_user_id/received_by_user_id (plain scalar columns, no FK relation) to display names for the movement history table. */
export async function getUserNamesByIds(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return new Map();
  const rows = await prisma.profiles.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, full_name: true },
  });
  return new Map(rows.map((r) => [r.id, r.full_name]));
}
