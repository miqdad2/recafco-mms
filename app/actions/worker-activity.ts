"use server";

import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkerActivityDetail, type WorkerActivityDetail } from "@/lib/work-orders/work-session-totals";

// Worker Activity Manager Hours and Payment Detail Unit 10C, Task 12.
//
// Gated on plain requireUser() — same "read-only, low-sensitivity" rationale
// already documented on getSessionsForAssignmentAction (app/actions/work-
// sessions.ts): this is a read of already-visible hours/pay figures, not a
// mutation. Any actual correction still goes through the existing, already
// manager-gated editWorkSessionAction/cancelWorkSessionAction (which
// independently re-check the caller's role server-side via assertIsManager)
// — this action never writes anything.
export async function getWorkerActivityDetailAction(workerId: string): Promise<WorkerActivityDetail> {
  await requireUser();
  return getWorkerActivityDetail(prisma, workerId);
}
