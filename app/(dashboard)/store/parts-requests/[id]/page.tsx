import { Paperclip } from "lucide-react";
import Link from "next/link";

import {
  approvePartsRequestAction,
  rejectPartsRequestAction,
  receiveMaterialFromRequestAction,
} from "@/app/actions/phase4";
import {
  uploadPartsRequestAttachmentAction,
  deletePartsRequestAttachmentAction,
} from "@/app/actions/files";
import { PartsRequestItemsTable } from "@/components/store/parts-request-items-table";
import { StoreIssuePanel } from "@/components/store/store-issue-panel";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import {
  displayPartsRequestStatus,
  partsRequestStatusTone,
} from "@/lib/display/parts-request-labels";
import { canReceiveIssueMaterials, getPartsRequestVisibilityFilter } from "@/lib/parts-requests/visibility";
import { PARTS_REQUEST_ATTACHMENT_CATEGORIES } from "@/lib/files/attachment-constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFoundResponse() {
  return (
    <>
      <PageHeader
        title="Materials Request not found"
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "Request Details" }]} />
        }
      />
      <div className="p-4 lg:p-6">
        <EmptyState
          title="Materials Request not found"
          message="This Materials Request may have been deleted, moved, or you may not have permission to view it."
          action={<BackLink href="/store/parts-requests" label="Back to Materials Requests" />}
        />
      </div>
    </>
  );
}

