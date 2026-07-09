import Link from "next/link";
import { upsertAssetAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import type { CategoryOption } from "@/components/assets/category-select-pair";
import { CategorySelectPair } from "@/components/assets/category-select-pair";

const assetStatuses = ["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"];
const assetConditions = ["Excellent", "Good", "Fair", "Poor", "Out of Service"];
const assetCriticalities = ["Critical", "High", "Medium", "Low"];

type FormRecord = Record<string, string | number | null | undefined>;

export function AssetForm({
  asset,
  categories,
}: {
  asset?: FormRecord | null;
  categories: CategoryOption[];
}) {
  return (
    <form action={upsertAssetAction} className="space-y-5">
      {asset?.id ? <input type="hidden" name="id" value={asset.id} /> : null}
      {/* Preserve existing department_id — department selection removed from UI */}
      <input type="hidden" name="department_id" value={typeof asset?.department_id === "string" ? asset.department_id : ""} />
      <FormSection title="Asset Identity" description="Core equipment, vehicle, or facility master information.">
        <Field label="Asset code" name="asset_code" defaultValue={asset?.asset_code} required />
        <Field label="Asset name" name="asset_name" defaultValue={asset?.asset_name} required />
        <div className="md:col-span-2">
          <CategorySelectPair
            categories={categories}
            defaultSubcategory={typeof asset?.category === "string" ? asset.category : undefined}
            required
          />
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Need to add a category?{" "}
            <Link href="/admin/settings/asset-categories" className="font-semibold text-[#ED1C24] hover:underline">
              Manage Categories
            </Link>
          </p>
        </div>
        <Field label="Location" name="location" defaultValue={asset?.location} />
        <p className="text-xs text-[#9CA3AF] md:col-span-2">
          Location identifies where the asset is installed or used.
        </p>
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

      <FormSection title="Condition and Risk Classification" description="Used for maintenance prioritisation and management reporting.">
        <Field label="Physical condition" name="condition">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="condition" defaultValue={asset?.condition ?? ""}>
            <option value="">Not assessed</option>
            {assetConditions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Criticality" name="criticality">
          <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="criticality" defaultValue={asset?.criticality ?? ""}>
            <option value="">Not classified</option>
            {assetCriticalities.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#111827]">Remarks</span>
          <textarea className="focus-ring mt-1 min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="remarks" placeholder="Optional internal notes about this asset's condition or risk." defaultValue={asset?.remarks ?? ""} />
        </label>
      </FormSection>

      <Button type="submit">Save asset</Button>
    </form>
  );
}
