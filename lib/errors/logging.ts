import "server-only";

import type { Json } from "@/types/database";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

type SystemErrorInput = {
  severity?: "info" | "warning" | "error" | "critical";
  source: string;
  message: string;
  stack?: string | null;
  metadata?: Json;
  userId?: string | null;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

function scrub(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value
      .replace(/(service[_-]?role[_-]?key=)[^&\s]+/gi, "$1[redacted]")
      .replace(/(anon[_-]?key=)[^&\s]+/gi, "$1[redacted]") as Json;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        key.toLowerCase().includes("secret") || key.toLowerCase().includes("token") || key.toLowerCase().includes("key") ? "[redacted]" : scrub(item)
      ])
    ) as Json;
  }
  return String(value);
}

export async function logSystemError(input: SystemErrorInput) {
  try {
    await prisma.system_error_logs.create({
      data: {
        severity: input.severity ?? "error",
        source: input.source,
        message: input.message.slice(0, 1000),
        stack: input.stack?.slice(0, 4000) ?? null,
        metadata: (scrub(input.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
        user_id: input.userId ?? null,
        route: input.route ?? null,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null
      }
    });
  } catch (dbErr) {
    // Error logging must never become a second failure path.
    if (process.env.NODE_ENV === "development") {
      console.error("[logSystemError] Failed to write system_error_logs:", dbErr);
    }
  }
}

export function errorToLogInput(error: unknown, source: string, userId?: string | null, metadata?: Json): SystemErrorInput {
  const route = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "route" in metadata ? String((metadata as Record<string, unknown>).route ?? "") || null : null;
  const entityType = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "entityType" in metadata ? String((metadata as Record<string, unknown>).entityType ?? "") || null : null;
  const entityId = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "entityId" in metadata ? String((metadata as Record<string, unknown>).entityId ?? "") || null : null;

  if (error instanceof Error) {
    return {
      source,
      message: error.message,
      stack: error.stack ?? null,
      userId,
      metadata,
      route,
      entityType,
      entityId
    };
  }

  return {
    source,
    message: "Unknown application error",
    userId,
    metadata: { error: scrub(error), ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}) } as Json,
    route,
    entityType,
    entityId
  };
}
