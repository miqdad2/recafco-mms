import Link from "next/link";
import { Package } from "lucide-react";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import {
  normalizeCategory,
  movementTypeLabel,
  movementTypeTone,
  type MovementRow,
} from "@/components/store/offline-inventory-types";

type SearchParams = Record<string, string | string[] | undefined>;

// Performance Optimization Unit 3, Task 1: replaces the previous flat
// `take: 500` cap (which silently hid any movement past the 500 most recent,
// with no way to reach them) with real page-based pagination — each page
// loads only PAGE_SIZE rows, so the query cost no longer grows with total
// history size, and every movement remains reachable via Next/Previous.
const PAGE_SIZE = 50;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

function buildHref(base: string, params: SearchParams): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    const val = single(v);
    if (val) p.set(k, val);
  });
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

export default async function MovementHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await requirePermission("parts.view");
  const canManage = canManageOfflineInventory(context);
  // Store Issue Materials + Offline Inventory Separation Unit Task 6/9: this
  // one page now serves two audiences — Store's own "Sent Materials" record
  // of what it has issued, and everyone else's Material Ledger view of the
  // same movements (issued by Store, received, opening stock).
  const isStoreKeeper = context.role?.slug === "store_keeper";
  const pageTitle = isStoreKeeper ? "Sent Materials" : "Movement History";
  // Store Send Materials Approval Gate Unit Task 6: dropped "plus opening
  // stock and received materials" — Store's own page is about what it sent,
  // not a description of every movement type still visible in the filter.
  const pageDescription = isStoreKeeper
    ? "Materials sent by Store for Job Cards."
    : "Materials received, issued, and tracked against Job Cards.";

  const params = (await searchParams) ?? {};
  const q    = single(params.q)?.trim() ?? "";
  const type = single(params.type)?.trim() ?? "";
  const from = single(params.from)?.trim() ?? "";
  const to   = single(params.to)?.trim() ?? "";
  const page = Math.max(1, Number(single(params.page)) || 1);

  const hasAnyRecords = await prisma.offline_inventory_movements.count({
    where: { deleted_at: null },
  });

  const where: Record<string, unknown> = { deleted_at: null };
  if (type === "OPENING_STOCK" || type === "RECEIVED" || type === "ISSUED") where.movement_type = type;
  if (from || to) {
    where.movement_date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { manual_material_name: { contains: q, mode: "insensitive" } },
      { manual_part_number: { contains: q, mode: "insensitive" } },
      { ss_rec_code: { contains: q, mode: "insensitive" } },
      { parts: { part_name: { contains: q, mode: "insensitive" } } },
      { parts: { part_number: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [filteredCount, movementsRaw] = await Promise.all([
    prisma.offline_inventory_movements.count({ where }),
    prisma.offline_inventory_movements.findMany({
      where,
      include: {
        parts:          { select: { part_name: true, part_number: true } },
        work_orders:    { select: { work_order_number: true, assets: { select: { asset_name: true, plate_number: true } } } },
        parts_requests: { select: { id: true, parts_request_number: true } },
        profiles:       { select: { full_name: true } },
      },
      orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  const movements: MovementRow[] = movementsRaw.map((m) => ({
    id:                    m.id,
    movement_type:         m.movement_type,
    movement_date:         m.movement_date.toISOString(),
    part_name:             m.parts?.part_name ?? null,
    part_number_display:   m.parts?.part_number ?? m.manual_part_number ?? null,
    ss_rec_code:           m.ss_rec_code,
    category:              normalizeCategory(m.category),
    manual_material_name:  m.manual_material_name,
    quantity:              Number(m.quantity),
    unit:                  m.unit,
    counterparty:          m.counterparty,
    reference_number:      m.reference_number,
    related_work_order_id: m.related_work_order_id,
    work_order_number:     m.work_orders?.work_order_number ?? null,
    remarks:               m.remarks,
    created_by_name:       m.profiles.full_name,
    parts_request_id:      m.parts_requests?.id ?? null,
    parts_request_number:  m.parts_requests?.parts_request_number ?? null,
    asset_name:            m.work_orders?.assets?.asset_name ?? null,
    plate_number:          m.work_orders?.assets?.plate_number ?? null,
  }));

  const isFiltered = Boolean(q || type || from || to);

  return (
    <>
      {/* Enterprise-Wide Real-Time Update Verification Task 2/8: widened the
          same way as the Offline Inventory Control balance page — this list
          previously never picked up the direct opening-stock/receive/record-
          used actions at all (no "offline_inventory." watcher existed). */}
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["offline_inventory.", "material_ledger.", "store_materials.", "materials_request.", "job_card."]} />
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        breadcrumb={
          isStoreKeeper
            ? <PageBreadcrumb items={[{ label: "Sent Materials" }]} />
            : <PageBreadcrumb items={[{ label: "Offline Inventory Control", href: "/store/offline-inventory" }, { label: "Movement History" }]} />
        }
        actions={
          isStoreKeeper
            ? <BackLink href="/store/issue-materials" label="Back to Issue Materials" />
            : <BackLink href="/store/offline-inventory" label="Back to Offline Inventory Control" />
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* Simple Wording Cleanup Task 5: subtle, one-line explanation of
            "Initial Stock" — Store Keeper's reduced view never shows the
            Movement Type column, so the explanation would be irrelevant there. */}
        {!isStoreKeeper && (
          <p className="text-xs text-[#9CA3AF]">
            Initial Stock means quantity entered when the material was first added to the system.
          </p>
        )}
        {/* Sidebar Access Alignment Task 7: same wording as the Offline
            Inventory Control balance page, so Engineer/Data Entry/Manager
            never read this page as "where I do store entry". */}
        {!canManage && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm font-semibold text-[#4B5563]">
            Offline Inventory Control records maintenance material movements linked to Job Cards.
          </div>
        )}
        {hasAnyRecords > 0 && (
          <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <form className="grid gap-3 lg:grid-cols-[1fr_160px_160px_160px_auto]">
              <input
                className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                name="q"
                defaultValue={q}
                placeholder="Search material, part no., SS Rec. Code"
              />
              <select
                className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                name="type"
                defaultValue={type}
              >
                <option value="">All types</option>
                <option value="OPENING_STOCK">Initial Stock</option>
                <option value="RECEIVED">Received</option>
                <option value="ISSUED">Issued</option>
              </select>
              <input
                className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                name="from"
                type="date"
                defaultValue={from}
              />
              <input
                className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm"
                name="to"
                type="date"
                defaultValue={to}
              />
              <button
                className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                type="submit"
              >
                Filter
              </button>
            </form>
          </section>
        )}

        {movements.length === 0 ? (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex flex-col items-center gap-6 px-4 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F5F6F8]">
                <Package className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
              </div>
              {isFiltered ? (
                <div>
                  <h2 className="text-lg font-black text-[#111827]">No movements match these filters.</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                    <Link href="/store/offline-inventory/movements" className="font-bold text-[#ED1C24] hover:underline">
                      Clear filters
                    </Link>{" "}
                    to see all movements.
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="text-lg font-black text-[#111827]">No material movements recorded yet.</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                    Received and issued materials will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] px-5 py-3">
              <p className="text-xs text-[#4B5563]">
                {filteredCount.toLocaleString()} record{filteredCount !== 1 ? "s" : ""}
                {totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Record Date</th>
                    {!isStoreKeeper && <th className="px-4 py-3">Movement Type</th>}
                    <th className="px-4 py-3">Material</th>
                    {!isStoreKeeper && <th className="px-4 py-3">Category</th>}
                    {!isStoreKeeper && <th className="px-4 py-3">Part No.</th>}
                    {!isStoreKeeper && <th className="px-4 py-3">SS Rec. Code</th>}
                    <th className="px-4 py-3">{isStoreKeeper ? "Quantity Sent" : "Quantity"}</th>
                    {!isStoreKeeper && <th className="px-4 py-3">Unit</th>}
                    <th className="px-4 py-3">Job Card / Asset</th>
                    <th className="px-4 py-3">Materials Request</th>
                    {!isStoreKeeper && <th className="px-4 py-3">Reference No.</th>}
                    <th className="px-4 py-3">{isStoreKeeper ? "Sent By" : "Entered By"}</th>
                    <th className="px-4 py-3">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {movements.map((m) => {
                    const name = m.manual_material_name ?? m.part_name ?? "—";
                    return (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-[#111827]">
                          {fmtDate(m.movement_date)}
                        </td>
                        {!isStoreKeeper && (
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={movementTypeLabel(m.movement_type, m.reference_number)}
                              tone={movementTypeTone(m.movement_type)}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 font-semibold text-[#111827]">{name}</td>
                        {!isStoreKeeper && <td className="px-4 py-3 text-xs text-[#4B5563]">{m.category}</td>}
                        {!isStoreKeeper && (
                          <td className="px-4 py-3 text-xs text-[#4B5563]">
                            {m.part_number_display ?? "—"}
                          </td>
                        )}
                        {!isStoreKeeper && (
                          <td className="px-4 py-3 text-xs text-[#4B5563]">
                            {m.ss_rec_code ?? "—"}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-[#111827]">
                          {m.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                          {isStoreKeeper ? ` ${m.unit}` : ""}
                        </td>
                        {!isStoreKeeper && <td className="px-4 py-3 text-[#4B5563]">{m.unit}</td>}
                        <td className="px-4 py-3">
                          {m.related_work_order_id ? (
                            <>
                              <Link
                                href={`/maintenance/work-orders/${m.related_work_order_id}`}
                                className="text-xs font-bold text-[#ED1C24] hover:underline"
                              >
                                {m.work_order_number ?? "View"}
                              </Link>
                              {m.asset_name && (
                                <p className="text-xs text-[#4B5563]">
                                  {m.asset_name}{m.plate_number ? ` - Plate ${m.plate_number}` : ""}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#4B5563]">
                          {m.parts_request_id ? (
                            <Link
                              href={`/store/parts-requests/${m.parts_request_id}`}
                              className="font-bold text-[#ED1C24] hover:underline"
                            >
                              {m.parts_request_number ?? "View"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        {!isStoreKeeper && (
                          <td className="px-4 py-3 text-xs text-[#4B5563]">
                            {m.reference_number ?? "—"}
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs text-[#4B5563]">
                          {m.created_by_name}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[#4B5563]">
                          {m.remarks ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={buildHref("/store/offline-inventory/movements", { ...params, page: String(page - 1) })}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50"
                >
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={buildHref("/store/offline-inventory/movements", { ...params, page: String(page + 1) })}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827] hover:bg-gray-50"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
