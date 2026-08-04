import Link from "next/link";
import { Clock, MapPin } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { displayStatus } from "@/lib/display/work-order-labels";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";

// Technician Dashboard and My Jobs Workflow Alignment Unit Task 5: never
// exposes "Parts" wording or the raw Materials Request status word — just
// the 4 plain states a technician needs to know.
function materialsLabel(status: string | null): string {
  if (!status) return "No Materials Request";
  if (status === "Issued") return "Materials sent";
  if (status === "Waiting Stock" || status === "Partially Issued") return "Store follow-up";
  return "Materials requested";
}

function jobAction(status: string): string {
  if (status === "Assigned") return "Start Work";
  if (status === "In Progress") return "Update / Close";
  return "View";
}

function formatDate(v: Date): string {
  return v.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function TechnicianJobsPage() {
  const context = await requirePermission("technician.jobs.view");
  const assignments = await prisma.work_order_assignments.findMany({
    select: {
      assigned_at: true,
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
          assets: { select: { asset_code: true, asset_name: true, plate_number: true, location: true } },
          parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
        }
      }
    },
    where: { technician_id: context.userId },
    orderBy: { assigned_at: "desc" }
  });

  const jobs = assignments
    .map((assignment) => ({
      job: Array.isArray(assignment.work_orders) ? assignment.work_orders[0] : assignment.work_orders,
      assignedAt: assignment.assigned_at,
    }))
    .filter((row) => Boolean(row.job));

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      {/* Backend Reliability Fix Unit 2, Task 1: previously watched only the
          exact event "job_card.assigned" — missed job_card.approved/.closed/
          .updated/.in_progress/.correction_* on jobs already in this list, so
          those changes waited on the 20s AutoRefresh fallback instead of
          updating immediately. Broadened to the full "job_card."/"work_order."
          prefixes (work_order. covers the legacy create/save events some
          older code paths still emit) alongside the existing
          technician_job./materials_request. prefixes. */}
      <RealtimeRefresh watch={["job_card.", "work_order.", "technician_job.", "materials_request."]} />
      <PageHeader title="My Jobs" description="Your assigned Job Cards — start work, update progress, and close when done." />
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {jobs.length ? jobs.map(({ job, assignedAt }) => {
          const asset = Array.isArray(job!.assets) ? job!.assets[0] : job!.assets;
          const materialsStatus = job!.parts_requests[0]?.status ?? null;
          return (
            <Link key={job!.id} href={`/technician/jobs/${job!.id}`} className="block min-h-48 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm transition hover:border-[#ED1C24]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-[#111827]">{job!.work_order_number}</p>
                  <p className="mt-1 text-sm text-[#4B5563]">
                    {asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"}
                    {asset?.plate_number ? ` - Plate ${asset.plate_number}` : ""}
                  </p>
                </div>
                <StatusBadge label={displayStatus(job!.status)} tone={job!.status === "In Progress" ? "blue" : job!.status === "Closed" ? "green" : "amber"} />
              </div>
              <p className="mt-4 text-sm text-[#111827]">{job!.operator_complaint || "No complaint recorded."}</p>
              <p className="mt-2 text-xs font-semibold text-[#4B5563]">{materialsLabel(materialsStatus)}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-[#4B5563]">
                <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> {job!.maintenance_type} / {job!.worker_type}</span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {asset?.location || job!.job_location || "No location"}</span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-3">
                <span className="text-xs text-[#9CA3AF]">Assigned {formatDate(assignedAt)}</span>
                <span className="rounded bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white">
                  {jobAction(job!.status)}
                </span>
              </div>
            </Link>
          );
        }) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="No assigned jobs" message="Assigned job cards will appear here when a supervisor schedules them for you." /></div>}
      </div>
    </>
  );
}
