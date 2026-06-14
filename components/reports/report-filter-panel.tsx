import { Button } from "@/components/ui/button";
import type { FilterOptions, ReportFilters, ReportMode } from "@/lib/reports/data";

type ReportFilterPanelProps = {
  filters: ReportFilters;
  options: FilterOptions;
  includeCosts?: boolean;
  lockedDepartmentId?: string;
  deptName?: string;
  visibleFields?: string[];
  reportMode?: ReportMode;
};

export function ReportFilterPanel({
  filters,
  options,
  includeCosts = false,
  lockedDepartmentId,
  deptName,
  visibleFields,
  reportMode
}: ReportFilterPanelProps) {
  // If visibleFields is provided, only show those fields.
  // If not provided (admin path), show all fields.
  const show = (field: string) => !visibleFields || visibleFields.includes(field);
  const resetHref = reportMode ? `?report=${reportMode}` : "?";

  return (
    <form className="grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm md:grid-cols-4 xl:grid-cols-6">
      {/* Hidden inputs to preserve locked values on form submit */}
      {lockedDepartmentId && <input type="hidden" name="departmentId" value={lockedDepartmentId} />}
      {reportMode && <input type="hidden" name="report" value={reportMode} />}

      {show("dateFrom") && (
        <Field label="From">
          <input type="date" name="dateFrom" defaultValue={filters.dateFrom} className="input" />
        </Field>
      )}
      {show("dateTo") && (
        <Field label="To">
          <input type="date" name="dateTo" defaultValue={filters.dateTo} className="input" />
        </Field>
      )}

      {/* Department: show locked badge if locked, dropdown if admin */}
      {!lockedDepartmentId && show("departmentId") && (
        <Field label="Department">
          <select name="departmentId" defaultValue={filters.departmentId ?? ""} className="input">
            <option value="">All departments</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {lockedDepartmentId && show("departmentId") && (
        <Field label="Department">
          <div className="flex min-h-[2.5rem] items-center justify-between rounded-md border border-[#E5E7EB] bg-gray-50 px-3 text-sm">
            <span className="text-[#4B5563]">{deptName ?? "Your Department"}</span>
            <span className="ml-2 shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-600">Locked</span>
          </div>
        </Field>
      )}

      {show("assetId") && (
        <Field label="Asset">
          <select name="assetId" defaultValue={filters.assetId ?? ""} className="input">
            <option value="">All assets</option>
            {options.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.asset_code} - {asset.asset_name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {show("status") && (
        <Field label="Status">
          <input name="status" defaultValue={filters.status} placeholder="Any status" className="input" />
        </Field>
      )}

      {show("technicianId") && (
        <Field label="Technician">
          <select name="technicianId" defaultValue={filters.technicianId ?? ""} className="input">
            <option value="">All technicians</option>
            {options.technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.full_name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {show("maintenanceType") && (
        <Field label="Maintenance type">
          <input name="maintenanceType" defaultValue={filters.maintenanceType} placeholder="Breakdown" className="input" />
        </Field>
      )}

      {show("workerType") && (
        <Field label="Worker type">
          <input name="workerType" defaultValue={filters.workerType} placeholder="Mechanical" className="input" />
        </Field>
      )}

      {show("priority") && (
        <Field label="Priority">
          <input name="priority" defaultValue={filters.priority} placeholder="Urgent" className="input" />
        </Field>
      )}

      {includeCosts && show("costMin") && (
        <Field label="Cost min">
          <input type="number" step="0.001" name="costMin" defaultValue={filters.costMin} className="input" />
        </Field>
      )}
      {includeCosts && show("costMax") && (
        <Field label="Cost max">
          <input type="number" step="0.001" name="costMax" defaultValue={filters.costMax} className="input" />
        </Field>
      )}

      <div className="flex items-end gap-2">
        <Button type="submit">Apply</Button>
        <a
          className="inline-flex min-h-10 items-center rounded-md border border-[#E5E7EB] px-4 text-sm font-semibold hover:bg-gray-50"
          href={resetHref}
        >
          Reset
        </a>
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
