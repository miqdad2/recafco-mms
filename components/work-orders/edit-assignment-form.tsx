"use client";

import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Loader2, Lock, Search, X } from "lucide-react";

import { saveInternalTeamRosterAction, type InternalTeamRosterState } from "@/app/actions/work-order-roster";
import { assignTechniciansModalAction, type AssignModalState } from "@/app/actions/workflow";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { dispatchActionToast } from "@/lib/action-messages";
import {
  initialAssignmentTab,
  matchesWorkerSearch,
  workersBeingRemoved,
  type AssignmentTab,
  type EditAssignmentCurrent,
  type EditAssignmentData,
  type EditAssignmentRosterRow,
} from "@/lib/work-orders/assignment-edit";

// The Edit Assignment popup. Each tab saves its own record through the
// existing actions (lib/work-orders/assignment-edit.ts explains the two
// records).

const inp =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF] disabled:bg-gray-50 disabled:text-[#6B7280]";
const lbl = "mb-1 block text-sm font-bold text-[#374151]";
const heading = "text-sm font-black text-[#111827]";

function Problem({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function CurrentAssignment({ roster, current }: { roster: EditAssignmentRosterRow[]; current: EditAssignmentCurrent }) {
  const names = (role: string) => roster.filter((r) => r.worker_role === role).map((r) => r.name);
  const groups = [
    { label: "Supervisor", names: names("Supervisor"), empty: "No Supervisor" },
    { label: "Technicians", names: names("Technician"), empty: "No Technicians Assigned" },
    { label: "Helpers / Labor", names: names("Helper/Labor"), empty: "No Helpers Assigned" },
  ];
  const external =
    current?.type === "FREELANCER"
      ? `Freelancer: ${current.externalName ?? ""}`
      : current?.type === "EXTERNAL_COMPANY"
        ? `Company: ${current.externalCompany ?? ""}`
        : current?.type === "OTHER"
          ? `Other: ${current.externalName ?? ""}`
          : current?.technicianName
            ? `Login technician: ${current.technicianName}`
            : null;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3" aria-label="Currently assigned">
      <p className="text-xs font-black uppercase tracking-wide text-[#6B7280]">Currently assigned</p>
      <dl className="mt-1 space-y-0.5 text-sm">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-wrap gap-x-1.5">
            <dt className="text-[#6B7280]">{g.label}:</dt>
            <dd className={g.names.length ? "font-semibold text-[#111827]" : "text-[#6B7280]"}>{g.names.join(", ") || g.empty}</dd>
          </div>
        ))}
        {external ? <p className="font-semibold text-[#111827]">{external}</p> : null}
      </dl>
    </section>
  );
}

const CONNECTION_PROBLEM = "The assignment could not be saved. Check your connection and try again.";

// A lost connection rejects the action; show it in the popup and keep the form.
function safely<S>(action: (prev: S, form: FormData) => Promise<S>) {
  return async (prev: S, form: FormData): Promise<S> => {
    try {
      return await action(prev, form);
    } catch {
      return { ok: false, error: CONNECTION_PROBLEM } as S;
    }
  };
}

// Submitted by hand: a <form action> makes React reset the form afterwards, so a
// refused save would clear the ticks and typed details still in the popup.
function submitTo(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  };
}

type PickerWorker = { id: string; name: string; detail: string | null; lock: string | null };

