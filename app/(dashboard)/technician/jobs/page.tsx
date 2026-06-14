import Link from "next/link";
import { Clock, MapPin } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function TechnicianJobsPage() {
  const context = await requirePermission("technician.jobs.view");
  const assignments = await prisma.work_order_assignments.findMany({
    select: {
      work_orders: {
        select: {
          id: true,
          work_order_number: true,
          status: true,
          priority: true,
          job_location: true,
          operator_complaint: true,
          maintenance_type: true,
          worker_type: true,
          assets: { select: { asset_code: true, asset_name: true } }
        }
      }
    },
    where: { technician_id: context.userId },
    orderBy: { assigned_at: "desc" }
  });

  const jobs = (assignments ?? []).map((assignment) => Array.isArray(assignment.work_orders) ? assignment.work_orders[0] : assignment.work_orders).filter(Boolean);

  return (
    <>
      <PageHeader title="My Technician Jobs" description="Mobile job dashboard for assigned maintenance work orders." />
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {jobs.length ? jobs.map((job) => {
          const asset = Array.isArray(job.assets) ? job.assets[0] : job.assets;
          return (
            <Link key={job.id} href={`/technician/jobs/${job.id}`} className="block min-h-44 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm transition hover:border-[#ED1C24]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-[#111827]">{job.work_order_number}</p>
                  <p className="mt-1 text-sm text-[#4B5563]">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"}</p>
                </div>
                <StatusBadge label={job.status} tone={job.status === "In Progress" ? "blue" : job.status === "Completed by Technician" ? "green" : "amber"} />
              </div>
              <p className="mt-4 text-sm text-[#111827]">{job.operator_complaint || "No complaint recorded."}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-[#4B5563]">
                <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> {job.maintenance_type} / {job.worker_type}</span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {job.job_location || "No location"}</span>
              </div>
            </Link>
          );
        }) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="No assigned jobs" message="Assigned work orders will appear here when a supervisor schedules work for you." /></div>}
      </div>
    </>
  );
}
