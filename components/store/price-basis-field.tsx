"use client";

import { AlertTriangle } from "lucide-react";

import { formatKwd, type PriceBasis } from "@/lib/materials/request-pricing";

// Material Request Price Basis Safety UX — shared by the General Inventory
// request form and the Job Card Materials Request wizard.
//
// PriceBasisField: when the purchase and stock units differ, "Price is
// for: [1 BARREL] [1 LITER]" as two large toggle buttons with NO default —
// the user must pick one once a price is entered (the form's validation
// blocks submit otherwise). With one unit there is nothing to choose: it
// shows "1 PCS" and posts purchase_unit. The hidden input carries the
// choice (empty while unchosen).
export function PriceBasisField({
  name,
  purchaseUnit,
  stockUnit,
  unitsDiffer,
  value,
  onChange,
  needsChoice,
  label,
}: {
  name: string;
  purchaseUnit: string;
  stockUnit: string;
  unitsDiffer: boolean;
  value: PriceBasis | null;
  onChange: (basis: PriceBasis) => void;
  // A price is entered but no basis picked yet: highlight the choice.
  needsChoice: boolean;
  label: string;
}) {
  if (!unitsDiffer) {
    return (
      <>
        <input type="hidden" name={name} value="purchase_unit" />
        <p className="px-2.5 py-1.5 text-sm text-[#111827]">1 {purchaseUnit || stockUnit || "unit"}</p>
      </>
    );
  }
  const options: Array<{ basis: PriceBasis; unit: string }> = [
    { basis: "purchase_unit", unit: purchaseUnit },
    { basis: "stock_unit", unit: stockUnit },
  ];
  return (
    <div className={`rounded-md p-1 ${needsChoice ? "bg-amber-50 ring-2 ring-amber-400" : ""}`}>
      <input type="hidden" name={name} value={value ?? ""} />
      <p className="px-1 text-[10px] font-black uppercase tracking-wide text-[#4B5563]">Price is for:</p>
      <div role="radiogroup" aria-label={label} className="mt-0.5 flex gap-1">
        {options.map((o) => {
          const selected = value === o.basis;
          return (
            <button
              key={o.basis}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.basis)}
              className={`min-h-8 flex-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold transition ${
                selected
                  ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                  : "border-[#D1D5DB] bg-white text-[#111827] hover:border-[#ED1C24]"
              }`}
            >
              1 {o.unit}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// PriceBasisWarnings: shown under a row once a price is entered.
// - Units differ with a conversion > 1: "Check price basis carefully",
//   plus "Confirm price basis: is X KWD for 1 BARREL or 1 LITER?" while no
//   basis is chosen.
// - A large total (isLargeEstimatedTotal): a confirmation checkbox the user
//   must tick before submit; editing the figures clears it (ack key).
export function PriceBasisWarnings({
  purchaseUnit,
  stockUnit,
  unitsDiffer,
  conversion,
  price,
  basis,
  total,
  largeTotal,
  acknowledged,
  onAcknowledge,
}: {
  purchaseUnit: string;
  stockUnit: string;
  unitsDiffer: boolean;
  conversion: number | null;
  price: number | null;
  basis: PriceBasis | null;
  total: number | null;
  largeTotal: boolean;
  acknowledged: boolean;
  onAcknowledge: (checked: boolean) => void;
}) {
  if (price === null) return null;
  const showCareful = unitsDiffer && conversion !== null && conversion > 1;
  if (!showCareful && !largeTotal) return null;
  const conv = conversion !== null ? String(Number(conversion.toFixed(4))) : "";
  return (
    <div className="mt-1.5 space-y-1.5">
      {showCareful && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold">Check price basis carefully.</p>
            <p>
              This request converts 1 {purchaseUnit} into {conv} {stockUnit}. Price per {purchaseUnit} and price per {stockUnit}{" "}
              create very different totals.
            </p>
            {basis === null && (
              <p className="mt-0.5 font-bold">
                Confirm price basis: is {formatKwd(price)} KWD for 1 {purchaseUnit} or 1 {stockUnit}?
              </p>
            )}
          </div>
        </div>
      )}
      {largeTotal && total !== null && (
        <label
          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
            acknowledged ? "border-[#E5E7EB] bg-white text-[#4B5563]" : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#ED1C24]"
          />
          <span>
            <span className="font-bold">Estimated total is {formatKwd(total)} KWD.</span> I confirm the price basis is correct.
          </span>
        </label>
      )}
    </div>
  );
}
