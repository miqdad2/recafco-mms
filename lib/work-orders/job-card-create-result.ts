// Job Card Creation Reliability — the JSON contract between the New Job
// Card wizard and POST /api/job-cards (and GET /api/job-cards/submissions/
// [submissionId]). No server imports: the wizard imports these types too.

// Wizard steps, in order: 1 Select Asset, 2 Request Details, 3 Work Team &
// Assignment, 4 Required Materials, 5 Attachments, 6 Review & Save.
export type JobCardWizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type JobCardCreatedSummary = {
  id: string;
  number: string | null;
  status: string;
  isDraft: boolean;
  assetName: string | null;
  assetCode: string | null;
  // The saved complaint (or description of work when there is none).
  issue: string | null;
  maintenanceType: string | null;
  // yyyy-mm-dd
  dateOfOrder: string | null;
  workerTeam: string | null;
  // Names actually saved on the Job Card (Internal Team roster, or the
  // freelancer / company) — empty when nothing is assigned.
  assignedTeam: string[];
  // What is actually stored, so the wizard can compare it with what was
  // entered and never call an incomplete save complete.
  requiredMaterialsCount: number;
  materialsRequests: { number: string | null; status: string }[];
  attachmentsCount: number;
  // False while the request that created the Job Card may still be adding
  // the assignment, Materials Request and attachment files (only seen by a
  // retry or a status check that ran alongside it).
  finalized: boolean;
};

export type JobCardCreateWarnings = {
  attachmentsFailed: boolean;
  materialsRequestFailed: boolean;
  assignmentFailed: boolean;
};

export type JobCardFailureCategory =
  // A field is missing or invalid; nothing was saved. `step` and `field` say where.
  | "validation"
  // Not signed in any more; nothing was saved.
  | "session"
  // Signed in but not allowed to create Job Cards; nothing was saved.
  | "permission"
  // The upload did not arrive complete (connection dropped, too large); nothing was saved.
  | "upload"
  // Database busy / unreachable / transaction failed; nothing was saved.
  | "database"
  // Malformed request (missing submission id etc.); nothing was saved.
  | "bad_request"
  // Anything else.
  | "unexpected";

export type JobCardCreateResponse =
  | {
      ok: true;
      // true when this submission id had already created the Job Card (a
      // retry or a second click) and the existing one is returned.
      replayed: boolean;
      jobCard: JobCardCreatedSummary;
      warnings: JobCardCreateWarnings;
      reference: string;
    }
  | {
      ok: false;
      category: JobCardFailureCategory;
      message: string;
      step?: JobCardWizardStep;
      field?: string;
      retryable: boolean;
      // Short id printed in the server log line for this attempt.
      reference: string;
    };

export type JobCardSubmissionStatusResponse =
  | { ok: true; found: true; jobCard: JobCardCreatedSummary }
  | { ok: true; found: false }
  | { ok: false; category: "session" | "permission" | "bad_request" | "database"; message: string };

// Upper bound for one New Job Card request body (all attachments plus the
// form fields) — matches serverActions.bodySizeLimit / proxyClientMaxBodySize
// in next.config.ts.
export const JOB_CARD_MAX_REQUEST_BYTES = 60 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSubmissionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// crypto.randomUUID() only exists on HTTPS / localhost; this app is also
// opened over plain http on the factory network, where getRandomValues()
// still works.
export function newSubmissionId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fall through
    }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
