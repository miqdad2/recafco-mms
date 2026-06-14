import "server-only";

import { workflowEdges, workflowNodes, type SystemTone } from "@/lib/system-map/config";

export type EditableWorkflowNode = {
  id: string;
  title: string;
  role: string;
  description: string;
  href: string;
  tone: SystemTone;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EditableWorkflowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type EditableWorkflowNote = {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
};

export type EditableWorkflowDiagram = {
  schemaVersion: 1;
  title: string;
  updatedFrom: "official-system-map";
  nodes: EditableWorkflowNode[];
  edges: EditableWorkflowEdge[];
  notes: EditableWorkflowNote[];
};

export type WorkflowMapVersion = {
  id: string;
  title: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  diagram: EditableWorkflowDiagram;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const layout: Record<string, { x: number; y: number }> = {
  "wo-create": { x: 80, y: 90 },
  "wo-approval": { x: 390, y: 90 },
  assignment: { x: 700, y: 90 },
  technician: { x: 1010, y: 90 },
  "parts-request": { x: 1010, y: 360 },
  "parts-approval": { x: 700, y: 360 },
  store: { x: 390, y: 360 },
  purchase: { x: 80, y: 360 },
  finance: { x: 80, y: 630 },
  ceo: { x: 390, y: 630 },
  receive: { x: 700, y: 630 },
  close: { x: 1010, y: 630 },
  reports: { x: 1010, y: 900 }
};

export function buildDefaultEditableWorkflowDiagram(): EditableWorkflowDiagram {
  return {
    schemaVersion: 1,
    title: "Latest RECAFCO Full Maintenance Workflow",
    updatedFrom: "official-system-map",
    nodes: workflowNodes.map((node, index) => ({
      id: node.id,
      title: node.title,
      role: node.role,
      description: node.description,
      href: node.href,
      tone: node.tone,
      x: layout[node.id]?.x ?? 80 + (index % 4) * 310,
      y: layout[node.id]?.y ?? 90 + Math.floor(index / 4) * 270,
      width: 250,
      height: 154
    })),
    edges: workflowEdges.map((edge, index) => ({
      id: `${edge.from}-${edge.to}-${index}`,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? ""
    })),
    notes: [
      {
        id: "meeting-notes",
        title: "Workshop notes",
        body: "Use this editable map during department meetings. Save proposed changes as drafts; publish only reviewed workflow versions.",
        x: 80,
        y: 900
      }
    ]
  };
}

export function parseEditableWorkflowDiagram(value: unknown): EditableWorkflowDiagram {
  const fallback = buildDefaultEditableWorkflowDiagram();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<EditableWorkflowDiagram>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return fallback;
  return {
    schemaVersion: 1,
    title: String(candidate.title || fallback.title),
    updatedFrom: "official-system-map",
    nodes: candidate.nodes.map((node, index) => ({
      id: String(node.id || `node-${index + 1}`),
      title: String(node.title || "Workflow Step"),
      role: String(node.role || "Role"),
      description: String(node.description || ""),
      href: String(node.href || "/dashboard"),
      tone: ["green", "amber", "red", "blue", "gray"].includes(String(node.tone)) ? node.tone : "blue",
      x: Number.isFinite(Number(node.x)) ? Number(node.x) : 80 + (index % 4) * 310,
      y: Number.isFinite(Number(node.y)) ? Number(node.y) : 90 + Math.floor(index / 4) * 270,
      width: Number.isFinite(Number(node.width)) ? Number(node.width) : 250,
      height: Number.isFinite(Number(node.height)) ? Number(node.height) : 154
    })),
    edges: candidate.edges.map((edge, index) => ({
      id: String(edge.id || `edge-${index + 1}`),
      from: String(edge.from || ""),
      to: String(edge.to || ""),
      label: String(edge.label || "")
    })),
    notes: Array.isArray(candidate.notes)
      ? candidate.notes.map((note, index) => ({
          id: String(note.id || `note-${index + 1}`),
          title: String(note.title || "Meeting note"),
          body: String(note.body || ""),
          x: Number.isFinite(Number(note.x)) ? Number(note.x) : 80,
          y: Number.isFinite(Number(note.y)) ? Number(note.y) : 900 + index * 170
        }))
      : fallback.notes
  };
}
