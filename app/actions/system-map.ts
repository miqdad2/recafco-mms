"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { notifyByEvent } from "@/lib/notifications/service";
import { parseEditableWorkflowDiagram } from "@/lib/system-map/editable-workflow";
import { getNextWorkflowMapVersionNumber } from "@/lib/system-map/workflow-map-versions";

const workflowMapSaveSchema = z.object({
  title: z.string().trim().min(3).max(160),
  status: z.enum(["draft", "published"]),
  notes: z.string().trim().max(2000).optional(),
  diagram_json: z.string().min(2).max(300000)
});

export async function saveWorkflowMapVersionAction(formData: FormData) {
  const context = await requireUser();

  if (context.role?.slug !== "super_admin") {
    redirect("/dashboard?error=super-admin-required");
  }

  const parsed = workflowMapSaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect("/admin/system-map/edit?error=invalid-input");
  }

  let diagram: unknown;
  try {
    diagram = parseEditableWorkflowDiagram(JSON.parse(parsed.data.diagram_json));
  } catch {
    redirect("/admin/system-map/edit?error=invalid-diagram");
  }

  const nextVersion = await getNextWorkflowMapVersionNumber();
  const status = parsed.data.status;
  const diagramJson = JSON.stringify(diagram);

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_profile_id', ${context.userId}, true)`;
    if (status === "published") {
      await tx.$executeRaw`
        update public.workflow_map_versions
        set status = 'archived', updated_at = now(), updated_by = ${context.userId}::uuid
        where status = 'published'
      `;
    }

    return tx.$queryRaw<Array<{ id: string }>>`
      insert into public.workflow_map_versions (
        title,
        version_number,
        status,
        diagram,
        notes,
        created_by,
        updated_by,
        published_at
      )
      values (
        ${parsed.data.title},
        ${nextVersion},
        ${status},
        ${diagramJson}::jsonb,
        ${parsed.data.notes || null},
        ${context.userId}::uuid,
        ${context.userId}::uuid,
        ${status === "published" ? new Date() : null}
      )
      returning id
    `;
  });

  const versionId = rows[0]?.id;

  await writeAuditLog({
    actorId: context.userId,
    action: status === "published" ? "workflow_map.publish" : "workflow_map.draft",
    entityType: "workflow_map_version",
    entityId: versionId,
    summary: `${context.profile.full_name} saved workflow map version ${nextVersion} as ${status}`,
    metadata: {
      version_number: nextVersion,
      title: parsed.data.title,
      status,
      nodes: parseEditableWorkflowDiagram(diagram).nodes.length,
      edges: parseEditableWorkflowDiagram(diagram).edges.length
    }
  });

  await notifyByEvent({
    eventKey: "system_map.updated",
    entityType: "workflow_map_version",
    entityId: versionId,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { user_name: context.profile.full_name, version_number: String(nextVersion) },
    actionUrl: "/admin/system-map/edit",
    actionLabel: "Open editable map"
  });

  revalidatePath("/admin/system-map");
  revalidatePath("/admin/system-map/edit");
  redirect(`/admin/system-map/edit?saved=${status}&version=${nextVersion}`);
}
