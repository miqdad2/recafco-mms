"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { upsertWorkOrderAction } from "@/app/actions/maintenance";
import { AttachmentUploadFields } from "@/components/files/attachment-upload-fields";
import {
  ATTACHMENT_FILE_ACCEPT,
  JOB_CARD_ATTACHMENT_CATEGORIES,
  MAX_ATTACHMENT_ROWS,
} from "@/lib/files/attachment-constants";

const MAINTENANCE_TYPES = [
  "Routine",
  "Service",
  "Breakdown",
  "Preventive",
  "Inspection",
  "Emergency",
  "Other",
];
const WORKER_TYPES = [
  "Auto",
  "Mechanical",
  "Electrical",
  "Civil",
  "AC",
  "Plumbing",
  "Welding/Fabrication",
  "Other",
];
const STEP_LABELS = ["Select Asset", "Request Details", "Assignment", "Required Parts", "Attachments", "Review & Save"];
const MAX_PART_ROWS = 8;

type AssetOption = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string | null;
  location: string | null;
  status: string;
  brand: string | null;
  model: string | null;
  plate_number: string | null;
  serial_number: string | null;
};

type ProfileOption = { id: string; name: string };

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
            <li key={label} className="flex flex-1 items-start min-w-0">
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

// ── Shared style tokens ───────────────────────────────────────────────────────

const inp =
  "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const ta = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm min-h-[5rem] resize-y";

// ── Main wizard export ────────────────────────────────────────────────────────

