import { ZodError } from "zod";

import { AppError, fieldErrorsFromZod, type ActionResult } from "@/lib/errors/app-error";

const genericMessage = "The system could not complete this request. Try again or contact IT support.";

export function normalizeError(error: unknown) {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError("Check the highlighted fields and try again.", {
      code: "VALIDATION_ERROR",
      fieldErrors: fieldErrorsFromZod(error),
      cause: error
    });
  }

  return new AppError(genericMessage, { code: "INTERNAL_ERROR", cause: error });
}

export function toActionResult<T = unknown>(error: unknown): ActionResult<T> {
  const appError = normalizeError(error);
  return {
    ok: false,
    error: appError.safeMessage,
    code: appError.code,
    fieldErrors: appError.fieldErrors
  };
}

export function safeErrorMessage(error: unknown) {
  return normalizeError(error).safeMessage;
}
