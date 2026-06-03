import { upsertAssetAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";

const assetCategories = ["Vehicle", "Bus", "Car", "Truck", "Crane", "Forklift", "Generator", "Factory Machine", "Electrical Equipment", "Building/Facility", "Other"];
const assetStatuses = ["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"];

type Option = { id: string; name: string };
type FormRecord = Record<string, string | number | null | undefined>;

export function AssetForm({ asset, departments }: { asset?: FormRecord | null; departments: Option[] }) {
  return (
    <form action={upsertAssetAction} className="space-y-5">
      {asset?.id ? <input type="hidden" name="id" value={asset.id} /> : null}
      <FormSection title="Asset Identity" description="Core equipment, vehicle, or facility master information.">
        <Field label="Asset code" name="asset_code" defaultValue={asset?.asset_code} required />
        <Field label="Asset name" name="asset_name" defaultValue={asset?.asset_name} required />
        <Field label="Category" name="category" required>
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="category" defaultValue={asset?.category ?? "Vehicle"}>
            {assetCategories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Department" name="department_id">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="department_id" defaultValue={asset?.department_id ?? ""}>
            <option value="">Not assigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location" name="location" defaultValue={asset?.location} />
        <Field label="Assigned operator / driver" name="assigned_operator_driver" defaultValue={asset?.assigned_operator_driver} />
      </FormSection>

      <FormSection title="Manufacturer and Registration">
        <Field label="Brand" name="brand" defaultValue={asset?.brand} />
        <Field label="Model" name="model" defaultValue={asset?.model} />
        <Field label="Serial number" name="serial_number" defaultValue={asset?.serial_number} />
        <Field label="Plate number" name="plate_number" defaultValue={asset?.plate_number} />
        <Field label="Chassis number" name="chassis_number" defaultValue={asset?.chassis_number} />
        <Field label="Engine number" name="engine_number" defaultValue={asset?.engine_number} />
      </FormSection>

      <FormSection title="Dates and Meter Readings">
        <Field label="Purchase date" name="purchase_date" type="date" defaultValue={asset?.purchase_date} />
        <Field label="Warranty expiry date" name="warranty_expiry_date" type="date" defaultValue={asset?.warranty_expiry_date} />
        <Field label="Registration expiry date" name="registration_expiry_date" type="date" defaultValue={asset?.registration_expiry_date} />
        <Field label="Insurance expiry date" name="insurance_expiry_date" type="date" defaultValue={asset?.insurance_expiry_date} />
        <Field label="Current kilometer reading" name="current_kilometer_reading" type="number" defaultValue={asset?.current_kilometer_reading} />
        <Field label="Current running hours" name="current_running_hours" type="number" defaultValue={asset?.current_running_hours} />
      </FormSection>

      <FormSection title="Status and Next Service">
        <Field label="Status" name="status">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="status" defaultValue={asset?.status ?? "Active"}>
            {assetStatuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Next service date" name="next_service_date" type="date" defaultValue={asset?.next_service_date} />
        <Field label="Next service kilometer" name="next_service_kilometer" type="number" defaultValue={asset?.next_service_kilometer} />
        <Field label="Next service running hours" name="next_service_running_hours" type="number" defaultValue={asset?.next_service_running_hours} />
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Notes</span>
          <textarea className="focus-ring mt-1 min-h-28 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="notes" defaultValue={asset?.notes ?? ""} />
        </label>
      </FormSection>
      <Button type="submit">Save asset</Button>
    </form>
  );
}
