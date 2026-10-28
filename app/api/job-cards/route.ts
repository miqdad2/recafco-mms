/**
 * POST /api/job-cards
 *
 * Creates a Job Card from the New Job Card wizard (multipart form data, the
 * same fields the wizard always posted, plus `submission_id`). Always
 * answers with JSON (JobCardCreateResponse) — never a redirect — so the
 * wizard can keep the form open and show what happened:
 *
 *   200 { ok: true, ... }              created, or already created by this submission id
 *   400 { ok: false, validation ... }  nothing saved; step + field say where
 *   401 / 403                          session expired / not allowed; nothing saved
 *   413                                request too large; nothing saved
 *   503 / 500                          database or server failure; nothing saved
 *
 * A route handler rather than a Server Action: the wizard needs a timeout
 * it controls and a status check that is not queued behind a stuck request
 * (Server Actions from one page run one at a time).
 */

import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/context";
import { createJobCardFromForm, logJobCardAttempt } from "@/lib/backend/work-orders/job-card-creation";
import {
  isSubmissionId,
  JOB_CARD_MAX_REQUEST_BYTES,
  type JobCardCreateResponse,
} from "@/lib/work-orders/job-card-create-result";
import { isSameOriginRequest } from "@/lib/security/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_FOR_CATEGORY: Record<string, number> = {
  validation: 400,
  bad_request: 400,
  session: 401,
  permission: 403,
  upload: 413,
  database: 503,
  unexpected: 500,
};

function reply(body: JobCardCreateResponse) {
  const status = body.ok ? 200 : (STATUS_FOR_CATEGORY[body.category] ?? 500);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const reference = randomBytes(4).toString("hex").toUpperCase();
  const base = { correlationId: reference, submissionId: null as string | null, userId: null as string | null, roleSlug: null as string | null, startedAt };

  if (!isSameOriginRequest(request)) {
    logJobCardAttempt(base, { outcome: "failed", category: "bad_request", field: "origin" });
    return reply({ ok: false, category: "bad_request", message: "Request refused.", retryable: false, reference });
  }

  // A database outage throws here; it is not an expired session, so it must
  // not send the user off to sign in (which would fail too).
  let context: Awaited<ReturnType<typeof getCurrentUserContext>>;
  try {
    context = await getCurrentUserContext();
  } catch {
    logJobCardAttempt(base, { outcome: "failed", category: "database" });
    return reply({
      ok: false,
      category: "database",
      message: "The server could not reach the database in time. Nothing was saved. Your information is still here. Please press Retry.",
      retryable: true,
      reference,
    });
  }
  if (!context || context.mustResetPassword) {
    logJobCardAttempt(base, { outcome: "failed", category: "session" });
    return reply({
      ok: false,
      category: "session",
      message: "Your session has expired. Sign in again, then press Retry. Your information is still here.",
      retryable: true,
      reference,
    });
  }
  base.userId = context.userId;
  base.roleSlug = context.role?.slug ?? null;
  if (!context.permissions.includes("work_orders.manage") && context.role?.slug !== "super_admin") {
    logJobCardAttempt(base, { outcome: "failed", category: "permission" });
    return reply({
      ok: false,
      category: "permission",
      message: "You do not have permission to create Job Cards.",
      retryable: false,
      reference,
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > JOB_CARD_MAX_REQUEST_BYTES) {
    logJobCardAttempt(base, { outcome: "failed", category: "upload", step: 5, field: "attachments" });
    return reply({
      ok: false,
      category: "upload",
      message: "The attachments are too large to send together (60 MB in total). Remove or replace some files, then try again.",
      step: 5,
      field: "attachments",
      retryable: false,
      reference,
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // Body cut off (connection dropped mid-upload) or not multipart.
    logJobCardAttempt(base, { outcome: "failed", category: "upload" });
    return reply({
      ok: false,
      category: "upload",
      message: "The Job Card did not reach the server completely. Check your connection, then press Retry.",
      retryable: true,
      reference,
    });
  }

  const submissionId = formData.get("submission_id");
  if (!isSubmissionId(submissionId)) {
    logJobCardAttempt(base, { outcome: "failed", category: "bad_request", field: "submission_id" });
    return reply({
      ok: false,
      category: "bad_request",
      message: "This form is out of date. Please reload the page and enter the Job Card again.",
      retryable: false,
      reference,
    });
  }

  const result = await createJobCardFromForm(context, formData, {
    submissionId,
    correlationId: reference,
    route: "/api/job-cards",
    startedAt,
  });
  return reply(result);
}
