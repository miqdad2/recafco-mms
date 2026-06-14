import type { ActionResult } from "@/lib/errors/app-error";
import { getCurrentUserContext } from "@/lib/auth/context";
import { toActionResult } from "@/lib/errors/error-handler";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import type { Json } from "@/types/database";

export async function safeAction<T>(source: string, handler: () => Promise<T>, metadata?: Json): Promise<ActionResult<T>> {
  try {
    const data = await handler();
    return { ok: true, data };
  } catch (error) {
    const context = await getCurrentUserContext();
    await logSystemError(errorToLogInput(error, source, context?.userId ?? null, metadata));
    return toActionResult<T>(error);
  }
}

export async function safeSideEffect(source: string, handler: () => Promise<unknown>, metadata?: Json) {
  try {
    await handler();
  } catch (error) {
    const context = await getCurrentUserContext();
    await logSystemError(errorToLogInput(error, source, context?.userId ?? null, metadata));
  }
}
