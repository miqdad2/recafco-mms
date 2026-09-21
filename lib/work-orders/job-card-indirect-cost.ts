import "server-only";

import { prisma } from "@/lib/db/prisma";

// Job Card Level Indirect Cost Correction Unit 10G.72B, Task 2/6.
//
// Reads the ONE global, Job-Card-wide Indirect Cost setting from the
// app_settings singleton row (same row/id every other app-wide setting
// already uses — see lib/files/settings.ts's own getFileSecuritySettings
// for the established "read one field off the singleton" pattern this
// mirrors). This is deliberately NOT read from worker_profiles — Unit
// 10G.72's worker_profiles.indirect_cost_per_job_card/indirect_cost_note
// columns are left in the schema (unused) for backward compatibility, but
// nothing in this app reads them any more after this unit.
export type JobCardIndirectCostSetting = {
  amount: number;
  note: string | null;
};

export async function getJobCardIndirectCostSetting(): Promise<JobCardIndirectCostSetting> {
  const data = await prisma.app_settings.findUnique({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    select: { job_card_indirect_cost: true, job_card_indirect_cost_note: true },
  });
  return {
    amount: data ? Number(data.job_card_indirect_cost) : 0,
    note: data?.job_card_indirect_cost_note ?? null,
  };
}
