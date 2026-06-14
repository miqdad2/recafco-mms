import { Save } from "lucide-react";

import { upsertDepartmentAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function DepartmentsPage() {
  await requirePermission("admin.departments.manage");
  const departments = await prisma.departments.findMany({
    orderBy: { name: "asc" }
  });

  return (
    <>
      <PageHeader title="Departments" description="Manage RECAFCO departments used for ownership, approvals, dashboards, and workflow routing." />
      <div className="grid gap-6 p-4 lg:grid-cols-[380px_1fr] lg:p-6">
        <form action={upsertDepartmentAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#111827]">Add department</h2>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">Name</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="name" required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Code</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 uppercase" name="code" required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Manager name</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="manager_name" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Description</span>
              <textarea className="focus-ring mt-1 min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="description" />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="is_active" defaultChecked /> Active
            </label>
            <Button type="submit" className="w-full">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save department
            </Button>
          </div>
        </form>

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] p-5">
            <h2 className="text-lg font-bold text-[#111827]">Department master</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Manager</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {departments?.map((department) => (
                  <tr key={department.id}>
                    <td className="px-4 py-3 font-semibold text-[#111827]">{department.name}</td>
                    <td className="px-4 py-3">{department.code}</td>
                    <td className="px-4 py-3">{department.manager_name ?? "Not assigned"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={department.is_active ? "Active" : "Inactive"} tone={department.is_active ? "green" : "gray"} />
                    </td>
                    <td className="px-4 py-3 text-[#4B5563]">{formatDateTime(department.updated_at.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
