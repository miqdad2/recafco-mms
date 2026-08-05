"use client";

import { useState } from "react";
import { assignTechniciansAction } from "@/app/actions/workflow";

type Technician = { id: string; full_name: string };

type AssignmentFormProps = {
  workOrderId: string;
  technicians: Technician[];
};

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24]";

const TYPES = [
  { value: "INTERNAL_TECHNICIAN", label: "Internal" },
  { value: "FREELANCER",          label: "Freelancer" },
  { value: "EXTERNAL_COMPANY",    label: "Company" },
] as const;

type AssignmentType = (typeof TYPES)[number]["value"];

export function AssignmentForm({ workOrderId, technicians }: AssignmentFormProps) {
  const [type, setType] = useState<AssignmentType>("INTERNAL_TECHNICIAN");

  const submitLabel =
    type === "INTERNAL_TECHNICIAN" ? "Assign Technician" :
    type === "FREELANCER"          ? "Assign Freelancer" :
    "Assign External Company";

  return (
    <form action={assignTechniciansAction} className="space-y-3">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <input type="hidden" name="assignment_type" value={type} />

      {/* Type selector */}
      <div>
        <p className="mb-1.5 text-xs font-bold text-[#4B5563]">Assignment type</p>
        <div className="grid grid-cols-3 gap-1.5">
          {TYPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-md border py-1.5 text-xs font-bold transition ${
                type === value
                  ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                  : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#ED1C24] hover:text-[#ED1C24]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Internal technician */}
      {type === "INTERNAL_TECHNICIAN" && (
        <select name="technician_ids" className={inp} required>
          <option value="">Select technician…</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{t.full_name}</option>
          ))}
        </select>
      )}

      {/* Freelancer */}
      {type === "FREELANCER" && (
        <div className="space-y-2">
          <input name="external_name" placeholder="Freelancer name *" className={inp} required />
          <input name="external_phone" placeholder="Phone" className={inp} />
          <input name="external_trade" placeholder="Work type / trade" className={inp} />
          <input name="agreed_amount" type="number" min="0" step="0.001" placeholder="Agreed amount / rate (optional)" className={inp} />
          <div>
            <label className="block text-xs text-[#9CA3AF] mb-1">Expected visit date</label>
            <input name="external_expected_visit_date" type="date" className={inp} />
          </div>
        </div>
      )}

      {/* External company */}
      {type === "EXTERNAL_COMPANY" && (
        <div className="space-y-2">
          <input name="external_company" placeholder="Company name *" className={inp} required />
          <input name="external_contact_person" placeholder="Contact person" className={inp} />
          <input name="external_phone" placeholder="Phone" className={inp} />
          <input name="external_trade" placeholder="Work type / service" className={inp} />
          <input name="agreed_amount" type="number" min="0" step="0.001" placeholder="Agreed amount (optional)" className={inp} />
          <div>
            <label className="block text-xs text-[#9CA3AF] mb-1">Expected visit date</label>
            <input name="external_expected_visit_date" type="date" className={inp} />
          </div>
        </div>
      )}

      {/* Common notes */}
      <textarea
        name="assign_notes"
        placeholder="Instructions / notes (optional)"
        className={`${inp} min-h-14 resize-none`}
        rows={2}
      />

      <button
        type="submit"
        className="w-full rounded-md bg-[#ED1C24] py-2 text-sm font-bold text-white transition hover:bg-red-700"
      >
        {submitLabel}
      </button>
    </form>
  );
}
