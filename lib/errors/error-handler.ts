import { ZodError } from "zod";

import { AppError, fieldErrorsFromZod, type ActionResult } from "@/lib/errors/app-error";

// Enterprise Error Handling Audit Unit Task 10: aligned to the standard
// "Unexpected" wording — this is the fallback shown for every error that
// isn't an AppError/ZodError, i.e. the message most users will actually see.
const genericMessage = "Something went wrong. Please try again or contact IT.";

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
