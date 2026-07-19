// Canonical 2-level asset category hierarchy.
// The `category` column in the database stores the subcategory value.
// Main category is derived at display time using getMainCategory().

export const MAIN_CATEGORIES = [
  "Production Equipment",
  "Vehicles",
  "Heavy Equipment",
  "Electrical Equipment",
  "Workshop Equipment",
  "Facility / Utility",
  "IT / Office Equipment",
  "Other",
] as const;

export type MainCategory = (typeof MAIN_CATEGORIES)[number];

export const SUBCATEGORIES: Record<MainCategory, readonly string[]> = {
  "Production Equipment": [
    "Batching Plant",
    "Mixer",
    "Compressor",
    "Pump",
    "Conveyor",
    "Spray Machine",
    "Factory Machine",
    "Concrete Equipment",
  ],
  "Vehicles": ["Car", "Pickup", "Bus", "Truck", "Trailer"],
  "Heavy Equipment": ["Crane", "Forklift", "Loader", "Excavator", "Generator"],
  "Electrical Equipment": [
    "Electrical Panel",
    "Transformer",
    "Welding Machine",
    "Control Panel",
    "Cable System",
    "Lighting System",
  ],
  "Workshop Equipment": [
    "Drill Machine",
    "Lathe",
    "Grinder",
    "Cutting Machine",
    "Hydraulic Press",
    "Tools",
  ],
  "Facility / Utility": [
    "Air Conditioner",
    "Water Pump",
    "Fire Pump",
    "Boiler",
    "Water System",
    "Air System",
  ],
  "IT / Office Equipment": ["Computer", "Printer", "UPS", "Network Device"],
  "Other": ["Other"],
};

// Build primary map from canonical subcategory names
const _primary: Record<string, MainCategory> = {};
for (const main of MAIN_CATEGORIES) {
  for (const sub of SUBCATEGORIES[main]) {
    _primary[sub] = main;
  }
}

// Legacy / alternate category names that may exist in the database from before this structure.
// These supplement (but do not override) the primary canonical map.
const _aliases: Record<string, MainCategory> = {
  // Legacy vehicle forms
  "Vehicle":              "Vehicles",
  "Transport":            "Vehicles",
  // Legacy production forms
  "Motor":                "Production Equipment",
  "Production Equipment": "Production Equipment",
  "Machinery":            "Production Equipment",
  "Process Equipment":    "Production Equipment",
  "Mixing Equipment":     "Production Equipment",
  // Legacy electrical forms
  "Electrical":           "Electrical Equipment",
  "Electrical Equipment": "Electrical Equipment",
  "Panel":                "Electrical Equipment",
  "Switchgear":           "Electrical Equipment",
  "Power Distribution":   "Electrical Equipment",
  "Lighting":             "Electrical Equipment",
  "Welding Equipment":    "Electrical Equipment",
  // Legacy workshop forms
  "Workshop":             "Workshop Equipment",
  "Workshop Equipment":   "Workshop Equipment",
  "Hand Tool":            "Workshop Equipment",
  "Power Tool":           "Workshop Equipment",
  // Legacy heavy equipment forms
  "Heavy Equipment":      "Heavy Equipment",
  "Lifting Equipment":    "Heavy Equipment",
  // Legacy facility / utility forms
  "HVAC":                 "Facility / Utility",
  "Air Conditioning":     "Facility / Utility",
  "Cooling System":       "Facility / Utility",
  "Utility":              "Facility / Utility",
  "Fire System":          "Facility / Utility",
  "Water Treatment":      "Facility / Utility",
  "Plumbing":             "Facility / Utility",
  "Building/Facility":    "Facility / Utility",
};

// SUB_TO_MAIN: maps any known category value → its main category.
// Primary canonical entries take precedence over aliases on key conflict.
export const SUB_TO_MAIN: Readonly<Record<string, MainCategory | undefined>> = {
  ..._aliases,
  ..._primary,
};

// Returns the main category for a given DB category value, defaulting to "Other".
export function getMainCategory(category: string): MainCategory {
  return SUB_TO_MAIN[category] ?? "Other";
}

// Type-guard: true when the string is a valid MainCategory name.
export function isMainCategory(value: string): value is MainCategory {
  return (MAIN_CATEGORIES as readonly string[]).includes(value);
}

// Vehicle Asset View Unit 1 — a fixed, business-defined subset of leaf
// categories treated as "vehicles" for the dedicated /assets/vehicles view
// and the asset detail page's Vehicle Information section. Deliberately NOT
// "everything under the Vehicles main category" (excludes Trailer) and NOT
// "everything under Heavy Equipment" (excludes Excavator/Generator) — this
// list is the exact 7 categories approved for the vehicle rollout.
export const VEHICLE_CATEGORIES = [
  "Car",
  "Pickup",
  "Bus",
  "Truck",
  "Loader",
  "Forklift",
  "Crane",
] as const;

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export function isVehicleCategory(category: string): boolean {
  return (VEHICLE_CATEGORIES as readonly string[]).includes(category);
}
