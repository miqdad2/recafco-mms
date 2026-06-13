import { redirect } from "next/navigation";

import { saveWorkflowMapVersionAction } from "@/app/actions/system-map";
import { WorkflowMapEditor } from "@/components/system-map/editor/workflow-map-editor";
import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { buildDefaultEditableWorkflowDiagram } from "@/lib/system-map/editable-workflow";
import { getWorkflowMapEditorState } from "@/lib/system-map/workflow-map-versions";

type WorkflowMapEditPageProps = {
  searchParams?: Promise<{ saved?: string; version?: string; error?: string }>;
};

export default async function WorkflowMapEditPage({ searchParams }: WorkflowMapEditPageProps) {
  const context = await requireUser();

  if (context.role?.slug !== "super_admin") {
    redirect("/dashboard?error=super-admin-required");
  }

  const params = await searchParams;
  const state = await getWorkflowMapEditorState();
  const officialDiagram = buildDefaultEditableWorkflowDiagram();

  try {
    await writeAuditLog({
      actorId: context.userId,
      action: "workflow_map.editor.viewed",
      entityType: "workflow_map",
      summary: `${context.profile.full_name} opened the editable workflow map`,
      metadata: { saved: params?.saved ?? null, version: params?.version ?? null, error: params?.error ?? null }
    });
  } catch {
    // Editing should remain available even when audit logging is temporarily unavailable.
  }

  return (
    <>
      {params?.saved ? (
        <div className="mx-4 mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800 lg:mx-6">
          Workflow map version {params.version ? `v${params.version} ` : ""}saved as {params.saved}.
        </div>
      ) : null}
      {params?.error ? (
        <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 lg:mx-6">
          Could not save workflow map: {params.error.replace(/-/g, " ")}.
        </div>
      ) : null}
      <WorkflowMapEditor
        initialDiagram={state.diagram}
        officialDiagram={officialDiagram}
        activeVersion={state.activeVersion}
        versions={state.versions}
        saveAction={saveWorkflowMapVersionAction}
      />
    </>
  );
}
