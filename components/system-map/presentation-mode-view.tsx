import { ExecutiveWorkflowStrip } from "@/components/system-map/executive-workflow-strip";
import { SystemMapHero } from "@/components/system-map/system-map-hero";
import { WorkflowDiagram } from "@/components/system-map/workflow-diagram";
import type { ExecutiveWorkflowStep, WorkflowEdge, WorkflowNode } from "@/lib/system-map/config";

export function PresentationModeView({
  steps,
  nodes,
  edges
}: {
  steps: ExecutiveWorkflowStep[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#F5F6F8]">
      <div className="space-y-6 p-5 lg:p-8">
        <SystemMapHero presentation />
        <ExecutiveWorkflowStrip steps={steps} presentation />
        <WorkflowDiagram nodes={nodes} edges={edges} presentation />
      </div>
    </div>
  );
}
