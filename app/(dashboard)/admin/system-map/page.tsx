import { redirect } from "next/navigation";

import { ExecutiveWorkflowStrip } from "@/components/system-map/executive-workflow-strip";
import { LiveDataSnapshot } from "@/components/system-map/live-data-snapshot";
import { ManagementMonitoringSection } from "@/components/system-map/management-monitoring-section";
import { ModuleGrid } from "@/components/system-map/module-grid";
import { PhaseTimeline } from "@/components/system-map/phase-timeline";
import { PresentationModeView } from "@/components/system-map/presentation-mode-view";
import { RoadmapSection } from "@/components/system-map/roadmap-section";
import { RoleSwimlanes } from "@/components/system-map/role-swimlanes";
import { SystemMapHero } from "@/components/system-map/system-map-hero";
import { SystemProgressOverview } from "@/components/system-map/system-progress-overview";
import { WorkflowDiagram } from "@/components/system-map/workflow-diagram";
import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { notifyByEvent } from "@/lib/notifications/service";
import { executiveWorkflowSteps, managementMonitorCards, roadmapItems, roleSwimlanes, systemModules, systemPhases, workflowEdges, workflowNodes } from "@/lib/system-map/config";
import { getSystemMapStats } from "@/lib/system-map/stats";

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
    await notifyByEvent({
      eventKey: "system_map.viewed",
      entityType: "system_map",
      actorId: context.userId,
      recipientUserIds: [context.userId],
      metadata: { user_name: context.profile.full_name },
      actionUrl: "/admin/system-map",
      actionLabel: "Open system map"
    });
  } catch {
    // The system map should remain available even if audit logging is temporarily unavailable.
  }

  const params = await searchParams;
  const presentation = params.presentation === "1";
  const stats = await getSystemMapStats(context.userId);

  if (presentation) {
    return <PresentationModeView steps={executiveWorkflowSteps} nodes={workflowNodes} edges={workflowEdges} />;
  }

  const content = (
    <div className="space-y-6 p-4 lg:p-6">
      <SystemMapHero presentation={false} editable={canEdit} />
      <ExecutiveWorkflowStrip steps={executiveWorkflowSteps} />
      <SystemProgressOverview stats={stats} />
      <WorkflowDiagram nodes={workflowNodes} edges={workflowEdges} presentation={presentation} />
      <RoleSwimlanes lanes={roleSwimlanes} />
      <ManagementMonitoringSection cards={managementMonitorCards} />
      <ModuleGrid modules={systemModules} />
      <LiveDataSnapshot stats={stats} />
      <PhaseTimeline phases={systemPhases} />
      <RoadmapSection items={roadmapItems} />
    </div>
  );

  return content;
}
