"use client";

import { useState, useEffect, useActionState } from "react";
import { X, AlertCircle, Loader2 } from "lucide-react";
import {
  assignTechniciansModalAction,
  type AssignModalState,
} from "@/app/actions/workflow";

type Technician = { id: string; full_name: string };

type Props = {
  workOrderId: string;
  technicians: Technician[];
  onSuccess: () => void;
  onCancel: () => void;
};

const TYPES = [
  { value: "INTERNAL_TECHNICIAN", label: "Internal" },
  { value: "FREELANCER",          label: "Freelancer" },
  { value: "EXTERNAL_COMPANY",    label: "Company" },
] as const;

type AssignmentType = (typeof TYPES)[number]["value"];

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";

export function AssignmentFormModal({
  workOrderId,
  technicians,
  onSuccess,
  onCancel,
}: Props) {
  const [type, setType] = useState<AssignmentType>("INTERNAL_TECHNICIAN");
  const [state, formAction, isPending] = useActionState<AssignModalState, FormData>(
    assignTechniciansModalAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const submitLabel =
    type === "INTERNAL_TECHNICIAN" ? "Assign Technician" :
    type === "FREELANCER"          ? "Assign Freelancer" :
    "Assign External Company";

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
          Assign Work
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md p-1 text-[#9CA3AF] hover:text-[#4B5563] disabled:opacity-50"
          aria-label="Cancel assignment"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {state?.ok === false && state.error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <form action={formAction} className="space-y-3">
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
                disabled={isPending}
                className={`rounded-md border py-1.5 text-xs font-bold transition disabled:opacity-50 ${
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
          <select
            name="technician_ids"
            className={inp}
            required
            disabled={isPending}
          >
            <option value="">Select technician…</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        )}

        {/* Freelancer */}
        {type === "FREELANCER" && (
          <div className="space-y-2">
            <input
              name="external_name"
              placeholder="Freelancer name *"
              className={inp}
              required
              disabled={isPending}
            />
            <input
              name="external_phone"
              placeholder="Phone"
              className={inp}
              disabled={isPending}
            />
            <input
              name="external_trade"
              placeholder="Work type / trade"
              className={inp}
              disabled={isPending}
            />
            <input
              name="agreed_amount"
              type="number"
              min="0"
              step="0.001"
              placeholder="Agreed amount / rate (optional)"
              className={inp}
              disabled={isPending}
            />
            <div>
              <label className="mb-1 block text-xs text-[#9CA3AF]">
                Expected visit date
              </label>
              <input
                name="external_expected_visit_date"
                type="date"
                className={inp}
                disabled={isPending}
              />
            </div>
          </div>
        )}

        {/* External company */}
        {type === "EXTERNAL_COMPANY" && (
          <div className="space-y-2">
            <input
              name="external_company"
              placeholder="Company name *"
              className={inp}
              required
              disabled={isPending}
            />
            <input
              name="external_contact_person"
              placeholder="Contact person"
              className={inp}
              disabled={isPending}
            />
            <input
              name="external_phone"
              placeholder="Phone"
              className={inp}
              disabled={isPending}
            />
            <input
              name="external_trade"
              placeholder="Work type / service"
              className={inp}
              disabled={isPending}
            />
            <input
              name="agreed_amount"
              type="number"
              min="0"
              step="0.001"
              placeholder="Agreed amount (optional)"
              className={inp}
              disabled={isPending}
            />
            <div>
              <label className="mb-1 block text-xs text-[#9CA3AF]">
                Expected visit date
              </label>
              <input
                name="external_expected_visit_date"
                type="date"
                className={inp}
                disabled={isPending}
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <textarea
          name="assign_notes"
          placeholder="Instructions / notes (optional)"
          className={`${inp} min-h-14 resize-none`}
          rows={2}
          disabled={isPending}
        />

        <button
          type="submit"
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Assigning…" : submitLabel}
        </button>
      </form>
    </div>
  );
}
