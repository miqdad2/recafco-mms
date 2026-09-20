"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";

import { saveWorkerProfileAction, type WorkerProfileState } from "@/app/actions/workers";
import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import {
  DEFAULT_MONTHLY_WORKING_HOURS,
  DEFAULT_MONTHLY_WORKING_DAYS,
  SALARY_INPUT_METHODS,
  SALARY_METHOD_LABELS,
  computeSalary,
  computeDailyRate,
  resolveSalaryMethod,
  salaryStatusLabel,
  type SalaryInputMethod,
} from "@/lib/backend/workers/salary";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";

// Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, updated
// by Worker Profile Data Entry Contact Fields and Manager Salary Only Unit
// 10G.41D.
//
// One form, three ways to open it:
//   - Add Worker (worker=null, readOnly=false): every normal HR/contact
//     field is editable by whoever can reach this at all, Data Entry
//     included — Employee ID, Worker Name, Worker Type, Division, Job
//     Title, Work Location, Contact No., Nationality, Reporting Manager
//     (Task 1 — Nationality/Reporting Manager moved OUT of the
//     Manager-only section this unit; they're normal, non-sensitive HR
//     fields, not pay-related).
//   - Edit Worker (worker set, readOnly=false): Manager/Super Admin only —
//     worker-profiles-view.tsx never renders an Edit button for anyone
//     else. Adds the Manager-only Salary Details section.
//   - View Worker (worker set, readOnly=true): Data Entry's read-only
//     window into a profile they created — everything the Add Worker form
//     showed them, plus Status, still with zero salary fields (Task 3/4 —
//     "Data Entry can create but not edit" stays true; this is a look, not
//     an edit path).
// The Salary Details section renders only when `canManageWorkerProfiles` is
// true — the exact same isManagerRole() check the server action
// re-verifies before trusting any submitted salary value (Task 10 — the UI
// hiding these fields is not the real security boundary, the service layer
// is; see lib/backend/workers/service.ts).
const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

