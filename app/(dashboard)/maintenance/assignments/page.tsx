import Link from "next/link";
import { AlertTriangle, CheckCircle, Info, Users } from "lucide-react";

import { AssignmentForm } from "@/components/work-orders/assignment-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { displayStatus } from "@/lib/display/work-order-labels";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

type AssignmentRow = {
  assignment_type: string;
  external_name: string | null;
  external_company: string | null;
  external_trade: string | null;
  external_phone: string | null;
  technician_id: string | null;
  profiles: { full_name: string } | null;
};

// One line describing who's on a Job Card — technician name(s), or the
// freelancer/company details for an external assignment (Sidebar Access
// Alignment Task 4: "internal/external assignment visibility").
function assigneeLine(assignments: AssignmentRow[]): string {
  if (assignments.length === 0) return "Not assigned";
  const parts = assignments.map((a) => {
    if (a.assignment_type === "FREELANCER") {
      return `${a.external_name ?? "Freelancer"}${a.external_trade ? ` (${a.external_trade})` : ""} · Freelancer`;
    }
    if (a.assignment_type === "EXTERNAL_COMPANY") {
      return `${a.external_company ?? "External company"}${a.external_trade ? ` (${a.external_trade})` : ""} · Company`;
    }
    return a.profiles?.full_name ?? "Technician";
  });
  return parts.join(", ");
}

function statusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Closed") return "green";
  if (status === "In Progress") return "blue";
  if (status === "Assigned") return "blue";
  return "amber";
}

