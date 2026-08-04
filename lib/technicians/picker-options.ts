import "server-only";

import { prisma } from "@/lib/db/prisma";

export type TechnicianPickerOption = {
  id: string;
  full_name: string;
};

// Performance Optimization Unit 3, Task 5: the "who can I assign this Job
// Card to" technician picker was duplicated (identical where/select/orderBy)
// across the Job Cards list, Job Card detail/quick-view, and Materials
// Requests list pages, each running its own unbounded findMany. Consolidated
// here so every entry point shares one query — same filtering as before
// (active, non-deleted profiles; no role filter, since none of the original
// call sites filtered by role either — this only lists who's assignable, it
// doesn't change who's allowed to be assigned) — plus a safe take limit so a
// pathologically large user base can't make this query unbounded.
const TECHNICIAN_PICKER_LIMIT = 500;

export async function getTechnicianPickerOptions(): Promise<TechnicianPickerOption[]> {
  return prisma.profiles.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, full_name: true },
    orderBy: { full_name: "asc" },
    take: TECHNICIAN_PICKER_LIMIT,
  });
}
