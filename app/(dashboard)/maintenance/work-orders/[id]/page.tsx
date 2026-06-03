import Link from "next/link";
import { Printer } from "lucide-react";

import { uploadWorkOrderFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QrLinkCard } from "@/components/ui/qr-link-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkflowActions } from "@/components/work-orders/workflow-actions";
import { PartsRequestForm } from "@/components/store/parts-request-form";
import { requirePermission } from "@/lib/auth/context";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("work_orders.view");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: wo }, { data: labor }, { data: materials }, { data: history }, { data: attachments }, { data: assignments }, { data: technicianNotes }, { data: parts }, { data: partsRequests }] = await Promise.all([
    supabase.from("work_orders").select("*, assets(asset_code, asset_name, category), departments(name)").eq("id", id).single(),
    supabase.from("work_order_labor").select("*").eq("work_order_id", id),
    supabase.from("work_order_materials").select("*").eq("work_order_id", id),
    supabase.from("work_order_status_history").select("*").eq("work_order_id", id).order("changed_at", { ascending: false }),
    supabase.from("work_order_attachments").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
    supabase.from("work_order_assignments").select("id, assigned_at, profiles(full_name)").eq("work_order_id", id),
    supabase.from("work_order_technician_notes").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
    supabase.from("parts").select("id, part_code, part_name, part_number, ss_rec_code, unit_price").is("deleted_at", null).order("part_code"),
    supabase.from("parts_requests").select("id, parts_request_number, status, total_price").eq("work_order_id", id).order("created_at", { ascending: false })
  ]);

  if (!wo) return <PageHeader title="Work order not found" />;
  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
  const canViewCosts = context.permissions.includes("costs.view") || context.role?.slug === "super_admin";
  const canManage = context.role?.slug === "super_admin" || context.permissions.includes("work_orders.manage");
  const canPrint = context.role?.slug === "super_admin" || context.permissions.includes("work_orders.print");
  const canCreatePartsRequest = context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.create");
  const canUploadFiles = context.role?.slug === "super_admin" || context.permissions.includes("files.upload");
  const signedAttachments = await Promise.all((attachments ?? []).map(async (attachment) => ({
    id: attachment.id,
    label: attachment.attachment_type,
    fileName: attachment.file_name,
    signedUrl: await createSignedFileUrl("work-order-files", attachment.file_path),
    createdAt: attachment.created_at
  })));

  return (
    <>
      <PageHeader
        title={wo.work_order_number}
        description="Work order details, paper-form fields, labor, materials, status history, and attachment foundation."
        actions={
          <>
            {canPrint ? <Link href={`/maintenance/work-orders/${wo.id}/print`}><Button variant="secondary"><Printer className="h-4 w-4" /> Print</Button></Link> : null}
            {canManage ? <Link href={`/maintenance/work-orders/${wo.id}/edit`}><Button>Edit work order</Button></Link> : null}
          </>
        }
      />
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.9fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Paper Form Details</h2>
            <StatusBadge label={wo.status} tone={wo.status === "Closed" ? "green" : wo.status.includes("Waiting") ? "amber" : "blue"} />
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              ["Ordered by", wo.ordered_by],
              ["Department", department?.name],
              ["Asset", asset ? `${asset.asset_code} - ${asset.asset_name}` : null],
              ["Asset category", wo.asset_category],
              ["Serial number", wo.serial_number],
              ["Plate number", wo.plate_number],
              ["Date of order", wo.date_of_order],
              ["Job location", wo.job_location],
              ["Starting date/time", formatDateTime(wo.starting_datetime)],
              ["Ending date/time", formatDateTime(wo.ending_datetime)],
              ["Maintenance type", wo.maintenance_type],
              ["Worker type", wo.worker_type],
              ["Running hours", wo.running_hours],
              ["Kilometers", wo.kilometers],
              ["Priority", wo.priority],
              ["Next service date", wo.next_service_date],
              ["Next service kilometer", wo.next_service_kilometer],
              ["Next service running hours", wo.next_service_running_hours]
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-sm text-[#4B5563]">{label}</dt>
                <dd className="font-semibold text-[#111827]">{value ?? "Not recorded"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid gap-4">
            <TextBlock label="Operator complaint" value={wo.operator_complaint} />
            <TextBlock label="Description of work" value={wo.description_of_work} />
            <TextBlock label="Notes" value={wo.notes} />
          </div>
        </section>
        <section className="space-y-5">
          <WorkflowActions workOrderId={wo.id} status={wo.status} context={context} />
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Cost Summary</h2>
            {canViewCosts ? (
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between"><dt>Labor</dt><dd className="font-bold">{wo.total_labor_cost}</dd></div>
                <div className="flex justify-between"><dt>Material</dt><dd className="font-bold">{wo.total_material_cost}</dd></div>
                <div className="flex justify-between border-t pt-3"><dt>Total</dt><dd className="font-black text-[#ED1C24]">{wo.total_work_order_cost}</dd></div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[#4B5563]">Cost visibility is restricted for your role.</p>
            )}
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Status History</h2>
            <div className="mt-4 space-y-3">
              {history?.map((item) => (
                <div key={item.id} className="border-l-2 border-[#ED1C24] pl-3 text-sm">
                  <p className="font-semibold">{item.from_status ? `${item.from_status} -> ${item.to_status}` : item.to_status}</p>
                  <p className="text-[#4B5563]">{formatDateTime(item.changed_at)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <TableSection title="Labor Entries" rows={labor ?? []} columns={["labor_name", "employee_number", "hours", "rate", "amount"]} />
        <TableSection title="Material Used" rows={materials ?? []} columns={["material_name", "part_number", "ss_rec_code", "quantity", "unit_price", "amount"]} />
        <TableSection title="Assigned Technicians" rows={(assignments ?? []).map((row) => {
          const profileRelation = row.profiles as { full_name?: string } | { full_name?: string }[] | null;
          const profile = Array.isArray(profileRelation) ? profileRelation[0] : profileRelation;
          return { id: row.id, technician: profile?.full_name ?? "Unknown technician", assigned_at: row.assigned_at };
        })} columns={["technician", "assigned_at"]} />
        <TableSection title="Technician Notes" rows={technicianNotes ?? []} columns={["note", "labor_hours", "photo_file_name", "created_at"]} />
        <TableSection title="Parts Requests" rows={partsRequests ?? []} columns={["parts_request_number", "status", "total_price"]} />
        <section className="grid gap-5 lg:col-span-2 lg:grid-cols-[1fr_0.8fr]">
          <SignedFileList title="Private Attachments" files={signedAttachments} />
          <QrLinkCard title="Work order internal route" href={`/maintenance/work-orders/${wo.id}`} />
        </section>
        {canUploadFiles ? (
          <section className="lg:col-span-2">
            <PrivateFilePanel
              title="Upload Work Order File"
              description="Add complaint photos, before/after photos, meter photos, documents, and PDF support files."
              action={uploadWorkOrderFileAction}
              hiddenFields={{ work_order_id: wo.id, return_to: `/maintenance/work-orders/${wo.id}` }}
              typeFieldName="attachment_type"
              typeOptions={["Complaint Photo", "Before Repair Photo", "After Repair Photo", "Damaged Part Photo", "Meter Photo", "Document"]}
            />
          </section>
        ) : null}
        {canCreatePartsRequest ? (
          <section className="lg:col-span-2">
            <PartsRequestForm workOrderId={wo.id} parts={parts ?? []} />
          </section>
        ) : null}
      </div>
    </>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-sm font-semibold text-[#4B5563]">{label}</p><p className="mt-1 rounded-md bg-gray-50 p-3 text-sm">{value || "Not recorded"}</p></div>;
}

function TableSection({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr>{columns.map((column) => <th key={column} className="px-3 py-2">{column.replaceAll("_", " ")}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {rows.length ? rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column} className="px-3 py-2">{String(row[column] ?? "-")}</td>)}</tr>) : <tr><td className="px-3 py-3 text-[#4B5563]" colSpan={columns.length}>No records have been added for this section yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
