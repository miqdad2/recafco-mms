import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { readPrivateFile } from "@/lib/files/local-storage";
import { PRIVATE_FILE_BUCKETS, type PrivateFileBucket } from "@/lib/files/validation";
import type { PermissionKey } from "@/types/database";

// ── Authorization note ────────────────────────────────────────────────────────
//
// The permission `files.view` exists in the database as a legacy, global bucket
// permission that was defined during the earlier Supabase Storage RLS design.
// In that design, a single `files.view` check was the only gate for all three
// private buckets.
//
// The local-storage download route below intentionally does NOT use `files.view`.
// Instead it enforces bucket + entity ownership:
//   work-order-files  →  work_orders.view  (or technician.jobs.view + assigned)
//   asset-files       →  assets.view
//   purchase-files    →  purchase_requests.view | finance.approve | ceo.approve
//
// This is tighter than `files.view` (which all eleven roles hold).
//
// IMPORTANT FOR FUTURE DEVELOPERS:
//   Do NOT replace these entity-level checks with a single `files.view` gate.
//   Doing so would let any authenticated user (e.g. a technician) download
//   financial documents or assets from departments they have no access to.
//   The entity check is intentional and must be preserved.
//
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain; charset=utf-8"
};

function mimeTypeFor(storagePath: string): string {
  const ext = storagePath.match(/\.[^./?#]+$/)?.[0]?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string) {
  return UUID_RE.test(s);
}

/**
 * work-order-files: users with work_orders.view see any work order;
 * technicians with only technician.jobs.view see only their assigned work orders.
 */
async function canAccessWorkOrder(
  entityId: string,
  userId: string,
  permissions: PermissionKey[]
): Promise<boolean> {
  if (permissions.includes("work_orders.view")) {
    const wo = await prisma.work_orders.findFirst({ where: { id: entityId }, select: { id: true } });
    return !!wo;
  }
  if (permissions.includes("technician.jobs.view")) {
    const assignment = await prisma.work_order_assignments.findFirst({
      where: { work_order_id: entityId, technician_id: userId },
      select: { id: true }
    });
    return !!assignment;
  }
  return false;
}

/** asset-files: any user with assets.view permission can access asset documents. */
async function canAccessAsset(entityId: string, permissions: PermissionKey[]): Promise<boolean> {
  if (!permissions.includes("assets.view")) return false;
  const asset = await prisma.assets.findFirst({ where: { id: entityId }, select: { id: true } });
  return !!asset;
}

/**
 * purchase-files: quotations, invoices, and delivery notes are finance-sensitive.
 * Requires purchase_requests.view, finance.approve, or ceo.approve.
 */
async function canAccessPurchaseRequest(
  entityId: string,
  permissions: PermissionKey[]
): Promise<boolean> {
  const hasAccess =
    permissions.includes("purchase_requests.view") ||
    permissions.includes("finance.approve") ||
    permissions.includes("ceo.approve");
  if (!hasAccess) return false;
  const pr = await prisma.purchase_requests.findFirst({ where: { id: entityId }, select: { id: true } });
  return !!pr;
}

type FileRouteProps = {
  params: Promise<{
    bucket: string;
    path: string[];
  }>;
};

export async function GET(request: Request, { params }: FileRouteProps) {
  // 1. Auth — return 401 rather than redirecting.
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const resolvedParams = await params;

  // 2. Bucket validation — 404 avoids confirming valid bucket names.
  if (!PRIVATE_FILE_BUCKETS.includes(resolvedParams.bucket as PrivateFileBucket)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const bucket = resolvedParams.bucket as PrivateFileBucket;
  const storagePath = resolvedParams.path.map(decodeURIComponent).join("/");

  // The first path segment is the entity folder (set by savePrivateFile as the entity ID).
  const entityId = storagePath.split("/")[0] ?? "";

  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "";
  const auditBase = { bucket, path: storagePath, entity_id: entityId, ip, user_agent: ua };

  // 3. Entity-level access check. Super Admin bypasses all entity checks.
  const isSuperAdmin = context.role?.slug === "super_admin";
  let entityAccess = isSuperAdmin;

  if (!isSuperAdmin) {
    // All legitimate files are stored under a UUID folder. Deny non-UUID paths.
    if (!isUuid(entityId)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    try {
      if (bucket === "work-order-files") {
        entityAccess = await canAccessWorkOrder(entityId, context.userId, context.permissions);
      } else if (bucket === "asset-files") {
        entityAccess = await canAccessAsset(entityId, context.permissions);
      } else if (bucket === "purchase-files") {
        entityAccess = await canAccessPurchaseRequest(entityId, context.permissions);
      }
    } catch {
      entityAccess = false;
    }

    if (!entityAccess) {
      // Return 404 rather than 403 — do not confirm that the file exists.
      await writeAuditLog({
        actorId: context.userId,
        action: "file.access_denied",
        entityType: "file",
        entityId,
        summary: `File access denied: ${bucket}`,
        metadata: auditBase
      }).catch(() => {});
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  // 4. Read file from local storage.
  let file: Buffer;
  try {
    file = await readPrivateFile(bucket, storagePath);
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // 5. Audit successful access for finance-sensitive files only.
  //    purchase-files contain quotations and invoices; always log.
  //    work-order-files and asset-files are accessed constantly during daily
  //    operations (technician photos, manager reviews) — logging every view
  //    creates noise that drowns out real security events.
  if (bucket === "purchase-files") {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.viewed",
      entityType: "file",
      entityId: isUuid(entityId) ? entityId : undefined,
      summary: `Viewed purchase file`,
      metadata: auditBase
    }).catch(() => {});
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": mimeTypeFor(storagePath),
      "Cache-Control": "private, max-age=60"
    }
  });
}
