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
import { constructionProjectFlow, executiveWorkflowSteps, maintenanceWorkOrderBranches, managementMonitorCards, roadmapItems, roleSwimlanes, systemModules, systemPhases, workflowEdges, workflowEngineTables, workflowNodes } from "@/lib/system-map/config";
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

      {/* ── Workflow Engine Foundation ─────────────────────────────────── */}
      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Phase 6 — Schema foundation</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Workflow Engine Foundation</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#4B5563]">
            10 new tables added to the database. No live workflow behavior is activated at this stage —
            the engine is schema-ready for definition seeding and service wiring in the next phase.
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {workflowEngineTables.map((table) => (
            <div key={table.name} className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
              <p className="font-mono text-xs font-black text-[#ED1C24] break-all">{table.name}</p>
              <p className="mt-2 text-xs leading-5 text-[#4B5563]">{table.purpose}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
          Schema-only stage. Live workflow orchestration will be activated in Phase 6-D after definitions are seeded and the service layer is wired.
        </p>
      </section>

      <SystemProgressOverview stats={stats} />
      <WorkflowDiagram nodes={workflowNodes} edges={workflowEdges} presentation={presentation} />

      {/* ── Parts Availability Branches ────────────────────────────────── */}
      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Maintenance workflow logic</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Parts Availability Branches</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#4B5563]">
            After parts approval, the Store Keeper checks stock. Two paths diverge based on availability.
          </p>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {maintenanceWorkOrderBranches.map((branch) => (
            <div
              key={branch.id}
              className={`rounded-md border p-4 ${branch.tone === "green" ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-black ${branch.tone === "green" ? "bg-green-700 text-white" : "bg-amber-600 text-white"}`}>
                  {branch.title}
                </span>
                <span className="text-xs text-[#4B5563]">{branch.condition}</span>
              </div>
              <ol className="mt-4 space-y-2">
                {branch.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white ${step.tone === "green" ? "bg-green-600" : step.tone === "red" ? "bg-[#ED1C24]" : step.tone === "amber" ? "bg-amber-500" : "bg-blue-600"}`}>
                      {i + 1}
                    </span>
                    <div>
                      <span className="font-semibold text-[#111827]">{step.actor}</span>
                      <span className="ml-2 text-[#4B5563]">{step.action}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        {/* Construction / Project Request Flow */}
        <div className="mt-5">
          <p className="text-xs font-black uppercase text-[#4B5563]">Alternative entry point</p>
          <h3 className="mt-1 text-lg font-black text-[#111827]">Construction / Project Request Flow</h3>
          <p className="mt-1 text-sm text-[#4B5563]">Large construction or project maintenance requests enter via Production and Factory Managers before reaching the standard maintenance chain.</p>
          {constructionProjectFlow.map((branch) => (
            <div key={branch.id} className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-700 px-3 py-1 text-xs font-black text-white">{branch.title}</span>
                <span className="text-xs text-[#4B5563]">{branch.condition}</span>
              </div>
              <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {branch.steps.map((step, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-md border border-blue-200 bg-white p-3 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-black text-white">{i + 1}</span>
                    <span className="mt-1 font-semibold text-[#111827]">{step.actor}</span>
                    <span className="text-xs text-[#4B5563]">{step.action}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

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