export function WorkOrderWizard({
  assets,
  supervisors,
  preselectedAssetId,
}: {
  assets: AssetOption[];
  supervisors: ProfileOption[];
  preselectedAssetId?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId ?? "");
  const [numPartRows, setNumPartRows] = useState(3);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewData, setReviewData] = useState<Record<string, string>>({});

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const form = formRef.current;

    if (step === 1 && !selectedAssetId) {
      errs.asset_id = "Please select an asset or machine to continue.";
    }

    if (step === 2 && form) {
      const fd = new FormData(form);
      if (!fd.get("ordered_by")?.toString().trim()) errs.ordered_by = "This field is required.";
      if (!fd.get("date_of_order")?.toString().trim()) errs.date_of_order = "This field is required.";
      if (!fd.get("operator_complaint")?.toString().trim())
        errs.operator_complaint = "Describe the complaint or issue.";
    }

    if (step === 3 && form) {
      const fd = new FormData(form);
      if (!fd.get("worker_type")?.toString().trim())
        errs.worker_type = "Please select a worker team.";
    }

    if (step === 4 && form) {
      const fd = new FormData(form);
      for (let i = 0; i < MAX_PART_ROWS; i++) {
        if (!fd.get(`req_part_description_${i}`)?.toString().trim()) continue;
        const qty = Number(fd.get(`req_part_quantity_${i}`));
        if (!Number.isInteger(qty) || qty <= 0) {
          errs.required_parts = "Quantity must be a whole number greater than 0.";
        }
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    const next = step + 1;
    if (next === 6) {
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

  const reviewTech = supervisors.find((s) => s.id === reviewData.assigned_supervisor_id)?.name;
  const reviewParts = Array.from({ length: MAX_PART_ROWS }, (_, i) => ({
    desc: reviewData[`req_part_description_${i}`] ?? "",
    partNo: reviewData[`req_part_part_number_${i}`] ?? "",
    qty: reviewData[`req_part_quantity_${i}`] ?? "1",
    unit: reviewData[`req_part_uom_${i}`] ?? "PCS",
  })).filter((p) => p.desc);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <StepIndicator current={step} />

      <form ref={formRef} action={upsertWorkOrderAction}>
        {/* Controlled fields derived from selected asset */}
        <input type="hidden" name="asset_category" value={selectedAsset?.category ?? ""} />
        <input type="hidden" name="serial_number" value={selectedAsset?.serial_number ?? ""} />
        <input type="hidden" name="plate_number" value={selectedAsset?.plate_number ?? ""} />
        {/* Fields not shown in wizard steps */}
        <input type="hidden" name="supervisor_verification" value="" />
        <input type="hidden" name="maintenance_manager_closure" value="" />
        <input type="hidden" name="operator_requester_confirmation" value="" />

        {/* ── Step 1: Select Asset ───────────────────────────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <WizardCard
            title="Select Asset / Machine"
            description="All repair records will be linked to this asset."
          >
            <div>
              <label className="block">
                <FieldLabel label="Asset / Machine" required />
                <select
                  name="asset_id"
                  className={inp}
                  value={selectedAssetId}
                  onChange={(e) => {
                    setSelectedAssetId(e.target.value);
                    setErrors({});
                  }}
                >
                  <option value="">— Select asset or machine —</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.asset_code} — {a.asset_name}
                      {a.plate_number ? ` / ${a.plate_number}` : ""}
                      {a.category ? ` [${a.category}]` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {errors.asset_id && (
                <p className="mt-1 text-xs text-[#DC2626]">{errors.asset_id}</p>
              )}
            </div>

            {selectedAsset ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
                  Selected Asset
                </p>
                <p className="mt-1 text-base font-black text-[#111827]">
                  {selectedAsset.asset_code} — {selectedAsset.asset_name}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedAsset.category && <AssetChip>{selectedAsset.category}</AssetChip>}
                  {selectedAsset.location && <AssetChip>{selectedAsset.location}</AssetChip>}
                  {(selectedAsset.brand || selectedAsset.model) && (
                    <AssetChip>
                      {[selectedAsset.brand, selectedAsset.model].filter(Boolean).join(" / ")}
                    </AssetChip>
                  )}
                  <AssetStatusBadge status={selectedAsset.status} />
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Please select an asset or machine to link this job card to.
              </p>
            )}
          </WizardCard>
        </div>

        {/* ── Step 2: Request Details ────────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <WizardCard
            title="Complaint / Request Details"
            description="Capture the complaint, type of work, and urgency."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block">
                  <FieldLabel label="Order taken by" required />
                  <input name="ordered_by" className={inp} placeholder="Full name" />
                </label>
                {errors.ordered_by && (
                  <p className="mt-1 text-xs text-[#DC2626]">{errors.ordered_by}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Date of order" required />
                  <input name="date_of_order" type="date" defaultValue={today} className={inp} />
                </label>
                {errors.date_of_order && (
                  <p className="mt-1 text-xs text-[#DC2626]">{errors.date_of_order}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Job location" hint="optional" />
                  <input name="job_location" className={inp} placeholder="Site, building, or area" />
                </label>
              </div>

              {/* priority defaulted to Normal — not shown to user */}
              <input type="hidden" name="priority" value="Normal" />

              <div>
                <label className="block">
                  <FieldLabel label="Running hours" hint="optional" />
                  <input
                    name="running_hours"
                    type="number"
                    step="0.01"
                    className={inp}
                    placeholder="e.g. 1250"
                  />
                </label>
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Kilometers" hint="optional" />
                  <input
                    name="kilometers"
                    type="number"
                    step="0.01"
                    className={inp}
                    placeholder="e.g. 45000"
                  />
                </label>
              </div>
            </div>

            <div className="mt-5">
              <FieldLabel label="Maintenance type" required />
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {MAINTENANCE_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[#111827]"
                  >
                    <input
                      type="radio"
                      name="maintenance_type"
                      value={t}
                      defaultChecked={t === "Breakdown"}
                      className="accent-[#ED1C24]"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <label className="block">
                <FieldLabel label="Operator complaint" required />
                <textarea
                  name="operator_complaint"
                  className={ta}
                  placeholder="Describe the issue, fault, or complaint reported by the operator…"
                />
              </label>
              {errors.operator_complaint && (
                <p className="mt-1 text-xs text-[#DC2626]">{errors.operator_complaint}</p>
              )}
            </div>

            <div className="mt-4">
              <label className="block">
                <FieldLabel label="Description of work" hint="optional" />
                <textarea
                  name="description_of_work"
                  className={ta}
                  placeholder="Describe the work required or to be carried out…"
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="block">
                <FieldLabel label="Notes" hint="optional" />
                <textarea
                  name="notes"
                  className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm min-h-[3rem] resize-y"
                  placeholder="Internal notes…"
                />
              </label>
            </div>
          </WizardCard>
        </div>

        {/* ── Step 3: Assignment Planning ────────────────────────────────── */}
        <div className={step !== 3 ? "hidden" : ""}>
          <WizardCard
            title="Assignment Planning"
            description="Select the maintenance team and optionally pre-assign a technician."
          >
            <div>
              <FieldLabel label="Worker team / trade" required />
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {WORKER_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[#111827]"
                  >
                    <input
                      type="radio"
                      name="worker_type"
                      value={t}
                      defaultChecked={t === "Mechanical"}
                      className="accent-[#ED1C24]"
                    />
                    {t}
                  </label>
                ))}
              </div>
              {errors.worker_type && (
                <p className="mt-1 text-xs text-[#DC2626]">{errors.worker_type}</p>
              )}
            </div>

            <div className="mt-5 max-w-xs">
              <label className="block">
                <FieldLabel label="Assigned technician" hint="optional" />
                <select name="assigned_supervisor_id" defaultValue="" className={inp}>
                  <option value="">Not yet assigned</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </WizardCard>
        </div>

        {/* ── Step 4: Required Parts ─────────────────────────────────────── */}
        <div className={step !== 4 ? "hidden" : ""}>
          <WizardCard
            title="Required Parts"
            description="List expected parts for this job. This is not a purchase order — it is a planned parts list."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                    <th className="w-8 border border-[#E5E7EB] px-2 py-2">#</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Description / Part Name</th>
                    <th className="w-28 border border-[#E5E7EB] px-3 py-2">Part No.</th>
                    <th className="w-16 border border-[#E5E7EB] px-3 py-2">Qty</th>
                    <th className="w-20 border border-[#E5E7EB] px-3 py-2">Unit</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: MAX_PART_ROWS }, (_, i) => (
                    <tr key={i} className={i >= numPartRows ? "hidden" : ""}>
                      <td className="border border-[#E5E7EB] px-2 py-1.5 text-center text-xs font-semibold text-[#9CA3AF]">
                        {i + 1}
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`req_part_description_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                          placeholder={i === 0 ? "e.g. oil filter…" : ""}
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`req_part_part_number_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`req_part_quantity_${i}`}
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          defaultValue="1"
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`req_part_uom_${i}`}
                          defaultValue="PCS"
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5">
                        <input
                          name={`req_part_notes_${i}`}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errors.required_parts && (
              <p className="mt-2 text-xs text-[#DC2626]">{errors.required_parts}</p>
            )}

            {numPartRows < MAX_PART_ROWS && (
              <button
                type="button"
                onClick={() => setNumPartRows((n) => n + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Row
              </button>
            )}
          </WizardCard>
        </div>

        {/* ── Step 5: Attachments ─────────────────────────────────── */}
        <div className={step !== 5 ? "hidden" : ""}>
          <WizardCard
            title="Attachments"
            description="Optional — upload problem photos, PDFs, Excel files, Word documents, or supporting files. On mobile, you can take a live photo."
          >
            <AttachmentUploadFields
              namePrefix="doc_attachment"
              categories={JOB_CARD_ATTACHMENT_CATEGORIES}
              defaultCategory="Problem Photo"
              accept={ATTACHMENT_FILE_ACCEPT}
              maxRows={MAX_ATTACHMENT_ROWS}
            />
            <p className="mt-4 text-xs text-[#9CA3AF]">
              Accepted: PDF, JPG, JPEG, PNG, WEBP, XLS, XLSX, DOC, DOCX
            </p>
          </WizardCard>
        </div>

        {/* ── Step 6: Review & Save ──────────────────────────────────────── */}
        <div className={step !== 6 ? "hidden" : ""}>
          <WizardCard
            title="Review & Save"
            description="Confirm all details before saving. A reference number is generated automatically."
          >
            <div className="space-y-5">
              <ReviewSection title="Asset / Machine">
                {selectedAsset ? (
                  <div>
                    <p className="font-bold text-[#111827]">
                      {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    </p>
                    <p className="mt-0.5 text-xs text-[#4B5563]">
                      {[selectedAsset.category, selectedAsset.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">
                      Status: {selectedAsset.status}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm italic text-[#9CA3AF]">No asset selected</p>
                )}
              </ReviewSection>

              <ReviewSection title="Request Details">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {reviewData.ordered_by && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Order taken by</p>
                      <p className="mt-0.5 text-[15px] font-semibold text-[#111827]">{reviewData.ordered_by}</p>
                    </div>
                  )}
                  {reviewData.date_of_order && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Date of order</p>
                      <p className="mt-0.5 text-[15px] font-semibold text-[#111827]">{reviewData.date_of_order}</p>
                    </div>
                  )}
                  {reviewData.maintenance_type && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Maintenance type</p>
                      <p className="mt-0.5 text-[15px] font-semibold text-[#111827]">{reviewData.maintenance_type}</p>
                    </div>
                  )}
                  {reviewData.job_location && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Job location</p>
                      <p className="mt-0.5 text-[15px] font-semibold text-[#111827]">{reviewData.job_location}</p>
                    </div>
                  )}
                </div>
                {reviewData.operator_complaint && (
                  <div className="mt-5 border-t border-[#F3F4F6] pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Operator complaint</p>
                    <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-[#111827]">{reviewData.operator_complaint}</p>
                  </div>
                )}
                {reviewData.description_of_work && (
                  <div className="mt-4 border-t border-[#F3F4F6] pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Description of work</p>
                    <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-[#111827]">{reviewData.description_of_work}</p>
                  </div>
                )}
              </ReviewSection>

              <ReviewSection title="Assignment">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReviewRow label="Worker team" value={reviewData.worker_type} />
                  <ReviewRow label="Assigned technician" value={reviewTech} />
                </dl>
              </ReviewSection>

              {reviewParts.length > 0 && (
                <ReviewSection title="Required Parts">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F3F4F6] text-left text-[10px] font-bold text-[#4B5563]">
                          <th className="px-3 py-1.5">Description</th>
                          <th className="px-3 py-1.5">Part No.</th>
                          <th className="px-3 py-1.5">Qty</th>
                          <th className="px-3 py-1.5">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {reviewParts.map((p, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 text-[#111827]">{p.desc}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">{p.partNo || "—"}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">{p.qty}</td>
                            <td className="px-3 py-1.5 text-[#4B5563]">{p.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ReviewSection>
              )}
            </div>

            <div className="mt-6 space-y-2 border-t border-[#E5E7EB] pt-5">
              <button
                type="submit"
                name="intent"
                value="submit_for_approval"
                className="focus-ring w-full rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
              >
                Submit Job Card
              </button>
              <button
                type="submit"
                name="intent"
                value="save_draft"
                className="focus-ring w-full rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6]"
              >
                Save Draft
              </button>
              <p className="text-center text-xs text-[#9CA3AF]">Draft can be edited and submitted later.</p>
            </div>
          </WizardCard>
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
          {step < 6 && (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-red-700"
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

function WizardCard({
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

function FieldLabel({
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

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
        {title}
      </h3>
      <div className="rounded-md border border-[#E5E7EB] p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined | null;
}) {
  if (!value) return null;
  return (
    <div className="py-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[#111827]">{value}</dd>
    </div>
  );
}

function AssetChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#4B5563]">
      {children}
    </span>
  );
}

function AssetStatusBadge({ status }: { status: string }) {
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