export function WorkerProfileFormModal({
  worker,
  // Task 5/10: gates only the Salary Details section now — Data Entry
  // never sees or submits any of it, whether adding a new worker or
  // (since Data Entry has no Edit button — worker-profiles-view.tsx) in
  // read-only View mode on one they created.
  canManageWorkerProfiles,
  // Task 3/4 — Data Entry's "View" action opens this with readOnly=true:
  // every field disabled, no submit button, just a Close button. Never
  // true for Manager's own Edit (worker-profiles-view.tsx only sets it on
  // the Data-Entry-only View button).
  readOnly = false,
  onClose,
}: {
  worker: WorkerProfileRow | null;
  canManageWorkerProfiles: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState<WorkerProfileState, FormData>(saveWorkerProfileAction, null);

  // Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 1/8 —
  // one of Yearly Cost / Monthly Cost / Manual Hourly Rate controls which
  // single field is editable; the rest are always computed (via
  // computeSalary, the exact same function the server uses, so this live
  // preview can never disagree with what actually gets saved). A brand-new
  // worker defaults to Yearly Cost (Task 1); an existing worker resolves to
  // whichever method it already has (or, for a pre-10G.68 row, the
  // Task 8 fallback resolveSalaryMethod derives from its old total_salary/
  // hourly_rate).
  const initialSalary = worker
    ? resolveSalaryMethod(worker)
    : { method: "yearly_cost" as SalaryInputMethod, yearlyCost: null, monthlyCost: null };
  const [method, setMethod] = useState<SalaryInputMethod>(initialSalary.method);
  const [yearlyCost, setYearlyCost] = useState(initialSalary.yearlyCost ?? 0);
  const [monthlyCost, setMonthlyCost] = useState(initialSalary.monthlyCost ?? 0);
  const [manualHourlyRate, setManualHourlyRate] = useState(worker?.hourly_rate ?? 0);
  const [manualReason, setManualReason] = useState(worker?.manual_hourly_rate_reason ?? "");
  const [monthlyWorkingDays, setMonthlyWorkingDays] = useState(worker?.monthly_working_days ?? DEFAULT_MONTHLY_WORKING_DAYS);
  const [monthlyWorkingHours, setMonthlyWorkingHours] = useState(worker?.monthly_working_hours ?? DEFAULT_MONTHLY_WORKING_HOURS);

  // Task 5 — Salary Breakdown (optional): kept for backward compatibility
  // and record-keeping only, collapsed by default, never feeding the
  // Hourly Rate calculation above.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [basicSalary, setBasicSalary] = useState(worker?.basic_salary ?? 0);
  const [transportAllowance, setTransportAllowance] = useState(worker?.transport_allowance ?? 0);
  const [accommodationAllowance, setAccommodationAllowance] = useState(worker?.accommodation_allowance ?? 0);
  const [foodAllowance, setFoodAllowance] = useState(worker?.food_allowance ?? 0);
  const totalSalary = basicSalary + transportAllowance + accommodationAllowance + foodAllowance;

  // Live preview — a pure derived value (useMemo, not a useEffect+setState),
  // recomputed from whatever the Manager has typed so far using the exact
  // same computeSalary the server calls on submit.
  const preview = useMemo(
    () =>
      computeSalary({
        salaryInputMethod: method,
        yearlyCost,
        monthlyCost,
        hourlyRate: manualHourlyRate,
        manualHourlyRateReason: manualReason,
        monthlyWorkingDays,
        monthlyWorkingHours,
      }),
    [method, yearlyCost, monthlyCost, manualHourlyRate, manualReason, monthlyWorkingDays, monthlyWorkingHours]
  );
  // Task 4 — Manual Hourly Rate's own read-only ESTIMATED fields: display-
  // only, recomputed on read, never persisted as if they were an entered
  // Yearly/Monthly Cost basis (see computeSalary's own doc comment).
  const estimatedMonthlyCost = preview.hourlyRate > 0 ? Math.round(preview.hourlyRate * monthlyWorkingHours * 1000) / 1000 : 0;
  const estimatedYearlyCost = Math.round(estimatedMonthlyCost * 12 * 1000) / 1000;
  const estimatedDailyRate = computeDailyRate(estimatedMonthlyCost, monthlyWorkingDays);

  // Task 9 — the live status the Manager will actually save, not just the
  // last-saved worker's own value, so typing a rate in immediately flips
  // "Salary Pending" to "Set"/"Manual Rate" before the form is even submitted.
  const salaryStatus = salaryStatusLabel({ hourly_rate: preview.hourlyRate, salary_input_method: preview.salaryInputMethod });
  const salaryStatusTone = salaryStatus === "Salary Pending" ? "amber" : salaryStatus === "Manual Rate" ? "blue" : "green";

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Worker Profile Saved" });
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="worker-profile-heading"
          className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[#F3F4F6] p-6 pb-4">
            <h2 id="worker-profile-heading" className="text-lg font-bold text-[#111827]">
              {readOnly ? "Worker Details" : worker ? "Edit Worker" : "Add Worker"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto p-6 pt-4">
            {state?.ok === false && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{state.error}</span>
              </div>
            )}

            <form action={formAction} className="space-y-3">
              {worker && <input type="hidden" name="id" value={worker.id} />}

              {/* Task 2/3 — Employee ID, Worker Name, Worker Type, Division,
                  Job Title, Work Location: shown to every role that can
                  reach this form (Data Entry included). */}
              <div>
                <label htmlFor="wp-employee-id" className={lbl}>
                  Employee ID {!worker && <span className="text-[#ED1C24]">*</span>}
                </label>
                <input
                  id="wp-employee-id"
                  name="employee_id"
                  required={!worker}
                  defaultValue={worker?.employee_id ?? ""}
                  placeholder="e.g. EMP-1025"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              <div>
                <label htmlFor="wp-name" className={lbl}>
                  Worker Name <span className="text-[#ED1C24]">*</span>
                </label>
                <input
                  id="wp-name"
                  name="name"
                  required
                  defaultValue={worker?.name ?? ""}
                  placeholder="e.g. Ahmed Hassan"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              <div>
                <label htmlFor="wp-type" className={lbl}>
                  Worker Type <span className="text-[#ED1C24]">*</span>
                </label>
                <select id="wp-type" name="worker_type" required defaultValue={worker?.worker_type ?? WORKER_TYPES[0]} className={inp} disabled={isPending || readOnly}>
                  {WORKER_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {/* Worker Type and Division Form Clarification Unit
                    10G.41C, Task 4: Worker Type is a simple system role
                    group (Supervisor/Technician/Helper-Labor) — kept
                    separate from Division (work team/skill area) and Job
                    Title (actual HR job title) so Data Entry doesn't
                    conflate the three. */}
                <p className="mt-1 text-xs text-[#6B7280]">Choose the worker&rsquo;s role group for assignment.</p>
              </div>

              <div>
                <label htmlFor="wp-skill" className={lbl}>
                  Division <span className="text-[#ED1C24]">*</span>
                </label>
                {/* Worker Division Dropdown Final Cleanup Unit 10G.41F,
                    Task 1: a real "Select division..." placeholder
                    (disabled, so it can't itself be submitted) — Division
                    is required, so the user must actively pick one of the
                    6 real options below, including "Not specified" as its
                    own genuine choice rather than the implicit default. */}
                <select id="wp-skill" name="skill_category" required defaultValue={worker?.skill_category ?? ""} className={inp} disabled={isPending || readOnly}>
                  <option value="" disabled>Select division...</option>
                  {SKILL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {/* A legacy stored value no longer in the curated list
                      (e.g. an old "Civil" row from before this unit) is
                      preserved as its own option instead of being silently
                      discarded — same pattern as the Assets module's own
                      Asset Type field. */}
                  {worker?.skill_category && !(SKILL_CATEGORIES as readonly string[]).includes(worker.skill_category) && (
                    <option value={worker.skill_category}>{worker.skill_category}</option>
                  )}
                </select>
                <p className="mt-1 text-xs text-[#6B7280]">Choose the work team or skill area.</p>
              </div>

              <div>
                <label htmlFor="wp-job-title" className={lbl}>Job Title</label>
                <input
                  id="wp-job-title"
                  name="job_title"
                  defaultValue={worker?.job_title ?? ""}
                  placeholder="e.g. Auto Diesel Mechanic"
                  className={inp}
                  disabled={isPending || readOnly}
                />
                {/* Worker Profile Form Wording and Job Title Simplicity
                    Unit 10G.41E, Task 2/3: Job Title stays a plain text
                    input (not a dropdown) — this is where every detailed
                    HR/company position from the Excel sheet belongs
                    (Auto Diesel Mechanic, Supervisor, Logistics, Driver,
                    Engineer, Mechanic, Electrician, etc.), never Worker
                    Type, which stays the 3-option system role group. */}
                <p className="mt-1 text-xs text-[#6B7280]">Enter the actual company job title.</p>
                {/* Worker Division Dropdown Final Cleanup Unit 10G.41F,
                    Task 3: "Industrial Mechanic"/"Industrial Electrician"
                    are the running example of the exact rule this unit
                    tightens — Industrial is a Job Title detail, never a
                    Division option (see SKILL_CATEGORIES above). */}
                <p className="mt-0.5 text-xs text-[#9CA3AF]">Examples: Industrial Mechanic, Industrial Electrician, Auto Diesel Mechanic, Helper.</p>
              </div>

              <div>
                <label htmlFor="wp-work-location" className={lbl}>Work Location</label>
                <input
                  id="wp-work-location"
                  name="work_location"
                  defaultValue={worker?.work_location ?? ""}
                  placeholder="Optional — e.g. Main Workshop"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              {/* Worker Profile Data Entry Contact Fields and Manager
                  Salary Only Unit 10G.41D, Task 1/9: "Contact No." (was
                  "Mobile No." before this unit — same field name, `phone`,
                  works for a mobile number or an extension either way),
                  Nationality, and Reporting Manager are now normal,
                  non-sensitive HR/contact fields Data Entry can enter too —
                  only actual salary fields stay Manager/Super-Admin-only
                  (see Salary Details below). */}
              <div>
                <label htmlFor="wp-phone" className={lbl}>Contact No.</label>
                <input
                  id="wp-phone"
                  name="phone"
                  defaultValue={worker?.phone ?? ""}
                  placeholder="Optional"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              <div>
                <label htmlFor="wp-nationality" className={lbl}>Nationality</label>
                <input
                  id="wp-nationality"
                  name="nationality"
                  defaultValue={worker?.nationality ?? ""}
                  placeholder="Optional"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              <div>
                <label htmlFor="wp-reporting-manager" className={lbl}>Reporting Manager</label>
                <input
                  id="wp-reporting-manager"
                  name="reporting_manager"
                  defaultValue={worker?.reporting_manager ?? ""}
                  placeholder="Optional"
                  className={inp}
                  disabled={isPending || readOnly}
                />
              </div>

              {/* Task 3/4 — Status is shown for context to whoever can see
                  this worker at all (Manager's Edit, or Data Entry's
                  read-only View on their own created worker); changing it
                  stays the existing Deactivate/Reactivate button in the
                  Worker Profiles table (worker-profiles-view.tsx, Manager/
                  Super-Admin-only), not a new control here — this unit
                  doesn't touch that already-working, separately-audited
                  action. */}
              {worker && (
                <div>
                  <span className={lbl}>Status</span>
                  <div>
                    <StatusBadge label={worker.is_active ? "Active" : "Inactive"} tone={worker.is_active ? "green" : "gray"} />
                  </div>
                </div>
              )}

              {/* Worker Salary Cost Method and Rate Calculation Unit 10G.68
                  — Salary Details: Manager/Super-Admin-only, visually
                  separate (its own bordered/shaded card) from the normal
                  worker details above. Only one main cost input is ever
                  editable at a time (Task 1's own "the UI must make only
                  one main cost input editable based on selected method"),
                  driven by the Salary Cost Input Method select below. */}
              {canManageWorkerProfiles && (
                <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-[#111827]">Salary Details</p>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge label={salaryStatus} tone={salaryStatusTone} />
                      <StatusBadge label={SALARY_METHOD_LABELS[method]} tone="gray" />
                    </div>
                  </div>

                  {/* Worker Salary Modal UI Alignment Unit 10G.68A, Task 1 —
                      Salary Cost Input Method is the first thing shown
                      inside Salary Details, as three clickable "radio
                      cards" (a plain <select> buries the three choices
                      behind a click-to-open dropdown; this makes all three
                      options — and which one is active — visible at a
                      glance). A hidden input carries the actual `name`/
                      `value` the form submits, same as the old select did. */}
                  <div className="mb-3">
                    <label className={lbl}>
                      Salary Cost Input Method <span className="text-[#ED1C24]">*</span>
                    </label>
                    <input type="hidden" name="salary_input_method" value={method} />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {SALARY_INPUT_METHODS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMethod(m)}
                          aria-pressed={method === m}
                          disabled={isPending}
                          className={`rounded-md border-2 px-3 py-2 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            method === m
                              ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]"
                              : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#ED1C24]/40"
                          }`}
                        >
                          {SALARY_METHOD_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Task 13 — always-visible helper text. */}
                  <p className="mb-3 text-xs text-[#6B7280]">
                    Yearly Cost or Monthly Cost is used to calculate the Hourly Rate. Hourly Rate is used to calculate
                    Job Card labor cost from worker time.
                  </p>

                  {/* Task 2 — the one editable main input for this method. */}
                  {method === "yearly_cost" && (
                    <div className="mb-3">
                      <label htmlFor="wp-yearly-cost" className={lbl}>Yearly Cost (KWD)</label>
                      <input
                        id="wp-yearly-cost"
                        name="yearly_cost"
                        type="number"
                        min="0"
                        step="0.001"
                        value={yearlyCost}
                        onChange={(e) => setYearlyCost(Number(e.target.value) || 0)}
                        className={inp}
                        disabled={isPending}
                      />
                    </div>
                  )}
                  {/* Task 3 — the one editable main input for this method. */}
                  {method === "monthly_cost" && (
                    <div className="mb-3">
                      <label htmlFor="wp-monthly-cost" className={lbl}>Monthly Cost (KWD)</label>
                      <input
                        id="wp-monthly-cost"
                        name="monthly_cost"
                        type="number"
                        min="0"
                        step="0.001"
                        value={monthlyCost}
                        onChange={(e) => setMonthlyCost(Number(e.target.value) || 0)}
                        className={inp}
                        disabled={isPending}
                      />
                    </div>
                  )}
                  {/* Task 4 — the one editable main input for this method,
                      plus an optional reason and the required warning. */}
                  {method === "manual_hourly_rate" && (
                    <>
                      <div className="mb-3">
                        <label htmlFor="wp-manual-rate" className={lbl}>Hourly Rate (KWD)</label>
                        <input
                          id="wp-manual-rate"
                          name="hourly_rate"
                          type="number"
                          min="0"
                          step="0.001"
                          value={manualHourlyRate}
                          onChange={(e) => setManualHourlyRate(Number(e.target.value) || 0)}
                          className={inp}
                          disabled={isPending}
                        />
                      </div>
                      <div className="mb-3">
                        <label htmlFor="wp-manual-reason" className={lbl}>Reason (optional)</label>
                        <input
                          id="wp-manual-reason"
                          name="manual_hourly_rate_reason"
                          type="text"
                          maxLength={300}
                          value={manualReason}
                          onChange={(e) => setManualReason(e.target.value)}
                          placeholder="e.g. Freelancer, temporary worker, special rate, outside labor"
                          className={inp}
                          disabled={isPending}
                        />
                      </div>
                      <p className="mb-3 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        Manual hourly rate will be used directly for Job Card labor cost.
                      </p>
                    </>
                  )}

                  {/* Task 2/3/4 — shared supporting inputs, always visible
                      regardless of method (used both to compute the rate
                      under Yearly/Monthly Cost, and to compute the Manual
                      Hourly Rate method's own Estimated figures below). */}
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="wp-working-days" className={lbl}>Monthly Working Days</label>
                      <input
                        id="wp-working-days"
                        name="monthly_working_days"
                        type="number"
                        min="1"
                        max="31"
                        step="1"
                        value={monthlyWorkingDays}
                        onChange={(e) => setMonthlyWorkingDays(Number(e.target.value) || DEFAULT_MONTHLY_WORKING_DAYS)}
                        className={inp}
                        disabled={isPending}
                      />
                    </div>
                    <div>
                      <label htmlFor="wp-working-hours" className={lbl}>Monthly Working Hours</label>
                      <input
                        id="wp-working-hours"
                        name="monthly_working_hours"
                        type="number"
                        min="1"
                        step="1"
                        value={monthlyWorkingHours}
                        onChange={(e) => setMonthlyWorkingHours(Number(e.target.value) || DEFAULT_MONTHLY_WORKING_HOURS)}
                        className={inp}
                        disabled={isPending}
                      />
                    </div>
                  </div>

                  {/* Task 2/3/4 — the read-only calculated/estimated fields
                      for whichever method is active. */}
                  <div className="grid grid-cols-3 gap-2">
                    {method === "yearly_cost" && (
                      <>
                        <ReadOnlyField label="Monthly Cost" value={preview.monthlyCost ?? 0} />
                        <ReadOnlyField label="Daily Rate" value={computeDailyRate(preview.monthlyCost ?? 0, monthlyWorkingDays)} />
                        <ReadOnlyField label="Hourly Rate" value={preview.hourlyRate} />
                      </>
                    )}
                    {method === "monthly_cost" && (
                      <>
                        <ReadOnlyField label="Yearly Cost" value={preview.yearlyCost ?? 0} />
                        <ReadOnlyField label="Daily Rate" value={computeDailyRate(preview.monthlyCost ?? 0, monthlyWorkingDays)} />
                        <ReadOnlyField label="Hourly Rate" value={preview.hourlyRate} />
                      </>
                    )}
                    {method === "manual_hourly_rate" && (
                      <>
                        <ReadOnlyField label="Est. Monthly Cost" value={estimatedMonthlyCost} />
                        <ReadOnlyField label="Est. Yearly Cost" value={estimatedYearlyCost} />
                        <ReadOnlyField label="Est. Daily Rate" value={estimatedDailyRate} />
                      </>
                    )}
                  </div>
                  {/* Task 6 — the exact required wording. */}
                  <p className="mt-2 text-xs text-[#6B7280]">
                    Hourly Rate is used to calculate Job Card labor cost from worker time.
                  </p>

                  {/* Task 5 — Salary Breakdown (optional): the legacy
                      allowance fields still exist and still save (so
                      existing data is never lost), but collapsed by default
                      and clearly marked as record-keeping only — they no
                      longer drive Hourly Rate under Yearly/Monthly Cost. */}
                  <div className="mt-3 border-t border-[#E5E7EB] pt-3">
                    <button
                      type="button"
                      onClick={() => setBreakdownOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-xs font-bold text-[#4B5563] hover:text-[#111827]"
                      aria-expanded={breakdownOpen}
                    >
                      {breakdownOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                      Salary Breakdown (optional)
                    </button>

                    {breakdownOpen && (
                      <div className="mt-2 space-y-2">
                        {/* Task 5 — the exact required wording. */}
                        <p className="text-xs text-[#9CA3AF]">
                          Optional breakdown for HR reference only. Main Job Card labor cost is calculated from the
                          selected salary cost input method.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor="wp-basic-salary" className={lbl}>Basic Salary (KWD)</label>
                            <input
                              id="wp-basic-salary"
                              name="basic_salary"
                              type="number"
                              min="0"
                              step="0.001"
                              value={basicSalary}
                              onChange={(e) => setBasicSalary(Number(e.target.value) || 0)}
                              className={inp}
                              disabled={isPending}
                            />
                          </div>
                          <div>
                            <label htmlFor="wp-transport" className={lbl}>Transport Allowance</label>
                            <input
                              id="wp-transport"
                              name="transport_allowance"
                              type="number"
                              min="0"
                              step="0.001"
                              value={transportAllowance}
                              onChange={(e) => setTransportAllowance(Number(e.target.value) || 0)}
                              className={inp}
                              disabled={isPending}
                            />
                          </div>
                          <div>
                            <label htmlFor="wp-accommodation" className={lbl}>Accommodation Allowance</label>
                            <input
                              id="wp-accommodation"
                              name="accommodation_allowance"
                              type="number"
                              min="0"
                              step="0.001"
                              value={accommodationAllowance}
                              onChange={(e) => setAccommodationAllowance(Number(e.target.value) || 0)}
                              className={inp}
                              disabled={isPending}
                            />
                          </div>
                          <div>
                            <label htmlFor="wp-food" className={lbl}>Food Allowance</label>
                            <input
                              id="wp-food"
                              name="food_allowance"
                              type="number"
                              min="0"
                              step="0.001"
                              value={foodAllowance}
                              onChange={(e) => setFoodAllowance(Number(e.target.value) || 0)}
                              className={inp}
                              disabled={isPending}
                            />
                          </div>
                        </div>
                        <div>
                          <label className={lbl}>Total Salary (KWD)</label>
                          <div className="rounded-md border border-[#E5E7EB] bg-gray-50 px-3 py-2 text-sm font-bold text-[#111827]">
                            {totalSalary.toFixed(3)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes: Manager/Super-Admin-only — not part of either Task 1
                  (Data Entry's Add Worker fields) or Task 3 (Data Entry's
                  View Worker fields) lists in this unit. */}
              {worker && canManageWorkerProfiles && (
                <div>
                  <label htmlFor="wp-notes" className={lbl}>Notes</label>
                  <textarea
                    id="wp-notes"
                    name="notes"
                    rows={2}
                    defaultValue={worker?.notes ?? ""}
                    placeholder="Optional"
                    className={`${inp} resize-none`}
                    disabled={isPending}
                  />
                </div>
              )}

              {/* Task 3/4 — read-only View mode has no Save action at all,
                  just Close; this is a look, not an edit path. */}
              <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
                {readOnly ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex flex-1 items-center justify-center rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
                  >
                    Close
                  </button>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
                    >
                      {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      {isPending ? "Saving…" : worker ? "Save Changes" : "Add Worker"}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isPending}
                      className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

// Task 6 — a small read-only calculated/estimated figure box: a dashed
// border and an explicit "Calculated" tag make it unmistakably different
// from the editable inputs above, on top of the gray "computed, not typed"
// background the old Total Salary field already used.
function ReadOnlyField({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1">
        <label className={`${lbl} mb-0`}>{label}</label>
        <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">Calculated</span>
      </div>
      <div className="rounded-md border border-dashed border-[#D1D5DB] bg-gray-50 px-3 py-2 text-sm font-bold text-[#111827]">
        {value.toFixed(3)}
      </div>
    </div>
  );
}