function WorkerPicker({
  title,
  noun,
  workers,
  selected,
  onChange,
  disabled,
}: {
  title: string;
  noun: string;
  workers: PickerWorker[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const headingId = useId();
  const visible = workers.filter((w) => matchesWorkerSearch(w.name, search));
  const chosen = workers.filter((w) => selected.includes(w.id));

  function toggle(id: string, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((v) => v !== id));
  }

  return (
    <fieldset className="min-w-0" aria-labelledby={headingId}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p id={headingId} className={heading}>{title}</p>
        <p className="text-xs font-bold text-[#6B7280]" aria-live="polite">{selected.length} selected</p>
      </div>

      {chosen.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`Selected ${title}`}>
          {chosen.map((w) => (
            <li key={w.id} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#F3F4F6] py-0.5 pl-2.5 pr-1 text-sm font-semibold text-[#111827]">
              {w.name}
              {w.lock ? (
                <span className="inline-flex items-center gap-1 px-1 text-xs font-bold text-[#6B7280]">
                  <Lock className="h-3 w-3" aria-hidden="true" /> {w.lock}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(w.id, false)}
                  aria-label={`Remove ${w.name}`}
                  className="focus-ring rounded p-1 text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#111827]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {workers.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#D1D5DB] px-3 py-4 text-sm text-[#6B7280]">
          No {noun} available. Add them under Worker Profiles first.
        </p>
      ) : (
        <div className="rounded-md border border-[#D1D5DB]">
          <div className="relative border-b border-[#E5E7EB]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
            <input
              type="search"
              value={search}
              data-no-dirty
              disabled={disabled}
              onChange={(e) => setSearch(e.target.value)}
              // Enter in a search box must not save the assignment.
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              placeholder={`Search ${noun} by name`}
              aria-label={`Search ${noun} by name`}
              className="focus-ring min-h-11 w-full rounded-t-md bg-white py-2 pl-9 pr-3 text-sm placeholder:text-[#9CA3AF]"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {visible.map((w) => (
              <li key={w.id}>
                <label className={`flex min-h-11 items-center gap-3 px-3 py-1.5 text-sm ${w.lock ? "text-[#6B7280]" : "cursor-pointer text-[#111827] hover:bg-[#F9FAFB]"}`}>
                  <input
                    type="checkbox"
                    className="h-4.5 w-4.5 shrink-0 accent-[#ED1C24]"
                    checked={selected.includes(w.id)}
                    disabled={disabled || Boolean(w.lock)}
                    onChange={(e) => toggle(w.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">{w.name}</span>
                  {w.detail ? <span className="shrink-0 text-xs text-[#6B7280]">{w.detail}</span> : null}
                </label>
              </li>
            ))}
            {visible.length === 0 ? <li className="px-3 py-3 text-sm text-[#6B7280]">No {noun} match that search.</li> : null}
          </ul>
        </div>
      )}
    </fieldset>
  );
}

function ExternalFields({ kind, current, canViewCosts, disabled }: {
  kind: "freelancer" | "company";
  current: EditAssignmentCurrent;
  canViewCosts: boolean;
  disabled: boolean;
}) {
  const company = kind === "company";
  const saved = current?.type === (company ? "EXTERNAL_COMPANY" : "FREELANCER") ? current : null;
  // A viewer who may not see costs keeps the saved amount without seeing it.
  const keepHiddenAmount = !canViewCosts && Boolean(saved?.hasAgreedAmount);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="assignment_type" value={company ? "EXTERNAL_COMPANY" : "FREELANCER"} />
      <div>
        <label htmlFor={`${kind}-name`} className={lbl}>{company ? "Company name" : "Freelancer name"} <span className="text-[#ED1C24]">*</span></label>
        <input id={`${kind}-name`} name={company ? "external_company" : "external_name"} defaultValue={(company ? saved?.externalCompany : saved?.externalName) ?? ""} className={inp} required disabled={disabled} />
      </div>
      {company ? (
        <div>
          <label htmlFor="company-contact" className={lbl}>Contact person</label>
          <input id="company-contact" name="external_contact_person" defaultValue={saved?.contactPerson ?? ""} className={inp} disabled={disabled} />
        </div>
      ) : null}
      <div>
        <label htmlFor={`${kind}-phone`} className={lbl}>Phone</label>
        <input id={`${kind}-phone`} name="external_phone" defaultValue={saved?.phone ?? ""} className={inp} disabled={disabled} />
      </div>
      <div>
        <label htmlFor={`${kind}-trade`} className={lbl}>{company ? "Work type / service" : "Work type / trade"}</label>
        <input id={`${kind}-trade`} name="external_trade" defaultValue={saved?.trade ?? ""} className={inp} disabled={disabled} />
      </div>
      <div>
        <label htmlFor={`${kind}-visit`} className={lbl}>Expected visit date</label>
        <input id={`${kind}-visit`} name="external_expected_visit_date" type="date" defaultValue={saved?.visitDate ?? ""} className={inp} disabled={disabled} />
      </div>
      {keepHiddenAmount ? (
        <div>
          <input type="hidden" name="keep_agreed_amount" value="1" />
          <p className={lbl}>Agreed amount</p>
          <p className="text-sm text-[#4B5563]">An amount is already recorded. It will be kept.</p>
        </div>
      ) : (
        <div>
          <label htmlFor={`${kind}-amount`} className={lbl}>{company ? "Agreed amount (optional)" : "Agreed amount / rate (optional)"}</label>
          <input id={`${kind}-amount`} name="agreed_amount" type="number" min="0" step="0.001" defaultValue={saved?.agreedAmount ?? ""} className={inp} disabled={disabled} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={`${kind}-notes`} className={lbl}>Instructions / notes (optional)</label>
        <textarea id={`${kind}-notes`} name="assign_notes" rows={2} defaultValue={saved?.notes ?? ""} className={`${inp} resize-none`} disabled={disabled} />
      </div>
    </div>
  );
}

const TABS: { value: AssignmentTab; label: string }[] = [
  { value: "internal", label: "Internal Team" },
  { value: "freelancer", label: "Freelancer" },
  { value: "company", label: "Company" },
];

export function EditAssignmentForm({
  workOrderId,
  status,
  closeHref,
  onSaved,
  workers,
  roster,
  current,
  canViewCosts,
  canManageRoster,
  canAssign,
}: EditAssignmentData & {
  // Where to go after saving, or onSaved for a page that stays where it is.
  closeHref?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [tab, setTab] = useState<AssignmentTab>(() => initialAssignmentTab(current?.type, { internal: canManageRoster, external: canAssign }));

  const [rosterState, rosterAction, rosterPending] = useActionState<InternalTeamRosterState, FormData>(safely(saveInternalTeamRosterAction), null);
  const [freelancerState, freelancerAction, freelancerPending] = useActionState<AssignModalState, FormData>(safely(assignTechniciansModalAction), null);
  const [companyState, companyAction, companyPending] = useActionState<AssignModalState, FormData>(safely(assignTechniciansModalAction), null);
  const saving = rosterPending || freelancerPending || companyPending;

  const saved = rosterState?.ok || freelancerState?.ok || companyState?.ok;
  useEffect(() => {
    if (!saved) return;
    dispatchActionToast({ tone: "success", title: "Assignment Updated" });
    if (onSaved) onSaved();
    else if (closeHref) router.push(closeHref, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const savedSupervisor = roster.find((r) => r.worker_role === "Supervisor") ?? null;
  const [supervisorId, setSupervisorId] = useState(savedSupervisor?.worker_id ?? "");
  const [technicianIds, setTechnicianIds] = useState(() => roster.filter((r) => r.worker_role === "Technician").map((r) => r.worker_id));
  const [helperIds, setHelperIds] = useState(() => roster.filter((r) => r.worker_role === "Helper/Labor").map((r) => r.worker_id));
  // Starts with the saved notes: the roster save writes this text to every
  // worker kept, so an empty box would erase them.
  const [notes, setNotes] = useState(() => roster.find((r) => r.notes)?.notes ?? "");

  // Changing a list through a Remove button fires no change event.
  function changeTechnicians(ids: string[]) { setTechnicianIds(ids); modal?.markDirty(); }
  function changeHelpers(ids: string[]) { setHelperIds(ids); modal?.markDirty(); }

  // Everyone on the roster stays listed under the role they hold, even if
  // their Worker Profile has since changed type or become inactive: a worker
  // missing from the list would be taken off the Job Card by saving.
  function pickerWorkers(role: string, workerType: string): PickerWorker[] {
    const onRoster = roster.filter((r) => r.worker_role === role);
    const heldElsewhere = new Set(roster.filter((r) => r.worker_role !== role).map((r) => r.worker_id));
    const available = workers.filter((w) => w.is_active && w.worker_type === workerType && !heldElsewhere.has(w.id));
    const rate = (id: string) => {
      const worker = workers.find((w) => w.id === id);
      return canViewCosts && worker?.hourly_rate != null ? `${worker.hourly_rate.toFixed(3)} KWD/hr` : null;
    };
    return [
      ...onRoster.map((r) => ({ id: r.worker_id, name: r.name, detail: rate(r.worker_id), lock: r.lock })),
      ...available.filter((w) => !onRoster.some((r) => r.worker_id === w.id)).map((w) => ({ id: w.id, name: w.name, detail: rate(w.id), lock: null })),
    ];
  }

  const supervisorLocked = savedSupervisor?.lock ?? null;
  const supervisorOptions = pickerWorkers("Supervisor", "Supervisor");
  const selectedIds = [...(supervisorId ? [supervisorId] : []), ...technicianIds, ...helperIds];
  const leaving = workersBeingRemoved(roster, selectedIds) as EditAssignmentRosterRow[];
  // Resubmitted unchanged so saving never wipes an estimate set earlier.
  const estimates = Object.fromEntries(roster.filter((r) => r.estimated_hours !== null).map((r) => [r.worker_id, r.estimated_hours]));

  const activeFormId = `edit-assignment-${tab}`;
  const replacesRecord =
    tab !== "internal" && (status === "In Progress" || (current !== null && current.type !== (tab === "company" ? "EXTERNAL_COMPANY" : "FREELANCER")));

  return (
    <div className="space-y-5">
      <CurrentAssignment roster={roster} current={current} />

      <fieldset>
        <legend className={`${heading} mb-2`}>Assignment type</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TABS.map(({ value, label }) => {
            const allowed = value === "internal" ? canManageRoster : canAssign;
            return (
              <label key={value} className={`block ${allowed && !saving ? "cursor-pointer" : "cursor-not-allowed"}`}>
                <input
                  type="radio"
                  name="edit-assignment-type"
                  data-no-dirty
                  className="peer sr-only"
                  checked={tab === value}
                  disabled={!allowed || saving}
                  onChange={() => setTab(value)}
                />
                <span className="flex min-h-12 items-center justify-center rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#374151] transition peer-checked:border-[#ED1C24] peer-checked:bg-red-50 peer-checked:text-[#B91C1C] peer-checked:shadow-[inset_0_0_0_1px_#ED1C24] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ED1C24] peer-disabled:bg-gray-50 peer-disabled:text-[#9CA3AF]">
                  {label}
                </span>
              </label>
            );
          })}
        </div>
        {!canAssign ? (
          <p className="mt-2 text-xs text-[#6B7280]">Freelancer and Company open once materials are resolved and the Job Card is approved.</p>
        ) : null}
      </fieldset>

      <form id="edit-assignment-internal" onSubmit={submitTo(rosterAction)} hidden={tab !== "internal"} className="space-y-5">
        <input type="hidden" name="work_order_id" value={workOrderId} />
        <input type="hidden" name="roster_notes" value={notes} />
        <input type="hidden" name="roster_worker_estimates" value={JSON.stringify(estimates)} />
        <input type="hidden" name="supervisor_id" value={supervisorId} />
        {technicianIds.map((id) => <input key={id} type="hidden" name="technician_ids" value={id} />)}
        {helperIds.map((id) => <input key={id} type="hidden" name="helper_ids" value={id} />)}

        {rosterState?.ok === false ? <Problem message={rosterState.error} /> : null}

        <div>
          <label htmlFor="assignment-supervisor" className={lbl}>Supervisor</label>
          <select
            id="assignment-supervisor"
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className={inp}
            disabled={saving || Boolean(supervisorLocked)}
          >
            <option value="">No supervisor</option>
            {supervisorOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.detail ? `${w.name} — ${w.detail}` : w.name}</option>
            ))}
          </select>
          {supervisorLocked ? <p className="mt-1 text-xs text-[#6B7280]">Cannot be changed: {supervisorLocked.toLowerCase()}.</p> : null}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <WorkerPicker title="Technicians" noun="technicians" workers={pickerWorkers("Technician", "Technician")} selected={technicianIds} onChange={changeTechnicians} disabled={saving} />
          <WorkerPicker title="Helpers / Labor" noun="helpers" workers={pickerWorkers("Helper/Labor", "Helper/Labor")} selected={helperIds} onChange={changeHelpers} disabled={saving} />
        </div>

        {roster.some((r) => r.lock) ? (
          <p className="flex items-start gap-1.5 text-xs text-[#4B5563]">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            Workers with a lock have work recorded on this Job Card, so they stay on it. Their timers and hours are not changed.
          </p>
        ) : null}

        <div>
          <label htmlFor="assignment-notes" className={lbl}>Assignment notes (optional)</label>
          <textarea id="assignment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} disabled={saving} />
        </div>
      </form>

      <form id="edit-assignment-freelancer" onSubmit={submitTo(freelancerAction)} hidden={tab !== "freelancer"} className="space-y-4">
        <input type="hidden" name="work_order_id" value={workOrderId} />
        {freelancerState?.ok === false ? <Problem message={freelancerState.error ?? "Could not save."} /> : null}
        <ExternalFields kind="freelancer" current={current} canViewCosts={canViewCosts} disabled={saving} />
      </form>

      <form id="edit-assignment-company" onSubmit={submitTo(companyAction)} hidden={tab !== "company"} className="space-y-4">
        <input type="hidden" name="work_order_id" value={workOrderId} />
        {companyState?.ok === false ? <Problem message={companyState.error ?? "Could not save."} /> : null}
        <ExternalFields kind="company" current={current} canViewCosts={canViewCosts} disabled={saving} />
      </form>

      <div className="sticky -bottom-5 -mx-6 -mb-5 border-t border-[#E5E7EB] bg-white px-6 py-4">
        {tab === "internal" && leaving.length > 0 ? (
          <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Will be removed when you save: {leaving.map((w) => w.name).join(", ")}
          </p>
        ) : null}
        {replacesRecord ? (
          <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {status === "In Progress" ? "Saving moves this Job Card back to Assigned. " : ""}
            {current !== null ? "This replaces the current assignment. The Internal Team stays." : ""}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => modal?.requestClose()}
            disabled={saving}
            className="focus-ring min-h-11 rounded-md border border-[#D1D5DB] bg-white px-5 text-sm font-bold text-[#374151] hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={activeFormId}
            disabled={saving}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#ED1C24] px-6 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save Assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
