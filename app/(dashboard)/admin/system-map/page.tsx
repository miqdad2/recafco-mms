import { redirect } from "next/navigation";

import { EnterpriseSystemMap } from "@/components/system-map/enterprise-system-map";
import { PresentationModeView } from "@/components/system-map/presentation-mode-view";
import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { executiveWorkflowSteps, workflowEdges, workflowNodes } from "@/lib/system-map/config";

type SystemMapPageProps = {
  searchParams: Promise<{ presentation?: string }>;
};

export default async function SystemMapPage({ searchParams }: SystemMapPageProps) {
  const context = await requireUser();
  const canView = context.role?.slug === "super_admin" || context.permissions.includes("system_map.view");
  const canEdit = context.role?.slug === "super_admin";

  if (!canView) {
    redirect("/dashboard?error=permission-denied");
  }

  try {
    await writeAuditLog({
      actorId: context.userId,
      action: "system_map.viewed",
      entityType: "system_map",
      summary: `${context.profile.full_name} viewed the system map`,
      metadata: { role: context.role?.slug ?? "none" }
    });
  } catch {
    // The system map should remain available even if audit logging is temporarily unavailable.
  }

  const params = await searchParams;

  if (params.presentation === "1") {
    return <PresentationModeView steps={executiveWorkflowSteps} nodes={workflowNodes} edges={workflowEdges} />;
  }

  return <EnterpriseSystemMap editable={canEdit} />;
}
