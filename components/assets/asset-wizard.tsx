"use client";

import { useRef, useState, useMemo } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import { upsertAssetAction } from "@/app/actions/maintenance";
import type { CategoryOption } from "@/components/assets/category-select-pair";
import { Button } from "@/components/ui/button";
import { isVehicleCategory } from "@/lib/assets/categories";

const ASSET_STATUSES = [
  "Active",
  "In Use",
  "Under Maintenance",
  "Breakdown",
  "Waiting for Parts",
  "Out of Service",
  "Retired",
];
const MACHINE_MAINS = [
  "Production Equipment",
  "Heavy Equipment",
  "Electrical Equipment",
  "Workshop Equipment",
  "Facility / Utility",
];

const STEP_LABELS = [
  "Basic Details",
  "Identification",
  "Service & Warranty",
  "Review & Save",
];
const TOTAL_STEPS = 4;

type FormRecord = Record<string, string | number | null | undefined>;

// ── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-start">
        {STEP_LABELS.map((label, idx) => {
          const num = idx + 1;
          const done = num < current;
          const active = num === current;
          const isLast = num === TOTAL_STEPS;
          return (
            <li key={label} className="flex flex-1 items-start">
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
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : num}
                </div>
                <span
                  className={`mt-1 hidden text-center text-[10px] font-semibold leading-tight sm:block ${
                    active
                      ? "text-[#ED1C24]"
                      : done
                        ? "text-[#111827]"
                        : "text-[#9CA3AF]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {!isLast && (
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

// ── Step card container ─────────────────────────────────────────────────────

function StepCard({
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
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

// ── Field wrapper ───────────────────────────────────────────────────────────

function WField({
  label,
  required,
  error,
  span2,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="block text-sm font-semibold text-[#111827]">
        {label}
        {required && <span className="ml-0.5 text-[#ED1C24]"> *</span>}
      </label>
      {children}
      {error && <p className="mt-0.5 text-xs text-[#DC2626]">{error}</p>}
    </div>
  );
}

// ── Uncontrolled text input ─────────────────────────────────────────────────

function TInput({
  name,
  defaultValue,
  placeholder,
  type = "text",
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      name={name}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
    />
  );
}

// ── Review row ──────────────────────────────────────────────────────────────

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#F3F4F6] py-1.5 last:border-0">
      <dt className="shrink-0 text-xs font-semibold text-[#4B5563]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs text-[#111827]">{value}</dd>
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">
        {title}
      </h3>
      <dl className="rounded-md border border-[#E5E7EB] px-4 py-1">{children}</dl>
    </section>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────────

export function AssetWizard({
  asset,
  categories,
  canManageCategories = false,
}: {
  asset?: FormRecord | null;
  categories: CategoryOption[];
  canManageCategories?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reviewData, setReviewData] = useState<Record<string, string>>({});

  // ── Category state ───────────────────────────────────────────────────────

  const mainCategories = useMemo(
    () => categories.filter((c) => c.parent_id === null && c.is_active),
    [categories],
  );

  const initialMain = useMemo(() => {
    const subcat = typeof asset?.category === "string" ? asset.category : "";
    if (!subcat) return "";
    const match = categories.find(
      (c) => c.parent_id !== null && c.name.toLowerCase() === subcat.toLowerCase(),
    );
    if (match) return mainCategories.find((m) => m.id === match.parent_id)?.name ?? "";
    return mainCategories.find((m) => m.name.toLowerCase() === subcat.toLowerCase())?.name ?? "";
  }, [asset, categories, mainCategories]);

  const [selectedMain, setSelectedMain] = useState(initialMain);

  const subcategories = useMemo(() => {
    if (!selectedMain) return [];
    const main = mainCategories.find((m) => m.name === selectedMain);
    if (!main) return [];
    return categories.filter((c) => c.parent_id === main.id && c.is_active);
  }, [selectedMain, categories, mainCategories]);

  const initialSubcat = useMemo(() => {
    const subcat = typeof asset?.category === "string" ? asset.category : "";
    if (!subcat) return "";
    const isMain = mainCategories.some((m) => m.name.toLowerCase() === subcat.toLowerCase());
    return isMain ? "" : subcat;
  }, [asset, mainCategories]);

  const [selectedSubcat, setSelectedSubcat] = useState(initialSubcat);

  // Vehicle field visibility is keyed off the actual selected subcategory
  // (the value that gets saved as `assets.category`), using the same
  // canonical 7-category list as the /assets/vehicles page and the asset
  // detail page — so Loader/Forklift/Crane (nested under "Heavy Equipment",
  // not "Vehicles") correctly reveal these fields too, not just Car/Pickup/
  // Bus/Truck under the "Vehicles" main category.
  const isVehicle = isVehicleCategory(selectedSubcat);
  const isMachineType = MACHINE_MAINS.includes(selectedMain);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const s = (key: string): string => {
    const v = asset?.[key];
    return v !== null && v !== undefined ? String(v) : "";
  };

  const dateVal = (key: string): string => {
    const v = s(key);
    return v ? v.slice(0, 10) : "";
  };

  // ── Validation (step 1 only) ─────────────────────────────────────────────

  function validate(): boolean {
    const form = formRef.current;
    if (!form) return false;
    const fd = new FormData(form);
    const errs: Record<string, string> = {};

    if (!fd.get("asset_code")?.toString().trim()) errs.asset_code = "Asset code is required";
    if (!fd.get("asset_name")?.toString().trim()) errs.asset_name = "Asset name is required";
    if (!selectedMain) errs.main_category = "Main category is required";
    if (!fd.get("category")?.toString().trim()) errs.category = "Subcategory is required";
    if (!fd.get("location")?.toString().trim()) errs.location = "Location is required";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  function handleNext() {
    if (step === 1 && !validate()) return;
    const next = step + 1;
    if (next === TOTAL_STEPS) {
      const form = formRef.current;
      if (form) {
        const fd = new FormData(form);
        const obj: Record<string, string> = {};
        fd.forEach((v, k) => {
          if (String(v).trim()) obj[k] = String(v);
        });
        setReviewData(obj);
      }
    }
    setStep(next);
  }

  function handleBack() {
    setStep((prev) => Math.max(prev - 1, 1));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl">
      <StepIndicator current={step} />

      <form ref={formRef} action={upsertAssetAction} className="space-y-5">
        {asset?.id ? <input type="hidden" name="id" value={s("id")} /> : null}
        {/* Preserve department_id on edit so it is not overwritten with null */}
        <input type="hidden" name="department_id" value={s("department_id")} />

        {/* ── STEP 1: Basic Details ────────────────────────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <StepCard
            title="Basic Details"
            description="Core identification fields. Fields marked * are required."
          >
            <WField label="Asset Code" required error={fieldErrors.asset_code}>
              <TInput
                name="asset_code"
                defaultValue={s("asset_code")}
                placeholder="e.g. EQ-001"
              />
            </WField>

            <WField label="Asset Name" required error={fieldErrors.asset_name}>
              <TInput
                name="asset_name"
                defaultValue={s("asset_name")}
                placeholder="e.g. Hydraulic Press No. 3"
              />
            </WField>

            {/* Category pair */}
            <div className="sm:col-span-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <WField label="Main Category" required error={fieldErrors.main_category}>
                  <select
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    value={selectedMain}
                    onChange={(e) => {
                      setSelectedMain(e.target.value);
                      setSelectedSubcat("");
                    }}
                    aria-label="Main category"
                  >
                    <option value="">Select main category…</option>
                    {mainCategories.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </WField>

                <WField label="Subcategory" required error={fieldErrors.category}>
                  <select
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="category"
                    value={selectedSubcat}
                    onChange={(e) => setSelectedSubcat(e.target.value)}
                  >
                    <option value="">
                      {selectedMain ? "Select subcategory…" : "Select main category first"}
                    </option>
                    {subcategories.map((sc) => (
                      <option key={sc.id} value={sc.name}>
                        {sc.name}
                      </option>
                    ))}
                    {/* Preserve legacy subcategory value that no longer exists in categories */}
                    {initialSubcat &&
                      !subcategories.some(
                        (sc) => sc.name.toLowerCase() === initialSubcat.toLowerCase(),
                      ) && (
                        <option value={initialSubcat}>{initialSubcat} (legacy)</option>
                      )}
                  </select>
                </WField>
              </div>

              {canManageCategories && (
                <p className="mt-1.5 text-xs text-[#9CA3AF]">
                  Need to add a category?{" "}
                  <Link
                    href="/admin/settings/asset-categories"
                    className="font-semibold text-[#ED1C24] hover:underline"
                  >
                    Manage Categories
                  </Link>
                </p>
              )}
            </div>

            <WField label="Location" required error={fieldErrors.location}>
              <TInput
                name="location"
                defaultValue={s("location")}
                placeholder="e.g. Workshop Block A"
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Location identifies where the asset is installed or used.
              </p>
            </WField>

            <WField label="Status">
              <select
                name="status"
                defaultValue={s("status") || "Active"}
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              >
                {ASSET_STATUSES.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </select>
            </WField>
          </StepCard>
        </div>

        {/* ── STEP 2: Identification ───────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <StepCard title="Identification" description="Manufacturer details and registration identifiers.">
            <WField label="Brand">
              <TInput name="brand" defaultValue={s("brand")} placeholder="e.g. Caterpillar" />
            </WField>
            <WField label="Model">
              <TInput name="model" defaultValue={s("model")} placeholder="e.g. 320" />
            </WField>
            <WField label="Serial Number">
              <TInput name="serial_number" defaultValue={s("serial_number")} />
            </WField>
            <WField label="Assigned Operator / Driver">
              <TInput
                name="assigned_operator_driver"
                defaultValue={s("assigned_operator_driver")}
              />
            </WField>

            {isVehicle && (
              <div className="sm:col-span-2">
                <p className="mb-3 mt-2 text-xs font-black uppercase tracking-widest text-[#ED1C24]">
                  Vehicle Information
                </p>
              </div>
            )}
            {isVehicle ? (
              <>
                <WField label="Plate Number">
                  <TInput name="plate_number" defaultValue={s("plate_number")} />
                  <p className="mt-1 text-xs text-[#9CA3AF]">The vehicle&apos;s registration/traffic plate number.</p>
                </WField>
                <WField label="Model Year">
                  <TInput
                    name="model_year"
                    type="number"
                    defaultValue={s("model_year")}
                    placeholder="e.g. 2022"
                  />
                  <p className="mt-1 text-xs text-[#9CA3AF]">Year of manufacture — different from Model above.</p>
                </WField>
                <WField label="Chassis Number">
                  <TInput name="chassis_number" defaultValue={s("chassis_number")} />
                </WField>
                <WField label="Engine Number">
                  <TInput name="engine_number" defaultValue={s("engine_number")} />
                </WField>
              </>
            ) : (
              <>
                <input type="hidden" name="plate_number" value="" />
                <input type="hidden" name="model_year" value="" />
                <input type="hidden" name="chassis_number" value="" />
                <input type="hidden" name="engine_number" value="" />
              </>
            )}
          </StepCard>
        </div>

        {/* ── STEP 3: Service & Warranty ───────────────────────────────── */}
        <div className={step !== 3 ? "hidden" : ""}>
          <StepCard
            title="Service & Warranty"
            description="Dates, meter readings, and scheduled service intervals."
          >
            <WField label="Purchase Date">
              <TInput
                name="purchase_date"
                type="date"
                defaultValue={dateVal("purchase_date")}
              />
            </WField>
            <WField label="Warranty Expiry Date">
              <TInput
                name="warranty_expiry_date"
                type="date"
                defaultValue={dateVal("warranty_expiry_date")}
              />
            </WField>

            {isVehicle ? (
              <>
                <div className="sm:col-span-2">
                  <p className="mb-3 mt-2 text-xs font-black uppercase tracking-widest text-[#ED1C24]">
                    Vehicle Information
                  </p>
                </div>
                <WField label="Registration Expiry Date">
                  <TInput
                    name="registration_expiry_date"
                    type="date"
                    defaultValue={dateVal("registration_expiry_date")}
                  />
                  <p className="mt-1 text-xs text-[#9CA3AF]">Used for renewal tracking on the Vehicles page.</p>
                </WField>
                <WField label="Insurance Expiry Date">
                  <TInput
                    name="insurance_expiry_date"
                    type="date"
                    defaultValue={dateVal("insurance_expiry_date")}
                  />
                  <p className="mt-1 text-xs text-[#9CA3AF]">Used for renewal tracking on the Vehicles page.</p>
                </WField>
                <WField label="Current KM Reading">
                  <TInput
                    name="current_kilometer_reading"
                    type="number"
                    defaultValue={s("current_kilometer_reading")}
                  />
                </WField>
              </>
            ) : (
              <>
                <input type="hidden" name="registration_expiry_date" value="" />
                <input type="hidden" name="insurance_expiry_date" value="" />
                <input type="hidden" name="current_kilometer_reading" value="" />
              </>
            )}

            {isMachineType ? (
              <WField label="Current Running Hours">
                <TInput
                  name="current_running_hours"
                  type="number"
                  defaultValue={s("current_running_hours")}
                />
              </WField>
            ) : (
              <input type="hidden" name="current_running_hours" value="" />
            )}

            <WField label="Next Service Date">
              <TInput
                name="next_service_date"
                type="date"
                defaultValue={dateVal("next_service_date")}
              />
            </WField>

            {isVehicle ? (
              <WField label="Next Service KM">
                <TInput
                  name="next_service_kilometer"
                  type="number"
                  defaultValue={s("next_service_kilometer")}
                />
              </WField>
            ) : (
              <input type="hidden" name="next_service_kilometer" value="" />
            )}

            {isMachineType ? (
              <WField label="Next Service Running Hours">
                <TInput
                  name="next_service_running_hours"
                  type="number"
                  defaultValue={s("next_service_running_hours")}
                />
              </WField>
            ) : (
              <input type="hidden" name="next_service_running_hours" value="" />
            )}

            <WField label="Notes" span2>
              <textarea
                name="notes"
                rows={3}
                defaultValue={s("notes")}
                placeholder="Optional maintenance notes…"
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              />
            </WField>
          </StepCard>
        </div>

        {/* Hidden inputs — preserve existing condition/criticality/remarks without showing them */}
        <input type="hidden" name="condition" value={s("condition")} />
        <input type="hidden" name="criticality" value={s("criticality")} />
        <input type="hidden" name="remarks" value={s("remarks")} />

        {/* ── STEP 4: Review & Save ────────────────────────────────────── */}
        <div className={step !== 4 ? "hidden" : ""}>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="mb-5 border-b border-[#E5E7EB] pb-4">
              <h2 className="text-base font-bold text-[#111827]">Review & Save</h2>
              <p className="mt-0.5 text-xs text-[#4B5563]">
                Confirm the details below, then click Save Asset.
              </p>
            </div>

            <div className="space-y-5">
              <ReviewSection title="Basic Details">
                <ReviewRow label="Asset Code" value={reviewData.asset_code} />
                <ReviewRow label="Asset Name" value={reviewData.asset_name} />
                <ReviewRow label="Main Category" value={selectedMain || undefined} />
                <ReviewRow label="Subcategory" value={reviewData.category} />
                <ReviewRow label="Location" value={reviewData.location} />
                <ReviewRow label="Status" value={reviewData.status} />
              </ReviewSection>

              <ReviewSection title="Identification">
                <ReviewRow label="Brand" value={reviewData.brand} />
                <ReviewRow label="Model" value={reviewData.model} />
                <ReviewRow label="Serial Number" value={reviewData.serial_number} />
                <ReviewRow
                  label="Assigned Operator / Driver"
                  value={reviewData.assigned_operator_driver}
                />
                {isVehicle && (
                  <>
                    <ReviewRow label="Plate Number" value={reviewData.plate_number} />
                    <ReviewRow label="Model Year" value={reviewData.model_year} />
                    <ReviewRow label="Chassis Number" value={reviewData.chassis_number} />
                    <ReviewRow label="Engine Number" value={reviewData.engine_number} />
                  </>
                )}
              </ReviewSection>

              <ReviewSection title="Service & Warranty">
                <ReviewRow label="Purchase Date" value={reviewData.purchase_date} />
                <ReviewRow label="Warranty Expiry" value={reviewData.warranty_expiry_date} />
                {isVehicle && (
                  <>
                    <ReviewRow
                      label="Registration Expiry"
                      value={reviewData.registration_expiry_date}
                    />
                    <ReviewRow
                      label="Insurance Expiry"
                      value={reviewData.insurance_expiry_date}
                    />
                    <ReviewRow
                      label="Current KM"
                      value={
                        reviewData.current_kilometer_reading
                          ? `${reviewData.current_kilometer_reading} km`
                          : undefined
                      }
                    />
                    <ReviewRow
                      label="Next Service KM"
                      value={
                        reviewData.next_service_kilometer
                          ? `${reviewData.next_service_kilometer} km`
                          : undefined
                      }
                    />
                  </>
                )}
                {isMachineType && (
                  <>
                    <ReviewRow
                      label="Current Running Hours"
                      value={
                        reviewData.current_running_hours
                          ? `${reviewData.current_running_hours} hrs`
                          : undefined
                      }
                    />
                    <ReviewRow
                      label="Next Service Running Hours"
                      value={
                        reviewData.next_service_running_hours
                          ? `${reviewData.next_service_running_hours} hrs`
                          : undefined
                      }
                    />
                  </>
                )}
                <ReviewRow label="Next Service Date" value={reviewData.next_service_date} />
                <ReviewRow label="Notes" value={reviewData.notes} />
              </ReviewSection>

            </div>
          </div>
        </div>

        {/* ── Navigation buttons ───────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          {step > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] shadow-sm transition hover:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <Button type="submit">Save Asset</Button>
          )}
        </div>
      </form>
    </div>
  );
}
