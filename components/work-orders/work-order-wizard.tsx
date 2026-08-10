"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";

import { upsertWorkOrderAction } from "@/app/actions/maintenance";
import { searchOfflineInventoryMaterialsAction } from "@/app/actions/offline-inventory";
import type { OfflineInventorySearchMatch } from "@/lib/store/offline-inventory-data";
import { AttachmentUploadFields } from "@/components/files/attachment-upload-fields";
import { AssetSearchPicker, type AssetPickerOption } from "@/components/assets/asset-search-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ATTACHMENT_FILE_ACCEPT,
  JOB_CARD_ATTACHMENT_CATEGORIES,
  MAX_ATTACHMENT_ROWS,
} from "@/lib/files/attachment-constants";
import { MAINTENANCE_TYPES, DEFAULT_MAINTENANCE_TYPE } from "@/lib/work-orders/maintenance-types";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";

// Required Materials Inventory Matching Unit 5 — Required Materials row
// state. Description/Part No./Qty/Unit were previously plain uncontrolled
// inputs (name attribute only); they're controlled now so a selected
// Offline Inventory suggestion can fill them in and so quantity changes can
// recompute availability without another server round trip.
type RequiredMaterialRowState = {
  description: string;
  partNumber: string;
  qty: string;
  unit: string;
  notes: string;
  // Identity key of the Offline Inventory match the user selected from the
  // dropdown (same "part:<id>" / "manual:<name>|<unit>" key used across
  // Offline Inventory Control) — null once the description is hand-typed or
  // edited away from a selected suggestion (Task 5).
  materialKey: string | null;
  balance: number | null;
  suggestions: OfflineInventorySearchMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
};

function emptyMaterialRow(): RequiredMaterialRowState {
  return {
    description: "",
    partNumber: "",
    // Required Materials Empty Row Quantity UX Fix Unit 10F.5, Task 1: an
    // empty row must not look like a real material row with Qty 1 — blank
    // until the user actually enters a material name (see
    // handleMaterialNameChange/handleSelectSuggestion, Task 2).
    qty: "",
    unit: "PCS",
    notes: "",
    materialKey: null,
    balance: null,
    suggestions: [],
    showSuggestions: false,
    loading: false,
    searched: false,
  };
}

type RowAvailability =
  | { kind: "available" }
  | { kind: "partial"; shortage: number }
  | { kind: "unavailable" }
  | { kind: "new" };

function computeRowAvailability(row: RequiredMaterialRowState): RowAvailability | null {
  if (!row.description.trim()) return null;
  if (row.materialKey === null || row.balance === null) return { kind: "new" };
  const qty = Number(row.qty) || 0;
  if (row.balance <= 0) return { kind: "unavailable" };
  if (qty <= row.balance) return { kind: "available" };
  return { kind: "partial", shortage: qty - row.balance };
}

function AvailabilityBadge({ row }: { row: RequiredMaterialRowState }) {
  const availability = computeRowAvailability(row);
  if (!availability) return null;

  if (availability.kind === "available") {
    return (
      <div className="mt-1 flex items-center gap-2">
        <StatusBadge label="Available" tone="green" />
        {row.balance !== null && (
          <span className="text-[11px] text-[#6B7280]">
            Available: {row.balance} {row.unit}
          </span>
        )}
      </div>
    );
  }
  if (availability.kind === "partial") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StatusBadge label="Partially Available" tone="amber" />
        <span className="text-[11px] font-semibold text-[#B45309]">
          Shortage: {availability.shortage} {row.unit}
        </span>
      </div>
    );
  }
  if (availability.kind === "unavailable") {
    return (
      <div className="mt-1">
        <StatusBadge label="Not Available" tone="red" />
      </div>
    );
  }
  return (
    <div className="mt-1">
      <StatusBadge label="New Material" tone="gray" />
    </div>
  );
}

// Worker Team / Division Option Cleanup: narrowed to the 4 options
// management wants offered for new Job Cards. The database still allows the
// full historical set (Civil/AC/Plumbing/Welding/Fabrication) via
// work_orders_worker_type_check — this list only controls what a NEW Job
// Card can select, it does not migrate or block existing records.
const WORKER_TYPES = ["Auto", "Mechanical", "Electrical", "Other"];
const STEP_LABELS = ["Select Asset", "Request Details", "Work Team & Assignment", "Required Materials", "Attachments", "Review & Save"];
const MAX_PART_ROWS = 8;

