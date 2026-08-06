import Link from "next/link";
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  Package,
  Pencil,
  Plus,
  Printer,
  Wrench,
  Clock3,
} from "lucide-react";

import { uploadAssetFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { displayStatus } from "@/lib/display/work-order-labels";
import { displayPartsRequestStatus, partsRequestStatusTone } from "@/lib/display/parts-request-labels";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import { prisma } from "@/lib/db/prisma";
import { getAssetMaintenanceSummary } from "@/lib/backend/assets/service";
import { computeContractStatus } from "@/lib/display/service-contract-status";
import { isVehicleCategory } from "@/lib/assets/categories";
import { getExpiryStatus } from "@/lib/assets/vehicle-status";
import { BackLink } from "@/components/ui/back-link";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { getAssetPickerOptions } from "@/lib/assets/picker-options";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";

// ── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL = new Set(["Closed", "Cancelled", "Rejected"]);

// Preventive Maintenance intentionally has no dedicated tab: there is no
// real PM schedule/tracking workflow yet (only the optional next-service
// fields shown in the Overview "Next Service" card), so a standalone tab
// would only ever show an empty placeholder.
const TABS = [
  { id: "overview",           label: "Overview" },
  { id: "repair-orders",      label: "Job Cards" },
  { id: "materials-history",  label: "Materials History" },
  { id: "service-contracts",  label: "Service Contracts" },
  { id: "documents",          label: "Documents" },
  { id: "history",            label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Tone helpers ──────────────────────────────────────────────────────────────

function statusTone(s: string): "green" | "amber" | "red" | "gray" {
  if (s === "Active") return "green";
  if (s === "Breakdown") return "red";
  if (s === "Under Maintenance") return "amber";
  return "gray";
}

function woStatusTone(s: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (s === "Closed") return "green";
  if (["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(s)) return "green";
  if (["Rejected", "Cancelled"].includes(s)) return "red";
  if (s.includes("Waiting") || ["Submitted", "Pending Approval"].includes(s)) return "amber";
  if (["Assigned", "In Progress", "Parts Issued", "Approved"].includes(s)) return "blue";
  return "gray";
}

function priorityTone(p: string): "red" | "amber" | "blue" | "gray" {
  if (p === "Urgent") return "red";
  if (p === "High") return "amber";
  if (p === "Normal") return "blue";
  return "gray";
}

function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Helper component ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[#111827]">
        {value ?? <span className="font-normal text-[#9CA3AF]">—</span>}
      </dd>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("assets.view");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const activeTab = ((sp.tab ?? "overview") as TabId);

  const today = new Date();

  const [rawAsset, summary, rawDocuments, assetContracts] = await Promise.all([
    prisma.assets.findUnique({
      where: { id },
      include: { departments: { select: { name: true } } },
    }),
    getAssetMaintenanceSummary(id),
    prisma.asset_documents.findMany({
      where: { asset_id: id },
      orderBy: { created_at: "desc" },
    }),
    prisma.service_contracts.findMany({
      where: { asset_id: id, deleted_at: null },
      orderBy: { end_date: "asc" },
    }),
  ]);

  if (!rawAsset) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-[#374151]">Asset not found.</p>
        <Link href="/assets" className="text-sm font-bold text-[#ED1C24] hover:underline">
          ← Back to Assets
        </Link>
      </div>
    );
  }

  // Serialise Decimal / Date fields
  const asset = {
    ...rawAsset,
    purchase_date: rawAsset.purchase_date?.toISOString() ?? null,
    warranty_expiry_date: rawAsset.warranty_expiry_date?.toISOString() ?? null,
    registration_expiry_date: rawAsset.registration_expiry_date?.toISOString() ?? null,
    insurance_expiry_date: rawAsset.insurance_expiry_date?.toISOString() ?? null,
    current_kilometer_reading: rawAsset.current_kilometer_reading?.toFixed(2) ?? null,
    current_running_hours: rawAsset.current_running_hours?.toFixed(2) ?? null,
    next_service_date: rawAsset.next_service_date?.toISOString() ?? null,
    next_service_kilometer: rawAsset.next_service_kilometer?.toFixed(2) ?? null,
    next_service_running_hours: rawAsset.next_service_running_hours?.toFixed(2) ?? null,
  };

  // Permissions
  const canUploadFiles =
    context.role?.slug === "super_admin" ||
    (context.permissions.includes("assets.manage") && context.permissions.includes("files.upload"));
  const canManage =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.manage");
  const canEdit =
    context.role?.slug === "super_admin" || context.permissions.includes("assets.manage");

  // New Job Card Modal Wizard Refactor: opened via ?new_job_card=1 as an
  // overlay on top of this asset's own detail page, preselecting this asset.
  const showNewJobCardModal = sp.new_job_card === "1" && canManage;
  const newJobCardAssets = showNewJobCardModal ? await getAssetPickerOptions() : [];
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10.
  const canAssignAtCreation =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign");
  const newJobCardActiveWorkers =
    showNewJobCardModal && canAssignAtCreation ? await getActiveWorkerProfilesForAssignment() : [];
  const newJobCardDismissHref = activeTab && activeTab !== "overview" ? `/assets/${id}?tab=${activeTab}` : `/assets/${id}`;

  // Maintenance summary
  const {
    workOrders,
    materialsHistory,
    recentMaterial,
    totalRepairs,
    openOrders: openCount,
    lastRepairedDate,
  } = summary;
  const openOrders = workOrders.filter((wo) => !TERMINAL.has(wo.status));

  // History tab: combined asset activity — Job Card + Materials Request
  // audit trail (entity_id scoped to this asset's own Job Cards/Materials
  // Requests) plus Store issue events, so nothing from an unrelated asset
  // ever leaks in. Depends on summary's ids, so it can't join the first
  // Promise.all above.
  const workOrderIds = workOrders.map((wo) => wo.id);
  const partsRequestIds = [...new Set(materialsHistory.map((m) => m.parts_request_id))];

  const [auditLogs, materialIssueEvents] = await Promise.all([
    prisma.audit_logs.findMany({
      where: {
        OR: [
          { entity_type: "asset", entity_id: id },
          ...(workOrderIds.length ? [{ entity_type: "work_order", entity_id: { in: workOrderIds } }] : []),
          ...(partsRequestIds.length ? [{ entity_type: "parts_request", entity_id: { in: partsRequestIds } }] : []),
        ],
      },
      orderBy: { created_at: "desc" },
      take: 60,
      select: { id: true, action: true, summary: true, created_at: true },
    }),
    workOrderIds.length
      ? prisma.offline_inventory_movements.findMany({
          where: { related_work_order_id: { in: workOrderIds }, movement_type: "ISSUED", deleted_at: null },
          orderBy: { created_at: "desc" },
          take: 30,
          select: {
            id: true,
            quantity: true,
            created_at: true,
            manual_material_name: true,
            parts: { select: { part_name: true } },
            parts_requests: { select: { parts_request_number: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Merge audit-log events and Store issue events into one plain-language,
  // asset-scoped timeline (no raw JSON, no legacy statuses).
  type HistoryEvent = { id: string; text: string; date: Date };
  const historyEvents: HistoryEvent[] = [
    ...auditLogs.map((log) => ({ id: `audit-${log.id}`, text: log.summary, date: log.created_at })),
    ...materialIssueEvents.map((mv) => ({
      id: `issue-${mv.id}`,
      text: `Materials issued: ${mv.parts?.part_name ?? mv.manual_material_name ?? "Material"} (Qty ${Number(mv.quantity)})${
        mv.parts_requests?.parts_request_number ? ` — ${mv.parts_requests.parts_request_number}` : ""
      }`,
      date: mv.created_at,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  // Documents with signed URLs
  const signedDocuments = await Promise.all(
    rawDocuments.map(async (doc) => ({
      id: doc.id,
      label: doc.document_type,
      fileName: doc.file_name,
      signedUrl:
        (await canViewEntityFile(context, "asset-files", asset.id))
          ? await createSignedFileUrl("asset-files", doc.file_path)
          : null,
      createdAt: doc.created_at.toISOString(),
    }))
  );

  // Vehicle / machine detection — Vehicle Asset View Unit 1 Task 6: the
  // Vehicle Information section is gated by category membership (Car,
  // Pickup, Bus, Truck, Loader, Forklift, Crane), not merely by whether any
  // vehicle-shaped field happens to be filled in on a non-vehicle asset.
  const isVehicle = isVehicleCategory(asset.category);
  const hasMachineHours = !!(asset.current_running_hours || rawAsset.next_service_running_hours);
  const insuranceStatus = getExpiryStatus(rawAsset.insurance_expiry_date);
  const registrationStatus = getExpiryStatus(rawAsset.registration_expiry_date);

  // PM status
  const pmOverdue = rawAsset.next_service_date && rawAsset.next_service_date < today;
  const hasPmSchedule = !!(
    rawAsset.next_service_date ||
    rawAsset.next_service_kilometer ||
    rawAsset.next_service_running_hours
  );

  // Category
  const categoryParts = (asset.category ?? "").split(" / ");
  const mainCategory = categoryParts[0] ?? asset.category ?? "—";
  const subCategory = categoryParts.length > 1 ? categoryParts.slice(1).join(" / ") : null;

  return (
    <>
      {/* New Job Card Modal Wizard Refactor: opened via ?new_job_card=1,
          overlaid on top of this asset's own detail page with this asset
          preselected. */}
      {showNewJobCardModal && (
        <WorkOrderWizard
          assets={newJobCardAssets}
          preselectedAssetId={asset.id}
          dismissHref={newJobCardDismissHref}
          activeWorkers={newJobCardActiveWorkers}
          canAssignAtCreation={canAssignAtCreation}
        />
      )}
      {/* ── Asset Identity Header ──────────────────────────────────────────── */}
      <div className="border-b border-[#DDE2EA] bg-white px-4 pb-0 pt-4 sm:px-6 sm:pt-5">
        <PageBreadcrumb
          items={
            isVehicle
              ? [
                  { label: "Assets & Equipment", href: "/assets" },
                  { label: "Vehicles", href: "/assets/vehicles" },
                  { label: "Asset Details" },
                ]
              : [{ label: "Assets & Equipment", href: "/assets" }, { label: "Asset Details" }]
          }
        />
        <div className="mb-3">
          <BackLink
            href={isVehicle ? "/assets/vehicles" : "/assets"}
            label={isVehicle ? "Back to Vehicles" : "Back to Assets & Equipment"}
            variant="text"
          />
        </div>

        <div className="flex flex-col gap-4 border-l-4 border-[#ED1C24] pl-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Identity */}
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-[#ED1C24]">
              {asset.asset_code}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[#111827] sm:text-3xl">
              {asset.asset_name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#4B5563]">
              <span className="font-medium">{mainCategory}</span>
              {subCategory && (
                <>
                  <span className="text-[#D1D5DB]">/</span>
                  <span>{subCategory}</span>
                </>
              )}
              {asset.location && (
                <>
                  <span className="text-[#D1D5DB]">·</span>
                  <span>{asset.location}</span>
                </>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <StatusBadge label={asset.status} tone={statusTone(asset.status)} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pb-2">
            {canManage && (
              <Link
                href={`?new_job_card=1&asset_id=${asset.id}${activeTab ? `&tab=${activeTab}` : ""}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Job Card
              </Link>
            )}
            {canEdit && (
              <Link
                href={`/assets/${asset.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-gray-50"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
            )}
            <Link
              href={`/assets/${asset.id}/history/print`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Link>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mt-3 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <Link
                  key={tab.id}
                  href={`/assets/${id}?tab=${tab.id}`}
                  className={`whitespace-nowrap px-4 py-3 text-xs font-bold transition ${
                    isActive
                      ? "border-b-2 border-[#ED1C24] text-[#ED1C24]"
                      : "border-b-2 border-transparent text-[#4B5563] hover:text-[#111827]"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 pb-24 lg:p-6">
        {/* ── Summary cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Open repair orders */}
          <div
            className={`rounded-md border p-4 shadow-sm ${
              openCount > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-2xl font-black ${
                  openCount > 0 ? "text-amber-700" : "text-[#111827]"
                }`}
              >
                {openCount}
              </p>
              <Wrench
                className={`h-5 w-5 ${openCount > 0 ? "text-amber-500" : "text-[#D1D5DB]"}`}
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">Open Job Cards</p>
          </div>

          {/* Last repair date */}
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold leading-tight text-[#111827]">
                {lastRepairedDate ? shortDate(lastRepairedDate) : "—"}
              </p>
              <Calendar className="h-5 w-5 text-[#D1D5DB]" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">Last Repair Date</p>
            {!lastRepairedDate && (
              <p className="mt-0.5 text-[11px] text-[#9CA3AF]">No repair history</p>
            )}
          </div>

          {/* Total repair orders */}
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-2xl font-black text-[#111827]">{totalRepairs}</p>
              <ClipboardList className="h-5 w-5 text-[#D1D5DB]" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">Total Job Cards</p>
          </div>

          {/* Recent Materials — latest Materials Request line for this
              asset, derived through its linked Job Cards (Materials
              Requests are never linked to an asset directly). This is an
              overview pointer, not a workflow-condition metric: no
              "Waiting for Parts" / "Waiting Materials" wording here, since
              that is a Job Card state, not an asset-level fact. */}
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-bold leading-tight text-[#111827]">
                {recentMaterial ? recentMaterial.material_name : "—"}
              </p>
              <Package className="h-5 w-5 shrink-0 text-[#D1D5DB]" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">Recent Materials</p>
            {recentMaterial ? (
              <p className="mt-0.5 text-[11px] text-[#6B7280]">
                Requested {recentMaterial.quantity_requested}
                {recentMaterial.issued_quantity > 0 ? ` · Issued ${recentMaterial.issued_quantity}` : ""}
                {" · "}
                {displayPartsRequestStatus(recentMaterial.parts_request_status)}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-[#9CA3AF]">No materials history</p>
            )}
          </div>
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            {/* Left — asset master data */}
            <div className="space-y-5">
              {/* Core identity */}
              <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                <p className="mb-4 text-[11px] font-black uppercase tracking-widest text-[#ED1C24]">
                  Asset Details
                </p>
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <InfoRow label="Asset Code" value={asset.asset_code} />
                  <InfoRow label="Asset Name" value={asset.asset_name} />
                  <InfoRow label="Main Category" value={mainCategory} />
                  {subCategory && <InfoRow label="Subcategory" value={subCategory} />}
                  <InfoRow label="Location" value={asset.location} />
                  {asset.brand && <InfoRow label="Brand / Manufacturer" value={asset.brand} />}
                  {asset.model && <InfoRow label="Model" value={asset.model} />}
                  {asset.serial_number && (
                    <InfoRow label="Serial Number" value={asset.serial_number} />
                  )}
                  {asset.assigned_operator_driver && (
                    <InfoRow label="Operator / Driver" value={asset.assigned_operator_driver} />
                  )}
                </dl>
              </section>

              {/* Vehicle Information — Vehicle Asset View Unit 1 Task 6 */}
              {isVehicle && (
                <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                  <p className="mb-4 text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    Vehicle Information
                  </p>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <InfoRow label="Plate Number" value={asset.plate_number} />
                    <InfoRow label="Chassis Number" value={asset.chassis_number} />
                    <InfoRow label="Engine Number" value={asset.engine_number} />
                    <InfoRow label="Brand" value={asset.brand} />
                    <InfoRow label="Model" value={asset.model} />
                    <InfoRow label="Model Year" value={asset.model_year ? String(asset.model_year) : null} />
                    <InfoRow
                      label="Insurance Expiry Date"
                      value={rawAsset.insurance_expiry_date ? shortDate(rawAsset.insurance_expiry_date) : null}
                    />
                    <InfoRow
                      label="Registration Expiry Date"
                      value={rawAsset.registration_expiry_date ? shortDate(rawAsset.registration_expiry_date) : null}
                    />
                    <InfoRow
                      label="Current Kilometer Reading"
                      value={asset.current_kilometer_reading ? `${asset.current_kilometer_reading} km` : null}
                    />
                    <InfoRow label="Assigned Operator / Driver" value={asset.assigned_operator_driver} />
                  </dl>
                  {asset.remarks && (
                    <div className="mt-4 border-t border-[#E5E7EB] pt-4">
                      <InfoRow label="Remarks" value={asset.remarks} />
                    </div>
                  )}

                  {/* Renewal Status */}
                  <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                    <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                      Renewal Status
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[#4B5563]">Insurance</p>
                          <StatusBadge label={insuranceStatus.status} tone={insuranceStatus.tone} />
                        </div>
                        <p className="mt-1.5 text-sm font-semibold text-[#111827]">
                          {insuranceStatus.daysRemaining === null
                            ? "No expiry date on record"
                            : insuranceStatus.daysRemaining < 0
                              ? `${Math.abs(insuranceStatus.daysRemaining)} days overdue`
                              : `${insuranceStatus.daysRemaining} days remaining`}
                        </p>
                      </div>
                      <div className="rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[#4B5563]">Registration</p>
                          <StatusBadge label={registrationStatus.status} tone={registrationStatus.tone} />
                        </div>
                        <p className="mt-1.5 text-sm font-semibold text-[#111827]">
                          {registrationStatus.daysRemaining === null
                            ? "No expiry date on record"
                            : registrationStatus.daysRemaining < 0
                              ? `${Math.abs(registrationStatus.daysRemaining)} days overdue`
                              : `${registrationStatus.daysRemaining} days remaining`}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Machine hours */}
              {hasMachineHours && (
                <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                  <p className="mb-4 text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    Running Hours
                  </p>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {asset.current_running_hours && (
                      <InfoRow
                        label="Current Running Hours"
                        value={`${asset.current_running_hours} hrs`}
                      />
                    )}
                    {asset.next_service_running_hours && (
                      <InfoRow
                        label="Next Service at Hours"
                        value={`${asset.next_service_running_hours} hrs`}
                      />
                    )}
                  </dl>
                </section>
              )}

            </div>

            {/* Right column */}
            <div className="space-y-5">
              {/* Next service */}
              {hasPmSchedule ? (
                <section
                  className={`rounded-md border p-5 shadow-sm ${
                    pmOverdue
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-[11px] font-black uppercase tracking-widest ${
                        pmOverdue ? "text-amber-700" : "text-[#4B5563]"
                      }`}
                    >
                      Next Service
                    </p>
                    {pmOverdue && <StatusBadge label="Overdue" tone="amber" />}
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    {asset.next_service_date && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[#6B7280]">Service Date</dt>
                        <dd
                          className={`font-semibold ${
                            pmOverdue ? "text-amber-700" : "text-[#111827]"
                          }`}
                        >
                          {shortDate(asset.next_service_date)}
                        </dd>
                      </div>
                    )}
                    {asset.next_service_kilometer && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[#6B7280]">At KM</dt>
                        <dd className="font-semibold text-[#111827]">
                          {asset.next_service_kilometer} km
                        </dd>
                      </div>
                    )}
                    {asset.next_service_running_hours && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[#6B7280]">At Running Hours</dt>
                        <dd className="font-semibold text-[#111827]">
                          {asset.next_service_running_hours} hrs
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>
              ) : (
                <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                  <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    Next Service
                  </p>
                  <p className="text-sm text-[#9CA3AF]">No service schedule set.</p>
                </section>
              )}

              {/* QR code */}
              <QrLinkCard title="Asset QR Code" href={`/assets/${asset.id}`} />
            </div>
          </div>
        )}

        {/* ── REPAIR ORDERS ─────────────────────────────────────────────────── */}
        {activeTab === "repair-orders" && (
          <div className="space-y-5">
            {/* A — Open repair orders */}
            {openOrders.length > 0 && (
              <section className="overflow-hidden rounded-md border border-amber-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">
                      Active
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-amber-900">
                      Open Job Cards ({openOrders.length})
                    </p>
                  </div>
                  {canManage && (
                    <Link
                      href={`?new_job_card=1&asset_id=${asset.id}${activeTab ? `&tab=${activeTab}` : ""}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c8181e]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      New
                    </Link>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-amber-50 text-xs font-bold uppercase text-amber-800">
                      <tr>
                        <th className="px-4 py-3">Job Card No</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Issue / Problem</th>
                        <th className="px-4 py-3">Priority</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Technician</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {openOrders.map((wo) => (
                        <tr key={wo.id} className="hover:bg-amber-50/40">
                          <td className="px-4 py-3">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="font-bold text-[#ED1C24] hover:underline"
                            >
                              {wo.work_order_number ?? "Draft"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{shortDate(wo.date_of_order)}</td>
                          <td className="max-w-[200px] px-4 py-3">
                            <span className="block truncate text-[#111827]">
                              {wo.operator_complaint ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge label={wo.priority} tone={priorityTone(wo.priority)} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={displayStatus(wo.status)}
                              tone={woStatusTone(wo.status)}
                            />
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">
                            {wo.technician_names.length > 0 ? (
                              wo.technician_names.join(", ")
                            ) : (
                              <span className="text-[#9CA3AF]">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#ED1C24] hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* B — Repair history (all orders) */}
            <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    History
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-[#111827]">
                    All Job Cards ({workOrders.length})
                  </p>
                </div>
                {canManage && (
                  <Link
                    href={`?new_job_card=1&asset_id=${asset.id}${activeTab ? `&tab=${activeTab}` : ""}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#111827] hover:bg-gray-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Create Job Card
                  </Link>
                )}
              </div>

              {workOrders.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-14 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                    <ClipboardList className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#374151]">No repair history yet</p>
                    <p className="mt-0.5 text-xs text-[#6B7280]">
                      Create the first job card for this asset.
                    </p>
                  </div>
                  {canManage && (
                    <Link
                      href={`?new_job_card=1&asset_id=${asset.id}${activeTab ? `&tab=${activeTab}` : ""}`}
                      className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Create Job Card
                    </Link>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-bold uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Job Card No</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Issue / Problem</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Completed Date</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {workOrders.map((wo) => (
                        <tr key={wo.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="font-bold text-[#ED1C24] hover:underline"
                            >
                              {wo.work_order_number ?? "Draft"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{shortDate(wo.date_of_order)}</td>
                          <td className="max-w-[200px] px-4 py-3">
                            <span
                              className="block truncate text-[#111827]"
                              title={wo.operator_complaint ?? undefined}
                            >
                              {wo.operator_complaint ?? (
                                <span className="text-[#9CA3AF]">—</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={displayStatus(wo.status)}
                              tone={woStatusTone(wo.status)}
                            />
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">
                            {shortDate(wo.ending_datetime)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#ED1C24] hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── MATERIALS HISTORY ─────────────────────────────────────────────── */}
        {/* assets.id -> work_orders.asset_id -> parts_requests.work_order_id ->
            parts_request_items — Materials Requests are children of Job
            Cards, never linked to an asset directly, so this table is built
            entirely off the Job Cards already fetched for this asset. */}
        {activeTab === "materials-history" && (
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                  Materials
                </p>
                <p className="mt-0.5 text-sm font-bold text-[#111827]">
                  Materials History ({materialsHistory.length} record{materialsHistory.length !== 1 ? "s" : ""})
                </p>
              </div>
            </div>

            {materialsHistory.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <Package className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">
                    No Materials Requests found for this asset.
                  </p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    Materials requested for this asset through a Job Card will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs font-bold uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-4 py-3">Requested</th>
                      <th className="px-4 py-3">Job Card</th>
                      <th className="px-4 py-3">Materials Request</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3 text-right">Requested Qty</th>
                      <th className="px-4 py-3 text-right">Issued Qty</th>
                      <th className="px-4 py-3 text-right">Remaining Qty</th>
                      <th className="px-4 py-3">Request Status</th>
                      <th className="px-4 py-3">Job Card Status</th>
                      <th className="px-4 py-3 text-right">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {materialsHistory.map((row) => (
                      <tr key={row.item_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-[#4B5563]">{shortDate(row.requested_date)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/maintenance/work-orders/${row.work_order_id}`}
                            className="font-bold text-[#ED1C24] hover:underline"
                          >
                            {row.work_order_number ?? "—"}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/store/parts-requests/${row.parts_request_id}`}
                            className="font-bold text-[#ED1C24] hover:underline"
                          >
                            {row.parts_request_number ?? "—"}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-semibold text-[#111827]">{row.material_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-[#111827]">
                          {row.quantity_requested}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[#111827]">
                          {row.issued_quantity}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[#111827]">
                          {row.remaining_quantity}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={displayPartsRequestStatus(row.parts_request_status)}
                            tone={partsRequestStatusTone(row.parts_request_status)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={displayStatus(row.work_order_status)}
                            tone={woStatusTone(row.work_order_status)}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <Link
                              href={`/maintenance/work-orders/${row.work_order_id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#ED1C24] hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Job Card
                            </Link>
                            <Link
                              href={`/store/parts-requests/${row.parts_request_id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#ED1C24] hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Materials Request
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── DOCUMENTS ─────────────────────────────────────────────────────── */}
        {activeTab === "documents" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            <SignedFileList title="Asset Documents &amp; Photos" files={signedDocuments} />
            {canUploadFiles ? (
              <PrivateFilePanel
                title="Upload Document / Photo"
                description="Registration, insurance, warranty, inspection, and asset support files."
                action={uploadAssetFileAction}
                hiddenFields={{ asset_id: asset.id }}
                typeFieldName="document_type"
                typeOptions={[
                  "Registration",
                  "Insurance",
                  "Warranty",
                  "Inspection",
                  "Photo",
                  "Other",
                ]}
              />
            ) : (
              <div className="rounded-md border border-[#E5E7EB] bg-white p-5 text-sm text-[#9CA3AF] shadow-sm">
                You do not have permission to upload files.
              </div>
            )}
          </div>
        )}

        {/* ── SERVICE CONTRACTS ─────────────────────────────────────────────── */}
        {activeTab === "service-contracts" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-[#ED1C24]">
                  Service Contracts
                </p>
                <p className="mt-0.5 text-sm text-[#4B5563]">
                  Contracts covering maintenance and servicing for this asset.
                </p>
              </div>
              <Link
                href={`/assets/service-contracts?asset_id=${asset.id}&open=new`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Service Contract
              </Link>
            </div>

            {assetContracts.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-md border border-[#E5E7EB] bg-white py-14 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <FileText className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">No service contracts yet</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    Add a service contract to track coverage and renewal for this asset.
                  </p>
                </div>
                <Link
                  href={`/assets/service-contracts?asset_id=${asset.id}&open=new`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Service Contract
                </Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Contract Title</th>
                        <th className="px-4 py-3">Service Company</th>
                        <th className="px-4 py-3">Start</th>
                        <th className="px-4 py-3">End / Expiry</th>
                        <th className="px-4 py-3">Renewal</th>
                        <th className="px-4 py-3">Frequency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {assetContracts.map((c) => {
                        const meta = computeContractStatus(c.end_date, c.contract_status);
                        const fmtD = (d: Date | null) =>
                          d
                            ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d)
                            : "—";
                        return (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${
                                  meta.tone === "green"
                                    ? "border-green-200 bg-green-50 text-green-700"
                                    : meta.tone === "amber"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : meta.tone === "red"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-gray-200 bg-gray-50 text-gray-700"
                                }`}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-[#111827]">
                              {c.contract_title}
                            </td>
                            <td className="px-4 py-3 text-[#111827]">{c.service_company}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-[#4B5563]">
                              {fmtD(c.start_date)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span
                                className={
                                  meta.label === "Expired"
                                    ? "font-bold text-[#ED1C24]"
                                    : meta.label === "Expiring Soon"
                                    ? "font-bold text-[#F59E0B]"
                                    : "text-[#4B5563]"
                                }
                              >
                                {fmtD(c.end_date)}
                                {meta.label === "Expiring Soon" && (
                                  <span className="ml-1 text-xs text-[#F59E0B]">
                                    ({meta.days}d)
                                  </span>
                                )}
                                {meta.label === "Expired" && (
                                  <span className="ml-1 text-xs text-[#ED1C24]">
                                    ({Math.abs(meta.days)}d ago)
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-[#4B5563]">
                              {fmtD(c.renewal_date ?? null)}
                            </td>
                            <td className="px-4 py-3 text-[#4B5563]">{c.service_frequency}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY ───────────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                Activity
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#111827]">Asset History</p>
            </div>

            {historyEvents.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <Clock3 className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">
                    No history available for this asset yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {historyEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F5F6F8]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#6B7280]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#111827]">{event.text}</p>
                      <p className="mt-0.5 text-xs text-[#9CA3AF]">
                        {event.date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
