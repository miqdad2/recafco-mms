"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { saveWorkerProfileAction, type WorkerProfileState } from "@/app/actions/workers";
import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import { DEFAULT_MONTHLY_WORKING_HOURS, isSalaryPending } from "@/lib/backend/workers/salary";
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

  // Task 3 — Total Salary and Hourly Rate auto-calculate from Basic Salary +
  // the three allowances and Monthly Working Hours (basic + transport +
  // accommodation + food; hourly rate = total ÷ hours). The Hourly Rate
  // input stays editable so a Manager can type a different number
  // afterward (an explicit override) — touching any salary/hours field
  // again recalculates and replaces it, which is the simplest way to
  // support both "auto-calculated" and "can override" without a separate
  // "has this been manually edited" flag.
  const [basicSalary, setBasicSalary] = useState(worker?.basic_salary ?? 0);
  const [transportAllowance, setTransportAllowance] = useState(worker?.transport_allowance ?? 0);
  const [accommodationAllowance, setAccommodationAllowance] = useState(worker?.accommodation_allowance ?? 0);
  const [foodAllowance, setFoodAllowance] = useState(worker?.food_allowance ?? 0);
  const [monthlyWorkingHours, setMonthlyWorkingHours] = useState(worker?.monthly_working_hours ?? DEFAULT_MONTHLY_WORKING_HOURS);
  const [hourlyRate, setHourlyRate] = useState(worker?.hourly_rate ?? 0);
  const totalSalary = basicSalary + transportAllowance + accommodationAllowance + foodAllowance;
  const skipFirstRecalc = useRef(true);

  useEffect(() => {
    // Skip the run that fires on mount — an existing worker's saved hourly
    // rate (possibly a manual override that doesn't match a plain
    // total÷hours division) should show as-is when the form first opens,
    // not get silently recalculated away before the Manager has touched
    // anything.
    if (skipFirstRecalc.current) {
      skipFirstRecalc.current = false;
      return;
    }
    setHourlyRate(monthlyWorkingHours > 0 ? Math.round((totalSalary / monthlyWorkingHours) * 1000) / 1000 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basicSalary, transportAllowance, accommodationAllowance, foodAllowance, monthlyWorkingHours]);

  const salaryPending = worker ? isSalaryPending(worker) : false;

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

              {/* Task 5/6/10 — Salary Details: Manager/Super-Admin-only,
                  visually separate (its own bordered/shaded card) from the
                  normal worker details above. */}
              {canManageWorkerProfiles && (
                <>
                  {/* Task 3/4 — Salary Details. */}
                  <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-[#111827]">Salary Details</p>
                      {salaryPending && <StatusBadge label="Salary Pending" tone="amber" />}
                    </div>

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

                    <div className="mt-2">
                      <label className={lbl}>Total Salary (KWD)</label>
                      {/* Task 3 — always the sum of the four fields above,
                          never typed directly (kept in sync server-side too
                          — see computeSalary in lib/backend/workers/salary.ts). */}
                      <div className="rounded-md border border-[#E5E7EB] bg-gray-50 px-3 py-2 text-sm font-bold text-[#111827]">
                        {totalSalary.toFixed(3)}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="wp-hours" className={lbl}>Monthly Working Hours</label>
                        <input
                          id="wp-hours"
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
                      <div>
                        <label htmlFor="wp-rate" className={lbl}>Hourly Rate (KWD)</label>
                        <input
                          id="wp-rate"
                          name="hourly_rate"
                          type="number"
                          min="0"
                          step="0.001"
                          value={hourlyRate}
                          onChange={(e) => setHourlyRate(Number(e.target.value) || 0)}
                          className={inp}
                          disabled={isPending}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-[#6B7280]">
                      Hourly Rate is used to calculate labor cost from Job Card work time. It fills in automatically from
                      Total Salary and Monthly Working Hours — change it directly here only if it needs to be different.
                    </p>
                  </div>
                </>
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
