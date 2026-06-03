import { createPartsRequestAction } from "@/app/actions/phase4";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";

type Part = { id: string; part_code: string; part_name: string; part_number: string | null; ss_rec_code: string | null; unit_price: number | string };

export function PartsRequestForm({ workOrderId, parts }: { workOrderId: string; parts: Part[] }) {
  return (
    <form action={createPartsRequestAction} className="space-y-5">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <FormSection title="Parts Request" description="Request spare parts linked to this work order.">
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Remarks / equipment name</span>
          <textarea className="focus-ring mt-1 min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="remarks" />
        </label>
      </FormSection>
      <FormSection title="Requested Items" description="Enter up to five items for this phase.">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="rounded-md border border-[#E5E7EB] p-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Inventory part" name={`part_id_${index}`}>
                <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name={`part_id_${index}`}>
                  <option value="">Manual item</option>
                  {parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.part_code} - {part.part_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" name={`description_${index}`} />
              <Field label="Part number" name={`part_number_${index}`} />
              <Field label="SS rec code" name={`ss_rec_code_${index}`} />
              <Field label="Quantity" name={`quantity_requested_${index}`} type="number" />
              <Field label="Unit price" name={`unit_price_${index}`} type="number" />
              <Field label="Remarks" name={`remarks_${index}`} />
            </div>
          </div>
        ))}
      </FormSection>
      <Button type="submit">Submit parts request</Button>
    </form>
  );
}
