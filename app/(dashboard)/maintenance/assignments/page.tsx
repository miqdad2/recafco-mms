import Link from "next/link";

import { assignTechniciansAction, verifyWorkOrderAction } from "@/app/actions/workflow";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function AssignmentsPage() {
  await requirePermission("work_orders.assign");

  const [rawWorkOrders, technicianOptions] = await Promise.all([
    prisma.work_orders.findMany({
      select: {
        id: true,
        work_order_number: true,
        status: true,
        priority: true,
        operator_complaint: true,
        assets: { select: { asset_code: true, asset_name: true } },
        work_order_assignments: { select: { technician_id: true } }
      },
      where: { status: { in: ["Approved", "Assigned", "Completed by Technician"] } },
      orderBy: { created_at: "desc" },
      take: 100
    }),
    prisma.profiles.findMany({
      where: { is_active: true, roles: { slug: "technician" } },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" }
    })
  ]);

  const workOrders = rawWorkOrders.map((wo) => ({
    ...wo,
    work_order_assignments: wo.work_order_assignments.filter(
      (a): a is { technician_id: string } => a.technician_id !== null
    )
  }));

  return (
    <>
      <PageHeader title="Technician Assignments" description="Assign approved work orders and verify technician-completed jobs." />
      <div className="grid gap-4 p-4 lg:p-6">
        {workOrders?.map((wo) => {
          const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
          const assignments: Array<{ technician_id: string }> = Array.isArray(wo.work_order_assignments) ? wo.work_order_assignments : [];
          return (
            <section key={wo.id} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Link href={`/maintenance/work-orders/${wo.id}`} className="text-lg font-black hover:text-[#ED1C24]">{wo.work_order_number}</Link>
                  <p className="text-sm text-[#4B5563]">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"}</p>
                  <p className="mt-2 text-sm">{wo.operator_complaint || "No complaint recorded."}</p>
                </div>
                <StatusBadge label={wo.status} tone={wo.status === "Completed by Technician" ? "amber" : "blue"} />
              </div>
              {wo.status === "Completed by Technician" ? (
                <form action={verifyWorkOrderAction} className="mt-4 space-y-2">
                  <input type="hidden" name="work_order_id" value={wo.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Supervisor verification notes" />
                  <Button type="submit">Verify completed work</Button>
                </form>
              ) : (
                <form action={assignTechniciansAction} className="mt-4 space-y-3">
                  <input type="hidden" name="work_order_id" value={wo.id} />
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {technicianOptions.map((tech) => (
                      <label key={tech.id} className="flex items-center gap-2 rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold">
                        <input type="checkbox" name="technician_ids" value={tech.id} defaultChecked={assignments.some((assignment) => assignment.technician_id === tech.id)} />
                        {tech.full_name}
                      </label>
                    ))}
                  </div>
                  <Button type="submit">Assign technician</Button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
