// Work Assignment and Worker Profiles Foundation Unit 7, Task 2/3.
//
// Client-safe (no "server-only") — split out of validators.ts so client
// components (Worker Profiles admin UI, Internal Team roster picker) can
// import these plain constants without pulling in server-only code, matching
// the existing lib/work-orders/simplified-status-display.ts /
// simplified-status.ts split (Unit 4).

export const WORKER_TYPES = ["Supervisor", "Technician", "Helper/Labor"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export const SKILL_CATEGORIES = ["Auto", "Mechanical", "Electrical", "Other"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
