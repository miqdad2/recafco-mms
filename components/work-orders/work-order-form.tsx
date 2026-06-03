import { upsertWorkOrderAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";

const maintenanceTypes = ["Routine", "Service", "Breakdown", "Preventive", "Inspection", "Emergency", "Other"];
const workerTypes = ["Auto", "Mechanical", "Electrical", "Civil", "AC", "Plumbing", "Welding/Fabrication", "Other"];
const priorities = ["Low", "Normal", "High", "Urgent"];
const statuses = [
  "Draft",
  "Submitted",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Assigned",
  "In Progress",
  "Waiting for Parts",
  "Waiting for Purchase",
  "Parts Issued",
  "Completed by Technician",
  "Verified by Supervisor",
  "Confirmed by Requester",
  "Closed",
  "Cancelled",
  "Reopened"
];

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
        <Field label="Status" name="status">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="status" defaultValue={workOrder?.status ?? "Pending Approval"}>
            {statuses.map((item) => (
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
