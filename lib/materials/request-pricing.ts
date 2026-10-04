// Material Request Purchase-First Unit and Flexible Price Basis.
//
// One place for the maths both Materials Request forms (General Inventory /
// Stock Request and Job Card Materials Request), their save paths and their
// detail views use, so the preview, the saved figures and the detail view
// can never disagree. Client-safe (no "server-only"): the forms call it for
// their live preview.
//
//   Requested Purchase Qty — how many purchase units are requested (BOX)
//   Stock Unit             — the unit inventory is tracked in (PCS)
//   Conversion Quantity    — stock units inside 1 purchase unit (9);
//                            always 1 when the two units are the same
//   Calculated Stock Qty   = Requested Purchase Qty × Conversion Quantity
//   Estimated Total        = Purchase Qty × price  (price per purchase unit)
//                          = Stock Qty × price     (price per stock unit)

export type PriceBasis = "purchase_unit" | "stock_unit";

export const PRICE_BASES: readonly PriceBasis[] = ["purchase_unit", "stock_unit"];

export function isPriceBasis(value: unknown): value is PriceBasis {
  return value === "purchase_unit" || value === "stock_unit";
}

export function sameUnit(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Material Request Purchase Unit / Stock Unit Logic Correction — guards
// against the units being entered the wrong way round. A pack/container
// unit (BOX, BARREL, ROLL, …) is how a supplier sells; a piece/measure unit
// (PCS, LITER, METER, KG, …) is how inventory counts. Stock Unit = pack
// with Purchase Unit = piece ("1 PCS = 9 BOX") is the reversed entry this
// flags. The forms show a "Fix automatically" / "Keep as entered" panel and
// block the row until one is chosen; both save paths reject it unless the
// row was explicitly kept as entered (units_confirmed). Units outside both
// lists (custom units, PAIR, HOUR, …) are never flagged.
const PACK_UNITS = new Set(["box", "pack", "packet", "carton", "barrel", "drum", "roll", "bag", "can", "bottle", "set"]);
const PIECE_UNITS = new Set(["pcs", "liter", "litre", "ml", "kg", "gram", "meter", "feet", "sqm", "cbm"]);

const norm = (u: string) => u.trim().toLowerCase();

export function unitsLookReversed(purchaseUnit: string, stockUnit: string): boolean {
  return PIECE_UNITS.has(norm(purchaseUnit)) && PACK_UNITS.has(norm(stockUnit));
}

export function reversedUnitsMessage(purchaseUnit: string, stockUnit: string): string {
  return `Units look reversed: ${stockUnit} is a pack unit and ${purchaseUnit} is a piece/measure unit. Use Fix automatically, or Keep as entered if this is intended.`;
}

// Key a "Keep as entered" confirmation to the exact pair it was given for,
// so changing either unit afterwards asks again.
export function unitPairKey(purchaseUnit: string, stockUnit: string): string {
  return `${norm(purchaseUnit)}|${norm(stockUnit)}`;
}

// Stock Unit to suggest when the Purchase Unit changes on a new material
// whose Stock Unit the user has not picked yet: a pack suggests what is
// usually inside it (BARREL/DRUM/CAN -> LITER, ROLL -> METER, BAG -> KG,
// other packs -> PCS); a piece/measure unit suggests itself (bought and
// stocked the same way). null = leave the Stock Unit as it is.
export function suggestedStockUnit(purchaseUnit: string): string | null {
  const u = norm(purchaseUnit);
  if (u === "barrel" || u === "drum" || u === "can") return "LITER";
  if (u === "roll") return "METER";
  if (u === "bag") return "KG";
  if (PACK_UNITS.has(u)) return "PCS";
  if (PIECE_UNITS.has(u)) return purchaseUnit;
  return null;
}

// ── Price Basis Safety ──────────────────────────────────────────────────────
// "45.000 KWD for 1 BARREL" vs "for 1 LITER" can differ by the conversion
// factor (×200), so the request forms make the basis an explicit choice
// whenever the two units differ and ask for confirmation of a large total.

// The unit a price is for under a basis ("BARREL" / "LITER").
export function basisUnit(basis: PriceBasis, purchaseUnit: string, stockUnit: string): string {
  return basis === "stock_unit" ? stockUnit : purchaseUnit;
}

// KWD with thousands separators and 3 decimals: 9000 -> "9,000.000".
export function formatKwd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// A total is "large" when it is at least LARGE_TOTAL_KWD and at least 10×
// the price typed — the signature of a per-stock-unit price multiplied by a
// big conversion (45 per LITER × 200 = 9,000). Such a row needs an explicit
// "the price basis is correct" acknowledgement before submit; it is never
// blocked outright.
export const LARGE_TOTAL_KWD = 1000;

export function isLargeEstimatedTotal(total: number | null, price: number | null): boolean {
  return total !== null && price !== null && price > 0 && total >= LARGE_TOTAL_KWD && total >= price * 10;
}

// Ties an acknowledgement to the exact figures it was given for, so editing
// the price, basis or quantity asks again.
export function largeTotalAckKey(price: number, basis: PriceBasis, total: number): string {
  return `${price}|${basis}|${total}`;
}

// "Per BOX" / "Per PCS" — the dropdown and detail-view label for a basis.
export function priceBasisLabel(basis: PriceBasis, purchaseUnit: string, stockUnit: string): string {
  const unit = basis === "purchase_unit" ? purchaseUnit : stockUnit;
  return `Per ${unit || (basis === "purchase_unit" ? "Purchase Unit" : "Stock Unit")}`;
}

export type RequestLineInput = {
  purchaseQty: number;
  purchaseUnit: string;
  stockUnit: string;
  // Ignored (treated as 1) when the purchase and stock units are the same.
  conversion: number | null;
  price: number | null;
  basis: PriceBasis | null;
};

export type RequestLineFigures = {
  unitsDiffer: boolean;
  // null when the units differ and no valid conversion has been entered yet.
  conversion: number | null;
  stockQty: number | null;
  // null when unpriced, or when a per-stock-unit price cannot be totalled
  // yet because the conversion is missing.
  total: number | null;
};

export function computeRequestLine(input: RequestLineInput): RequestLineFigures {
  const unitsDiffer = Boolean(input.purchaseUnit && input.stockUnit) && !sameUnit(input.purchaseUnit, input.stockUnit);
  const conversion = unitsDiffer ? (input.conversion !== null && input.conversion > 0 ? input.conversion : null) : 1;
  const qty = Number.isFinite(input.purchaseQty) ? input.purchaseQty : 0;
  const stockQty = conversion !== null ? qty * conversion : null;

  let total: number | null = null;
  if (input.price !== null && Number.isFinite(input.price)) {
    if (input.basis === "stock_unit") total = stockQty !== null ? round3(stockQty * input.price) : null;
    else total = round3(qty * input.price);
  }
  return { unitsDiffer, conversion, stockQty, total };
}

// The price each table already stores in `unit_price`, converted from what
// was typed. General Inventory stores per purchase unit; Job Card stores per
// stock unit (see the 20261004000000 migration for why each one is fixed).
export function pricePerPurchaseUnit(price: number, basis: PriceBasis, conversion: number): number {
  return basis === "purchase_unit" ? price : round3(price * conversion);
}

export function pricePerStockUnit(price: number, basis: PriceBasis, conversion: number): number {
  return basis === "stock_unit" ? price : round3(price / conversion);
}

// Exact estimated total of one saved Job Card Materials Request line
// (parts_request_items: quantity_requested/unit_price are per stock unit).
// unit_price is rounded to 3 decimals, so for a per-purchase-unit price it
// can be slightly off (10.000 KWD per 120 LITER -> 0.083/LITER -> 9.960);
// this uses the price as typed instead. Lines saved before the price basis
// existed fall back to quantity × unit_price, as before.
export function savedStockLineTotal(line: {
  quantity_requested: number;
  unit_price: number | null;
  conversion_quantity: number | null;
  entered_unit_price: number | null;
  price_basis: string | null;
}): number {
  if (line.entered_unit_price !== null && line.price_basis === "purchase_unit") {
    return (line.quantity_requested / (line.conversion_quantity ?? 1)) * line.entered_unit_price;
  }
  if (line.entered_unit_price !== null && line.price_basis === "stock_unit") {
    return line.quantity_requested * line.entered_unit_price;
  }
  return line.quantity_requested * (line.unit_price ?? 0);
}
