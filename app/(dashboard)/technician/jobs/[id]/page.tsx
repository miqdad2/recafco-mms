import {
  addTechnicianUpdateAction,
  completeTechnicianJobAction,
  startTechnicianJobAction
} from "@/app/actions/workflow";
import { uploadWorkOrderFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { PartsRequestForm } from "@/components/store/parts-request-form";
import { requirePermission } from "@/lib/auth/context";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function TechnicianJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("technician.jobs.view");
  const { id } = await params;
  const [rawAssignment, rawNotes, rawLabor, rawAttachments, rawParts] = await Promise.all([
    prisma.work_order_assignments.findFirst({
      where: { work_order_id: id, technician_id: context.userId },
      include: {
        work_orders: {
          include: {
            assets: { select: { asset_code: true, asset_name: true } },
            departments: { select: { name: true } }
          }
        }
      }
    }),
    prisma.work_order_technician_notes.findMany({
      where: { work_order_id: id },
      orderBy: { created_at: "desc" }
    }),
    prisma.work_order_labor.findMany({ where: { work_order_id: id } }),
    prisma.work_order_attachments.findMany({ where: { work_order_id: id } }),
    prisma.parts.findMany({
      where: { deleted_at: null },
      select: { id: true, part_code: true, part_name: true, part_number: true, ss_rec_code: true, unit_price: true },
      orderBy: { part_code: "asc" }
    })
  ]);

  const rawWo = rawAssignment?.work_orders ?? null;
  const wo = rawWo ? {
    ...rawWo,
    running_hours: rawWo.running_hours?.toFixed(2) ?? null,
    kilometers: rawWo.kilometers?.toFixed(2) ?? null,
  } : null;
  if (!wo) return <PageHeader title="Job not found" description="This job is not assigned to your technician account." />;
  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
  const notes = rawNotes.map((note) => ({
    ...note,
    created_at: note.created_at.toISOString(),
    labor_hours: note.labor_hours.toFixed(2)
  }));
  const labor = rawLabor.map((row) => ({
    ...row,
    hours: row.hours.toFixed(2),
    rate: row.rate.toFixed(3),
    amount: row.amount?.toFixed(3) ?? null
  }));
  const parts = rawParts.map((part) => ({
    ...part,
    unit_price: part.unit_price.toFixed(3)
  }));
  const signedAttachments = await Promise.all(rawAttachments.map(async (attachment) => ({
    id: attachment.id,
    label: attachment.attachment_type,
    fileName: attachment.file_name,
    signedUrl: await canViewEntityFile(context, "work-order-files", wo.id) ? await createSignedFileUrl("work-order-files", attachment.file_path) : null,
    createdAt: attachment.created_at.toISOString()
  })));

  return (
    <>
      <PageHeader title={wo.work_order_number ?? ""} description="Technician mobile job detail and quick actions." actions={<StatusBadge label={wo.status} tone={wo.status === "In Progress" ? "blue" : wo.status === "Completed by Technician" ? "green" : "amber"} />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_0.85fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-[#111827]">Job Details</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Info label="Asset" value={asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"} />
            <Info label="Department" value={department?.name ?? "No department"} />
            <Info label="Location" value={wo.job_location ?? "No location"} />
            <Info label="Priority" value={wo.priority} />
            <Info label="Maintenance type" value={wo.maintenance_type} />
            <Info label="Worker type" value={wo.worker_type} />
            <Info label="Running hours" value={wo.running_hours ?? "-"} />
            <Info label="Kilometers" value={wo.kilometers ?? "-"} />
          </dl>
          <div className="mt-5 space-y-4">
            <TextBlock label="Operator complaint" value={wo.operator_complaint} />
            <TextBlock label="Description of work" value={wo.description_of_work} />
          </div>
        </section>

        <section className="space-y-4">
          {wo.status === "Assigned" ? (
            <form action={startTechnicianJobAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <Button type="submit" className="min-h-12 w-full text-base">Start job</Button>
            </form>
          ) : null}
          {["Assigned", "In Progress"].includes(wo.status) ? (
            <form action={addTechnicianUpdateAction} className="space-y-3 rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <h2 className="text-lg font-black">Add Work Update</h2>
              <textarea className="focus-ring min-h-28 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="note" placeholder="Work notes" required />
              <input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-3" name="labor_hours" type="number" step="0.25" min="0" placeholder="Labor hours" />
              <input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-3" name="photo_file_name" placeholder="Photo file name metadata" />
              <input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-3" name="photo_file_path" placeholder="Private photo path metadata" />
              <Button type="submit" variant="secondary" className="min-h-12 w-full">Save update</Button>
            </form>
          ) : null}
          {wo.status === "In Progress" ? (
            <form action={completeTechnicianJobAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <Button type="submit" className="min-h-12 w-full text-base">Mark completed</Button>
            </form>
          ) : null}
        </section>

        <History title="Technician Notes" rows={(notes ?? []).map((note) => `${formatDateTime(note.created_at)} - ${note.note} (${note.labor_hours} hrs)`)} />
        <History title="Labor Entries" rows={(labor ?? []).map((row) => `${row.labor_name}: ${row.hours} hrs`)} />
        <section className="grid gap-4 lg:col-span-2 lg:grid-cols-[1fr_0.9fr]">
          <SignedFileList title="Private Job Photos and Files" files={signedAttachments} />
          <PrivateFilePanel
            title="Upload Job Photo"
            description="Upload before, after, damaged part, and meter photos for this assigned job."
            action={uploadWorkOrderFileAction}
            hiddenFields={{ work_order_id: wo.id, return_to: `/technician/jobs/${wo.id}` }}
            typeFieldName="attachment_type"
            typeOptions={["Before Repair Photo", "After Repair Photo", "Damaged Part Photo", "Meter Photo", "Technician Photo"]}
          />
        </section>
        <section className="lg:col-span-2">
          <PartsRequestForm workOrderId={wo.id} parts={parts ?? []} />
        </section>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="font-bold text-[#111827]">{value}</dd></div>;
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-sm font-semibold text-[#4B5563]">{label}</p><p className="mt-1 rounded-md bg-gray-50 p-3 text-sm">{value || "Not recorded"}</p></div>;
}

function History({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
      <h2 className="text-lg font-black">{title}</h2>
      <div className="mt-3 space-y-2">{rows.length ? rows.map((row) => <p key={row} className="rounded-md bg-gray-50 p-3 text-sm">{row}</p>) : <p className="text-sm text-[#4B5563]">No technician updates have been recorded yet.</p>}</div>
    </section>
  );
}
