import { AlertTriangle, CheckCircle, Package } from "lucide-react";

import { confirmWorkOrderRequiredPartAvailabilityAction } from "@/app/actions/store";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

type SearchParams = Record<string, string | string[]>;

export default async function InventoryCheckPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requirePermission("store.issue");

  const sp = searchParams ? await searchParams : {};
  const errorMsg = typeof sp.error === "string" ? decodeURIComponent(sp.error) : null;
  const successMsg = sp.success === "part-confirmed" ? "Part availability confirmed." : null;

  const settings = await prisma.app_settings
    .findUnique({ where: { id: SETTINGS_ID }, select: { inventory_check_enabled: true } })
    .catch(() => null);

  const enabled = settings?.inventory_check_enabled ?? false;

  if (!enabled) {
    return (
      <>
        <PageHeader
          title="Inventory Check"
          description="Store Keeper availability confirmation for required parts."
        />
        <div className="p-4 lg:p-6">
          <div className="max-w-xl rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-[#F59E0B]" />
              <p className="text-sm font-semibold text-[#111827]">
                Inventory check workflow is not active yet.
              </p>
            </div>
            <p className="mt-2 text-sm text-[#4B5563]">
              An administrator must enable the inventory check workflow in Admin → Settings before
              this queue becomes active. Existing workflows are unaffected.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Fetch Approved work orders that have at least one required part not yet confirmed as available.
  const workOrders = await prisma.work_orders.findMany({
    where: {
      status: "Approved",
      work_order_required_parts: {
        some: { availability_status: { in: ["unchecked", "partial", "unavailable"] } }
      }
    },
    select: {
      id: true,
      work_order_number: true,
      description_of_work: true,
      priority: true,
      departments: { select: { name: true } },
      assets: { select: { asset_name: true } },
      work_order_required_parts: { orderBy: { created_at: "asc" } }
    },
    orderBy: { created_at: "asc" }
  });

  // Sort by priority severity: Urgent > High > Normal > Low
  const priorityRank: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
  workOrders.sort((a, b) => {
    return (priorityRank[a.priority ?? "Normal"] ?? 2) - (priorityRank[b.priority ?? "Normal"] ?? 2);
  });

  const priorityTone = (p: string | null) =>
    p === "Urgent" ? "red" : p === "High" ? "amber" : p === "Normal" ? "blue" : "gray";

  const statusTone = (s: string) =>
    s === "available" ? "green" : s === "unavailable" ? "red" : s === "partial" ? "amber" : "gray";

  const statusLabel = (s: string) => {
    if (s === "unchecked") return "Unchecked";
    if (s === "available") return "Available";
    if (s === "partial") return "Partial";
    if (s === "unavailable") return "Unavailable";
    return s;
  };

  const totalUnchecked = workOrders.reduce(
    (sum, wo) =>
      sum + wo.work_order_required_parts.filter((p) => p.availability_status === "unchecked").length,
    0
  );

  return (
    <>
      <PageHeader
        title="Inventory Check"
        description="Confirm required parts availability for approved work orders before assignment."
        actions={
          <div className="flex items-center gap-2 rounded-md bg-[#F0FDF4] px-3 py-2 text-xs font-semibold text-[#16A34A]">
            <CheckCircle className="h-4 w-4" />
            Feature active
          </div>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        {errorMsg && (
          <div className="rounded-md border border-[#DC2626]/20 bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="rounded-md border border-[#16A34A]/20 bg-[#F0FDF4] px-4 py-3 text-sm text-[#16A34A]">
            {successMsg}
          </div>
        )}

        {workOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-[#E5E7EB] bg-white py-16 text-center shadow-sm">
            <Package className="mx-auto mb-3 h-10 w-10 text-[#9CA3AF]" />
            <p className="font-semibold text-[#111827]">No pending inventory checks</p>
            <p className="mt-1 text-sm text-[#4B5563]">
              All approved work orders have their required parts confirmed.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-[#4B5563]">
              {workOrders.length} work order{workOrders.length !== 1 ? "s" : ""} pending ·{" "}
              {totalUnchecked} part{totalUnchecked !== 1 ? "s" : ""} unchecked
            </p>
            {workOrders.map((wo) => (
              <div
                key={wo.id}
                className="rounded-md border border-[#E5E7EB] bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-[#111827]">
                      {wo.work_order_number ?? wo.id.slice(0, 8)}
                    </p>
                    <p className="mt-0.5 text-sm text-[#4B5563]">
                      {wo.assets?.asset_name ?? "No asset"} ·{" "}
                      {wo.departments?.name ?? "No department"}
                    </p>
                    {wo.description_of_work && (
                      <p className="mt-1 line-clamp-1 text-xs text-[#6B7280]">
                        {wo.description_of_work}
                      </p>
                    )}
                  </div>
                  <StatusBadge
                    label={wo.priority ?? "Normal"}
                    tone={priorityTone(wo.priority)}
                  />
                </div>

                <div className="divide-y divide-[#F3F4F6]">
                  {wo.work_order_required_parts.map((part) => {
                    const needsConfirm = part.availability_status !== "available";
                    return (
                      <div key={part.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#111827]">
                              {part.description}
                            </p>
                            <p className="mt-0.5 text-xs text-[#6B7280]">
                              {part.part_number ? `Part no: ${part.part_number} · ` : ""}
                              Qty: {Number(part.quantity_required)} {part.unit_of_measure}
                              {part.confirmed_at
                                ? ` · Checked ${new Date(part.confirmed_at).toLocaleDateString()}`
                                : ""}
                            </p>
                            {part.notes && (
                              <p className="mt-1 text-xs text-[#4B5563]">{part.notes}</p>
                            )}
                          </div>
                          <StatusBadge
                            label={statusLabel(part.availability_status)}
                            tone={statusTone(part.availability_status)}
                          />
                        </div>

                        {needsConfirm && (
                          <form
                            action={confirmWorkOrderRequiredPartAvailabilityAction}
                            className="mt-3 flex flex-wrap items-end gap-3"
                          >
                            <input type="hidden" name="required_part_id" value={part.id} />
                            <input type="hidden" name="work_order_id" value={wo.id} />
                            <div className="min-w-[180px] flex-1">
                              <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                                Availability
                              </label>
                              <select
                                name="availability_status"
                                defaultValue={part.availability_status === "unchecked" ? "available" : part.availability_status}
                                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED1C24]/30"
                              >
                                <option value="available">Available</option>
                                <option value="partial">Partial — partially in stock</option>
                                <option value="unavailable">Unavailable</option>
                              </select>
                            </div>
                            <div className="min-w-[180px] flex-1">
                              <label className="mb-1 block text-xs font-semibold text-[#4B5563]">
                                Notes (optional)
                              </label>
                              <input
                                type="text"
                                name="notes"
                                placeholder="e.g. 5 of 10 in stock"
                                defaultValue={part.notes ?? ""}
                                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED1C24]/30"
                              />
                            </div>
                            <button
                              type="submit"
                              className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#C81018] focus:outline-none focus:ring-2 focus:ring-[#ED1C24]/30"
                            >
                              Confirm
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
