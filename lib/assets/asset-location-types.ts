// Site Locations (asset_locations table) — shared shapes, safe to import
// from client components. The table still has a `type` column from the
// first version of this feature; the UI no longer shows or edits it (new
// rows take the database default, existing rows keep their value).

// One option of the Send to Site dropdown (active locations only).
export type AssetLocationOption = {
  id: string;
  name: string;
  code: string | null;
};

// "Salmi 1604 — SALMI-1604", or just "Salmi 1604" without a code.
export function assetLocationOptionLabel(option: AssetLocationOption): string {
  return option.code ? `${option.name} — ${option.code}` : option.name;
}

// One row of the Site Locations page.
export type AssetLocationRow = AssetLocationOption & {
  remarks: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Asset movements that used this location (by id, or by the same name
  // typed before the master existed). > 0 means it cannot be deleted.
  usage_count: number;
};
