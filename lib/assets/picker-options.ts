import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { AssetPickerOption } from "@/components/assets/asset-search-picker";

// New Job Card Modal Wizard Refactor: extracted from the (now retired)
// standalone "/maintenance/work-orders/new" full page so every entry point
// that opens the New Job Card modal (Dashboard, Job Cards list, Asset
// Details, Vehicles list) can fetch the same asset picker options without
// duplicating the query.
export async function getAssetPickerOptions(): Promise<AssetPickerOption[]> {
  return prisma.assets.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      asset_code: true,
      asset_name: true,
      category: true,
      serial_number: true,
      plate_number: true,
      location: true,
      status: true,
      brand: true,
      model: true,
      model_year: true,
    },
    orderBy: { asset_code: "asc" },
  });
}
