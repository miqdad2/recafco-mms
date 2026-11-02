"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

import { saveJobCardEditAction, type JobCardEditState } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { CancelEditButton } from "@/components/work-orders/cancel-edit-button";
import { DEFAULT_MAINTENANCE_TYPE, MAINTENANCE_TYPES } from "@/lib/work-orders/maintenance-types";

// Edit Job Card. Edits the Job Card's own details only. Workers, worker time,
// required materials, stock, attachments and closure each have their own
// workflow, shown here read-only with a link. Older paper-form labor and
// "material used" rows are not posted, so the save keeps them as they are
// (see the save action's section rules).

const WORKER_TYPES = ["Auto", "Mechanical", "Electrical", "Other"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

type FormRecord = Record<string, string | number | null | undefined>;
type Option = { id: string; name: string };
type AssetOption = { id: string; asset_code: string; asset_name: string };

export type JobCardEditRelated = {
  detailHref: string;
  team: { supervisor: string[]; technicians: string[]; helpers: string[]; external: string | null };
  canEditAssignment: boolean;
  timing: { completed: string; duration: string; approved: string | null };
  requiredMaterials: Array<{ name: string; partNumber: string | null; quantity: number; unit: string; issued: number }>;
  materialsRequest: { number: string | null; status: string; href: string } | null;
  attachmentsCount: number;
};

const select = "focus-ring mt-1 min-h-11 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2";
const help = "mt-1 text-xs leading-relaxed text-[#6B7280]";


function Hint({ children }: { children: ReactNode }) {
  return <p className={help}>{children}</p>;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[#111827]">{label}</p>
      <p className="mt-1 rounded-md bg-[#F9FAFB] px-3 py-2 text-sm text-[#374151]">{value}</p>
    </div>
  );
}

function ElsewhereLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[#ED1C24] hover:underline">
      {children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function AutomaticNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#4B5563] md:col-span-2">{children}</p>;
}

export function JobCardEditForm({
  workOrder,
  departments,
  assets,
  related,
  cancelHref,
}: {
  workOrder: FormRecord;
  departments: Option[];
  assets: AssetOption[];
  related: JobCardEditRelated;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState<JobCardEditState, FormData>(saveJobCardEditAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Show the problem and move to the field it is about.
  useEffect(() => {
    if (!state) return;
    errorRef.current?.scrollIntoView({ block: "center" });
    const field = state.field ? formRef.current?.elements.namedItem(state.field) : null;
    if (field instanceof HTMLElement) field.focus();
  }, [state]);

  // Submitted by hand: a <form action> makes React reset the form afterwards,
  // which would clear everything typed when the save is refused.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  }

  const team = related.team;
  const hasTeam = team.supervisor.length + team.technicians.length + team.helpers.length > 0 || team.external !== null;
  const legacyType = (value: unknown, list: readonly string[]) => (typeof value === "string" && value && !list.includes(value) ? value : null);
  const legacyMaintenance = legacyType(workOrder.maintenance_type, MAINTENANCE_TYPES);
  const legacyWorker = legacyType(workOrder.worker_type, WORKER_TYPES);

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-5 pb-24">
      <input type="hidden" name="id" value={String(workOrder.id)} />
      {/* Kept as they are: no longer edited here. */}
      <input type="hidden" name="assigned_supervisor_id" value={typeof workOrder.assigned_supervisor_id === "string" ? workOrder.assigned_supervisor_id : ""} />
      <input type="hidden" name="notes" value={typeof workOrder.notes === "string" ? workOrder.notes : ""} />
      {/* Older paper-form start / end times: not shown, sent back exactly as
          stored (an absent field would be saved as blank). The start feeds the
          overdue reports. */}
      <input type="hidden" name="starting_datetime" value={typeof workOrder.starting_datetime === "string" ? workOrder.starting_datetime : ""} />
      <input type="hidden" name="ending_datetime" value={typeof workOrder.ending_datetime === "string" ? workOrder.ending_datetime : ""} />

      {state ? (
        <div ref={errorRef} role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.error} Nothing was saved. Your changes are still in the form.</span>
        </div>
      ) : null}

      <FormSection title="1. Basic Information" description="Who asked for the work and which machine it is for.">
        <Field label="Requested by *" name="ordered_by" defaultValue={workOrder.ordered_by} required />
        <Field label="Requested by department" name="requested_by_department_id">
          <select className={select} name="requested_by_department_id" defaultValue={workOrder.requested_by_department_id ?? ""}>
            <option value="">Not assigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Machine / Asset" name="asset_id">
          <select className={select} name="asset_id" defaultValue={workOrder.asset_id ?? ""}>
            <option value="">No asset selected</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.asset_code} - {a.asset_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Job location" name="job_location" defaultValue={workOrder.job_location} />
        <div className="grid gap-4 sm:grid-cols-3 md:col-span-2">
          <Field label="Asset category" name="asset_category" defaultValue={workOrder.asset_category} />
          <Field label="Serial number" name="serial_number" defaultValue={workOrder.serial_number} />
          <Field label="Plate number" name="plate_number" defaultValue={workOrder.plate_number} />
          <p className={`${help} sm:col-span-3 -mt-2`}>
            Copied onto this Job Card when it was created. Changing them here does not change the asset record, and choosing another asset does not update them.
          </p>
        </div>
        <Field label="Maintenance type" name="maintenance_type">
          <select className={select} name="maintenance_type" defaultValue={workOrder.maintenance_type ?? DEFAULT_MAINTENANCE_TYPE}>
            {legacyMaintenance ? <option value={legacyMaintenance}>{legacyMaintenance} (older value)</option> : null}
            {MAINTENANCE_TYPES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Worker type" name="worker_type">
          <select className={select} name="worker_type" defaultValue={workOrder.worker_type ?? "Mechanical"}>
            {legacyWorker ? <option value={legacyWorker}>{legacyWorker} (older value)</option> : null}
            {WORKER_TYPES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" name="priority">
          <select className={select} name="priority" defaultValue={workOrder.priority ?? "Normal"}>
            {PRIORITIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="2. Problem & Work Details" description="What is wrong and what work is needed.">
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Operator complaint</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="operator_complaint" defaultValue={workOrder.operator_complaint ?? ""} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Description of work</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="description_of_work" defaultValue={workOrder.description_of_work ?? ""} />
        </label>
        <Field label="Running hours" name="running_hours" type="number" min="0" step="any" defaultValue={workOrder.running_hours} />
        <Field label="Kilometers" name="kilometers" type="number" min="0" step="any" defaultValue={workOrder.kilometers} />
        <div>
          <Field label="Estimated Worker Hours" name="estimated_labor_hours" type="number" min="0" step="any" defaultValue={workOrder.estimated_labor_hours} />
          <Hint>Combined working hours expected for all workers. Not the time the Job Card stays open.</Hint>
        </div>
      </FormSection>

      <FormSection title="3. Job Card Dates & Time" description="All times are Kuwait time.">
        <Field label="Date of order *" name="date_of_order" type="date" defaultValue={workOrder.date_of_order} required />
        <div>
          <Field label="Job Card Closed Date" name="job_card_end_date" type="date" defaultValue={workOrder.job_card_end_date ?? ""} />
          <Hint>Optional. Cannot be before the Open Date. This is not the Manager&apos;s approval.</Hint>
        </div>
        <div>
          <Field label="Job Card Open Date" name="job_card_start_date" type="date" defaultValue={workOrder.job_card_start_date ?? ""} />
          <Hint>Optional. The date this Job Card was opened.</Hint>
        </div>
        <div>
          <Field label="Job Card Open Time" name="job_card_open_time" type="time" defaultValue={workOrder.job_card_open_time ?? undefined} />
          <Hint>Optional. Needed to work out the Job Card Duration.</Hint>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 md:col-span-2">
          <ReadOnly label="Work Completed" value={related.timing.completed} />
          <ReadOnly label="Job Card Duration" value={related.timing.duration} />
          <ReadOnly label="Manager Approved On" value={related.timing.approved ?? "Not approved yet"} />
          <p className={`${help} sm:col-span-3 -mt-2`}>Filled automatically from worker time and the closure request. They cannot be changed here.</p>
        </div>
      </FormSection>

      <FormSection title="4. Workers & Assignments" description="Changed in Edit Assignment, and worker time in Daily Activity.">
        <div className="space-y-1 text-sm md:col-span-2">
          {hasTeam ? (
            <>
              {team.supervisor.length ? <p><span className="text-[#6B7280]">Supervisor:</span> <strong>{team.supervisor.join(", ")}</strong></p> : null}
              {team.technicians.length ? <p><span className="text-[#6B7280]">Technicians:</span> <strong>{team.technicians.join(", ")}</strong></p> : null}
              {team.helpers.length ? <p><span className="text-[#6B7280]">Helpers / Labor:</span> <strong>{team.helpers.join(", ")}</strong></p> : null}
              {team.external ? <p><strong>{team.external}</strong></p> : null}
            </>
          ) : (
            <p className="text-[#6B7280]">Nobody is assigned yet.</p>
          )}
          {related.canEditAssignment ? (
            <ElsewhereLink href={`${related.detailHref}?editAssignment=1&tab=assignment`}>Change workers in Edit Assignment</ElsewhereLink>
          ) : null}
        </div>
      </FormSection>

      <FormSection title="5. Materials" description="Required materials are handled through the Materials Request and Inventory Control.">
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-[#111827]">Required materials</p>
          {related.requiredMaterials.length ? (
            <div className="mt-1 overflow-x-auto rounded-md border border-[#E5E7EB]">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-[#F9FAFB] text-xs font-bold text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Part number</th>
                    <th className="px-3 py-2">Required</th>
                    <th className="px-3 py-2">Issued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {related.requiredMaterials.map((m, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-semibold text-[#111827]">{m.name}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{m.partNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{m.quantity} {m.unit}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{m.issued} {m.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-1 text-sm text-[#6B7280]">No required materials.</p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-5">
            {related.materialsRequest ? (
              <ElsewhereLink href={related.materialsRequest.href}>
                Materials Request {related.materialsRequest.number ?? ""} ({related.materialsRequest.status})
              </ElsewhereLink>
            ) : null}
            <ElsewhereLink href={`${related.detailHref}?tab=materials`}>Materials on the Job Card</ElsewhereLink>
          </div>
        </div>
      </FormSection>

      <FormSection title="6. Attachments & Additional Information">
        <div className="md:col-span-2">
          <p className="text-sm text-[#374151]">
            {related.attachmentsCount ? `${related.attachmentsCount} attachment${related.attachmentsCount === 1 ? "" : "s"} on this Job Card.` : "No attachments yet."}
          </p>
          <ElsewhereLink href={`${related.detailHref}?tab=attachments`}>View or add attachments</ElsewhereLink>
        </div>
        <AutomaticNote>
          Paper-form signature text, printed on the Job Card. Writing here does not approve, verify or close the Job Card: closure goes through Request Closure and the Manager&apos;s approval.
        </AutomaticNote>
        <Field label="Operator / requester confirmation" name="operator_requester_confirmation" defaultValue={workOrder.operator_requester_confirmation} />
        <Field label="Supervisor verification" name="supervisor_verification" defaultValue={workOrder.supervisor_verification} />
        <Field label="Maintenance manager closure (text)" name="maintenance_manager_closure" defaultValue={workOrder.maintenance_manager_closure} />
        <div className="hidden md:block" aria-hidden="true" />
        <AutomaticNote>Next service, printed on this Job Card. It does not change the asset&apos;s own service schedule.</AutomaticNote>
        <Field label="Next service date" name="next_service_date" type="date" defaultValue={workOrder.next_service_date} />
        <Field label="Next service kilometers" name="next_service_kilometer" type="number" min="0" step="any" defaultValue={workOrder.next_service_kilometer} />
        <Field label="Next service running hours" name="next_service_running_hours" type="number" min="0" step="any" defaultValue={workOrder.next_service_running_hours} />
      </FormSection>

      {/* Fixed, not sticky: the page body is its own (non-scrolling) scroll
          container, so position: sticky never engages there. Sits above the
          phone bottom navigation and beside the desktop sidebar. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-end gap-2 border-t border-[#E5E7EB] bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(17,24,39,0.06)] lg:bottom-0 lg:left-64 lg:px-6">
        <CancelEditButton returnHref={cancelHref} />
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
