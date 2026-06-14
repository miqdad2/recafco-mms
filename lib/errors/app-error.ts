import { ZodError } from "zod";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "STORAGE_ERROR"
  | "WORKFLOW_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  code: AppErrorCode;
  status: number;
  safeMessage: string;
  fieldErrors?: Record<string, string[]>;

  constructor(message: string, options: { code?: AppErrorCode; status?: number; fieldErrors?: Record<string, string[]>; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code ?? "INTERNAL_ERROR";
    this.status = options.status ?? statusForCode(this.code);
    this.safeMessage = message;
    this.fieldErrors = options.fieldErrors;
  }
}

export function statusForCode(code: AppErrorCode) {
  if (code === "BAD_REQUEST" || code === "VALIDATION_ERROR") return 400;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT" || code === "WORKFLOW_ERROR") return 409;
  return 500;
}

export function fieldErrorsFromZod(error: ZodError): Record<string, string[]> {
  return error.issues.reduce<Record<string, string[]>>((fieldErrors, issue) => {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    return fieldErrors;
  }, {});
}
