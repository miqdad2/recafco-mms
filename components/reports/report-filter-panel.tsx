import { Button } from "@/components/ui/button";
import type { FilterOptions, ReportFilters } from "@/lib/reports/data";

type ReportFilterPanelProps = {
  filters: ReportFilters;
  options: FilterOptions;
  includeCosts?: boolean;
};

export function ReportFilterPanel({ filters, options, includeCosts = false }: ReportFilterPanelProps) {
  return (
    <form className="grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm md:grid-cols-4 xl:grid-cols-6">
      <Field label="From"><input type="date" name="dateFrom" defaultValue={filters.dateFrom} className="input" /></Field>
      <Field label="To"><input type="date" name="dateTo" defaultValue={filters.dateTo} className="input" /></Field>
      <Field label="Department">
        <select name="departmentId" defaultValue={filters.departmentId ?? ""} className="input">
          <option value="">All departments</option>
          {options.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </Field>
      <Field label="Asset">
        <select name="assetId" defaultValue={filters.assetId ?? ""} className="input">
          <option value="">All assets</option>
          {options.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} - {asset.asset_name}</option>)}
        </select>
      </Field>
      <Field label="Status"><input name="status" defaultValue={filters.status} placeholder="Any status" className="input" /></Field>
      <Field label="Technician">
        <select name="technicianId" defaultValue={filters.technicianId ?? ""} className="input">
          <option value="">All technicians</option>
          {options.technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.full_name}</option>)}
        </select>
      </Field>
      <Field label="Maintenance type"><input name="maintenanceType" defaultValue={filters.maintenanceType} placeholder="Breakdown" className="input" /></Field>
      <Field label="Worker type"><input name="workerType" defaultValue={filters.workerType} placeholder="Mechanical" className="input" /></Field>
      <Field label="Priority"><input name="priority" defaultValue={filters.priority} placeholder="Urgent" className="input" /></Field>
      {includeCosts ? (
        <>
          <Field label="Cost min"><input type="number" step="0.001" name="costMin" defaultValue={filters.costMin} className="input" /></Field>
          <Field label="Cost max"><input type="number" step="0.001" name="costMax" defaultValue={filters.costMax} className="input" /></Field>
        </>
      ) : null}
      <div className="flex items-end gap-2">
        <Button type="submit">Apply</Button>
        <a className="inline-flex min-h-10 items-center rounded-md border border-[#E5E7EB] px-4 text-sm font-semibold" href="?">Reset</a>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-[#111827]">
      <span>{label}</span>
      {children}
    </label>
  );
}
