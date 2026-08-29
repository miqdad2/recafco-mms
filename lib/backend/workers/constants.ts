// Work Assignment and Worker Profiles Foundation Unit 7, Task 2/3.
//
// Client-safe (no "server-only") — split out of validators.ts so client
// components (Worker Profiles admin UI, Internal Team roster picker) can
// import these plain constants without pulling in server-only code, matching
// the existing lib/work-orders/simplified-status-display.ts /
// simplified-status.ts split (Unit 4).

export const WORKER_TYPES = ["Supervisor", "Technician", "Helper/Labor"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

// Worker Profile Form Simplification and Division Rename Unit 10G.6, Task 2:
// user-facing label is now "Division" everywhere (Worker Profiles form/list,
// assignment picker, Worker Activity filter) — this array's own name and the
// underlying skill_category DB column are unchanged (renaming the column
// isn't required or done here; only the label users see changed).
//
// Worker Division Dropdown Final Cleanup Unit 10G.41F, Task 1: final,
// closed list. "Civil" removed — it was never a real Division for this
// maintenance department. "Industrial" deliberately NOT added — Industrial
// Mechanic/Industrial Electrician are Job Titles, not Divisions (adding it
// here would make Data Entry confuse Industrial/Mechanical/Electrical).
// "Not specified" is now a real, listed option (not just an implicit
// blank/default) so Division can be a required field the user actively
// answers — see components/admin/worker-profile-form-modal.tsx's "Select
// division..." placeholder.
export const SKILL_CATEGORIES = ["Mechanical", "Electrical", "Auto", "General", "Other", "Not specified"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
