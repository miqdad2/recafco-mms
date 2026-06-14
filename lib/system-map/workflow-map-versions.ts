import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  buildDefaultEditableWorkflowDiagram,
  parseEditableWorkflowDiagram,
  type EditableWorkflowDiagram,
  type WorkflowMapVersion
} from "@/lib/system-map/editable-workflow";

type WorkflowMapVersionRow = {
  id: string;
  title: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  diagram: unknown;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function serializeVersion(row: WorkflowMapVersionRow): WorkflowMapVersion {
  return {
    id: row.id,
    title: row.title,
    version_number: row.version_number,
    status: row.status,
    diagram: parseEditableWorkflowDiagram(row.diagram),
    notes: row.notes,
    created_by: row.created_by,
    updated_by: row.updated_by,
    published_at: row.published_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

export async function getLatestWorkflowMapVersion() {
  try {
    const rows = await prisma.$queryRaw<WorkflowMapVersionRow[]>`
      select *
      from public.workflow_map_versions
      where status in ('draft', 'published')
      order by
        case when status = 'published' then 0 else 1 end,
        version_number desc,
        updated_at desc
      limit 1
    `;

    if (rows[0]) return serializeVersion(rows[0]);
  } catch {
    return null;
  }

  return null;
}

export async function getRecentWorkflowMapVersions() {
  try {
    const rows = await prisma.$queryRaw<WorkflowMapVersionRow[]>`
      select *
      from public.workflow_map_versions
      order by version_number desc, updated_at desc
      limit 12
    `;
    return rows.map(serializeVersion);
  } catch {
    return [];
  }
}

export async function getWorkflowMapEditorState(): Promise<{
  activeVersion: WorkflowMapVersion | null;
  versions: WorkflowMapVersion[];
  diagram: EditableWorkflowDiagram;
}> {
  const [activeVersion, versions] = await Promise.all([getLatestWorkflowMapVersion(), getRecentWorkflowMapVersions()]);
  return {
    activeVersion,
    versions,
    diagram: activeVersion?.diagram ?? buildDefaultEditableWorkflowDiagram()
  };
}

export async function getNextWorkflowMapVersionNumber() {
  const rows = await prisma.$queryRaw<Array<{ next_version: number }>>`
    select coalesce(max(version_number), 0) + 1 as next_version
    from public.workflow_map_versions
  `;
  return Number(rows[0]?.next_version ?? 1);
}
