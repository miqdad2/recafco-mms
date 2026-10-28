/**
 * GET /api/job-cards/submissions/[submissionId]
 *
 * Answers "did this New Job Card submission create a Job Card?" for the
 * wizard after a request whose outcome it could not see (timeout, dropped
 * connection). Read-only. Only ever returns the caller's own Job Card,
 * through the normal Job Card visibility filter.
 */

import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/context";
import { findJobCardBySubmission } from "@/lib/backend/work-orders/job-card-creation";
import { isSubmissionId, type JobCardSubmissionStatusResponse } from "@/lib/work-orders/job-card-create-result";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reply(body: JobCardSubmissionStatusResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  if (!isSubmissionId(submissionId)) {
    return reply({ ok: false, category: "bad_request", message: "Unknown submission." }, 400);
  }

  let context: Awaited<ReturnType<typeof getCurrentUserContext>>;
  try {
    context = await getCurrentUserContext();
  } catch {
    return reply({ ok: false, category: "database", message: "The server could not check right now. Please try again." }, 503);
  }
  if (!context || context.mustResetPassword) {
    return reply({ ok: false, category: "session", message: "Your session has expired. Sign in again, then press Retry." }, 401);
  }
  if (!context.permissions.includes("work_orders.manage") && context.role?.slug !== "super_admin") {
    return reply({ ok: false, category: "permission", message: "You do not have permission to create Job Cards." }, 403);
  }

  try {
    const jobCard = await findJobCardBySubmission(context, submissionId);
    return reply(jobCard ? { ok: true, found: true, jobCard } : { ok: true, found: false });
  } catch {
    return reply({ ok: false, category: "database", message: "The server could not check right now. Please try again." }, 503);
  }
}
