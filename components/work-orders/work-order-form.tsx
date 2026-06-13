import { upsertWorkOrderAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { FormDocumentHeader } from "@/components/forms/form-document-header";
import Link from "next/link";

const maintenanceTypes = ["Routine", "Service", "Breakdown", "Preventive", "Inspection", "Emergency", "Other"];
const workerTypes = ["Auto", "Mechanical", "Electrical", "Civil", "AC", "Plumbing", "Welding/Fabrication", "Other"];
const priorities = ["Low", "Normal", "High", "Urgent"];

type Option = { id: string; name: string; code?: string };
type AssetOption = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  serial_number: string | null;
  plate_number: string | null;
};
type FormRecord = Record<string, string | number | null | undefined>;

function dateTimeLocal(value: string | number | null | undefined) {
  return typeof value === "string" ? value.slice(0, 16) : "";
}

export function WorkOrderForm({
  workOrder,
  departments,
  assets,
  supervisors,
  laborRows = [],
  materialRows = [],
  attachmentRows = []
}: {
  workOrder?: FormRecord | null;
  departments: Option[];
  assets: AssetOption[];
  supervisors: Option[];
  laborRows?: FormRecord[];
  materialRows?: FormRecord[];
  attachmentRows?: FormRecord[];
}) {
  const isNew = !workOrder?.id;

  if (isNew) {
    const today = new Date().toISOString().slice(0, 10);
    // Focus color gives clear RECAFCO-branded highlight without changing cell borders
    const inputClass = "w-full border-0 bg-transparent px-2 py-1 text-sm outline-none focus:bg-red-50 transition-colors";
    const cellClass = "border border-[#2B2B2B] px-2 py-1 align-top";

    return (
      <form action={upsertWorkOrderAction} className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
              <FormDocumentHeader
                variant="form"
                title="Work Order"
                departmentName="Maintenance Department"
                referenceLabel="Ref:"
                referenceNumber="REC/MD/JOB/Sr.No"
              />
            </div>

            <div className="p-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm text-[#111827]">
                  <tbody>
                    <tr>
                      <td className={cellClass}>
                        <span className="font-semibold">Order taken by <span className="text-[#ED1C24]">*</span></span>
                        <input className={inputClass} name="ordered_by" required placeholder="Name of person ordering the work" />
                      </td>
                      <td className={cellClass}>
                        <span className="font-semibold">Date of order <span className="text-[#ED1C24]">*</span></span>
                        <input className={inputClass} name="date_of_order" type="date" defaultValue={today} required />
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass}>
                        <span className="font-semibold">Department <span className="text-[#ED1C24]">*</span></span>
                        <select className={inputClass} name="requested_by_department_id" defaultValue="" required>
                          <option value="" disabled>— required, select department —</option>
                          {departments.map((department) => (
                            <option key={department.id} value={department.id}>
                              {department.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={cellClass}>
                        <span className="font-semibold">Job location</span>
                        <input className={inputClass} name="job_location" placeholder="site, building, or area" />
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass}>
                        <span className="font-semibold">Machine / asset</span>
                        <select className={inputClass} name="asset_id" defaultValue="">
                          <option value="">Select asset if known</option>
                          {assets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.asset_code} - {asset.asset_name}
                              {asset.plate_number ? ` / ${asset.plate_number}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={cellClass}>
                        <span className="font-semibold">Start / end date time</span>
                        <div className="grid grid-cols-2 gap-2">
                          <input className={inputClass} name="starting_datetime" type="datetime-local" />
                          <input className={inputClass} name="ending_datetime" type="datetime-local" />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass}>
                        <span className="font-semibold">Serial / plate no.</span>
                        <input className={inputClass} name="serial_number" placeholder="if known" />
                        <input type="hidden" name="plate_number" value="" />
                      </td>
                      <td className={cellClass}>
                        <span className="font-semibold">Running hours / kms</span>
                        <div className="grid grid-cols-2 gap-2">
                          <input className={inputClass} name="running_hours" type="number" placeholder="hours (if known)" />
                          <input className={inputClass} name="kilometers" type="number" placeholder="kms (if known)" />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass} colSpan={2}>
                        <div className="grid gap-3 md:grid-cols-[1fr_1fr_12rem]">
                          <div>
                            <span className="font-semibold">Maintenance type</span>
                            <div className="mt-2 flex flex-wrap gap-3">
                              {maintenanceTypes.map((item) => (
                                <label key={item} className="flex items-center gap-1 text-xs font-semibold">
                                  <input type="radio" name="maintenance_type" value={item} defaultChecked={item === "Breakdown"} className="accent-[#ED1C24]" />
                                  {item}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span className="font-semibold">Worker team</span>
                            <div className="mt-2 flex flex-wrap gap-3">
                              {workerTypes.map((item) => (
                                <label key={item} className="flex items-center gap-1 text-xs font-semibold">
                                  <input type="radio" name="worker_type" value={item} defaultChecked={item === "Mechanical"} className="accent-[#ED1C24]" />
                                  {item}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span className="font-semibold">Priority</span>
                            <select className={inputClass} name="priority" defaultValue="Normal">
                              {priorities.map((item) => (
                                <option key={item}>{item}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass} colSpan={2}>
                        <span className="font-semibold">Operator complaint <span className="text-[#ED1C24]">*</span></span>
                        <textarea
                          className="mt-1 min-h-20 w-full resize-y border border-[#2B2B2B] bg-[#FFFDF7] px-3 py-2 outline-none focus:bg-red-50 transition-colors"
                          name="operator_complaint"
                          required
                          placeholder="Describe the issue, fault, or complaint reported by the operator…"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className={cellClass} colSpan={2}>
                        <span className="font-semibold">Description of work</span>
                        <textarea
                          className="mt-1 min-h-28 w-full resize-y border border-[#2B2B2B] bg-[repeating-linear-gradient(white,white_27px,#D1D5DB_28px)] px-3 py-2 leading-7 outline-none focus:bg-red-50 transition-colors"
                          name="description_of_work"
                          placeholder="Describe the work required or to be carried out…"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-4 mb-1 text-xs text-[#9CA3AF]">Labor entries are optional — leave blank if not yet assigned.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm text-[#111827]">
                  <thead>
                    <tr className="bg-[#F3F4F6]">
                      <th className={cellClass}>Labor name / number</th>
                      <th className={cellClass}>Hours</th>
                      <th className={cellClass}>Rate</th>
                      <th className={cellClass}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3].map((index) => (
                      <tr key={index}>
                        <td className={cellClass}>
                          <div className="grid grid-cols-[1fr_10rem] gap-2">
                            <input className={inputClass} name={`labor_name_${index}`} />
                            <input className={inputClass} name={`labor_employee_number_${index}`} placeholder="employee no." />
                          </div>
                        </td>
                        <td className={cellClass}><input className={inputClass} name={`labor_hours_${index}`} type="number" step="0.01" /></td>
                        <td className={cellClass}><input className={inputClass} name={`labor_rate_${index}`} type="number" step="0.01" /></td>
                        <td className={cellClass}><input className={inputClass} readOnly placeholder="auto" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 mb-1 text-xs text-[#9CA3AF]">Material entries are optional — leave blank if no materials used yet.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm text-[#111827]">
                  <thead>
                    <tr className="bg-[#F3F4F6]">
                      <th className={cellClass}>Material</th>
                      <th className={cellClass}>Part no.</th>
                      <th className={cellClass}>SS rec code</th>
                      <th className={cellClass}>Quantity</th>
                      <th className={cellClass}>Unit price</th>
                      <th className={cellClass}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4].map((index) => (
                      <tr key={index}>
                        <td className={cellClass}><input className={inputClass} name={`material_name_${index}`} /></td>
                        <td className={cellClass}><input className={inputClass} name={`material_part_number_${index}`} /></td>
                        <td className={cellClass}><input className={inputClass} name={`material_ss_rec_code_${index}`} /></td>
                        <td className={cellClass}><input className={inputClass} name={`material_quantity_${index}`} type="number" step="0.01" /></td>
                        <td className={cellClass}><input className={inputClass} name={`material_unit_price_${index}`} type="number" step="0.01" /></td>
                        <td className={cellClass}><input className={inputClass} readOnly placeholder="auto" /></td>
                      </tr>
                    ))}
                    <tr>
                      <td className={cellClass} colSpan={4}>
                        <span className="font-semibold">Operator signature / confirmation</span>
                        <input className={inputClass} name="operator_requester_confirmation" />
                      </td>
                      <td className={cellClass} colSpan={2}>
                        <span className="font-semibold">Next service</span>
                        <input className={inputClass} name="next_service_date" type="date" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="asset_category" value="" />
                <input type="hidden" name="assigned_supervisor_id" value="" />
                <input type="hidden" name="supervisor_verification" value="" />
                <input type="hidden" name="maintenance_manager_closure" value="" />
                <input type="hidden" name="next_service_kilometer" value="" />
                <input type="hidden" name="next_service_running_hours" value="" />
                <label className="block">
                  <span className="text-sm font-semibold text-[#111827]">Data entry notes</span>
                  <textarea className="focus-ring mt-1 min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="notes" />
                </label>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            {/* Other forms panel */}
            <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Other Forms</p>
              <p className="mt-0.5 mb-3 text-xs text-[#4B5563]">Currently filling: Work Order</p>
              <Link
                href="/store/parts-requests/new"
                className="flex flex-col gap-0.5 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3 transition hover:border-[#ED1C24] hover:bg-red-50"
              >
                <p className="text-sm font-black text-[#111827]">Parts Request</p>
                <p className="text-xs text-[#4B5563]">Request spare parts or materials linked to a work order.</p>
                <p className="mt-1 text-xs font-bold text-[#ED1C24]">Start Parts Request →</p>
              </Link>
            </section>

            {/* Sticky action panel */}
            <div className="sticky bottom-4 rounded-md border border-[#DDE2EA] bg-white p-4 shadow-lg shadow-black/5">
              {/* Current status */}
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Status</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-[#4B5563]">Draft</span>
              </div>
              {/* Reference note */}
              <p className="mb-3 rounded-md bg-[#F8FAFC] px-3 py-2 text-xs text-[#4B5563]">
                Reference number will be generated on save.
              </p>
              {/* Required fields reminder */}
              <div className="mb-3 border-t border-[#E5E7EB] pt-3">
                <p className="mb-1.5 text-xs font-black text-[#111827]">Required to submit:</p>
                <ul className="space-y-1 text-xs text-[#4B5563]">
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Order taken by</li>
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Department</li>
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Operator complaint</li>
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Description of work</li>
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Maintenance type <span className="text-[#9CA3AF]">(pre-selected)</span></li>
                  <li className="flex items-center gap-1.5"><span className="font-bold text-[#ED1C24]">*</span> Worker team <span className="text-[#9CA3AF]">(pre-selected)</span></li>
                </ul>
              </div>
              {/* Action buttons */}
              <div className="space-y-3 border-t border-[#E5E7EB] pt-3">
                <div>
                  <p className="mb-2 text-xs text-[#4B5563]">Submit sends this request to the manager for approval.</p>
                  <Button type="submit" name="intent" value="submit_for_approval" className="w-full">
                    Submit for Approval
                  </Button>
                </div>
                <div className="border-t border-[#E5E7EB] pt-3">
                  <Button type="submit" name="intent" value="save_draft" variant="ghost" className="w-full">
                    Save Draft
                  </Button>
                  <p className="mt-1.5 text-center text-xs text-[#9CA3AF]">Use draft only if the form is incomplete.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </form>
    );
  }

  return (
    <form action={upsertWorkOrderAction} className="space-y-5">
      {workOrder?.id ? <input type="hidden" name="id" value={workOrder.id} /> : null}
      <FormSection title="Work Order Header" description="Primary paper-form details and asset reference.">
        <Field label="Ordered by" name="ordered_by" defaultValue={workOrder?.ordered_by} required />
        <Field label="Requested by department" name="requested_by_department_id">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="requested_by_department_id" defaultValue={workOrder?.requested_by_department_id ?? ""}>
            <option value="">Not assigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Machine / asset" name="asset_id">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="asset_id" defaultValue={workOrder?.asset_id ?? ""}>
            <option value="">No asset selected</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.asset_code} - {asset.asset_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asset category" name="asset_category" defaultValue={workOrder?.asset_category} />
        <Field label="Serial number" name="serial_number" defaultValue={workOrder?.serial_number} />
        <Field label="Plate number" name="plate_number" defaultValue={workOrder?.plate_number} />
        <Field label="Date of order" name="date_of_order" type="date" defaultValue={workOrder?.date_of_order ?? new Date().toISOString().slice(0, 10)} required />
        <Field label="Job location" name="job_location" defaultValue={workOrder?.job_location} />
      </FormSection>

      <FormSection title="Job Details">
        <Field label="Starting date/time" name="starting_datetime" type="datetime-local" defaultValue={dateTimeLocal(workOrder?.starting_datetime)} />
        <Field label="Ending date/time" name="ending_datetime" type="datetime-local" defaultValue={dateTimeLocal(workOrder?.ending_datetime)} />
        <Field label="Maintenance type" name="maintenance_type">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="maintenance_type" defaultValue={workOrder?.maintenance_type ?? "Routine"}>
            {maintenanceTypes.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Worker type" name="worker_type">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="worker_type" defaultValue={workOrder?.worker_type ?? "Mechanical"}>
            {workerTypes.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Running hours" name="running_hours" type="number" defaultValue={workOrder?.running_hours} />
        <Field label="Kilometers" name="kilometers" type="number" defaultValue={workOrder?.kilometers} />
        <Field label="Priority" name="priority">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="priority" defaultValue={workOrder?.priority ?? "Normal"}>
            {priorities.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Assigned supervisor" name="assigned_supervisor_id">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="assigned_supervisor_id" defaultValue={workOrder?.assigned_supervisor_id ?? ""}>
            <option value="">Not assigned</option>
            {supervisors.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {supervisor.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Operator complaint</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="operator_complaint" defaultValue={workOrder?.operator_complaint ?? ""} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Description of work</span>
          <textarea className="focus-ring mt-1 min-h-28 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="description_of_work" defaultValue={workOrder?.description_of_work ?? ""} />
        </label>
      </FormSection>

      <FormSection title="Labor Entries" description="Enter up to three labor lines for this phase.">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-md border border-[#E5E7EB] p-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Labor name" name={`labor_name_${index}`} defaultValue={laborRows[index]?.labor_name} />
              <Field label="Employee number" name={`labor_employee_number_${index}`} defaultValue={laborRows[index]?.employee_number} />
              <Field label="Hours" name={`labor_hours_${index}`} type="number" defaultValue={laborRows[index]?.hours} />
              <Field label="Rate" name={`labor_rate_${index}`} type="number" defaultValue={laborRows[index]?.rate} />
            </div>
          </div>
        ))}
      </FormSection>

      <FormSection title="Material Used Entries" description="Enter up to three material lines for this phase.">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-md border border-[#E5E7EB] p-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Material / part" name={`material_name_${index}`} defaultValue={materialRows[index]?.material_name} />
              <Field label="Part number" name={`material_part_number_${index}`} defaultValue={materialRows[index]?.part_number} />
              <Field label="SS rec code" name={`material_ss_rec_code_${index}`} defaultValue={materialRows[index]?.ss_rec_code} />
              <Field label="Quantity" name={`material_quantity_${index}`} type="number" defaultValue={materialRows[index]?.quantity} />
              <Field label="Unit price" name={`material_unit_price_${index}`} type="number" defaultValue={materialRows[index]?.unit_price} />
            </div>
          </div>
        ))}
      </FormSection>

      <FormSection title="Confirmations and Next Service">
        <Field label="Operator/requester confirmation" name="operator_requester_confirmation" defaultValue={workOrder?.operator_requester_confirmation} />
        <Field label="Supervisor verification" name="supervisor_verification" defaultValue={workOrder?.supervisor_verification} />
        <Field label="Maintenance manager closure" name="maintenance_manager_closure" defaultValue={workOrder?.maintenance_manager_closure} />
        <Field label="Next service date" name="next_service_date" type="date" defaultValue={workOrder?.next_service_date} />
        <Field label="Next service kilometer" name="next_service_kilometer" type="number" defaultValue={workOrder?.next_service_kilometer} />
        <Field label="Next service running hours" name="next_service_running_hours" type="number" defaultValue={workOrder?.next_service_running_hours} />
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Notes</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="notes" defaultValue={workOrder?.notes ?? ""} />
        </label>
      </FormSection>

      <FormSection title="Attachment Metadata Foundation" description="Private file upload flow is completed later; record file references now if needed.">
        {[0, 1].map((index) => (
          <div key={index} className="rounded-md border border-[#E5E7EB] p-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Attachment type" name={`attachment_type_${index}`} defaultValue={attachmentRows[index]?.attachment_type} />
              <Field label="File name" name={`attachment_file_name_${index}`} defaultValue={attachmentRows[index]?.file_name} />
              <Field label="Private file path" name={`attachment_file_path_${index}`} defaultValue={attachmentRows[index]?.file_path} />
            </div>
          </div>
        ))}
      </FormSection>

      <Button type="submit">Save work order</Button>
    </form>
  );
}
