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
import { displayStatus } from "@/lib/display/work-order-labels";

// Technician Dashboard and My Jobs Workflow Alignment Unit Task 6: a Job Card
// can only ever have one active Materials Request at a time — mirrors the
// same local constant used on the Job Card quick-view and Materials Request
// detail pages.
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

function materialsLabel(status: string | null): string {
  if (!status) return "No Materials Request";
  if (status === "Issued") return "Materials sent";
  if (status === "Waiting Stock" || status === "Partially Issued") return "Store follow-up";
  return "Materials requested";
}

export default async function TechnicianJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("technician.jobs.view");
  const { id } = await params;
  const [rawAssignment, rawNotes, rawLabor, rawAttachments, rawParts, partsRequests] = await Promise.all([
    prisma.work_order_assignments.findFirst({
      where: { work_order_id: id, technician_id: context.userId },
      include: {
        work_orders: {
          include: {
            assets: { select: { asset_code: true, asset_name: true, plate_number: true, location: true } },
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
    }),
    prisma.parts_requests.findMany({
      where: { work_order_id: id },
      select: { id: true, parts_request_number: true, status: true },
      orderBy: { created_at: "desc" }
    })
  ]);

  const rawWo = rawAssignment?.work_orders ?? null;
  const wo = rawWo ? {
    ...rawWo,
    running_hours: rawWo.running_hours?.toFixed(2) ?? null,
    kilometers: rawWo.kilometers?.toFixed(2) ?? null,
  } : null;
  if (!wo || !rawAssignment) return <PageHeader title="Job not found" description="This job is not assigned to your technician account." />;
  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;

  const assignerProfile = rawAssignment.assigned_by
    ? await prisma.profiles.findUnique({ where: { id: rawAssignment.assigned_by }, select: { full_name: true } })
    : null;

  const activeMaterialsRequest = partsRequests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;
  const latestMaterialsStatus = partsRequests[0]?.status ?? null;

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

  // Technician Dashboard and My Jobs Workflow Alignment Unit Task 6: never
  // shows Review/Approve/Assign/Store Issue/Manager Approval to Technician —
  // only these three technician-scoped actions ever appear here, each gated
  // to the exact status it applies to.
  const isAssigned = wo.status === "Assigned";
  const isInProgress = wo.status === "In Progress";
  const isClosed = wo.status === "Closed";
  const canUpdateOrUpload = isAssigned || isInProgress;
  // Technician Materials Request Access Cleanup Task 3: explicit permission
  // check added — this page is already scoped to Job Cards assigned to this
  // technician (the query above returns null otherwise), so this only adds
  // the parts_requests.create gate on top of the existing status/active-
  // request conditions.
  const canCreatePartsRequest =
    context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.create");
  const canRequestExtraMaterials = canUpdateOrUpload && !activeMaterialsRequest && canCreatePartsRequest;

  return (
    <>
      <PageHeader title={wo.work_order_number ?? ""} description="Technician mobile job detail and quick actions." actions={<StatusBadge label={displayStatus(wo.status)} tone={wo.status === "In Progress" ? "blue" : wo.status === "Closed" ? "green" : "amber"} />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_0.85fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-[#111827]">Job Details</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Info label="Asset" value={asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"} />
            {asset?.plate_number && <Info label="Plate Number" value={asset.plate_number} />}
            <Info label="Department" value={department?.name ?? "No department"} />
            <Info label="Location" value={asset?.location || wo.job_location || "No location"} />
            <Info label="Priority" value={wo.priority} />
            <Info label="Maintenance type" value={wo.maintenance_type} />
            <Info label="Worker type" value={wo.worker_type} />
            <Info label="Assigned by" value={assignerProfile?.full_name ?? "-"} />
            <Info label="Assigned date" value={formatDateTime(rawAssignment.assigned_at.toISOString())} />
            <Info label="Materials" value={materialsLabel(latestMaterialsStatus)} />
            <Info label="Running hours" value={wo.running_hours ?? "-"} />
            <Info label="Kilometers" value={wo.kilometers ?? "-"} />
          </dl>
          <div className="mt-5 space-y-4">
            <TextBlock label="Operator complaint" value={wo.operator_complaint} />
            <TextBlock label="Description of work" value={wo.description_of_work} />
            {rawAssignment.notes && <TextBlock label="Instructions from assigner" value={rawAssignment.notes} />}
          </div>
        </section>

        <section className="space-y-4">
          {isAssigned ? (
            <form action={startTechnicianJobAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <Button type="submit" className="min-h-12 w-full text-base">Start Work</Button>
            </form>
          ) : null}

          {canUpdateOrUpload ? (
            <form action={addTechnicianUpdateAction} className="space-y-3 rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <h2 className="text-lg font-black">Add Work Update</h2>
              <textarea className="focus-ring min-h-28 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="note" placeholder="Work notes" required />
              <input className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-3" name="labor_hours" type="number" step="0.25" min="0" placeholder="Labor hours" />
              <Button type="submit" variant="secondary" className="min-h-12 w-full">Save update</Button>
            </form>
          ) : null}

          {isInProgress ? (
            <form action={completeTechnicianJobAction} className="space-y-3 rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <input type="hidden" name="work_order_id" value={wo.id} />
              <h2 className="text-lg font-black">Close Job</h2>
              <p className="text-xs text-[#4B5563]">Upload a work photo before closing if available.</p>
              <textarea
                className="focus-ring min-h-24 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
                name="comments"
                placeholder="Completion note (required)"
                required
                minLength={3}
              />
              <Button type="submit" className="min-h-12 w-full text-base">Close Job</Button>
            </form>
          ) : null}

          {isClosed ? (
            <div className="rounded-md border border-[#E5E7EB] bg-white p-5 text-center shadow-sm">
              <p className="text-sm font-semibold text-[#4B5563]">This job is closed. View only.</p>
            </div>
          ) : null}
        </section>

        <History title="Technician Notes" rows={(notes ?? []).map((note) => `${formatDateTime(note.created_at)} - ${note.note} (${note.labor_hours} hrs)`)} />
        <History title="Labor Entries" rows={(labor ?? []).map((row) => `${row.labor_name}: ${row.hours} hrs`)} />

        <section className="grid gap-4 lg:col-span-2 lg:grid-cols-[1fr_0.9fr]">
          <SignedFileList title="Private Job Photos and Files" files={signedAttachments} />
          {/* Task 8: upload only offered while the job is still open — a
              closed job is view-only, matching every other action here. */}
          {canUpdateOrUpload && (
            <PrivateFilePanel
              title="Upload Job Photo"
              description="Upload before, after, damaged part, and meter photos for this assigned job."
              action={uploadWorkOrderFileAction}
              hiddenFields={{ work_order_id: wo.id, return_to: `/technician/jobs/${wo.id}` }}
              typeFieldName="attachment_type"
              typeOptions={["Before Repair Photo", "After Repair Photo", "Damaged Part Photo", "Meter Photo", "Technician Photo"]}
            />
          )}
        </section>

        {/* Task 10: Request Extra Materials only while the job is open and no
            Materials Request is already active — the Job Card is already
            fixed via workOrderId, so there's no selection step needed. */}
        {canRequestExtraMaterials ? (
          <section className="lg:col-span-2">
            <PartsRequestForm workOrderId={wo.id} parts={parts ?? []} />
          </section>
        ) : activeMaterialsRequest ? (
          <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-black text-[#111827]">Request Extra Materials</h2>
            <p className="mt-2 text-sm text-[#4B5563]">
              {activeMaterialsRequest.parts_request_number ?? "A Materials Request"} is already {materialsLabel(activeMaterialsRequest.status).toLowerCase()} for this Job Card.
            </p>
          </section>
        ) : null}
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
