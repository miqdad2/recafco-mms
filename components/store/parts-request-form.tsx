import { createPartsRequestAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import { FormDocumentHeader } from "@/components/forms/form-document-header";

type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
  ordered_by: string | null;
  worker_type: string | null;
};

type PartOption = {
  id: string;
  part_code: string | null;
  part_name: string | null;
  part_number: string | null;
  ss_rec_code: string | null;
  unit_price: string | number | null;
};

type PartsRequestFormProps =
  | { workOrders: WorkOrderOption[]; workOrderId?: never; parts?: never }
  | { workOrderId: string; parts: PartOption[]; workOrders?: never };

const inputClass = "w-full border-0 bg-transparent px-2 py-1 text-sm outline-none focus:bg-white";
const cellClass = "border border-[#2B2B2B] px-2 py-1 align-top";

export function PartsRequestForm(props: PartsRequestFormProps) {
  if (props.workOrderId) {
    return <EmbeddedPartsRequestForm workOrderId={props.workOrderId} parts={props.parts} />;
  }

  const workOrders = props.workOrders ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toTimeString().slice(0, 5);

  return (
    <form action={createPartsRequestAction} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
        <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
          <FormDocumentHeader
            variant="form"
            title="Parts Request"
            departmentName="Maintenance Department"
            referenceLabel="Ref:"
            referenceNumber="SS-REQ/Sr.No"
          />
        </div>

        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm text-[#111827]">
              <tbody>
                <tr>
                  <td className={cellClass}>
                    <span className="font-semibold">Department / worker type</span>
                    <input className={inputClass} name="department_label" placeholder="Example: Maintenance / Auto" />
                  </td>
                  <td className={cellClass}>
                    <span className="font-semibold">Work Order No.</span>
                    <select className={inputClass} name="work_order_id" required defaultValue="">
                      <option value="">Select work order</option>
                      {workOrders.map((workOrder) => (
                        <option key={workOrder.id} value={workOrder.id}>
                          {workOrder.work_order_number ?? "Work order"} - {workOrder.ordered_by ?? "No requester"}
                          {workOrder.worker_type ? ` / ${workOrder.worker_type}` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={cellClass} colSpan={2}>
                    <span className="font-semibold">Remarks / equipment name</span>
                    <input className={inputClass} name="remarks" />
                  </td>
                </tr>
                <tr>
                  <td className={cellClass}>
                    <span className="font-semibold">Date</span>
                    <input className={inputClass} name="request_date" type="date" defaultValue={today} />
                  </td>
                  <td className={cellClass}>
                    <span className="font-semibold">Time</span>
                    <input className={inputClass} name="request_time" type="time" defaultValue={time} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm text-[#111827]">
              <thead>
                <tr className="bg-[#F3F4F6] text-center">
                  <th className={cellClass}>Sr. No.</th>
                  <th className={cellClass}>Description</th>
                  <th className={cellClass}>P/NA</th>
                  <th className={cellClass}>SS-Rec.Code</th>
                  <th className={cellClass}>Qty.</th>
                  <th className={cellClass}>Remarks</th>
                  <th className={cellClass}>Unit price</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4].map((index) => (
                  <tr key={index}>
                    <td className={`${cellClass} text-center font-semibold`}>{index + 1}</td>
                    <td className={cellClass}>
                      <textarea className="min-h-12 w-full resize-y border-0 bg-transparent px-2 py-1 text-sm outline-none focus:bg-white" name={`description_${index}`} />
                    </td>
                    <td className={cellClass}><input className={inputClass} name={`part_number_${index}`} /></td>
                    <td className={cellClass}><input className={inputClass} name={`ss_rec_code_${index}`} /></td>
                    <td className={cellClass}><input className={inputClass} name={`quantity_requested_${index}`} type="number" step="0.01" min="0" /></td>
                    <td className={cellClass}><input className={inputClass} name={`remarks_${index}`} /></td>
                    <td className={cellClass}><input className={inputClass} name={`unit_price_${index}`} type="number" step="0.01" min="0" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 text-sm text-[#111827] md:grid-cols-3">
            <label>
              <span className="font-semibold">Total price</span>
              <input className="mt-1 w-full border-b border-[#2B2B2B] bg-transparent px-2 py-1 outline-none" readOnly placeholder="Calculated after save" />
            </label>
            <label>
              <span className="font-semibold">Prepared by</span>
              <input className="mt-1 w-full border-b border-[#2B2B2B] bg-transparent px-2 py-1 outline-none" readOnly placeholder="Current login" />
            </label>
            <label>
              <span className="font-semibold">Approved by</span>
              <input className="mt-1 w-full border-b border-[#2B2B2B] bg-transparent px-2 py-1 outline-none" readOnly placeholder="Manager approval" />
            </label>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-[#111827]">Template</h2>
          <div className="mt-3 rounded-md border border-[#ED1C24] bg-red-50 p-3">
            <p className="text-sm font-black text-[#111827]">Parts Request</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Linked to a work order</p>
          </div>
        </section>

        <div className="sticky bottom-4 rounded-md border border-[#DDE2EA] bg-white p-4 shadow-lg shadow-black/5">
          <Button type="submit" className="w-full">
            Submit parts request
          </Button>
        </div>
      </aside>
    </form>
  );
}

function EmbeddedPartsRequestForm({ workOrderId, parts }: { workOrderId: string; parts: PartOption[] }) {
  return (
    <form action={createPartsRequestAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <div className="flex flex-col gap-2 border-l-4 border-[#ED1C24] pl-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Maintenance Form</p>
          <h2 className="text-lg font-black text-[#111827]">Parts Request</h2>
        </div>
        <Button type="submit">Submit parts request</Button>
      </div>
      <label className="mt-4 block">
        <span className="text-sm font-semibold text-[#111827]">Remarks / equipment name</span>
        <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="remarks" />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-[#F3F4F6] text-xs uppercase text-[#4B5563]">
            <tr>
              <th className="border border-[#E5E7EB] px-3 py-2">Description</th>
              <th className="border border-[#E5E7EB] px-3 py-2">Stock part</th>
              <th className="border border-[#E5E7EB] px-3 py-2">P/NA</th>
              <th className="border border-[#E5E7EB] px-3 py-2">SS rec code</th>
              <th className="border border-[#E5E7EB] px-3 py-2">Qty</th>
              <th className="border border-[#E5E7EB] px-3 py-2">Unit price</th>
              <th className="border border-[#E5E7EB] px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((index) => (
              <tr key={index}>
                <td className="border border-[#E5E7EB] p-2">
                  <input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`description_${index}`} />
                </td>
                <td className="border border-[#E5E7EB] p-2">
                  <select className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`part_id_${index}`} defaultValue="">
                    <option value="">Manual item</option>
                    {parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.part_code} - {part.part_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border border-[#E5E7EB] p-2"><input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`part_number_${index}`} /></td>
                <td className="border border-[#E5E7EB] p-2"><input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`ss_rec_code_${index}`} /></td>
                <td className="border border-[#E5E7EB] p-2"><input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`quantity_requested_${index}`} type="number" min="0" step="0.01" /></td>
                <td className="border border-[#E5E7EB] p-2"><input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`unit_price_${index}`} type="number" min="0" step="0.01" /></td>
                <td className="border border-[#E5E7EB] p-2"><input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-2" name={`remarks_${index}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
