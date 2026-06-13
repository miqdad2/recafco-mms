import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

const ERROR_LABELS: Record<string, string> = {
  "missing-ordered-by":  "Please enter who is taking the order.",
  "missing-department":  "Please select a department.",
  "missing-complaint":   "Please describe the issue or complaint.",
  "missing-description": "Please describe the work required before submitting.",
  "missing-type":        "Please select the maintenance type.",
  "missing-team":        "Please select the worker team.",
  "missing-priority":    "Please select priority.",
  "missing-date":        "Please enter the date of order.",
  "invalid-input":       "Some required fields are missing or invalid. Please check the form and try again.",
  "save-failed":         "The work order could not be saved. Please check required fields or contact IT if this continues.",
  "invalid-status":      "Invalid submission. Please try again.",
};

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  await requirePermission("work_orders.manage");
  const sp = (await searchParams) ?? {};
  const errorMsg = sp.error ? (ERROR_LABELS[sp.error] ?? "An error occurred. Please try again.") : null;

  const [departments, assets, supervisors] = await Promise.all([
    prisma.departments.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    }),
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: { id: true, asset_code: true, asset_name: true, category: true, serial_number: true, plate_number: true },
      orderBy: { asset_code: "asc" }
    }),
    prisma.profiles.findMany({
      where: { is_active: true },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" }
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Work Order"
        description="Capture the RECAFCO paper work order as structured maintenance data. Reference number is generated on save."
      />

      {errorMsg && (
        <div className="mx-4 mt-4 flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3 lg:mx-6">
          <span className="mt-0.5 flex-shrink-0 font-black text-[#ED1C24]">!</span>
          <p className="text-sm font-semibold text-[#ED1C24]">{errorMsg}</p>
        </div>
      )}

      <div className="p-4 lg:p-6">
        <WorkOrderForm
          departments={departments ?? []}
          assets={assets ?? []}
          supervisors={(supervisors ?? []).map((item) => ({ id: item.id, name: item.full_name }))}
        />
      </div>
    </>
  );
}
