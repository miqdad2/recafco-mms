import Link from "next/link";

import { uploadAssetFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import { prisma } from "@/lib/db/prisma";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("assets.view");
  const { id } = await params;
  const [rawAsset, rawWorkOrders, rawDocuments] = await Promise.all([
    prisma.assets.findUnique({
      where: { id },
      include: { departments: { select: { name: true } } }
    }),
    prisma.work_orders.findMany({
      select: {
        id: true,
        work_order_number: true,
        status: true,
        maintenance_type: true,
        worker_type: true,
        priority: true,
        date_of_order: true,
        total_work_order_cost: true
      },
      where: { asset_id: id },
      orderBy: { date_of_order: "desc" },
      take: 20
    }),
    prisma.asset_documents.findMany({
      where: { asset_id: id },
      orderBy: { created_at: "desc" }
    })
  ]);

  if (!rawAsset) return <PageHeader title="Asset not found" />;
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
  const workOrders = rawWorkOrders.map((wo) => ({
    ...wo,
    date_of_order: wo.date_of_order.toISOString(),
    total_work_order_cost: wo.total_work_order_cost?.toFixed(3) ?? null
  }));
  const canUploadFiles = context.role?.slug === "super_admin" || (context.permissions.includes("assets.manage") && context.permissions.includes("files.upload"));
  const canViewCosts = context.role?.slug === "super_admin" || context.permissions.includes("costs.view");
  const signedDocuments = await Promise.all(rawDocuments.map(async (document) => ({
    id: document.id,
    label: document.document_type,
    fileName: document.file_name,
    signedUrl: await canViewEntityFile(context, "asset-files", asset.id) ? await createSignedFileUrl("asset-files", document.file_path) : null,
    createdAt: document.created_at.toISOString()
  })));

  return (
    <>
      <PageHeader
        title={`${asset.asset_code} - ${asset.asset_name}`}
        description="Asset master detail, expiry alerts, next service data, documents, and maintenance history."
        actions={
          <>
            <Link href={`/assets/${asset.id}/history`}><Button variant="secondary">History</Button></Link>
            <Link href={`/assets/${asset.id}/history/print`}><Button variant="secondary">Print History</Button></Link>
            <Link href={`/assets/${asset.id}/edit`}><Button>Edit asset</Button></Link>
          </>
        }
      />
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.9fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Asset Information</h2>
            <StatusBadge label={asset.status} tone={asset.status === "Breakdown" ? "red" : "green"} />
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              ["Category", asset.category],
              ["Department", Array.isArray(asset.departments) ? asset.departments[0]?.name : asset.departments?.name],
              ["Location", asset.location],
              ["Brand", asset.brand],
              ["Model", asset.model],
              ["Serial number", asset.serial_number],
              ["Plate number", asset.plate_number],
              ["Chassis number", asset.chassis_number],
              ["Engine number", asset.engine_number],
              ["Purchase date", asset.purchase_date],
              ["Warranty expiry", asset.warranty_expiry_date],
              ["Registration expiry", asset.registration_expiry_date],
              ["Insurance expiry", asset.insurance_expiry_date],
              ["Current KM", asset.current_kilometer_reading],
              ["Running hours", asset.current_running_hours],
              ["Operator / driver", asset.assigned_operator_driver]
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-sm text-[#4B5563]">{label}</dt>
                <dd className="font-semibold text-[#111827]">{value ?? "Not recorded"}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="space-y-5">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Next Service</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Date</dt><dd className="font-semibold">{asset.next_service_date ?? "Not scheduled"}</dd></div>
              <div className="flex justify-between gap-3"><dt>Kilometer</dt><dd className="font-semibold">{asset.next_service_kilometer ?? "-"}</dd></div>
              <div className="flex justify-between gap-3"><dt>Running hours</dt><dd className="font-semibold">{asset.next_service_running_hours ?? "-"}</dd></div>
            </dl>
          </div>
          <QrLinkCard title="Asset internal route" href={`/assets/${asset.id}`} />
        </section>
        <section className="grid gap-5 lg:col-span-2 lg:grid-cols-[1fr_0.9fr]">
          <SignedFileList title="Private Asset Documents" files={signedDocuments} />
          {canUploadFiles ? (
            <PrivateFilePanel
              title="Upload Asset Document"
              description="Add registration, insurance, warranty, inspection, and asset support documents."
              action={uploadAssetFileAction}
              hiddenFields={{ asset_id: asset.id }}
              typeFieldName="document_type"
              typeOptions={["Registration", "Insurance", "Warranty", "Inspection", "Photo", "Other"]}
            />
          ) : null}
        </section>
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-bold">Maintenance History</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">WO</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Worker</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Cost</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {workOrders?.map((wo) => (
                  <tr key={wo.id}><td className="px-3 py-2"><Link className="font-bold text-[#ED1C24]" href={`/maintenance/work-orders/${wo.id}`}>{wo.work_order_number}</Link></td><td className="px-3 py-2">{wo.date_of_order}</td><td className="px-3 py-2">{wo.maintenance_type}</td><td className="px-3 py-2">{wo.worker_type}</td><td className="px-3 py-2">{wo.priority}</td><td className="px-3 py-2">{wo.status}</td><td className="px-3 py-2">{canViewCosts ? wo.total_work_order_cost : "Restricted"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
