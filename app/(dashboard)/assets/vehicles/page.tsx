import Link from "next/link";
import { AlertTriangle, Car, ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { VEHICLE_CATEGORIES } from "@/lib/assets/categories";
import {
  EXPIRY_FILTER_OPTIONS,
  getExpiryStatus,
  matchesExpiryFilter,
  type ExpiryFilterValue,
} from "@/lib/assets/vehicle-status";
import { cn } from "@/lib/utils";
import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { getAssetPickerOptions } from "@/lib/assets/picker-options";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  "Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired",
];

type SearchParams = {
  q?: string;
  category?: string;
  status?: string;
  insurance?: string;
  registration?: string;
  page?: string;
  new_job_card?: string;
  asset_id?: string;
};

type VehicleRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  plate_number: string | null;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  status: string;
  insurance_expiry_date: Date | null;
  registration_expiry_date: Date | null;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isExpiryValue(v: string): v is ExpiryFilterValue {
  return EXPIRY_FILTER_OPTIONS.some((o) => o.value === v);
}

function listHref(params: {
  q?: string; category?: string; status?: string; insurance?: string; registration?: string; page?: number;
}) {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.category) p.set("category", params.category);
  if (params.status) p.set("status", params.status);
  if (params.insurance && params.insurance !== "all") p.set("insurance", params.insurance);
  if (params.registration && params.registration !== "all") p.set("registration", params.registration);
  if (params.page && params.page > 1) p.set("page", String(params.page));
  const qs = p.toString();
  return qs ? `/assets/vehicles?${qs}` : "/assets/vehicles";
}

// New Job Card Modal Wizard Refactor: same filter set as listHref, plus the
// modal's own new_job_card/asset_id flags, so opening "New Job Card" for a
// row doesn't lose the list's current search/filter/page state.
function newJobCardHref(
  vehicleId: string,
  params: { q?: string; category?: string; status?: string; insurance?: string; registration?: string; page?: number }
) {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.category) p.set("category", params.category);
  if (params.status) p.set("status", params.status);
  if (params.insurance && params.insurance !== "all") p.set("insurance", params.insurance);
  if (params.registration && params.registration !== "all") p.set("registration", params.registration);
  if (params.page && params.page > 1) p.set("page", String(params.page));
  p.set("new_job_card", "1");
  p.set("asset_id", vehicleId);
  return `/assets/vehicles?${p.toString()}`;
}

function shortDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await requirePermission("assets.view");
  const canManage =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.manage");

  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim().replace(/[%,()]/g, " ").slice(0, 80) ?? "";
  const category = single(params.category)?.trim() ?? "";
  const status = single(params.status)?.trim() ?? "";
  const insuranceFilterRaw = single(params.insurance)?.trim() ?? "all";
  const registrationFilterRaw = single(params.registration)?.trim() ?? "all";
  const insuranceFilter: ExpiryFilterValue = isExpiryValue(insuranceFilterRaw) ? insuranceFilterRaw : "all";
  const registrationFilter: ExpiryFilterValue = isExpiryValue(registrationFilterRaw) ? registrationFilterRaw : "all";
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);

  // New Job Card Modal Wizard Refactor: opened via ?new_job_card=1 as an
  // overlay on top of this list, preselecting whichever vehicle row it was
  // triggered from.
  const showNewJobCardModal = single(params.new_job_card) === "1" && canManage;
  const newJobCardAssetId = single(params.asset_id) ?? null;
  const newJobCardAssets = showNewJobCardModal ? await getAssetPickerOptions() : [];
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10.
  const canAssignAtCreation =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign");
  const newJobCardActiveWorkers =
    showNewJobCardModal && canAssignAtCreation ? await getActiveWorkerProfilesForAssignment() : [];
  const newJobCardDismissHref = listHref({ q: query, category, status, insurance: insuranceFilter, registration: registrationFilter, page });

  // ── Fleet-wide data (unaffected by the table's own filters) — feeds the
  // top summary cards and the per-category cards, matching the main Assets
  // page's convention of unfiltered KPI cards above a filterable table.
  const allVehicles = await prisma.assets.findMany({
    where: { deleted_at: null, category: { in: [...VEHICLE_CATEGORIES] } },
    select: {
      id: true, category: true, status: true,
      insurance_expiry_date: true, registration_expiry_date: true,
    },
  });

  const totalVehicles = allVehicles.length;
  let insuranceExpiringSoon = 0;
  let registrationExpiringSoon = 0;
  let expiredDocuments = 0;
  for (const v of allVehicles) {
    const ins = getExpiryStatus(v.insurance_expiry_date);
    const reg = getExpiryStatus(v.registration_expiry_date);
    if (ins.status === "Expiring Soon") insuranceExpiringSoon++;
    if (reg.status === "Expiring Soon") registrationExpiringSoon++;
    if (ins.status === "Expired") expiredDocuments++;
    if (reg.status === "Expired") expiredDocuments++;
  }

  const categoryStats = new Map<string, { total: number; active: number; underMaintenance: number }>();
  for (const cat of VEHICLE_CATEGORIES) categoryStats.set(cat, { total: 0, active: 0, underMaintenance: 0 });
  for (const v of allVehicles) {
    const stat = categoryStats.get(v.category);
    if (!stat) continue;
    stat.total++;
    if (v.status === "Active" || v.status === "In Use") stat.active++;
    if (v.status === "Under Maintenance") stat.underMaintenance++;
  }

  // ── Filtered vehicle list (category/status/search pushed to SQL; expiry
  // filters applied in-memory via the shared helper so the table and the
  // badges it renders can never disagree on what "Expiring Soon" means) ──
  const where = {
    deleted_at: null,
    category: { in: [...VEHICLE_CATEGORIES] },
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { asset_code: { contains: query, mode: "insensitive" as const } },
            { asset_name: { contains: query, mode: "insensitive" as const } },
            { plate_number: { contains: query, mode: "insensitive" as const } },
            { brand: { contains: query, mode: "insensitive" as const } },
            { model: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const matchingVehicles: VehicleRow[] = await prisma.assets.findMany({
    where,
    orderBy: { asset_code: "asc" },
    select: {
      id: true, asset_code: true, asset_name: true, category: true, plate_number: true,
      brand: true, model: true, model_year: true, status: true,
      insurance_expiry_date: true, registration_expiry_date: true,
    },
  });

  const filteredVehicles = matchingVehicles.filter(
    (v) =>
      matchesExpiryFilter(v.insurance_expiry_date, insuranceFilter) &&
      matchesExpiryFilter(v.registration_expiry_date, registrationFilter)
  );

  const total = filteredVehicles.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageVehicles = filteredVehicles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasActiveFilters = !!(query || category || status || insuranceFilter !== "all" || registrationFilter !== "all");

  // ── Renewals & Expiry Tracking — vehicles with a document expiring within
  // 60 days or already expired, expired first then nearest expiry first.
  type RenewalRow = {
    assetId: string; assetCode: string; assetName: string; plateNumber: string | null;
    category: string; document: "Insurance" | "Registration"; expiryDate: Date;
    daysRemaining: number; status: "Expired" | "Expiring Soon";
  };
  const renewalRows: RenewalRow[] = [];
  const renewalSource = await prisma.assets.findMany({
    where: { deleted_at: null, category: { in: [...VEHICLE_CATEGORIES] } },
    select: {
      id: true, asset_code: true, asset_name: true, plate_number: true, category: true,
      insurance_expiry_date: true, registration_expiry_date: true,
    },
  });
  for (const v of renewalSource) {
    const ins = getExpiryStatus(v.insurance_expiry_date);
    if ((ins.status === "Expired" || ins.status === "Expiring Soon") && ins.daysRemaining !== null && ins.daysRemaining <= 60) {
      renewalRows.push({
        assetId: v.id, assetCode: v.asset_code, assetName: v.asset_name, plateNumber: v.plate_number,
        category: v.category, document: "Insurance", expiryDate: v.insurance_expiry_date!,
        daysRemaining: ins.daysRemaining, status: ins.status === "Expired" ? "Expired" : "Expiring Soon",
      });
    }
    const reg = getExpiryStatus(v.registration_expiry_date);
    if ((reg.status === "Expired" || reg.status === "Expiring Soon") && reg.daysRemaining !== null && reg.daysRemaining <= 60) {
      renewalRows.push({
        assetId: v.id, assetCode: v.asset_code, assetName: v.asset_name, plateNumber: v.plate_number,
        category: v.category, document: "Registration", expiryDate: v.registration_expiry_date!,
        daysRemaining: reg.daysRemaining, status: reg.status === "Expired" ? "Expired" : "Expiring Soon",
      });
    }
  }
  renewalRows.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return (
    <>
      {/* New Job Card Modal Wizard Refactor: opened via ?new_job_card=1,
          overlaid on top of this list with the triggering vehicle
          preselected. */}
      {showNewJobCardModal && (
        <WorkOrderWizard
          assets={newJobCardAssets}
          preselectedAssetId={newJobCardAssetId}
          dismissHref={newJobCardDismissHref}
          activeWorkers={newJobCardActiveWorkers}
          canAssignAtCreation={canAssignAtCreation}
        />
      )}
      <PageHeader
        title="Vehicles & Mobile Equipment"
        description="Manage company vehicles, mobile equipment, expiry dates, renewals, and repair history."
        breadcrumb={
          <PageBreadcrumb
            items={[{ label: "Assets & Equipment", href: "/assets" }, { label: "Vehicles & Mobile Equipment" }]}
          />
        }
        actions={<PageNavigationActions secondaryLinks={[{ label: "Assets & Equipment", href: "/assets" }]} />}
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* ── Top summary cards ───────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard title="Total Vehicles" value={totalVehicles} icon={Car} tone="gray" detail="All registered company vehicles" />
          <SummaryCard
            title="Insurance Expiring Soon"
            value={insuranceExpiringSoon}
            icon={ShieldAlert}
            tone={insuranceExpiringSoon > 0 ? "amber" : "gray"}
            detail="Within the next 30 days"
          />
          <SummaryCard
            title="Registration Expiring Soon"
            value={registrationExpiringSoon}
            icon={AlertTriangle}
            tone={registrationExpiringSoon > 0 ? "amber" : "gray"}
            detail="Within the next 30 days"
          />
          <SummaryCard
            title="Expired Documents"
            value={expiredDocuments}
            icon={ShieldAlert}
            tone={expiredDocuments > 0 ? "red" : "gray"}
            detail="Insurance or registration overdue"
          />
        </section>

        {/* ── Category cards ──────────────────────────────────────────────── */}
        <section>
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Vehicle Categories</p>
          <p className="mb-2 text-xs text-[#9CA3AF]">
            This page includes company vehicles and mobile equipment such as loaders, forklifts, and cranes.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {VEHICLE_CATEGORIES.map((cat) => {
              const stat = categoryStats.get(cat)!;
              const isSelected = category === cat;
              return (
                <Link
                  key={cat}
                  href={listHref({ q: query, category: isSelected ? "" : cat, status, insurance: insuranceFilter, registration: registrationFilter })}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-4 py-3 shadow-sm transition hover:border-[#ED1C24] hover:shadow-md",
                    isSelected ? "border-[#ED1C24] bg-red-50" : "border-[#E5E7EB] bg-white"
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("text-sm font-bold truncate", isSelected ? "text-[#ED1C24]" : "text-[#111827]")}>{cat}</p>
                    <p className="mt-0.5 text-xs text-[#9CA3AF]">
                      {stat.active} active · {stat.underMaintenance} under maintenance
                    </p>
                  </div>
                  <span className={cn("ml-3 shrink-0 text-xl font-black", stat.total > 0 ? "text-[#111827]" : "text-[#D1D5DB]")}>
                    {stat.total}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Search & filters ────────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm lg:col-span-2"
              name="q"
              defaultValue={query}
              placeholder="Search asset code, name, plate, brand, or model…"
            />
            <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="category" defaultValue={category}>
              <option value="">All categories</option>
              {VEHICLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className="focus-ring h-9 rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="submit" className="focus-ring h-9 flex-1 rounded-md bg-[#ED1C24] px-3 text-sm font-bold text-white hover:bg-[#c9151c]">
                Filter
              </button>
              {hasActiveFilters && (
                <Link href="/assets/vehicles" className="focus-ring flex h-9 items-center rounded-md border border-[#E5E7EB] px-3 text-sm font-semibold text-[#4B5563] hover:bg-gray-50">
                  Reset
                </Link>
              )}
            </div>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-xs font-semibold text-[#4B5563]">Insurance expiry</span>
              <select className="focus-ring h-9 w-full rounded-md border border-[#E5E7EB] px-3 text-sm" name="insurance" defaultValue={insuranceFilter}>
                {EXPIRY_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-xs font-semibold text-[#4B5563]">Registration expiry</span>
              <select className="focus-ring h-9 w-full rounded-md border border-[#E5E7EB] px-3 text-sm" name="registration" defaultValue={registrationFilter}>
                {EXPIRY_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </form>
        </section>

        {/* ── Vehicle list table ──────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Vehicle Register</p>
              <p className="mt-1 text-sm font-semibold text-[#111827]">
                {total.toLocaleString("en-US")} {total === 1 ? "vehicle" : "vehicles"}{hasActiveFilters && " matching filters"}
              </p>
            </div>
            <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
          </div>

          {pageVehicles.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={hasActiveFilters ? "No vehicles match the current filters." : "No vehicles registered yet."}
                message={hasActiveFilters ? "Try clearing the search or filters above." : "Vehicles imported into Assets & Equipment under Car, Pickup, Bus, Truck, Loader, Forklift, or Crane will appear here."}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Asset Code</th>
                    <th className="px-4 py-3">Vehicle / Asset Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Plate Number</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Model Year</th>
                    <th className="px-4 py-3">Insurance Expiry</th>
                    <th className="px-4 py-3">Registration Expiry</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {pageVehicles.map((v) => {
                    const ins = getExpiryStatus(v.insurance_expiry_date);
                    const reg = getExpiryStatus(v.registration_expiry_date);
                    return (
                      <tr key={v.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <Link href={`/assets/${v.id}`} className="font-bold text-[#111827] hover:text-[#ED1C24]">
                            {v.asset_code}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 max-w-[14rem] truncate">{v.asset_name}</td>
                        <td className="px-4 py-2.5 text-[#4B5563]">{v.category}</td>
                        <td className="px-4 py-2.5">{v.plate_number ?? <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-4 py-2.5 text-[#4B5563]">{v.brand ?? <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-4 py-2.5 text-[#4B5563]">{v.model ?? <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-4 py-2.5 text-[#4B5563]">{v.model_year ?? <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-1">
                            <StatusBadge label={ins.status} tone={ins.tone} />
                            <span className="text-[10px] text-[#9CA3AF]">{shortDate(v.insurance_expiry_date)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-1">
                            <StatusBadge label={reg.status} tone={reg.tone} />
                            <span className="text-[10px] text-[#9CA3AF]">{shortDate(v.registration_expiry_date)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge label={v.status} tone={v.status === "Active" || v.status === "In Use" ? "green" : v.status === "Breakdown" || v.status === "Out of Service" ? "red" : v.status === "Under Maintenance" || v.status === "Waiting for Parts" ? "amber" : "gray"} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link href={`/assets/${v.id}`} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]">
                              View
                            </Link>
                            {canManage && (
                              <Link href={newJobCardHref(v.id, { q: query, category, status, insurance: insuranceFilter, registration: registrationFilter, page })} className="rounded-md bg-[#111827] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2b2b2b]">
                                Open Job Card
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between border-t border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
              <Link
                href={listHref({ q: query, category, status, insurance: insuranceFilter, registration: registrationFilter, page: Math.max(1, page - 1) })}
                className={cn("rounded-md border border-[#DDE2EA] px-4 py-2", page <= 1 ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50")}
                aria-disabled={page <= 1}
              >
                Previous
              </Link>
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
              <Link
                href={listHref({ q: query, category, status, insurance: insuranceFilter, registration: registrationFilter, page: Math.min(totalPages, page + 1) })}
                className={cn("rounded-md border border-[#DDE2EA] px-4 py-2", page >= totalPages ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50")}
                aria-disabled={page >= totalPages}
              >
                Next
              </Link>
            </div>
          )}
        </section>

        {/* ── Renewals & Expiry Tracking ──────────────────────────────────── */}
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Renewals &amp; Expiry Tracking</p>
            <p className="mt-1 text-sm font-semibold text-[#111827]">
              {renewalRows.length} document{renewalRows.length !== 1 ? "s" : ""} expired or expiring within 60 days
            </p>
          </div>
          {renewalRows.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No renewals due" message="No vehicle insurance or registration is expired or expiring within 60 days." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Plate Number</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Expiry Date</th>
                    <th className="px-4 py-3">Days Remaining</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {renewalRows.map((r) => (
                    <tr key={`${r.assetId}-${r.document}`} className={r.status === "Expired" ? "bg-red-50" : "hover:bg-gray-50"}>
                      <td className="px-4 py-2.5">
                        <p className="font-bold text-[#111827]">{r.assetCode}</p>
                        <p className="text-xs text-[#4B5563]">{r.assetName}</p>
                      </td>
                      <td className="px-4 py-2.5">{r.plateNumber ?? <span className="text-[#9CA3AF]">—</span>}</td>
                      <td className="px-4 py-2.5 text-[#4B5563]">{r.category}</td>
                      <td className="px-4 py-2.5">{r.document}</td>
                      <td className="px-4 py-2.5">{shortDate(r.expiryDate)}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)} days overdue` : `${r.daysRemaining} days`}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge label={r.status} tone={r.status === "Expired" ? "red" : "amber"} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link href={`/assets/${r.assetId}`} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]">
                            View Asset
                          </Link>
                          {canManage && (
                            <Link href={`/assets/${r.assetId}/edit`} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]">
                              Edit Asset
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SummaryCard({
  title, value, detail, icon: Icon, tone,
}: {
  title: string; value: number; detail: string;
  icon: typeof Car; tone: "gray" | "amber" | "red";
}) {
  const toneClass = { gray: "bg-[#111827] text-white", amber: "bg-[#F59E0B] text-white", red: "bg-[#ED1C24] text-white" }[tone];
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("rounded-md p-2", toneClass)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className="text-2xl font-black text-[#111827]">{value.toLocaleString("en-US")}</span>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-[#4B5563]">{title}</p>
      <p className="mt-1 text-sm leading-5 text-[#4B5563]">{detail}</p>
    </div>
  );
}
