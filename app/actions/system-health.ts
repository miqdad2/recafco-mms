"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser, getCurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { logSystemError } from "@/lib/errors/logging";

const issueIdSchema = z.string().uuid();
const statusSchema = z.enum(["open", "investigating", "resolved", "ignored"]);
const severitySchema = z.enum(["info", "warning", "error", "critical"]);

function appendQuery(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

async function requireSystemHealthAccess(manage = false) {
  const context = await requireUser();
  const hasAccess =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("admin.audit_logs.view") ||
    context.permissions.includes(manage ? "admin.system_health.manage" : "admin.system_health.view");

  if (!hasAccess) {
    throw new AppError("You do not have permission to manage system health.", { code: "FORBIDDEN" });
  }

  return context;
}

export async function updateSystemIssueStatusAction(formData: FormData) {
  let fallbackPath = "/admin/system-health";

  try {
    const context = await requireSystemHealthAccess(true);
    const id = issueIdSchema.parse(formData.get("issue_id"));
    const status = statusSchema.parse(formData.get("status"));
    const notes = String(formData.get("resolution_notes") ?? "").trim().slice(0, 1000) || null;
    fallbackPath = `/admin/system-health?issue=${id}`;

    await prisma.system_error_logs.update({
      where: { id },
      data: {
        status,
        resolution_notes: notes,
        resolved_by: status === "resolved" || status === "ignored" ? context.userId : null,
        resolved_at: status === "resolved" || status === "ignored" ? new Date() : null
      }
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "system_health.issue_status.update",
      entityType: "system_error_log",
      entityId: id,
      summary: `Updated system issue status to ${status}`,
      metadata: { status, notes }
    });

    revalidatePath("/admin/system-health");
    fallbackPath = `/admin/system-health?success=status-updated&issue=${id}`;
  } catch (error) {
    redirect(appendQuery(fallbackPath, "error", safeErrorMessage(error)));
  }

  redirect(fallbackPath);
}

export async function createManualSystemIssueAction(formData: FormData) {
  let targetPath = "/admin/system-health";

  try {
    const context = await requireSystemHealthAccess(true);
    const severity = severitySchema.parse(formData.get("severity"));
    const message = z.string().trim().min(3).max(1000).parse(formData.get("message"));
    const source = String(formData.get("source") ?? "manual.admin_note").trim().slice(0, 160) || "manual.admin_note";
    const route = String(formData.get("route") ?? "").trim().slice(0, 300) || null;

    const issue = await prisma.system_error_logs.create({
      data: {
        severity,
        source,
        message,
        route,
        user_id: context.userId,
        metadata: {
          created_manually: true,
          created_by_name: context.profile.full_name
        }
      },
      select: { id: true }
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "system_health.issue.create",
      entityType: "system_error_log",
      entityId: issue.id,
      summary: `Created manual system health issue: ${message.slice(0, 120)}`,
      metadata: { severity, source, route }
    });

    revalidatePath("/admin/system-health");
    targetPath = `/admin/system-health?success=issue-created&issue=${issue.id}`;
  } catch (error) {
    redirect(`/admin/system-health?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect(targetPath);
}

export async function logClientModuleErrorAction(input: { message: string; digest?: string; route?: string }) {
  const context = await getCurrentUserContext();

  await logSystemError({
    severity: "critical",
    source: "client.dashboard_error_boundary",
    message: input.message || "Client module error",
    userId: context?.userId ?? null,
    route: input.route ?? null,
    metadata: {
      digest: input.digest ?? null,
      captured_by: "dashboard_error_boundary"
    }
  });
}
