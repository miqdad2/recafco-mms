import Link from "next/link";
import {
  ArrowLeft,
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
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import { prisma } from "@/lib/db/prisma";
import { getAssetMaintenanceSummary } from "@/lib/backend/assets/service";
import { computeContractStatus } from "@/lib/display/service-contract-status";

// ── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL = new Set(["Closed", "Cancelled", "Rejected"]);

const TABS = [
  { id: "overview",               label: "Overview" },
  { id: "repair-orders",          label: "Job Cards" },
  { id: "parts-used",             label: "Parts Used" },
  { id: "preventive-maintenance", label: "Preventive Maintenance" },
  { id: "service-contracts",      label: "Service Contracts" },
  { id: "documents",              label: "Documents" },
  { id: "history",                label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Tone helpers ──────────────────────────────────────────────────────────────

function statusTone(s: string): "green" | "amber" | "red" | "gray" {
  if (s === "Active") return "green";
  if (s === "Breakdown") return "red";
  if (s === "Under Maintenance") return "amber";
  return "gray";
}

function conditionTone(c: string | null | undefined): "green" | "amber" | "red" | "blue" | "gray" {
  if (!c) return "gray";
  if (c === "Good") return "green";
  if (c === "Fair") return "blue";
  if (c === "Poor") return "amber";
  if (c === "Critical") return "red";
  return "gray";
}

function criticalityTone(c: string | null | undefined): "green" | "amber" | "red" | "blue" | "gray" {
  if (!c) return "gray";
  if (c === "Low") return "gray";
  if (c === "Medium") return "blue";
  if (c === "High") return "amber";
  if (c === "Critical") return "red";
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

  const [rawAsset, summary, rawDocuments, auditLogs, assetContracts] = await Promise.all([
    prisma.assets.findUnique({
      where: { id },
      include: { departments: { select: { name: true } } },
    }),
    getAssetMaintenanceSummary(id),
    prisma.asset_documents.findMany({
      where: { asset_id: id },
      orderBy: { created_at: "desc" },
    }),
    prisma.audit_logs.findMany({
      where: { entity_type: "asset", entity_id: id },
      orderBy: { created_at: "desc" },
      take: 30,
      select: { id: true, action: true, summary: true, created_at: true },
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

  // Maintenance summary
  const { workOrders, materials, partsUsed, totalRepairs, openOrders: openCount, lastRepairedDate } =
    summary;
  const openOrders = workOrders.filter((wo) => !TERMINAL.has(wo.status));
  const waitingForPartsCount = workOrders.filter((wo) =>
    ["Waiting for Parts", "Waiting for Purchase"].includes(wo.status)
  ).length;
  const pmWorkOrders = workOrders.filter((wo) =>
    ["Routine", "Preventive", "Inspection", "Service"].includes(wo.maintenance_type)
  );

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

  // Vehicle / machine detection
  const isVehicle = !!(
    asset.plate_number ||
    asset.chassis_number ||
    asset.engine_number ||
    rawAsset.registration_expiry_date ||
    rawAsset.insurance_expiry_date
  );
  const hasMachineHours = !!(asset.current_running_hours || rawAsset.next_service_running_hours);

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
      {/* ── Asset Identity Header ──────────────────────────────────────────── */}
      <div className="border-b border-[#DDE2EA] bg-white px-4 pb-0 pt-4 sm:px-6 sm:pt-5">
        <Link
          href="/assets"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#111827]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Assets
        </Link>

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
              {asset.condition && (
                <StatusBadge label={asset.condition} tone={conditionTone(asset.condition)} />
              )}
              {asset.criticality && (
                <StatusBadge
                  label={`${asset.criticality} Criticality`}
                  tone={criticalityTone(asset.criticality)}
                />
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pb-2">
            {canManage && (
              <Link
                href={`/maintenance/work-orders/new?asset_id=${asset.id}`}
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

          {/* Waiting for parts */}
          <div
            className={`rounded-md border p-4 shadow-sm ${
              waitingForPartsCount > 0 ? "border-red-200 bg-red-50" : "border-[#E5E7EB] bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-2xl font-black ${
                  waitingForPartsCount > 0 ? "text-red-700" : "text-[#111827]"
                }`}
              >
                {waitingForPartsCount}
              </p>
              <Package
                className={`h-5 w-5 ${
                  waitingForPartsCount > 0 ? "text-red-500" : "text-[#D1D5DB]"
                }`}
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">Waiting for Parts</p>
            {waitingForPartsCount === 0 && (
              <p className="mt-0.5 text-[11px] text-[#9CA3AF]">None waiting</p>
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

              {/* Vehicle-specific fields */}
              {isVehicle && (
                <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                  <p className="mb-4 text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    Vehicle Details
                  </p>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {asset.plate_number && (
                      <InfoRow label="Plate Number" value={asset.plate_number} />
                    )}
                    {asset.chassis_number && (
                      <InfoRow label="Chassis Number" value={asset.chassis_number} />
                    )}
                    {asset.engine_number && (
                      <InfoRow label="Engine Number" value={asset.engine_number} />
                    )}
                    {rawAsset.registration_expiry_date && (
                      <InfoRow
                        label="Registration Expiry"
                        value={shortDate(rawAsset.registration_expiry_date)}
                      />
                    )}
                    {rawAsset.insurance_expiry_date && (
                      <InfoRow
                        label="Insurance Expiry"
                        value={shortDate(rawAsset.insurance_expiry_date)}
                      />
                    )}
                    {asset.current_kilometer_reading && (
                      <InfoRow
                        label="Current KM Reading"
                        value={`${asset.current_kilometer_reading} km`}
                      />
                    )}
                  </dl>
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

              {/* Condition & risk */}
              {(asset.condition || asset.criticality || asset.remarks) && (
                <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
                  <p className="mb-4 text-[11px] font-black uppercase tracking-widest text-[#ED1C24]">
                    Condition &amp; Risk
                  </p>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {asset.condition && (
                      <InfoRow label="Physical Condition" value={asset.condition} />
                    )}
                    {asset.criticality && (
                      <InfoRow label="Criticality Level" value={asset.criticality} />
                    )}
                    {asset.remarks && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                          Remarks
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm text-[#111827]">
                          {asset.remarks}
                        </dd>
                      </div>
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
                      href={`/maintenance/work-orders/new?asset_id=${asset.id}`}
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
                    href={`/maintenance/work-orders/new?asset_id=${asset.id}`}
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
                      href={`/maintenance/work-orders/new?asset_id=${asset.id}`}
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

        {/* ── PARTS USED ────────────────────────────────────────────────────── */}
        {activeTab === "parts-used" && (
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                  Materials &amp; Spare Parts
                </p>
                <p className="mt-0.5 text-sm font-bold text-[#111827]">
                  Parts Used ({partsUsed.length} record{partsUsed.length !== 1 ? "s" : ""})
                </p>
              </div>
            </div>

            {partsUsed.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <Package className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">No parts used yet</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    Parts used during job cards will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[580px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-bold uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Job Card</th>
                        <th className="px-4 py-3">Part / Material</th>
                        <th className="px-4 py-3">Part No.</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {partsUsed.map((row, i) => (
                        <tr
                          key={`${row.work_order_id}-${row.material_name}-${i}`}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 text-[#4B5563]">
                            {shortDate(row.date_of_order)}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/maintenance/work-orders/${row.work_order_id}`}
                              className="font-bold text-[#ED1C24] hover:underline"
                            >
                              {row.work_order_number ?? "—"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#111827]">
                            {row.material_name}
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{row.part_number ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#111827]">
                            {row.quantity.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Aggregated totals */}
                {materials.length > 0 && (
                  <details className="border-t border-[#E5E7EB] px-4 py-3">
                    <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-[#4B5563] hover:text-[#111827]">
                      Totals by part / material
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[360px] text-left text-sm">
                        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                          <tr>
                            <th className="px-3 py-2">Material</th>
                            <th className="px-3 py-2">Part No.</th>
                            <th className="px-3 py-2 text-right">Total Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E5E7EB]">
                          {materials.map((m) => (
                            <tr key={m.name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-semibold text-[#111827]">{m.name}</td>
                              <td className="px-3 py-2 text-[#4B5563]">{m.part_number ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {m.totalQty.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        )}

        {/* ── PREVENTIVE MAINTENANCE ────────────────────────────────────────── */}
        {activeTab === "preventive-maintenance" && (
          <div className="space-y-5">
            {/* Service schedule */}
            {hasPmSchedule ? (
              <section
                className={`rounded-md border p-6 shadow-sm ${
                  pmOverdue ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    Service Schedule
                  </p>
                  {pmOverdue && <StatusBadge label="Overdue" tone="amber" />}
                </div>
                <dl className="mt-5 grid gap-5 sm:grid-cols-3">
                  {asset.next_service_date && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                        Next Service Date
                      </dt>
                      <dd
                        className={`mt-1 text-xl font-black ${
                          pmOverdue ? "text-amber-700" : "text-[#111827]"
                        }`}
                      >
                        {shortDate(asset.next_service_date)}
                      </dd>
                      {pmOverdue && (
                        <p className="mt-0.5 text-xs font-semibold text-amber-700">
                          Service date has passed
                        </p>
                      )}
                    </div>
                  )}
                  {asset.next_service_kilometer && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                        At Kilometer
                      </dt>
                      <dd className="mt-1 text-xl font-black text-[#111827]">
                        {asset.next_service_kilometer} km
                      </dd>
                    </div>
                  )}
                  {asset.next_service_running_hours && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                        At Running Hours
                      </dt>
                      <dd className="mt-1 text-xl font-black text-[#111827]">
                        {asset.next_service_running_hours} hrs
                      </dd>
                    </div>
                  )}
                </dl>
                {canEdit && (
                  <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                    <Link
                      href={`/assets/${asset.id}/edit`}
                      className="text-sm font-bold text-[#ED1C24] hover:underline"
                    >
                      Update service schedule →
                    </Link>
                  </div>
                )}
              </section>
            ) : (
              <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
                <div className="flex flex-col items-center gap-4 py-14 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                    <Calendar className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#374151]">
                      No preventive maintenance schedule set
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-[#6B7280]">
                      Preventive maintenance schedules can be added later when editing the asset.
                    </p>
                  </div>
                  {canEdit && (
                    <Link
                      href={`/assets/${asset.id}/edit`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Edit Asset
                    </Link>
                  )}
                </div>
              </section>
            )}

            {/* PM repair history */}
            {pmWorkOrders.length > 0 && (
              <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
                <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#4B5563]">
                    PM History
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-[#111827]">
                    Preventive / Routine Orders ({pmWorkOrders.length})
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-bold uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">RO No</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {pmWorkOrders.map((wo) => (
                        <tr key={wo.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="font-bold text-[#ED1C24] hover:underline"
                            >
                              {wo.work_order_number ?? "Draft"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{wo.maintenance_type}</td>
                          <td className="px-4 py-3 text-[#4B5563]">{shortDate(wo.date_of_order)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={displayStatus(wo.status)}
                              tone={woStatusTone(wo.status)}
                            />
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">
                            {shortDate(wo.ending_datetime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
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

            {auditLogs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <Clock3 className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">No activity recorded yet</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    Activity for this asset will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F5F6F8]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#6B7280]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#111827]">{log.summary}</p>
                      <p className="mt-0.5 text-xs text-[#9CA3AF]">
                        {log.created_at.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-[#6B7280]">
                      {log.action}
                    </span>
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
