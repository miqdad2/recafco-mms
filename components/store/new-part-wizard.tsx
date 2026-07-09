"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Package } from "lucide-react";

import { upsertPartAction } from "@/app/actions/maintenance";

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_LABELS = ["Part Identity", "Stock & Storage", "Supplier & Review"];

const CATEGORIES = [
  "Filters",
  "Hydraulic",
  "Electrical",
  "Mechanical",
  "Belts",
  "Bearings",
  "Brake",
  "Oil / Lubricants",
  "Consumables",
  "Tools",
  "Other",
];

const UNITS = ["PCS", "SET", "MTR", "LTR", "KG", "BOX", "ROLL", "PAIR", "OTHER"];

const STATUSES = ["Active", "Inactive", "Unavailable", "Discontinued"];

// ── Stock health ──────────────────────────────────────────────────────────────

function stockHealth(stock: number, minStock: number) {
  if (stock <= 0) return { label: "Out of Stock", color: "bg-red-100 text-red-700" };
  if (stock <= minStock) return { label: "Low Stock", color: "bg-amber-100 text-amber-700" };
  return { label: "Stock OK", color: "bg-green-100 text-green-700" };
}

// ── Shared tokens ─────────────────────────────────────────────────────────────

const inp =
  "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Wizard progress" className="mb-8">
      <ol className="flex items-start">
        {STEP_LABELS.map((label, idx) => {
          const n = idx + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                    done
                      ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                      : active
                        ? "border-[#ED1C24] bg-white text-[#ED1C24]"
                        : "border-[#E5E7EB] bg-white text-[#9CA3AF]"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
                </div>
                <span
                  className={`mt-1 hidden text-center text-[10px] font-semibold leading-tight sm:block ${
                    active ? "text-[#ED1C24]" : done ? "text-[#111827]" : "text-[#9CA3AF]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {n < STEP_LABELS.length && (
                <div
                  className={`mx-1 mt-4 h-0.5 flex-1 transition-colors ${
                    done ? "bg-[#ED1C24]" : "bg-[#E5E7EB]"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function WizCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="mb-5 border-b border-[#E5E7EB] pb-4">
        <h2 className="text-base font-bold text-[#111827]">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-[#4B5563]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Label helper ──────────────────────────────────────────────────────────────

function WizLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <span className="block text-sm font-semibold text-[#111827]">
      {label}
      {required && <span className="ml-0.5 text-[#ED1C24]"> *</span>}
      {hint && <span className="ml-1.5 text-xs font-normal text-[#9CA3AF]">{hint}</span>}
    </span>
  );
}

// ── Error message ─────────────────────────────────────────────────────────────

function ErrMsg({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-[#DC2626]">{children}</p>;
}

// ── Review row ────────────────────────────────────────────────────────────────

function ReviewRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[#111827]">
        {value?.trim() || <span className="font-normal text-[#9CA3AF]">—</span>}
      </dd>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function NewPartWizard({ canViewCosts }: { canViewCosts: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Snapshot of steps 1+2 captured when entering step 3
  const [reviewData, setReviewData] = useState<Record<string, string>>({});

  // Step 3 supplier fields are controlled so they reflect in the review live
  const [supplier, setSupplier] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [notes, setNotes] = useState("");

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const form = formRef.current;
    if (!form) return true;
    const fd = new FormData(form);

    if (step === 1) {
      if (!fd.get("part_name")?.toString().trim()) {
        errs.part_name = "Part name is required.";
      }
      if (!fd.get("unit_of_measure")?.toString().trim()) {
        errs.unit_of_measure = "Unit of measure is required.";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    const next = step + 1;
    if (next === 3) {
      const form = formRef.current;
      if (form) {
        const fd = new FormData(form);
        const obj: Record<string, string> = {};
        fd.forEach((v, k) => {
          obj[k] = String(v);
        });
        setReviewData(obj);
      }
    }
    setStep(next);
  }

  function handleBack() {
    setErrors({});
    setStep((p) => Math.max(p - 1, 1));
  }

  const reviewStock = Number(reviewData.current_stock ?? 0);
  const reviewMinStock = Number(reviewData.minimum_stock ?? 0);
  const health = stockHealth(reviewStock, reviewMinStock);

  return (
    <div className="mx-auto max-w-2xl">
      <StepIndicator current={step} />

      <form ref={formRef} action={upsertPartAction}>
        {/* ── Step 1: Part Identity ──────────────────────────────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <WizCard
            title="Part Identity"
            description="Core identification details for this spare part."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <WizLabel label="Part Code" hint="Auto-generated if left empty" />
                <input
                  name="part_code"
                  className={inp}
                  placeholder="e.g. HYD-001"
                  autoComplete="off"
                />
              </div>

              <div>
                <WizLabel label="Part Name" required />
                <input
                  name="part_name"
                  className={inp}
                  placeholder="e.g. Hydraulic Oil Filter"
                  autoFocus
                />
                {errors.part_name && <ErrMsg>{errors.part_name}</ErrMsg>}
              </div>

              <div>
                <WizLabel label="Category" />
                <select name="category" className={inp} defaultValue="">
                  <option value="">— Select category —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <WizLabel label="Part Number" hint="Manufacturer's part number" />
                <input name="part_number" className={inp} placeholder="e.g. H-4532-A" />
              </div>

              <div>
                <WizLabel label="SS Rec Code" hint="Optional" />
                <input name="ss_rec_code" className={inp} />
              </div>

              <div>
                <WizLabel label="Unit of Measure" required />
                <select name="unit_of_measure" className={inp} defaultValue="PCS">
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                {errors.unit_of_measure && <ErrMsg>{errors.unit_of_measure}</ErrMsg>}
              </div>

              <div className="sm:col-span-2">
                <WizLabel label="Description" hint="Optional" />
                <textarea
                  name="description"
                  className={`${inp} min-h-20`}
                  placeholder="Describe what this part is used for…"
                />
              </div>
            </div>
          </WizCard>
        </div>

        {/* ── Step 2: Stock & Storage ────────────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <WizCard
            title="Stock & Storage"
            description="Set the current inventory quantity, alert threshold, and storage location."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <WizLabel label="Current Stock" />
                <input
                  name="current_stock"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue="0"
                  className={inp}
                />
              </div>

              <div>
                <WizLabel label="Minimum Stock" hint="Low-stock threshold" />
                <input
                  name="minimum_stock"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue="0"
                  className={inp}
                />
              </div>

              <div>
                <WizLabel label="Bin Location" hint="Optional" />
                <input
                  name="store_location_bin"
                  className={inp}
                  placeholder="e.g. A-3-12"
                />
              </div>

              <div>
                <WizLabel label="Status" />
                <select name="status" className={inp} defaultValue="Active">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </WizCard>
        </div>

        {/* ── Step 3: Supplier & Review ──────────────────────────────────────── */}
        <div className={step !== 3 ? "hidden" : ""}>
          <div className="space-y-4">
            {/* Supplier inputs */}
            <WizCard
              title="Supplier"
              description="Enter supplier and pricing details. All fields are optional."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <WizLabel label="Supplier" hint="Optional" />
                  <input
                    name="supplier"
                    className={inp}
                    placeholder="e.g. Al Ghanim Industrial"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                  />
                </div>

                {canViewCosts && (
                  <div>
                    <WizLabel label="Unit Price (KWD)" hint="Optional" />
                    <input
                      name="unit_price"
                      type="number"
                      step="0.001"
                      min="0"
                      className={inp}
                      placeholder="0.000"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                    />
                  </div>
                )}

                <div className={canViewCosts ? "" : "sm:col-span-2"}>
                  <WizLabel label="Remarks" hint="Optional" />
                  <textarea
                    name="notes"
                    className={`${inp} min-h-16`}
                    placeholder="Any additional notes…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </WizCard>

            {/* Review summary */}
            <WizCard
              title="Review Summary"
              description="Confirm all details before saving the spare part record."
            >
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <ReviewRow
                  label="Part Code"
                  value={reviewData.part_code?.trim() || "Auto-generated"}
                />
                <ReviewRow label="Part Name" value={reviewData.part_name} />
                <ReviewRow label="Category" value={reviewData.category} />
                <ReviewRow label="Part Number" value={reviewData.part_number} />
                <ReviewRow label="SS Rec Code" value={reviewData.ss_rec_code} />
                <ReviewRow label="Unit of Measure" value={reviewData.unit_of_measure} />
                <ReviewRow label="Current Stock" value={reviewData.current_stock ?? "0"} />
                <ReviewRow label="Minimum Stock" value={reviewData.minimum_stock ?? "0"} />
                <ReviewRow label="Bin Location" value={reviewData.store_location_bin} />
                <ReviewRow label="Status" value={reviewData.status ?? "Active"} />
                <ReviewRow label="Supplier" value={supplier || undefined} />
                {canViewCosts && unitPrice && (
                  <ReviewRow label="Unit Price" value={`${unitPrice} KWD`} />
                )}
              </dl>

              {/* Auto-calculated stock health */}
              <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">
                  Stock Health
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${health.color}`}>
                    {health.label}
                  </span>
                  <p className="text-xs text-[#6B7280]">
                    {reviewStock} {reviewData.unit_of_measure ?? "units"} in stock
                    {reviewMinStock > 0 ? `, minimum ${reviewMinStock}` : ""}
                  </p>
                </div>
              </div>
            </WizCard>
          </div>
        </div>

        {/* ── Navigation ────────────────────────────────────────────────────── */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] shadow-sm transition hover:bg-[#F3F4F6]"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
            )}
          </div>

          <div>
            {step < 3 && (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {step === 3 && (
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                <Package className="h-4 w-4" aria-hidden="true" />
                Save Spare Part
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