// Optional Work Assignment During Job Card Creation Unit 7C.
//
// "INTERNAL_TEAM" here means the Unit 7 worker_profiles-backed roster
// (Supervisor/Technicians/Helpers, saved via assignInternalTeamRoster) —
// distinct from the legacy single-technician "INTERNAL_TECHNICIAN" type the
// Job Card detail page's separate "Assign Work" panel still uses for
// technician self-service login linkage. Freelancer/External Company here
// reuse that same legacy work_order_assignments mechanism (assignTechnicians)
// since Unit 7 already added everything they need (agreed_amount).
type WizardAssignmentType = "INTERNAL_TEAM" | "FREELANCER" | "EXTERNAL_COMPANY";

const ASSIGNMENT_TYPE_OPTIONS: { value: WizardAssignmentType; label: string }[] = [
  { value: "INTERNAL_TEAM", label: "Internal Team" },
  { value: "FREELANCER", label: "Freelancer" },
  { value: "EXTERNAL_COMPANY", label: "External Company" },
];

type WizardAssignmentState = {
  assignNow: boolean;
  type: WizardAssignmentType;
  supervisorId: string;
  technicianIds: string[];
  helperIds: string[];
  notes: string;
  freelancerName: string;
  freelancerPhone: string;
  freelancerTrade: string;
  freelancerAmount: string;
  companyName: string;
  companyContact: string;
  companyPhone: string;
  companyTrade: string;
  companyAmount: string;
};

const EMPTY_ASSIGNMENT: WizardAssignmentState = {
  assignNow: false,
  type: "INTERNAL_TEAM",
  supervisorId: "",
  technicianIds: [],
  helperIds: [],
  notes: "",
  freelancerName: "",
  freelancerPhone: "",
  freelancerTrade: "",
  freelancerAmount: "",
  companyName: "",
  companyContact: "",
  companyPhone: "",
  companyTrade: "",
  companyAmount: "",
};

