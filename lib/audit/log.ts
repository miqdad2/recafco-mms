import type { Json } from "@/types/database";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Json;
};

export async function writeAuditLog(input: AuditInput) {
  try {
    await prisma.audit_logs.create({
      data: {
        actor_id: input.actorId,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        summary: input.summary,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  } catch (error) {
    await logSystemError(errorToLogInput(error, "audit.write", input.actorId, { action: input.action, entityType: input.entityType }));
  }
}
