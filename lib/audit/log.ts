import type { Json } from "@/types/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Json;
};

export async function writeAuditLog(input: AuditInput) {
  const supabase = await createSupabaseServerClient();

  await supabase.from("audit_logs").insert({
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {}
  });
}