type AssetOption = AssetPickerOption;

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Wizard progress">
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
  preselectedAssetId,
  dismissHref,
  activeWorkers = [],
  canAssignAtCreation = false,
}: {
  assets: AssetOption[];
  preselectedAssetId?: string | null;
  // New Job Card Modal Wizard Refactor: where "Cancel"/"X"/"Discard and Exit"
  // navigate to once the modal is dismissed — the Job Cards list when opened
  // from its own standalone route, or the current page with the modal's own
  // query param stripped when opened as an overlay from Dashboard/Asset
  // Details/Vehicles.
  dismissHref: string;
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10:
  // omitted/false for any caller that can't hold work_orders.assign — the
  // "Assign work now" section simply never renders for them.
  activeWorkers?: WorkerProfileRow[];
  canAssignAtCreation?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId ?? "");
  // Unit 10F.5, Task 3 (Recommended): one empty row by default + Add Row,
  // instead of 3 always-visible rows that looked like real material lines.
  const [numPartRows, setNumPartRows] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewData, setReviewData] = useState<Record<string, string>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Cancel/Close Confirmation Task 8: only interrupt with a confirmation
  // dialog once the user has actually entered something — a fresh, untouched
  // wizard can be dismissed immediately with nothing to lose.
  const [dirty, setDirty] = useState(false);

  // Required Materials Inventory Matching Unit 5, Tasks 3–5.
  const [partRows, setPartRows] = useState<RequiredMaterialRowState[]>(
    () => Array.from({ length: MAX_PART_ROWS }, () => emptyMaterialRow())
  );

  // Optional Work Assignment During Job Card Creation Unit 7C.
  const [assignment, setAssignment] = useState<WizardAssignmentState>(EMPTY_ASSIGNMENT);
  function updateAssignment(patch: Partial<WizardAssignmentState>) {
    setAssignment((prev) => ({ ...prev, ...patch }));
  }
  // Simplify Assignment Picker Unit 7D, Task 5: lifted from an uncontrolled
  // radio to state so the worker picker can sort matching skill_category
  // workers first — the field itself still submits identically via the same
  // `name="worker_type"` radios.
  const [workerTeam, setWorkerTeam] = useState("Mechanical");
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchSeq = useRef<Record<number, number>>({});

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  function updateRow(index: number, patch: Partial<RequiredMaterialRowState>) {
    setPartRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function handleMaterialNameChange(index: number, value: string) {
    // Unit 10F.5, Task 2: quantity only ever defaults to 1 once the user has
    // actually entered a material name, and only if they haven't already
    // typed a quantity of their own — clearing the name back to blank does
    // not clear a quantity the user already entered.
    const currentQty = partRows[index]?.qty ?? "";
    const shouldDefaultQty = value.trim() !== "" && currentQty.trim() === "";
    // Task 5: editing the name after a suggestion was selected clears the
    // link — the row goes back to "New Material" until re-matched.
    updateRow(index, {
      description: value,
      materialKey: null,
      balance: null,
      showSuggestions: true,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });
    setDirty(true);

    if (searchTimers.current[index]) clearTimeout(searchTimers.current[index]);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      updateRow(index, { suggestions: [], loading: false, searched: false });
      return;
    }

    updateRow(index, { loading: true });
    const seq = (searchSeq.current[index] ?? 0) + 1;
    searchSeq.current[index] = seq;

    searchTimers.current[index] = setTimeout(async () => {
      try {
        const results = await searchOfflineInventoryMaterialsAction(trimmed);
        // Ignore stale responses from an earlier keystroke that resolved late.
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: results, loading: false, searched: true });
      } catch {
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: [], loading: false, searched: true });
      }
    }, 300);
  }

  function handleSelectSuggestion(index: number, match: OfflineInventorySearchMatch) {
    // Task 2 — selecting a suggestion counts as entering a material name too.
    const currentQty = partRows[index]?.qty ?? "";
    const shouldDefaultQty = currentQty.trim() === "";
    updateRow(index, {
      description: match.display_name,
      partNumber: match.part_number ?? "",
      unit: match.unit,
      materialKey: match.key,
      balance: match.balance,
      suggestions: [],
      showSuggestions: false,
      searched: false,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });
  }

  function requestClose() {
    if (dirty) {
      setShowCancelConfirm(true);
    } else {
      router.push(dismissHref);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showCancelConfirm) {
        setShowCancelConfirm(false);
      } else {
        requestClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCancelConfirm, dirty]);

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

      // Optional Work Assignment During Job Card Creation Unit 7C, Task 3/4/5:
      // fields are only required once "Assign work now" is on, and only for
      // whichever assignment type is currently selected.
      if (assignment.assignNow && canAssignAtCreation) {
        if (
          assignment.type === "INTERNAL_TEAM" &&
          !assignment.supervisorId &&
          assignment.technicianIds.length === 0 &&
          assignment.helperIds.length === 0
        ) {
          errs.assignment = "Select at least one worker or turn off Assign work now.";
        }
        if (assignment.type === "FREELANCER" && !assignment.freelancerName.trim()) {
          errs.assignment = "Freelancer name is required.";
        }
        if (assignment.type === "EXTERNAL_COMPANY" && !assignment.companyName.trim()) {
          errs.assignment = "Company name is required.";
        }
      }
    }

    if (step === 4 && form) {
      const fd = new FormData(form);
      // Unit 10F.5, Task 6: a completely blank extra row (no description)
      // never blocks submit. A row WITH a material name needs a quantity —
      // "Enter quantity." when it's blank, a distinct "Quantity must be
      // greater than 0." once something was entered but isn't a valid
      // positive whole number. Stops at the first offending row so one
      // message shows at a time, top to bottom.
      for (let i = 0; i < MAX_PART_ROWS; i++) {
        if (!fd.get(`req_part_description_${i}`)?.toString().trim()) continue;
        const qtyRaw = fd.get(`req_part_quantity_${i}`)?.toString().trim();
        if (!qtyRaw) {
          errs.required_parts = "Enter quantity.";
          break;
        }
        const qty = Number(qtyRaw);
        if (!Number.isInteger(qty) || qty <= 0) {
          errs.required_parts = "Quantity must be greater than 0.";
          break;
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

  const reviewParts = Array.from({ length: MAX_PART_ROWS }, (_, i) => ({
    desc: reviewData[`req_part_description_${i}`] ?? "",
    partNo: reviewData[`req_part_part_number_${i}`] ?? "",
    qty: reviewData[`req_part_quantity_${i}`] ?? "1",
    unit: reviewData[`req_part_uom_${i}`] ?? "PCS",
  })).filter((p) => p.desc);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={requestClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-job-card-heading"
          className="flex max-h-[90vh] w-[min(92vw,1280px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling, stepper stays visible above the body's own scroll area */}
          <div className="shrink-0 border-b border-[#E5E7EB] px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="new-job-card-heading" className="text-xl font-black text-[#111827] sm:text-2xl">
                  New Job Card
                </h2>
                <p className="mt-1 text-sm text-[#4B5563]">
                  Capture the job request as structured maintenance data. Reference number is generated on save.
                </p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-6">
              <StepIndicator current={step} />
            </div>
          </div>

          <form
            ref={formRef}
            action={upsertWorkOrderAction}
            onChange={() => setDirty(true)}
            className="flex min-h-0 flex-1 flex-col"
          >
        {/* Controlled fields derived from selected asset */}
        <input type="hidden" name="asset_category" value={selectedAsset?.category ?? ""} />
        <input type="hidden" name="serial_number" value={selectedAsset?.serial_number ?? ""} />
        <input type="hidden" name="plate_number" value={selectedAsset?.plate_number ?? ""} />
        {/* Fields not shown in wizard steps */}
        <input type="hidden" name="supervisor_verification" value="" />
        <input type="hidden" name="maintenance_manager_closure" value="" />
        <input type="hidden" name="operator_requester_confirmation" value="" />

        {/* Body — the only scrolling region */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">

        {/* ── Step 1: Select Asset ───────────────────────────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <WizardCard
            title="Select Asset / Machine"
            description="All repair records will be linked to this asset."
          >
            <div>
              <FieldLabel label="Asset / Machine" required />
              <input type="hidden" name="asset_id" value={selectedAssetId} />
              <div className="mt-1">
                <AssetSearchPicker
                  assets={assets}
                  value={selectedAssetId}
                  onChange={(id) => {
                    setSelectedAssetId(id);
                    setErrors({});
                    setDirty(true);
                  }}
                  required
                />
              </div>
              {errors.asset_id && (
                <p className="mt-2 text-xs text-[#DC2626]">{errors.asset_id}</p>
              )}
            </div>
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
                      defaultChecked={t === DEFAULT_MAINTENANCE_TYPE}
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
          </WizardCard>
        </div>

        {/* ── Step 3: Work Team & Assignment ────────────────────────────────
            Worker team / division is a maintenance category/team type, not
            the actual work assignment — kept exactly as before. Optional Work
            Assignment During Job Card Creation Unit 7C adds an optional
            "Assign work now" section below it; if left off, assignment stays
            available later from the Job Card detail page exactly as before. */}
        <div className={step !== 3 ? "hidden" : ""}>
          <WizardCard
            title="Work Team & Assignment"
            description="Select the maintenance team/category for this Job Card. Assigning workers now is optional."
          >
            <div>
              <FieldLabel label="Worker team / division" required />
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
                      checked={workerTeam === t}
                      onChange={() => setWorkerTeam(t)}
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
            {/* New Job Card Wizard Cleanup Unit Task 4: no Assigned Technician
                field here — the legacy single-technician self-service
                assignment still happens later from the Job Card detail page. */}
            <input type="hidden" name="assigned_supervisor_id" value="" />

            {canAssignAtCreation && (
              <div className="mt-6 border-t border-[#F3F4F6] pt-5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name="assign_now"
                    checked={assignment.assignNow}
                    onChange={(e) => updateAssignment({ assignNow: e.target.checked })}
                    className="h-4 w-4 accent-[#ED1C24]"
                  />
                  <span className="text-sm font-bold text-[#111827]">Assign work now</span>
                </label>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  You can assign workers now or assign later from the Job Card.
                </p>

                {assignment.assignNow && (
                  <div className="mt-4 space-y-4 rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
                    <input type="hidden" name="assignment_type" value={assignment.type} />

                    <div>
                      <FieldLabel label="Assignment Type" />
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {ASSIGNMENT_TYPE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateAssignment({ type: value })}
                            className={`rounded-md border py-1.5 text-xs font-bold transition ${
                              assignment.type === value
                                ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                                : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {assignment.type === "INTERNAL_TEAM" && (
                      <InternalTeamWizardFields
                        assignment={assignment}
                        updateAssignment={updateAssignment}
                        activeWorkers={activeWorkers}
                        workerTeam={workerTeam}
                      />
                    )}

                    {assignment.type === "FREELANCER" && (
                      <div className="space-y-2">
                        <input
                          name="assign_freelancer_name"
                          value={assignment.freelancerName}
                          onChange={(e) => updateAssignment({ freelancerName: e.target.value })}
                          placeholder="Freelancer name *"
                          className={inp}
                        />
                        <input
                          name="assign_freelancer_phone"
                          value={assignment.freelancerPhone}
                          onChange={(e) => updateAssignment({ freelancerPhone: e.target.value })}
                          placeholder="Phone / contact"
                          className={inp}
                        />
                        <input
                          name="assign_freelancer_trade"
                          value={assignment.freelancerTrade}
                          onChange={(e) => updateAssignment({ freelancerTrade: e.target.value })}
                          placeholder="Work type"
                          className={inp}
                        />
                        <input
                          name="assign_freelancer_amount"
                          type="number"
                          min="0"
                          step="0.001"
                          value={assignment.freelancerAmount}
                          onChange={(e) => updateAssignment({ freelancerAmount: e.target.value })}
                          placeholder="Agreed amount / rate (optional)"
                          className={inp}
                        />
                        <textarea
                          name="assign_notes"
                          value={assignment.notes}
                          onChange={(e) => updateAssignment({ notes: e.target.value })}
                          placeholder="Notes (optional)"
                          rows={2}
                          className={`${inp} resize-none`}
                        />
                      </div>
                    )}

                    {assignment.type === "EXTERNAL_COMPANY" && (
                      <div className="space-y-2">
                        <input
                          name="assign_company_name"
                          value={assignment.companyName}
                          onChange={(e) => updateAssignment({ companyName: e.target.value })}
                          placeholder="Company name *"
                          className={inp}
                        />
                        <input
                          name="assign_company_contact"
                          value={assignment.companyContact}
                          onChange={(e) => updateAssignment({ companyContact: e.target.value })}
                          placeholder="Contact person"
                          className={inp}
                        />
                        <input
                          name="assign_company_phone"
                          value={assignment.companyPhone}
                          onChange={(e) => updateAssignment({ companyPhone: e.target.value })}
                          placeholder="Phone / contact"
                          className={inp}
                        />
                        <input
                          name="assign_company_trade"
                          value={assignment.companyTrade}
                          onChange={(e) => updateAssignment({ companyTrade: e.target.value })}
                          placeholder="Work type"
                          className={inp}
                        />
                        <input
                          name="assign_company_amount"
                          type="number"
                          min="0"
                          step="0.001"
                          value={assignment.companyAmount}
                          onChange={(e) => updateAssignment({ companyAmount: e.target.value })}
                          placeholder="Agreed amount (optional)"
                          className={inp}
                        />
                        <textarea
                          name="assign_notes"
                          value={assignment.notes}
                          onChange={(e) => updateAssignment({ notes: e.target.value })}
                          placeholder="Notes (optional)"
                          rows={2}
                          className={`${inp} resize-none`}
                        />
                      </div>
                    )}

                    {errors.assignment && (
                      <p className="text-xs text-[#DC2626]">{errors.assignment}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </WizardCard>
        </div>

        {/* ── Step 4: Required Materials ─────────────────────────────────── */}
        <div className={step !== 4 ? "hidden" : ""}>
          <WizardCard
            title="Required Materials"
            description="List materials required for this Job Card. This is not a purchase order."
          >
            <p className="mb-3 text-xs text-[#6B7280]">
              Type a material name to check Offline Inventory availability.
            </p>
            <div>
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                    <th className="w-8 border border-[#E5E7EB] px-2 py-2">#</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Material Name / Description</th>
                    <th className="w-28 border border-[#E5E7EB] px-3 py-2">Part No. / Code</th>
                    <th className="w-16 border border-[#E5E7EB] px-3 py-2">Qty</th>
                    <th className="w-20 border border-[#E5E7EB] px-3 py-2">Unit</th>
                    <th className="border border-[#E5E7EB] px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {partRows.map((row, i) => (
                    <tr key={i} className={i >= numPartRows ? "hidden" : ""}>
                      <td className="border border-[#E5E7EB] px-2 py-1.5 text-center text-xs font-semibold text-[#9CA3AF]">
                        {i + 1}
                      </td>
                      <td className="relative border border-[#E5E7EB] p-0.5 align-top">
                        <input
                          name={`req_part_description_${i}`}
                          value={row.description}
                          onChange={(e) => handleMaterialNameChange(i, e.target.value)}
                          onFocus={() => updateRow(i, { showSuggestions: true })}
                          onBlur={() => updateRow(i, { showSuggestions: false })}
                          autoComplete="off"
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                          placeholder={i === 0 ? "e.g. oil filter…" : ""}
                        />
                        <input type="hidden" name={`req_part_material_key_${i}`} value={row.materialKey ?? ""} />
                        <AvailabilityBadge row={row} />

                        {row.showSuggestions && (row.loading || row.suggestions.length > 0 || row.searched) && (
                          <div className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[80vw] rounded-md border border-[#E5E7EB] bg-white shadow-lg">
                            {row.loading ? (
                              <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-[#6B7280]">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                Searching Offline Inventory…
                              </div>
                            ) : row.suggestions.length === 0 ? (
                              <p className="px-3 py-2.5 text-xs text-[#9CA3AF]">
                                No match in Offline Inventory. You can still type this material manually.
                              </p>
                            ) : (
                              <ul className="max-h-64 divide-y divide-[#F3F4F6] overflow-y-auto">
                                {row.suggestions.map((s) => (
                                  <li key={s.key}>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelectSuggestion(i, s);
                                      }}
                                      className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                                    >
                                      <p className="text-sm font-bold text-[#111827]">{s.display_name}</p>
                                      <p className="mt-0.5 text-[11px] text-[#6B7280]">
                                        Available: {s.balance} {s.unit}
                                        {s.part_number ? ` • Part No: ${s.part_number}` : ""}
                                        {s.ss_rec_code ? ` • SS Rec. Code: ${s.ss_rec_code}` : ""}
                                        {s.location ? ` • Location: ${s.location}` : ""}
                                      </p>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5 align-top">
                        <input
                          name={`req_part_part_number_${i}`}
                          value={row.partNumber}
                          onChange={(e) => updateRow(i, { partNumber: e.target.value })}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5 align-top">
                        <input
                          name={`req_part_quantity_${i}`}
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={row.qty}
                          onChange={(e) => updateRow(i, { qty: e.target.value })}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5 align-top">
                        <input
                          name={`req_part_uom_${i}`}
                          value={row.unit}
                          onChange={(e) => updateRow(i, { unit: e.target.value })}
                          className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                        />
                      </td>
                      <td className="border border-[#E5E7EB] p-0.5 align-top">
                        <input
                          name={`req_part_notes_${i}`}
                          value={row.notes}
                          onChange={(e) => updateRow(i, { notes: e.target.value })}
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
        {/* New Job Card Required Materials and Attachment Simplification
            Task 3/4: category dropdown and the desktop-confusing Take Photo
            button are hidden here (showCategory={false} showCamera={false})
            — every attachment on this form is silently filed under
            "Other Document" (the existing safest category, already the
            server's own fallback in parsePendingAttachments when no category
            is submitted at all — kept explicit here via the hidden field
            rather than relying on that implicit fallback). Mobile camera
            capture was only ever reachable through the now-removed separate
            Take Photo button, so there is no progressive-mobile behavior to
            preserve inside the single Upload Attachment button itself. */}
        <div className={step !== 5 ? "hidden" : ""}>
          <WizardCard
            title="Attachments"
            description="Optional — upload photos, PDFs, Excel files, Word documents, quotations, invoices, or supporting files."
          >
            <AttachmentUploadFields
              namePrefix="doc_attachment"
              categories={JOB_CARD_ATTACHMENT_CATEGORIES}
              defaultCategory="Other Document"
              accept={ATTACHMENT_FILE_ACCEPT}
              maxRows={MAX_ATTACHMENT_ROWS}
              showCategory={false}
              showCamera={false}
            />
            <p className="mt-4 text-xs text-[#9CA3AF]">
              Allowed files: JPG, PNG, PDF, WEBP, XLS, XLSX, DOC, DOCX
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
              <ReviewSection title="Asset / Equipment / Vehicle">
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

              <ReviewSection title="Work Team / Division">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReviewRow label="Worker team / division" value={reviewData.worker_type} />
                </dl>
              </ReviewSection>

              <ReviewSection title="Assignment">
                {!assignment.assignNow ? (
                  <p className="text-sm italic text-[#9CA3AF]">Assignment: Not assigned yet</p>
                ) : assignment.type === "INTERNAL_TEAM" ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewRow label="Assignment" value="Internal Team" />
                    <ReviewRow
                      label="Supervisor"
                      value={activeWorkers.find((w) => w.id === assignment.supervisorId)?.name ?? "Not selected"}
                    />
                    <ReviewRow
                      label="Technicians"
                      value={activeWorkers.filter((w) => assignment.technicianIds.includes(w.id)).map((w) => w.name).join(", ")}
                    />
                    <ReviewRow
                      label="Helpers / Labor"
                      value={activeWorkers.filter((w) => assignment.helperIds.includes(w.id)).map((w) => w.name).join(", ")}
                    />
                  </dl>
                ) : assignment.type === "FREELANCER" ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewRow label="Assignment" value="Freelancer" />
                    <ReviewRow label="Name" value={assignment.freelancerName} />
                    <ReviewRow label="Agreed amount" value={assignment.freelancerAmount ? `${assignment.freelancerAmount} KWD` : undefined} />
                  </dl>
                ) : (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewRow label="Assignment" value="External Company" />
                    <ReviewRow label="Company" value={assignment.companyName} />
                    <ReviewRow label="Agreed amount" value={assignment.companyAmount ? `${assignment.companyAmount} KWD` : undefined} />
                  </dl>
                )}
                {assignment.assignNow && (
                  <p className="mt-3 text-xs text-[#9CA3AF]">
                    If you Save Draft, assignment will be saved when the Job Card is activated — Draft does not save assignment yet.
                  </p>
                )}
              </ReviewSection>

              <ReviewSection title="Required Materials">
                {reviewParts.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F3F4F6] text-left text-[10px] font-bold text-[#4B5563]">
                          <th className="px-3 py-1.5">Material Name / Description</th>
                          <th className="px-3 py-1.5">Part No. / Code</th>
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
                ) : (
                  <p className="text-sm italic text-[#9CA3AF]">No materials requested</p>
                )}
              </ReviewSection>

              {/* New Job Card Button Wording and Success Popup Clarity Unit
                  10F.2, Task 2: "Create Job Card" makes the Job Card Active —
                  it does not start worker time, which only ever starts from
                  Daily Activity. Wording-only; submit_for_approval's backend
                  behavior is unchanged. */}
              <p className="text-xs text-[#9CA3AF]">
                The Job Card will be created as Active. Worker time is tracked from Daily Activity.
              </p>
            </div>
          </WizardCard>
        </div>
        </div>

        {/* Footer — sticky, non-scrolling, always-visible action buttons */}
        <div className="shrink-0 border-t border-[#E5E7EB] px-6 py-4 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50"
              >
                Cancel
              </button>
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
            <div className="flex items-center gap-2">
              {step === 6 && (
                <p className="hidden text-xs text-[#9CA3AF] sm:block">Draft can be edited and submitted later.</p>
              )}
              {step < 6 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-red-700"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    name="intent"
                    value="save_draft"
                    className="focus-ring inline-flex items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-5 py-2 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6]"
                  >
                    Save Draft
                  </button>
                  <button
                    type="submit"
                    name="intent"
                    value="submit_for_approval"
                    className="focus-ring inline-flex items-center justify-center rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-red-700"
                  >
                    Create Job Card
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </form>
        </div>
      </div>

      {showCancelConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setShowCancelConfirm(false)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-jc-heading"
              className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
            >
              <h2 id="cancel-jc-heading" className="text-lg font-black text-[#111827]">
                Discard Job Card?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                You have entered information that has not been saved. Are you sure you want to discard it?
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push(dismissHref)}
                  className="flex-1 rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
                >
                  Discard and Exit
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
                >
                  Continue Editing
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Local sub-components ──────────────────────────────────────────────────────

// Optional Work Assignment During Job Card Creation Unit 7C, Task 3.
// Simplify Assignment Picker Unit 7D, Task 1: Supervisor now uses the same
// searchable picker as Technicians/Helpers (capped to one selection) instead
// of a plain <select> — "searchable single picker preferred" per the task.
function InternalTeamWizardFields({
  assignment,
  updateAssignment,
  activeWorkers,
  workerTeam,
}: {
  assignment: WizardAssignmentState;
  updateAssignment: (patch: Partial<WizardAssignmentState>) => void;
  activeWorkers: WorkerProfileRow[];
  workerTeam: string;
}) {
  const supervisors = activeWorkers.filter((w) => w.worker_type === "Supervisor");
  const technicians = activeWorkers.filter((w) => w.worker_type === "Technician");
  const helpers = activeWorkers.filter((w) => w.worker_type === "Helper/Labor");

  if (activeWorkers.length === 0) {
    return (
      <p className="text-sm text-[#6B7280]">
        No active worker profiles yet — add Supervisors, Technicians, and Helpers/Labor under Worker
        Profiles first, or turn off &quot;Assign work now&quot; and assign later.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <WorkerPickerField
        label="Supervisor"
        hint="Optional"
        fieldName="assign_supervisor_id"
        workers={supervisors}
        selectedIds={assignment.supervisorId ? [assignment.supervisorId] : []}
        onChange={(ids) => updateAssignment({ supervisorId: ids[0] ?? "" })}
        multiple={false}
        emptyMessage="No active supervisor found."
        preferredSkillCategory={workerTeam}
      />

      <WorkerPickerField
        label="Technicians"
        hint="Optional"
        fieldName="assign_technician_ids"
        workers={technicians}
        selectedIds={assignment.technicianIds}
        onChange={(ids) => updateAssignment({ technicianIds: ids })}
        multiple
        emptyMessage="No active technicians found. Add worker profiles first."
        preferredSkillCategory={workerTeam}
      />

      <WorkerPickerField
        label="Helpers / Labor"
        hint="Optional"
        fieldName="assign_helper_ids"
        workers={helpers}
        selectedIds={assignment.helperIds}
        onChange={(ids) => updateAssignment({ helperIds: ids })}
        multiple
        emptyMessage="No active helpers/labor found. Add worker profiles first."
        preferredSkillCategory={workerTeam}
      />

      <div>
        <FieldLabel label="Assignment notes" hint="Optional" />
        <textarea
          name="assign_notes"
          value={assignment.notes}
          onChange={(e) => updateAssignment({ notes: e.target.value })}
          rows={2}
          className={`${inp} resize-none`}
        />
      </div>
    </div>
  );
}

function normalizeSearchText(s: string): string {
  return s.trim().toLowerCase();
}

// Worker Profile Form Simplification and Division Rename Unit 10G.6, Task 6:
// also matches Employee ID — name/phone/division/type matching unchanged.
function matchesWorkerQuery(w: WorkerProfileRow, q: string): boolean {
  if (!q) return true;
  return [w.employee_id, w.name, w.phone, w.skill_category, w.worker_type]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(q));
}

// Simplify Assignment Picker Unit 7D, Tasks 1–5: a search-to-add / chip-to-
// remove picker replacing the old Ctrl/Cmd browser multi-select. Reused for
// Supervisor (multiple=false, capped at one chip), Technicians, and Helpers/
// Labor. Search runs entirely client-side over the already-fetched active
// worker list — no extra backend calls (Task 2).
function WorkerPickerField({
  label,
  hint,
  fieldName,
  workers,
  selectedIds,
  onChange,
  multiple,
  emptyMessage,
  preferredSkillCategory,
}: {
  label: string;
  hint?: string;
  fieldName: string;
  workers: WorkerProfileRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple: boolean;
  emptyMessage: string;
  preferredSkillCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Task 4: no active workers of this type at all — nothing to search.
  if (workers.length === 0) {
    return (
      <div>
        <FieldLabel label={label} hint={hint} />
        <p className="mt-1.5 text-xs text-[#9CA3AF]">{emptyMessage}</p>
      </div>
    );
  }

  const selectedWorkers = selectedIds
    .map((id) => workers.find((w) => w.id === id))
    .filter((w): w is WorkerProfileRow => Boolean(w));

  const q = normalizeSearchText(query);
  const available = workers.filter((w) => !selectedIds.includes(w.id) && matchesWorkerQuery(w, q));
  // Task 5: workers whose skill category matches the selected Work Team /
  // Division float to the top — cheap, no new query, no new table.
  const sorted = [...available].sort((a, b) => {
    if (preferredSkillCategory) {
      const aMatch = (a.skill_category ?? "").toLowerCase() === preferredSkillCategory.toLowerCase();
      const bMatch = (b.skill_category ?? "").toLowerCase() === preferredSkillCategory.toLowerCase();
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const results = sorted.slice(0, 8);

  function addWorker(id: string) {
    onChange(multiple ? [...selectedIds, id] : [id]);
    setQuery("");
    setOpen(false);
  }
  function removeWorker(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  // Supervisor (multiple=false): once one is picked, hide the search box —
  // "Remove" first, then search again, keeps the UI from implying you can
  // pick a second one.
  const showSearch = multiple || selectedWorkers.length === 0;

  return (
    <div>
      <FieldLabel label={label} hint={hint} />

      {selectedWorkers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {selectedWorkers.map((w) => (
            <span
              key={w.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white py-1 pl-3 pr-1.5 text-xs font-semibold text-[#111827]"
            >
              <span className="truncate">{w.name}</span>
              <button
                type="button"
                onClick={() => removeWorker(w.id)}
                className="shrink-0 rounded-full p-0.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#DC2626]"
                aria-label={`Remove ${w.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showSearch && (
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder={`Search ${label.toLowerCase()} by employee ID, name, or division…`}
            className={`${inp} pl-8`}
          />

          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-[#E5E7EB] bg-white shadow-lg">
              {results.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-[#9CA3AF]">
                  {q ? "No matching workers." : "All active workers are already selected."}
                </p>
              ) : (
                <ul className="divide-y divide-[#F3F4F6]">
                  {results.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addWorker(w.id);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <p className="text-sm font-bold text-[#111827]">
                          {w.employee_id ? `${w.employee_id} • ` : ""}
                          {w.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-[#6B7280]">
                          {w.worker_type}
                          {w.skill_category ? ` • ${w.skill_category}` : ""}
                          {w.phone ? ` • ${w.phone}` : ""}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {selectedIds.map((id) => (
        <input key={id} type="hidden" name={fieldName} value={id} />
      ))}
    </div>
  );
}

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

