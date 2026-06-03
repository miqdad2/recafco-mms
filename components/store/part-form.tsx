import { upsertPartAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";

const partStatuses = ["Active", "Inactive", "Low Stock", "Unavailable", "Discontinued"];
type PartRecord = Record<string, string | number | string[] | null | undefined>;

function scalar(value: string | number | string[] | null | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

export function PartForm({ part }: { part?: PartRecord | null }) {
  return (
    <form action={upsertPartAction} className="space-y-5">
      {part?.id ? <input type="hidden" name="id" value={part.id} /> : null}
      <FormSection title="Part Identity" description="Spare part master information used by store and maintenance.">
        <Field label="Part code" name="part_code" defaultValue={scalar(part?.part_code)} required />
        <Field label="Part name" name="part_name" defaultValue={scalar(part?.part_name)} required />
        <Field label="Category" name="category" defaultValue={scalar(part?.category)} />
        <Field label="Part number" name="part_number" defaultValue={scalar(part?.part_number)} />
        <Field label="SS rec code" name="ss_rec_code" defaultValue={scalar(part?.ss_rec_code)} />
        <Field label="Unit of measure" name="unit_of_measure" defaultValue={scalar(part?.unit_of_measure) ?? "PCS"} required />
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Description</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="description" defaultValue={part?.description ?? ""} />
        </label>
      </FormSection>

      <FormSection title="Inventory and Supplier">
        <Field label="Current stock" name="current_stock" type="number" defaultValue={scalar(part?.current_stock) ?? 0} />
        <Field label="Minimum stock" name="minimum_stock" type="number" defaultValue={scalar(part?.minimum_stock) ?? 0} />
        <Field label="Unit price" name="unit_price" type="number" defaultValue={scalar(part?.unit_price) ?? 0} />
        <Field label="Supplier" name="supplier" defaultValue={scalar(part?.supplier)} />
        <Field label="Store location / bin" name="store_location_bin" defaultValue={scalar(part?.store_location_bin)} />
        <Field label="Status" name="status">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="status" defaultValue={part?.status ?? "Active"}>
            {partStatuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Compatible asset categories" name="compatible_asset_categories" defaultValue={Array.isArray(part?.compatible_asset_categories) ? part.compatible_asset_categories.join(", ") : ""} />
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Notes</span>
          <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="notes" defaultValue={part?.notes ?? ""} />
        </label>
      </FormSection>
      <Button type="submit">Save part</Button>
    </form>
  );
}
