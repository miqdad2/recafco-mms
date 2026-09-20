// General Inventory Request Unit, Price, and Conversion Polish Unit 10G.58A,
// Task 2/3 — shared between the create form and the receive/quick-view UI so
// the dropdown list and the "custom unit" sentinel value never drift apart.

export const GENERAL_INVENTORY_UNIT_OPTIONS = [
  "PCS",
  "BOX",
  "PACK",
  "SET",
  "PAIR",
  "METER",
  "FEET",
  "KG",
  "GRAM",
  "LITER",
  "ML",
  "GALLON",
  "BARREL",
  "ROLL",
  "BAG",
  "BOTTLE",
  "CAN",
  "DRUM",
  "CARTON",
  "TON",
  "SQM",
  "CBM",
  "HOUR",
  "DAY"
] as const;

// Sentinel <select> value for "OTHER / CUSTOM" — never itself stored; the
// real unit typed into the accompanying custom-unit input is what gets
// saved (see parseGeneralItems in app/actions/general-inventory-requests.ts).
export const CUSTOM_UNIT_VALUE = "__custom__";

export const DEFAULT_UNIT = "PCS";