export default async function AssignmentsPage() {
  await requirePermission("work_orders.assign");
  // Sidebar Access Alignment Task 6: only Data Entry / Engineer / Manager /
  // Super Admin ever hold work_orders.assign, so this page is never reached
  // by the Technician role itself — Technician has its own separate
  // self-service page at /technician/jobs. The wording here is always the
  // operational "tracking" framing, never "my own jobs".
  const pageTitle = "Technician Work Tracking";
  const pageDescription =
    "Assign approved job cards, track work in progress, and review technician workload and recently closed jobs.";

  const [settings, needsAssignment, inFlight, recentlyClosed, technicianOptions] = await Promise.all([
    prisma.app_settings
      .findUnique({ where: { id: SETTINGS_ID }, select: { inventory_check_enabled: true } })
      .catch(() => null),
    // Ready for a technician (or freelancer/company) to be assigned — matches
    // the current 9-status model's assignable stages (Sidebar Access
    // Alignment Task 4: the previous version of this page only checked
    // ["Approved", "Assigned", "Completed by Technician"] — the latter a
    // legacy status no live Job Card can hold under the locked Unit 3 model,
    // and it never included Partially Issued/Materials Issued, which are
    // also valid assign-from stages).
    prisma.work_orders.findMany({
      select: {
        id: true,
        work_order_number: true,
        status: true,
        priority: true,
        operator_complaint: true,
        assets: { select: { asset_code: true, asset_name: true } },
        work_order_assignments: {
          select: {
            assignment_type: true, external_name: true, external_company: true,
            external_trade: true, external_phone: true, technician_id: true,
            profiles: { select: { full_name: true } },
          },
        },
        work_order_required_parts: { select: { availability_status: true } },
      },
      where: { status: { in: ["Approved", "Partially Issued", "Materials Issued"] } },
      orderBy: { created_at: "desc" },
      take: 100,
    }),
    // Currently assigned and being worked on — the tracking view this page
    // was missing entirely before (Task 4: "work in progress").
    prisma.work_orders.findMany({
      select: {
        id: true,
        work_order_number: true,
        status: true,
        updated_at: true,
        operator_complaint: true,
        assets: { select: { asset_code: true, asset_name: true } },
        work_order_assignments: {
          select: {
            assignment_type: true, external_name: true, external_company: true,
            external_trade: true, external_phone: true, technician_id: true,
            profiles: { select: { full_name: true } },
          },
        },
      },
      where: { status: { in: ["Assigned", "In Progress"] } },
      orderBy: { updated_at: "asc" },
      take: 100,
    }),
    // Recently closed, assigned Job Cards — read-only tracking only (Task 4:
    // "completed/closed work"), no action offered here.
    prisma.work_orders.findMany({
      select: {
        id: true,
        work_order_number: true,
        status: true,
        updated_at: true,
        assets: { select: { asset_code: true, asset_name: true } },
        work_order_assignments: {
          select: {
            assignment_type: true, external_name: true, external_company: true,
            external_trade: true, external_phone: true, technician_id: true,
            profiles: { select: { full_name: true } },
          },
        },
      },
      where: { status: "Closed", work_order_assignments: { some: {} } },
      orderBy: { updated_at: "desc" },
      take: 10,
    }),
    prisma.profiles.findMany({
      where: { is_active: true, roles: { slug: "technician" } },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
  ]);

  const inventoryCheckEnabled = settings?.inventory_check_enabled ?? false;

  // Technician workload — count of currently Assigned/In Progress Job Cards
  // per internal technician (Task 4: "technician workload").
  const workload = new Map<string, { name: string; count: number }>();
  for (const wo of inFlight) {
    for (const a of wo.work_order_assignments) {
      if (a.assignment_type === "INTERNAL_TECHNICIAN" && a.technician_id) {
        const entry = workload.get(a.technician_id) ?? { name: a.profiles?.full_name ?? "Technician", count: 0 };
        entry.count += 1;
        workload.set(a.technician_id, entry);
      }
    }
  }
  const workloadRows = [...workload.values()].sort((a, b) => b.count - a.count);

  return (
    <>
      <PageHeader title={pageTitle} description={pageDescription} />
      <div className="space-y-6 p-4 lg:p-6">

        {/* Technician workload summary */}
        {workloadRows.length > 0 && (
          <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-[#4B5563]" aria-hidden />
              <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Technician Workload</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {workloadRows.map((row) => (
                <div key={row.name} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                  <span className="font-bold text-[#111827]">{row.name}</span>
                  <span className="ml-1.5 text-[#4B5563]">{row.count} active job{row.count !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Needs assignment */}
        <section>
          <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">
            Needs Assignment ({needsAssignment.length})
          </p>
          <div className="grid gap-4">
            {needsAssignment.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#E5E7EB] bg-white p-5 text-sm text-[#9CA3AF]">
                No job cards are waiting for assignment right now.
              </p>
            ) : (
              needsAssignment.map((wo) => {
                const showInventoryLabel = inventoryCheckEnabled && wo.status === "Approved";
                const requiredParts = wo.work_order_required_parts ?? [];
                const anyUnchecked = requiredParts.some((p) => p.availability_status === "unchecked");
                const allConfirmed = requiredParts.length > 0 && !anyUnchecked;
                const hasShortage = requiredParts.some(
                  (p) => p.availability_status === "partial" || p.availability_status === "unavailable"
                );
                const blockAssignment = showInventoryLabel && anyUnchecked;

                return (
                  <section key={wo.id} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <Link href={`/maintenance/work-orders/${wo.id}`} className="text-lg font-black hover:text-[#ED1C24]">
                          {wo.work_order_number}
                        </Link>
                        <p className="text-sm text-[#4B5563]">
                          {wo.assets ? `${wo.assets.asset_code} - ${wo.assets.asset_name}` : "No asset"}
                        </p>
                        <p className="mt-2 text-sm">{wo.operator_complaint || "No complaint recorded."}</p>
                      </div>
                      <StatusBadge label={displayStatus(wo.status)} tone={statusTone(wo.status)} />
                    </div>

                    {showInventoryLabel && (
                      <div className="mt-3 space-y-1.5">
                        {anyUnchecked ? (
                          <div className="flex items-start gap-2 rounded-md bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
                            <span>
                              <span className="font-semibold">Inventory check pending</span> — Store Keeper must confirm all required parts before assignment.
                            </span>
                          </div>
                        ) : allConfirmed ? (
                          <>
                            <div className="flex items-center gap-2 rounded-md bg-[#F0FDF4] px-3 py-2 text-sm text-[#166534]">
                              <CheckCircle className="h-4 w-4 shrink-0 text-[#16A34A]" />
                              <span className="font-semibold">Inventory check complete — ready for assignment.</span>
                            </div>
                            {hasShortage && (
                              <div className="flex items-center gap-2 rounded-md bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                                <Info className="h-3.5 w-3.5 shrink-0 text-[#F59E0B]" />
                                Some parts are partial or unavailable. Assignment is allowed — shortage handling will be addressed separately.
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    )}

                    <div className="mt-4">
                      {blockAssignment ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
                          Inventory check pending
                        </p>
                      ) : (
                        <AssignmentForm workOrderId={wo.id} technicians={technicianOptions} />
                      )}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </section>

        {/* Assigned / In Progress */}
        <section>
          <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">
            Assigned / In Progress ({inFlight.length})
          </p>
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            {inFlight.length === 0 ? (
              <p className="p-5 text-sm text-[#9CA3AF]">No job cards are currently assigned or in progress.</p>
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {inFlight.map((wo) => (
                  <Link
                    key={wo.id}
                    href={`/maintenance/work-orders/${wo.id}`}
                    className="flex flex-col gap-2 p-4 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#111827] hover:text-[#ED1C24]">
                        {wo.work_order_number}
                        {wo.assets && <span className="ml-2 text-xs font-normal text-[#6B7280]">· {wo.assets.asset_code} - {wo.assets.asset_name}</span>}
                      </p>
                      <p className="truncate text-xs text-[#4B5563]">{wo.operator_complaint || "No complaint recorded."}</p>
                      <p className="mt-1 text-xs font-semibold text-[#111827]">{assigneeLine(wo.work_order_assignments)}</p>
                    </div>
                    <StatusBadge label={displayStatus(wo.status)} tone={statusTone(wo.status)} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recently closed — read-only tracking */}
        {recentlyClosed.length > 0 && (
          <section>
            <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">Recently Closed</p>
            <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
              <div className="divide-y divide-[#E5E7EB]">
                {recentlyClosed.map((wo) => (
                  <Link
                    key={wo.id}
                    href={`/maintenance/work-orders/${wo.id}`}
                    className="flex flex-col gap-2 p-4 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#111827] hover:text-[#ED1C24]">
                        {wo.work_order_number}
                        {wo.assets && <span className="ml-2 text-xs font-normal text-[#6B7280]">· {wo.assets.asset_code} - {wo.assets.asset_name}</span>}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#111827]">{assigneeLine(wo.work_order_assignments)}</p>
                    </div>
                    <StatusBadge label="Closed" tone="green" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