export default async function PartsRequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | undefined>> }) {
  const context = await requirePermission("parts_requests.view");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : null;
  const warningMsg = sp.warning ?? null;

  // Same visibility rule the list page uses (Route Detail Fix Unit 1 Task 6)
  // — a previous hand-rolled check here used `parts_requests.approve` instead
  // of `work_orders.approve`, which could disagree with the list page for a
  // role that has one permission but not the other. Sharing the exact same
  // function guarantees the two can never drift apart again.
  const visibilityFilter = getPartsRequestVisibilityFilter(context);
  const includeShape = {
    work_orders: { select: { id: true, work_order_number: true } },
    assets: { select: { asset_code: true, asset_name: true } },
    departments: { select: { name: true } },
  };

  // Look up by id first; `id` is `@db.Uuid` so only attempt that lookup when
  // the param is actually UUID-shaped. Otherwise fall back to a request-number
  // match (accepting the dash-separated URL form of "REC/STORE/PR/0006").
  const isUuid = UUID_RE.test(id);
  let request = isUuid
    ? await prisma.parts_requests.findFirst({
        where: { AND: [{ id }, visibilityFilter] },
        include: includeShape,
      })
    : null;
  if (!request) {
    request = await prisma.parts_requests.findFirst({
      where: {
        AND: [
          { parts_request_number: { equals: id.replace(/-/g, "/"), mode: "insensitive" } },
          visibilityFilter,
        ],
      },
      include: includeShape,
    });
  }

  if (!request) return notFoundResponse();

  const [rawItems, rawAttachments] = await Promise.all([
    prisma.parts_request_items.findMany({
      where: { parts_request_id: request.id },
    }),
    prisma.parts_request_attachments.findMany({
      where: { parts_request_id: request.id },
      orderBy: { created_at: "desc" },
    }),
  ]);

  const items = rawItems.map((item) => ({
    ...item,
    quantity_requested: item.quantity_requested.toFixed(2),
    unit_price: item.unit_price.toFixed(3),
    total_price: item.total_price?.toFixed(3) ?? null,
    issued_quantity: item.issued_quantity.toFixed(2)
  }));

  const canApprove = context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.approve");
  const canReceive = canReceiveIssueMaterials(context);

  // The single-material receive panel below only applies while the request
  // is still "Requested" — once received, use the list's Issue popup instead
  // (MaterialsRequest-DataEntryReceiveIssue-01 Task 2/5).
  const isOpen = displayPartsRequestStatus(request.status) === "Requested";

  const canUploadFiles =
    context.role?.slug === "super_admin" ||
    (context.permissions.includes("files.upload") &&
      (context.permissions.includes("parts_requests.approve") ||
        context.permissions.includes("store.issue") ||
        context.permissions.includes("work_orders.manage") ||
        context.permissions.includes("parts_requests.create")));

  const canDeleteFiles =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.approve") ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.manage");

  // Files stored in work-order-files under the linked work_order_id folder
  const workOrderId = (Array.isArray(request.work_orders)
    ? request.work_orders[0]?.id
    : request.work_orders?.id) ?? "";
  const canViewFiles = workOrderId
    ? await canViewEntityFile(context, "work-order-files", workOrderId)
    : false;

  // Fetch uploader names
  const uploaderIds = [...new Set(rawAttachments.map((a) => a.uploaded_by).filter(Boolean))] as string[];
  const uploaderProfiles =
    uploaderIds.length > 0
      ? await prisma.profiles.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, full_name: true },
        })
      : [];
  const uploaderMap = new Map(uploaderProfiles.map((p) => [p.id, p.full_name]));
  const uploaderName = (uid?: string | null) =>
    uid ? (uploaderMap.get(uid) ?? "System") : "System";

  const signedAttachments = await Promise.all(
    rawAttachments.map(async (a) => ({
      id: a.id,
      label: a.attachment_type,
      fileName: a.file_name,
      contentType: a.content_type ?? "",
      signedUrl: canViewFiles ? await createSignedFileUrl("work-order-files", a.file_path) : null,
      uploadedByName: uploaderName(a.uploaded_by),
      createdAt: a.created_at.toISOString(),
    }))
  );

  return (
    <>
      <PageHeader
        title={request.parts_request_number ?? ""}
        description="Materials request detail, approval, and receipt."
        breadcrumb={
          <PageBreadcrumb items={[{ label: "Materials Requests", href: "/store/parts-requests" }, { label: "Request Details" }]} />
        }
        actions={
          <>
            <BackLink href="/store/parts-requests" label="Back to Materials Requests" />
            <Link href={`/store/parts-requests/${request.id}/print`}>
              <Button variant="secondary">Print</Button>
            </Link>
            <StatusBadge
              label={displayPartsRequestStatus(request.status)}
              tone={partsRequestStatusTone(request.status)}
            />
          </>
        }
      />

      {errorMsg && (
        <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 lg:mx-6">
          {errorMsg}
        </div>
      )}
      {warningMsg === "attachments-failed" && (
        <div className="mx-4 mt-4 rounded-md border border-[#F59E0B] bg-amber-50 px-4 py-3 lg:mx-6">
          <p className="text-sm font-black text-[#92400E]">
            Materials Request created, but some attachments failed to upload
          </p>
          <p className="mt-1 text-sm leading-5 text-[#4B5563]">
            The request was saved successfully. You can upload the missing files again from
            Attachments below.
          </p>
        </div>
      )}

      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.8fr] lg:p-6">
        {/* ── Summary ─────────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Request Summary</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Info label="Job card" value={(Array.isArray(request.work_orders) ? request.work_orders[0]?.work_order_number : request.work_orders?.work_order_number) ?? "-"} />
            <Info label="Asset" value={(Array.isArray(request.assets) ? request.assets[0]?.asset_code : request.assets?.asset_code) ?? "-"} />
            <Info label="Department" value={(Array.isArray(request.departments) ? request.departments[0]?.name : request.departments?.name) ?? "-"} />
            <Info label="Total" value={<CostVisibilityGuard context={context}>{request.total_price.toFixed(3)}</CostVisibilityGuard>} />
          </dl>
        </section>

        {/* ── Action panels ────────────────────────────────────────── */}
        <section className="space-y-5">
          {/* Manager approval */}
          {canApprove && ["Submitted", "Pending Approval"].includes(request.status) ? (
            <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Maintenance Manager Approval</h2>
              <div className="mt-4 grid gap-3">
                <form action={approvePartsRequestAction} className="space-y-2">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder="Approval comments" />
                  <Button type="submit" className="w-full">Approve</Button>
                </form>
                <form action={rejectPartsRequestAction} className="space-y-2">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder="Rejection reason" required />
                  <Button type="submit" variant="danger" className="w-full">Reject</Button>
                </form>
              </div>
            </section>
          ) : null}

          {/* Receive Material */}
          {canReceive && isOpen && (
            <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Receive Material</h2>
              <p className="mt-1 text-sm text-[#4B5563]">Record materials received against this request.</p>
              <form action={receiveMaterialFromRequestAction} className="mt-4 space-y-3">
                <input type="hidden" name="parts_request_id" value={request.id} />
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Material name *</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="material_name"
                    required
                    placeholder="e.g. Hydraulic oil, Filter, Bearing…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity received *</label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      name="quantity_received"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Unit</label>
                    <input
                      className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      name="unit"
                      defaultValue="PCS"
                      placeholder="PCS"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Received from</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="received_from"
                    placeholder="Supplier / vendor name (optional)"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Reference number</label>
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="reference_number"
                    placeholder="Invoice or delivery note number (optional)"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Remarks</label>
                  <textarea
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="remarks"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>
                <Button type="submit">Confirm receipt</Button>
              </form>
            </section>
          )}

          {/* Store Issue Panel — kept for store keepers */}
          <StoreIssuePanel requestId={request.id} status={request.status} items={items ?? []} context={context} />
        </section>

        {/* ── Items table ──────────────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Items</h2>
          <PartsRequestItemsTable items={items ?? []} context={context} />
        </section>

        {/* ── Attachments ───────────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#111827] text-white">
              <Paperclip className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Files</p>
              <h2 className="text-lg font-bold text-[#111827]">Attachments</h2>
            </div>
          </div>

          {/* File list */}
          <div className="mt-5">
            {signedAttachments.length > 0 ? (
              <div className="divide-y divide-[#E5E7EB]">
                {signedAttachments.map((file) => {
                  const isPhoto = file.contentType.startsWith("image/");
                  return (
                    <div key={file.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                          <Paperclip className="h-4 w-4 text-[#4B5563]" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#111827]">{file.label}</p>
                          <p className="truncate text-sm text-[#4B5563]">{file.fileName}</p>
                          <p className="mt-0.5 text-xs text-[#9CA3AF]">
                            {isPhoto ? "Photo" : "Document"} · Uploaded by {file.uploadedByName} · {file.createdAt.slice(0, 10)}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {file.signedUrl ? (
                          <>
                            <Link className="text-sm font-bold text-[#ED1C24] hover:underline" href={file.signedUrl} target="_blank">View</Link>
                            <Link className="text-sm font-bold text-[#4B5563] hover:underline" href={`${file.signedUrl}?download=1`} download>Download</Link>
                          </>
                        ) : (
                          <span className="text-sm text-[#9CA3AF]">Access restricted</span>
                        )}
                        {canDeleteFiles && (
                          <form action={deletePartsRequestAttachmentAction}>
                            <input type="hidden" name="attachment_id" value={file.id} />
                            <input type="hidden" name="parts_request_id" value={request.id} />
                            <button type="submit" className="text-sm text-red-500 hover:text-red-700 hover:underline">Delete</button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[#4B5563]">No files uploaded yet.</p>
            )}
          </div>

          {/* Upload forms */}
          {canUploadFiles && (
            <div className="mt-5 space-y-4 border-t border-[#E5E7EB] pt-4">
              <p className="text-xs text-[#4B5563]">
                Upload PDFs, Excel files, Word documents, or photos. On mobile, you can take a live photo.
              </p>

              {/* Upload File */}
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Upload File</p>
                <form action={uploadPartsRequestAttachmentAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                    {PARTS_REQUEST_ATTACHMENT_CATEGORIES.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <input
                    required
                    type="file"
                    name="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                    className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                  />
                  <Button type="submit">Upload File</Button>
                </form>
              </div>

              {/* Take Photo — rear camera on mobile */}
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Take Photo</p>
                <form action={uploadPartsRequestAttachmentAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
                  <input type="hidden" name="parts_request_id" value={request.id} />
                  <select name="attachment_type" className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                    {["Received Material Photo", "Material Photo", "Delivery Note", "Other Document"].map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <input
                    required
                    type="file"
                    name="file"
                    accept="image/*"
                    capture="environment"
                    className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
                  />
                  <Button type="submit">Take Photo</Button>
                </form>
              </div>

              <p className="text-xs text-[#9CA3AF]">
                Accepted: PDF, JPG, PNG, WEBP, XLS, XLSX, DOC, DOCX · Max 10 MB per file
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="font-bold text-[#111827]">{value}</dd></div>;
}
