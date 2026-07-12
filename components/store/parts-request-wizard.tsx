"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { createPartsRequestAction } from "@/app/actions/phase4";

const MAX_ITEM_ROWS = 8;

type AssetSummary = {
  asset_code: string;
  asset_name: string;
  location: string | null;
  category: string | null;
  status: string;
};

export type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
  ordered_by: string | null;
  worker_type: string | null;
  maintenance_type: string | null;
  operator_complaint: string | null;
  created_at: string;
  assets: AssetSummary | null;
};

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <nav aria-label="Wizard progress" className="mb-8">
      <ol className="flex items-start">
        {labels.map((label, idx) => {
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
              {n < labels.length && (
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

// ── Shared style tokens ───────────────────────────────────────────────────────

const inp =
  "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";

// ── Main wizard export ────────────────────────────────────────────────────────

export function PartsRequestWizard({
  workOrders,
  preselectedWorkOrderId,
  preselectedWorkOrder,
}: {
  workOrders: WorkOrderOption[];
  preselectedWorkOrderId?: string;
  preselectedWorkOrder?: WorkOrderOption | null;
}) {
  const isPreselected = !!preselectedWorkOrderId;

  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [selectedWoId, setSelectedWoId] = useState(preselectedWorkOrderId ?? "");
  const [numItemRows, setNumItemRows] = useState(3);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewData, setReviewData] = useState<Record<string, string>>({});

  // Resolve the selected work order: use preselected prop if provided, else find in list
  const selectedWo: WorkOrderOption | null = isPreselected
    ? (preselectedWorkOrder ?? null)
    : (workOrders.find((w) => w.id === selectedWoId) ?? null);

  const selectedAsset = selectedWo?.assets ?? null;

  const stepLabels = isPreselected
    ? ["Job Card Context", "Requested Materials", "Review & Submit"]
    : ["Select Job Card", "Requested Materials", "Review & Submit"];

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (step === 1 && !isPreselected && !selectedWoId) {
      errs.work_order_id = "Please select a job card.";
    }

    if (step === 2) {
      const form = formRef.current;
      if (form) {
        const fd = new FormData(form);
        let hasItem = false;
        for (let i = 0; i < MAX_ITEM_ROWS; i++) {
          if (fd.get(`description_${i}`)?.toString().trim()) {
            hasItem = true;
            break;
          }
        }
        if (!hasItem) errs.items = "Please add at least one part or material.";
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
          if (String(v).trim()) obj[k] = String(v);
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

  const reviewItems = Array.from({ length: MAX_ITEM_ROWS }, (_, i) => ({
    desc: reviewData[`description_${i}`] ?? "",
    partNo: reviewData[`part_number_${i}`] ?? "",
    qty: reviewData[`quantity_requested_${i}`] ?? "1",
    ssCode: reviewData[`ss_rec_code_${i}`] ?? "",
    unitPrice: reviewData[`unit_price_${i}`] ?? "",
    remarks: reviewData[`remarks_${i}`] ?? "",
  })).filter((it) => it.desc);

  return (
    <div className="mx-auto max-w-3xl">
      <StepIndicator current={step} labels={stepLabels} />

      <form ref={formRef} action={createPartsRequestAction}>
        {/* Always include work_order_id — via hidden input (pre-selected) or select (normal) */}
        {isPreselected && (
          <input type="hidden" name="work_order_id" value={selectedWoId} />
        )}

        {/* ── Step 1: Job Card Context / Select Job Card ─────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <PRCard
            title={isPreselected ? "Job Card Context" : "Select Job Card"}
            description={
              isPreselected
                ? "This materials request is linked to the job card below."
                : "Asset details will load automatically from the linked job card."
            }
          >
            {/* Pre-selected: show read-only context */}
            {isPreselected ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#ED1C24]/30 bg-red-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#ED1C24]">
                    Job Card
                  </p>
                  <p className="mt-1 font-bold text-[#111827]">
                    {selectedWo?.work_order_number ?? "Draft"}
                    {selectedWo?.ordered_by ? ` — ${selectedWo.ordered_by}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {selectedWo?.maintenance_type && (
                      <PRChip>{selectedWo.maintenance_type}</PRChip>
                    )}
                    {selectedWo?.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                  </div>
                  {selectedWo?.operator_complaint && (
                    <p className="mt-2 text-xs italic text-[#4B5563]">
                      {selectedWo.operator_complaint}
                    </p>
                  )}
                </div>

                {selectedAsset && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
                      Linked Asset / Machine
                    </p>
                    <p className="mt-1 font-bold text-[#111827]">
                      {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {selectedAsset.category && <PRChip>{selectedAsset.category}</PRChip>}
                      {selectedAsset.location && <PRChip>{selectedAsset.location}</PRChip>}
                      <PRStatusBadge status={selectedAsset.status} />
                    </div>
                  </div>
                )}

                <p className="text-xs text-[#9CA3AF]">
                  Click Next to add the materials needed for this job card.
                </p>
              </div>
            ) : (
              /* Normal flow: show work order dropdown */
              <div>
                <label className="block">
                  <PRLabel label="Job Card" required />
                  <select
                    name="work_order_id"
                    className={inp}
                    value={selectedWoId}
                    onChange={(e) => {
                      setSelectedWoId(e.target.value);
                      setErrors({});
                    }}
                  >
                    <option value="">— Select a job card —</option>
                    {workOrders.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.work_order_number ?? "Draft"} — {w.ordered_by}
                        {w.maintenance_type ? ` [${w.maintenance_type}]` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {errors.work_order_id && (
                  <p className="mt-1 text-xs text-[#DC2626]">{errors.work_order_id}</p>
                )}

                {selectedWo && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                        Job Card
                      </p>
                      <p className="mt-1 font-bold text-[#111827]">
                        {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {selectedWo.maintenance_type && (
                          <PRChip>{selectedWo.maintenance_type}</PRChip>
                        )}
                        {selectedWo.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                      </div>
                      {selectedWo.operator_complaint && (
                        <p className="mt-2 text-xs italic text-[#4B5563]">
                          {selectedWo.operator_complaint}
                        </p>
                      )}
                    </div>

                    {selectedAsset && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
                          Linked Asset
                        </p>
                        <p className="mt-1 font-bold text-[#111827]">
                          {selectedAsset.asset_code} — {selectedAsset.asset_name}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {selectedAsset.category && <PRChip>{selectedAsset.category}</PRChip>}
                          {selectedAsset.location && <PRChip>{selectedAsset.location}</PRChip>}
                          <PRStatusBadge status={selectedAsset.status} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!selectedWo && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Select a job card above to view its linked asset details.
                  </p>
                )}
              </div>
            )}
          </PRCard>
        </div>

        {/* ── Step 2: Requested Parts ────────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <PRCard
            title="Requested Materials"
            description="List the materials required for this job card."
          >
            {/* Compact RO context reminder */}
            {selectedWo && (
              <div className="mb-4 rounded-md border-l-4 border-[#ED1C24] bg-red-50 px-4 py-3">
                <p className="text-xs font-bold text-[#ED1C24]">
                  {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                </p>
                {selectedAsset && (
                  <p className="mt-0.5 text-xs text-[#4B5563]">
                    Asset: {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    {selectedAsset.location ? ` · ${selectedAsset.location}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block">
                <PRLabel label="Overall remarks" hint="optional" />
                <input
                  name="remarks"
                  className={inp}
                  placeholder="General notes for this materials request…"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                    <th className="w-8 border border-[#E5E7EB] px-2 py-2">#</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Part / Material</th>
                    <th className="w-28 border border-[#E5E7EB] px-3 py-2">Part No.</th>
                    <th className="w-24 border border-[#E5E7EB] px-3 py-2">SS Rec. Code</th>
                    <th className="w-16 border border-[#E5E7EB] px-3 py-2">Qty</th>
                    <th className="w-20 border border-[#E5E7EB] px-3 py-2">Unit</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: MAX_ITEM_ROWS }, (_, i) => (
                    <tr key={i} className={i >= numItemRows ? "hidden" : ""}>
                      <td className="border border-[#E5E7EB] px-2 py-1.5 text-center text-xs font-semibold text-[#9CA3AF]">
                        {i + 1}
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`description_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                          placeholder={i === 0 ? "e.g. oil filter…" : ""}
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`part_number_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`ss_rec_code_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`quantity_requested_${i}`}
                          type="number"
                          step="0.001"
                          defaultValue="1"
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`unit_of_measure_${i}`}
                          defaultValue="PCS"
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`remarks_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errors.items && (
              <p className="mt-2 text-xs text-[#DC2626]">{errors.items}</p>
            )}

            {numItemRows < MAX_ITEM_ROWS && (
              <button
                type="button"
                onClick={() => setNumItemRows((n) => n + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Row
              </button>
            )}
          </PRCard>
        </div>

        {/* ── Step 3: Review & Submit ────────────────────────────────────── */}
        <div className={step !== 3 ? "hidden" : ""}>
          <PRCard
            title="Review & Submit"
            description="Confirm all details before submitting the materials request."
          >
            <div className="space-y-5">
              <PRReviewSection title="Job Card">
                {selectedWo ? (
                  <div>
                    <p className="font-bold text-[#111827]">
                      {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selectedWo.maintenance_type && (
                        <PRChip>{selectedWo.maintenance_type}</PRChip>
                      )}
                      {selectedWo.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                    </div>
                    {selectedAsset && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-[#4B5563]">
                          Asset: {selectedAsset.asset_code} — {selectedAsset.asset_name}
                        </p>
                        {selectedAsset.location && (
                          <p className="text-xs text-[#4B5563]">
                            Location: {selectedAsset.location}
                          </p>
                        )}
                      </div>
                    )}
                    {selectedWo.operator_complaint && (
                      <p className="mt-2 text-xs italic text-[#4B5563]">
                        {selectedWo.operator_complaint}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm italic text-[#9CA3AF]">No job card selected</p>
                )}
              </PRReviewSection>

              {reviewItems.length > 0 ? (
                <PRReviewSection title="Requested Parts">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F3F4F6] text-left text-[10px] font-bold text-[#4B5563]">
                          <th className="px-3 py-1.5">#</th>
                          <th className="px-3 py-1.5">Part / Material</th>
                          <th className="px-3 py-1.5">Part No.</th>
                          <th className="px-3 py-1.5">Qty</th>
                          <th className="px-3 py-1.5">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {reviewItems.map((it, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 text-[#9CA3AF]">{i + 1}</td>
                            <td className="px-3 py-1.5 text-[#111827]">{it.desc}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">{it.partNo || "—"}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">{it.qty}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">
                              {reviewData[`unit_of_measure_${i}`] || "PCS"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {reviewData.remarks && (
                    <p className="mt-3 text-xs text-[#4B5563]">
                      <strong>Remarks:</strong> {reviewData.remarks}
                    </p>
                  )}
                </PRReviewSection>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-700">
                    No parts have been added. Go back to Step 2 to add parts.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-[#E5E7EB] pt-5">
              <button
                type="submit"
                className="focus-ring w-full rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                Submit Materials Request
              </button>
              <p className="mt-2 text-center text-xs text-[#9CA3AF]">
                A reference number will be generated on submission.
              </p>
            </div>
          </PRCard>
        </div>

        {/* ── Navigation ────────────────────────────────────────────────── */}
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
        </div>
      </form>
    </div>
  );
}

// ── Local sub-components ──────────────────────────────────────────────────────

function PRCard({
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

function PRLabel({
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
      {hint && <span className="ml-2 text-xs font-normal text-[#9CA3AF]">{hint}</span>}
    </span>
  );
}

function PRReviewSection({
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
      <div className="rounded-md border border-[#E5E7EB] p-4">{children}</div>
    </section>
  );
}

function PRChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#4B5563]">
      {children}
    </span>
  );
}

function PRStatusBadge({ status }: { status: string }) {
  const cls =
    status === "Breakdown"
      ? "bg-red-100 text-red-700"
      : status === "Active" || status === "In Use"
        ? "bg-green-100 text-green-700"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{status}</span>
  );
}
