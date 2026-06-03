import Link from "next/link";

import { getSystemMapIcon, toneStyles } from "@/components/system-map/system-map-icons";
import { WorkflowLegend } from "@/components/system-map/workflow-legend";
import type { WorkflowEdge, WorkflowNode } from "@/lib/system-map/config";

export function WorkflowDiagram({ nodes, edges, presentation = false }: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; presentation?: boolean }) {
  const edgeLabels = new Map(edges.map((edge) => [`${edge.from}:${edge.to}`, edge.label]));

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Detailed workflow map</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Every handoff from request to management visibility.</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#4B5563]">From work order to closure, stock control, cost approval, and asset history.</p>
        </div>
        <WorkflowLegend />
      </div>
      <div className={presentation ? "mt-7 grid gap-5 lg:grid-cols-3 xl:grid-cols-4" : "mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4"}>
        {nodes.map((node, index) => {
          const Icon = getSystemMapIcon(node.icon);
          const tone = toneStyles[node.tone];
          const next = nodes[index + 1];
          const label = next ? edgeLabels.get(`${node.id}:${next.id}`) : null;
          return (
            <div key={node.id} className="relative system-map-fade-up" style={{ animationDelay: `${index * 45}ms` }}>
              <Link href={node.href} className={`group block min-h-52 rounded-md border bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-[#ED1C24] hover:shadow-lg ${tone.border}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-md text-sm font-black text-white ${tone.solid}`}>{index + 1}</span>
                  <span className={`rounded-md p-2 ${tone.bg} ${tone.text}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                </div>
                <h3 className="mt-5 text-lg font-black text-[#111827]">{node.title}</h3>
                <p className="mt-1 text-xs font-black uppercase text-[#4B5563]">{node.role}</p>
                <p className="mt-4 text-sm leading-6 text-[#4B5563]">{node.description}</p>
                <div className="mt-5 h-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full w-2/3 ${tone.solid} transition-all group-hover:w-full`} />
                </div>
              </Link>
              {next ? (
                <>
                  <div className="mx-auto my-2 flex w-px justify-center md:hidden">
                    <div className="h-8 w-0.5 bg-[#ED1C24] system-map-connector-pulse" />
                  </div>
                  <div className="hidden xl:block">
                    <svg className="absolute -right-5 top-1/2 z-10 h-10 w-10 -translate-y-1/2" viewBox="0 0 44 24" aria-hidden="true">
                      <path d="M3 12 H33" fill="none" stroke="#ED1C24" strokeWidth="2" className="system-map-flow-line" />
                      <path d="M31 5 L40 12 L31 19" fill="none" stroke="#ED1C24" strokeWidth="2" />
                    </svg>
                    {label ? <span className="absolute -right-12 top-[59%] z-20 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[10px] font-black uppercase text-[#4B5563] shadow-sm">{label}</span> : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
