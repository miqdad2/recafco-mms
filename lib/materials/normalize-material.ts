// Required Materials Inventory Matching Unit 5, Task 1.
//
// Shared, dependency-free (no "server-only", safe for client components)
// helper for comparing material identity across Offline Inventory Control,
// Required Materials rows, and Materials Requests — so "Oil Filter",
// "OIL FILTER", and " oil   filter " are all recognized as the same
// material instead of creating near-duplicate Offline Inventory records or
// missing an obvious autocomplete match.

// Trims, lowercases, and collapses internal whitespace runs into a single
// space. Deliberately does NOT strip punctuation/hyphens — part numbers and
// codes like "12-MM" or "A/C" rely on those characters staying intact, and
// this key is only ever used for equality comparison, never fuzzy matching.
export function normalizeMaterialKey(input: string | null | undefined): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export type MaterialIdentityInput = {
  name: string | null | undefined;
  unit?: string | null | undefined;
  partNumber?: string | null | undefined;
  ssRecCode?: string | null | undefined;
};

// Stable identity key for "is this the same material" comparisons — name is
// always required for identity; unit/part number/SS Rec. Code are folded in
// only when present, so two records that only differ by an optional field
// neither one ever supplied still match on name (+ unit, when both have one).
export function buildMaterialIdentityKey(input: MaterialIdentityInput): string {
  const name = normalizeMaterialKey(input.name);
  const unit = normalizeMaterialKey(input.unit);
  const partNumber = normalizeMaterialKey(input.partNumber);
  const ssRecCode = normalizeMaterialKey(input.ssRecCode);
  return [name, unit, partNumber, ssRecCode].join("|");
}

export function materialIdentitiesMatch(a: MaterialIdentityInput, b: MaterialIdentityInput): boolean {
  if (normalizeMaterialKey(a.name) !== normalizeMaterialKey(b.name)) return false;
  if (normalizeMaterialKey(a.unit) !== normalizeMaterialKey(b.unit)) return false;
  // Part number / SS Rec. Code only need to match when BOTH sides supply a
  // value — an existing record with no part number recorded yet should not
  // be treated as "different" just because the new entry adds one.
  const aPart = normalizeMaterialKey(a.partNumber);
  const bPart = normalizeMaterialKey(b.partNumber);
  if (aPart && bPart && aPart !== bPart) return false;
  const aSs = normalizeMaterialKey(a.ssRecCode);
  const bSs = normalizeMaterialKey(b.ssRecCode);
  if (aSs && bSs && aSs !== bSs) return false;
  return true;
}
