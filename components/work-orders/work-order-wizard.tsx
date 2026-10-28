"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";

import { searchOfflineInventoryMaterialsAction, getCostViewPermissionAction } from "@/app/actions/offline-inventory";
import { getUploadLimitsAction } from "@/app/actions/files";
import { ALLOWED_PRIVATE_FILE_TYPES, MAX_PRIVATE_FILE_SIZE } from "@/lib/files/validation";
import {
  JOB_CARD_MAX_REQUEST_BYTES,
  newSubmissionId,
  type JobCardCreatedSummary,
  type JobCardCreateResponse,
  type JobCardCreateWarnings,
  type JobCardSubmissionStatusResponse,
  type JobCardWizardStep,
} from "@/lib/work-orders/job-card-create-result";
import type { OfflineInventorySearchMatch } from "@/lib/store/offline-inventory-data";
import { AttachmentUploadFields } from "@/components/files/attachment-upload-fields";
import { AssetSearchPicker, type AssetPickerOption } from "@/components/assets/asset-search-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { JobCardCreatedSuccessDialog } from "@/components/work-orders/job-card-created-success-dialog";
import {
  ATTACHMENT_FILE_ACCEPT,
  JOB_CARD_ATTACHMENT_CATEGORIES,
  MAX_ATTACHMENT_ROWS,
} from "@/lib/files/attachment-constants";
import { MAINTENANCE_TYPES, DEFAULT_MAINTENANCE_TYPE } from "@/lib/work-orders/maintenance-types";
import { checkJobCardDateRange, formatJobCardDate, NOT_ENTERED } from "@/lib/work-orders/job-card-edit";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";
import { stockStatusLabel, stockStatusTone } from "@/components/store/offline-inventory-types";

// Required Materials Inventory Matching Unit 5 — Required Materials row
// state. New Job Card Required Materials Inventory Selection and Smart Unit
// UX: a row is a material SELECTED FROM INVENTORY (Inventory Control is the
// source of truth for materials and their units). A typed name with no
// selection is "not in Inventory" and blocks the step until the user adds
// it in Inventory and selects it. `unit` is the unit the quantity is
// entered in — only the material's Stock Unit or, when its Inventory unit
// setup has one, its Purchase Unit (converted to stock units for
// availability and on save).
type RequiredMaterialRowState = {
  description: string;
  partNumber: string;
  ssRecCode: string;
  qty: string;
  unit: string;
  notes: string;
  // Identity key of the Offline Inventory material the user selected
  // ("part:<id>" / "manual:<name>|<unit>") — null once the description is
  // typed or edited away from a selected suggestion.
  materialKey: string | null;
  balance: number | null;
  suggestions: OfflineInventorySearchMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
  // The selected material's Stock Unit and Inventory unit setup (purchase
  // unit + stock units inside 1 of it; both null = bought in the stock
  // unit). lastUnitCost is its last known cost per stock unit (Unit
  // 10G.61), read-only — never editable from this step.
  inventoryUnit: string | null;
  purchaseUnit: string | null;
  conversion: number | null;
  stockStatus: OfflineInventorySearchMatch["stock_status"] | null;
  lastUnitCost: number | null;
};

function emptyMaterialRow(): RequiredMaterialRowState {
  return {
    description: "",
    partNumber: "",
    ssRecCode: "",
    // Required Materials Empty Row Quantity UX Fix Unit 10F.5, Task 1: an
    // empty row must not look like a real material row with Qty 1 — blank
    // until the user actually selects a material.
    qty: "",
    unit: "",
    notes: "",
    materialKey: null,
    balance: null,
    suggestions: [],
    showSuggestions: false,
    loading: false,
    searched: false,
    inventoryUnit: null,
    purchaseUnit: null,
    conversion: null,
    stockStatus: null,
    lastUnitCost: null,
  };
}

// True when the row's quantity is entered in the material's Purchase Unit
// (so it is multiplied by the conversion to get stock units).
function usesPurchaseUnit(row: RequiredMaterialRowState): boolean {
  return (
    row.purchaseUnit !== null &&
    row.conversion !== null &&
    row.purchaseUnit !== row.inventoryUnit &&
    row.unit === row.purchaseUnit
  );
}

// Required stock quantity in the Stock Unit — what availability, shortage
// and the saved quantity_required use. null for a row not selected from
// Inventory.
function rowStockQty(row: RequiredMaterialRowState): number | null {
  if (row.materialKey === null) return null;
  const qty = Number(row.qty) || 0;
  return Math.round(qty * (usesPurchaseUnit(row) ? row.conversion! : 1) * 1e6) / 1e6;
}

// The unit choices for a selected material: Stock Unit first (the default
// — Job Card issue happens in it), then its Purchase Unit when different.
function unitOptionsFor(row: RequiredMaterialRowState): string[] {
  if (!row.inventoryUnit) return [];
  return row.purchaseUnit && row.conversion !== null && row.purchaseUnit !== row.inventoryUnit
    ? [row.inventoryUnit, row.purchaseUnit]
    : [row.inventoryUnit];
}

function fmtQty(n: number): string {
  return String(Number(n.toFixed(3)));
}

type RowAvailability =
  | { kind: "available" }
  | { kind: "partial"; shortage: number }
  | { kind: "unavailable"; shortage: number }
  | { kind: "not_in_inventory" };

function computeRowAvailability(row: RequiredMaterialRowState): RowAvailability | null {
  if (!row.description.trim()) return null;
  const required = rowStockQty(row);
  if (required === null || row.balance === null) return { kind: "not_in_inventory" };
  if (row.balance <= 0) return { kind: "unavailable", shortage: required };
  if (required <= row.balance) return { kind: "available" };
  return { kind: "partial", shortage: required - row.balance };
}

// Estimated Total = required stock quantity × the material's last known
// cost per stock unit; null (never 0) when unpriced. Planning only — the
// final cost comes from the real received/issued movements.
function rowEstimatedTotal(row: RequiredMaterialRowState): number | null {
  const required = rowStockQty(row);
  if (required === null || row.lastUnitCost === null) return null;
  return Math.round(required * row.lastUnitCost * 1000) / 1000;
}

// Worker Team / Division Option Cleanup: narrowed to the 4 options
// management wants offered for new Job Cards. The database still allows the
// full historical set (Civil/AC/Plumbing/Welding/Fabrication) via
// work_orders_worker_type_check — this list only controls what a NEW Job
// Card can select, it does not migrate or block existing records.
const WORKER_TYPES = ["Auto", "Mechanical", "Electrical", "Other"];
// One plain line per team so staff can pick the right one.
const WORKER_TYPE_HINTS: Record<string, string> = {
  Auto: "Vehicles — cars, pickups, buses, lorries, trailers.",
  Mechanical: "Machines and equipment — engines, pumps, hydraulics, moving parts.",
  Electrical: "Wiring, motors, panels, lights and other electrical faults.",
  Other: "Anything that does not fit the teams above.",
};
const STEP_LABELS = ["Select Asset", "Request Details", "Work Team & Assignment", "Required Materials", "Attachments", "Review & Save"];
const MAX_PART_ROWS = 8;

// Optional Work Assignment During Job Card Creation Unit 7C.
//
// "INTERNAL_TEAM" here means the Unit 7 worker_profiles-backed roster
// (Supervisor/Technicians/Helpers, saved via assignInternalTeamRoster) —
// distinct from the legacy single-technician "INTERNAL_TECHNICIAN" type the
// Job Card detail page's separate "Assign Work" panel still uses for
// technician self-service login linkage. Freelancer/External Company here
// reuse that same legacy work_order_assignments mechanism (assignTechnicians)
// since Unit 7 already added everything they need (agreed_amount).
type WizardAssignmentType = "INTERNAL_TEAM" | "FREELANCER" | "EXTERNAL_COMPANY";

const ASSIGNMENT_TYPE_OPTIONS: { value: WizardAssignmentType; label: string }[] = [
  { value: "INTERNAL_TEAM", label: "Internal Team" },
  { value: "FREELANCER", label: "Freelancer" },
  { value: "EXTERNAL_COMPANY", label: "External Company" },
];

type WizardAssignmentState = {
  assignNow: boolean;
  type: WizardAssignmentType;
  supervisorId: string;
  technicianIds: string[];
  helperIds: string[];
  notes: string;
  freelancerName: string;
  freelancerPhone: string;
  freelancerTrade: string;
  freelancerAmount: string;
  companyName: string;
  companyContact: string;
  companyPhone: string;
  companyTrade: string;
  companyAmount: string;
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 2:
  // keyed by worker_profiles.id, string (raw input) values so an in-progress
  // "1." or empty field doesn't get coerced away mid-typing — parsed to a
  // number only at submit time (parseWorkerEstimates in app/actions/
  // maintenance.ts) and for the live sum/warning below.
  workerEstimates: Record<string, string>;
};

const EMPTY_ASSIGNMENT: WizardAssignmentState = {
  assignNow: false,
  type: "INTERNAL_TEAM",
  supervisorId: "",
  technicianIds: [],
  helperIds: [],
  notes: "",
  freelancerName: "",
  freelancerPhone: "",
  freelancerTrade: "",
  freelancerAmount: "",
  companyName: "",
  companyContact: "",
  companyPhone: "",
  companyTrade: "",
  companyAmount: "",
  workerEstimates: {},
};

type AssetOption = AssetPickerOption;

// Smart Meter Field Unit 10G.60, Task 2/3/4 — the exact leaf asset-type
// strings assets actually carry today (lib/assets/asset-excel-mapping.ts's
// ASSET_TYPE_DISPLAY_ORDER, the same list driving the New/Edit Asset Type
// dropdown and the Excel importer's TYPE_MAP) split into vehicle-like
// (Kilometers) and equipment-like (Running Hours). assets.category is free
// text with no DB CHECK constraint — a type outside both lists (a custom
// type, "Needs Review", null/blank) falls back to the Meter Reading Type
// dropdown below rather than guessing.
const VEHICLE_ASSET_TYPES = ["Car", "Pickup", "Bus", "Half Lorry", "Tanker", "Trailer"];
const EQUIPMENT_ASSET_TYPES = [
  "Generator",
  "Bobcat",
  "Crane",
  "Forklift",
  "Compressor",
  "Tower Light",
  "Welding Machine",
  "Manlift",
  "Loader",
];

type MeterKind = "km" | "hours" | "unknown";

function meterKindForAsset(category: string | null | undefined): MeterKind {
  if (category && VEHICLE_ASSET_TYPES.includes(category)) return "km";
  if (category && EQUIPMENT_ASSET_TYPES.includes(category)) return "hours";
  return "unknown";
}

// ── Reliable save (Job Card Creation Reliability) ─────────────────────────────
//
// The final save posts the form to POST /api/job-cards with a submission id
// that stays the same for every retry of this one Job Card and changes only
// when a fresh wizard starts ("Create Another", or closing and reopening).
// The server uses it to return the already-created Job Card instead of
// creating a second one, so a retry can never duplicate. When a request's
// outcome is unknown (connection dropped, no answer in time), the wizard
// first asks GET /api/job-cards/submissions/[id] whether it went through.

// Show "Still creating…" after this long.
const SLOW_SAVE_MS = 8_000;
// Give up waiting for an answer this long after the upload finished.
const RESPONSE_TIMEOUT_MS = 90_000;
// Give up when the upload makes no progress for this long.
const UPLOAD_STALL_MS = 60_000;
const STATUS_CHECK_TIMEOUT_MS = 15_000;

type SendOutcome =
  | { kind: "answer"; body: JobCardCreateResponse }
  // Redirected to the sign-in page by the proxy (no session cookie).
  | { kind: "signed_out" }
  // No usable answer: connection error, timeout, or a non-JSON error page
  // from something in between. The Job Card may or may not exist.
  | { kind: "unknown"; reason: "network" | "timeout" | "bad_response" };

function sendJobCard(formData: FormData, onUploadProgress: (fraction: number) => void): Promise<SendOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: SendOutcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        finish({ kind: "unknown", reason: "timeout" });
        xhr.abort();
      }, ms);
    };

    xhr.open("POST", "/api/job-cards");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onUploadProgress(e.loaded / e.total);
      arm(UPLOAD_STALL_MS);
    };
    xhr.upload.onload = () => {
      onUploadProgress(1);
      arm(RESPONSE_TIMEOUT_MS);
    };
    xhr.onerror = () => finish({ kind: "unknown", reason: "network" });
    xhr.onabort = () => finish({ kind: "unknown", reason: "network" });
    xhr.onload = () => {
      if (xhr.responseURL && new URL(xhr.responseURL).pathname === "/login") {
        finish({ kind: "signed_out" });
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as JobCardCreateResponse;
        if (body && typeof body === "object" && typeof body.ok === "boolean") {
          finish({ kind: "answer", body });
          return;
        }
      } catch {
        // not JSON
      }
      finish({ kind: "unknown", reason: "bad_response" });
    };
    arm(UPLOAD_STALL_MS);
    xhr.send(formData);
  });
}

type StatusOutcome =
  | { kind: "found"; jobCard: JobCardCreatedSummary }
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "unknown" };

async function checkSubmission(submissionId: string): Promise<StatusOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/job-cards/submissions/${submissionId}`, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.type === "opaqueredirect" || res.status === 401) return { kind: "signed_out" };
    const body = (await res.json()) as JobCardSubmissionStatusResponse;
    if (body.ok) return body.found ? { kind: "found", jobCard: body.jobCard } : { kind: "not_found" };
    return body.category === "session" ? { kind: "signed_out" } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

type SaveIntent = "save_draft" | "submit_for_approval";

type SavePhase =
  | { kind: "idle" }
  | { kind: "saving"; intent: SaveIntent; slow: boolean; upload: number | null }
  | { kind: "checking" }
  | {
      kind: "failed";
      // "uncertain": we could not confirm either way and the server could not be asked yet.
      tone: "failed" | "uncertain" | "session" | "validation";
      message: string;
      reference?: string;
      step?: JobCardWizardStep;
      canRetry: boolean;
    }
  | {
      kind: "success";
      jobCard: JobCardCreatedSummary;
      warnings: JobCardCreateWarnings | null;
      // Found by a retry / status check rather than created by this answer.
      replayed: boolean;
      requested: SaveRequest;
    };

// What the user asked to save, captured when Create / Save Draft is pressed,
// so the confirmation can compare it with what the server actually stored.
type SaveRequest = { assignment: boolean; materials: number; attachments: number };

// How long a confirmation waits for the original request to finish its
// follow-up steps (assignment, Materials Request, files) before reporting
// what is stored.
const FINALIZE_WAIT_MS = 20_000;

// ── Local draft (refresh / accidental close) ──────────────────────────────────
//
// Text and selections only — never files, passwords or tokens — kept per user
// in this browser and removed on a successful save, Discard, or Start fresh.
// It is only ever restored when the user presses Restore; nothing is sent.

const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type RequestFields = {
  ordered_by: string;
  date_of_order: string;
  // Optional Job Card calendar dates (not worker time) — YYYY-MM-DD or "".
  job_card_start_date: string;
  job_card_end_date: string;
  maintenance_type: string;
  operator_complaint: string;
  description_of_work: string;
  kilometers: string;
  running_hours: string;
};

type StoredMaterialRow = Pick<
  RequiredMaterialRowState,
  | "description"
  | "partNumber"
  | "ssRecCode"
  | "qty"
  | "unit"
  | "notes"
  | "materialKey"
  | "balance"
  | "inventoryUnit"
  | "purchaseUnit"
  | "conversion"
  | "stockStatus"
  | "lastUnitCost"
>;

type StoredDraft = {
  v: number;
  savedAt: number;
  submissionId: string;
  step: number;
  selectedAssetId: string;
  fields: RequestFields;
  jobLocation: string;
  jobLocationTouched: boolean;
  meterReadingType: "none" | "km" | "hours";
  workerTeam: string;
  assignment: WizardAssignmentState;
  numPartRows: number;
  partRows: StoredMaterialRow[];
};

function draftStorageKey(userId: string | undefined): string | null {
  return userId ? `recafco.newJobCardDraft.v${DRAFT_VERSION}.${userId}` : null;
}

function readDraft(key: string | null): StoredDraft | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    if (d?.v !== DRAFT_VERSION || typeof d.savedAt !== "number" || Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function writeDraft(key: string | null, draft: StoredDraft) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // storage full / blocked — the draft is a convenience only
  }
}

function clearDraft(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function formatBytesShort(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : Number(mb.toFixed(1))} MB`;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, errorStep }: { current: number; errorStep?: number | null }) {
  return (
    <nav aria-label="Wizard progress">
      <ol className="flex items-start">
        {STEP_LABELS.map((label, idx) => {
          const n = idx + 1;
          const done = n < current;
          const active = n === current;
          const hasError = errorStep === n;
          return (
            <li key={label} className="flex flex-1 items-start min-w-0">
              <div className="flex flex-col items-center">
                <div
                  aria-label={hasError ? `${label}: needs attention` : undefined}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                    hasError
                      ? "border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]"
                      : done
                      ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                      : active
                      ? "border-[#ED1C24] bg-white text-[#ED1C24]"
                      : "border-[#E5E7EB] bg-white text-[#9CA3AF]"
                  }`}
                >
                  {done && !hasError ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
                </div>
                <span
                  className={`mt-1 hidden text-center text-[11px] font-semibold leading-tight sm:block ${
                    active ? "text-[#ED1C24]" : done ? "text-[#111827]" : "text-[#9CA3AF]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {n < STEP_LABELS.length && (
                <div
                  className={`mx-1 mt-4 h-0.5 flex-1 transition-colors ${
                    done ? "bg-[#ED1C24]" : "bg-[#E5E7EB]"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Shared style tokens ───────────────────────────────────────────────────────

// 16px text on phones (smaller makes iOS zoom in on focus), 44px tall.
const inp =
  "focus-ring mt-1 min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base sm:text-sm";
const ta =
  "focus-ring mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base sm:text-sm min-h-[5.5rem] resize-y";
// Small grey help line under a field.
const helpCls = "mt-1 text-xs leading-relaxed text-[#6B7280]";
// A radio choice drawn as a large, easy-to-tap option.
const choiceCls =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] hover:border-[#9CA3AF] has-[:checked]:border-[#ED1C24] has-[:checked]:bg-[#FEF2F2] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#ED1C24]/40";
// Added to a field's classes while it has an error.
const invalidCls = "border-[#DC2626] ring-1 ring-[#DC2626] bg-[#FEF2F2]";

// ── Main wizard export ────────────────────────────────────────────────────────

type WorkOrderWizardProps = {
  assets: AssetOption[];
  preselectedAssetId?: string | null;
  dismissHref: string;
  activeWorkers?: WorkerProfileRow[];
  canAssignAtCreation?: boolean;
  // Keys the local draft to the signed-in user, so a shared PC never offers
  // one user's unsaved Job Card to another. No draft is kept without it.
  currentUserId?: string;
};

// "Create Another Job Card" remounts the wizard with a new key: every field,
// the attachments and the submission id start completely fresh.
export function WorkOrderWizard(props: WorkOrderWizardProps) {
  const [instance, setInstance] = useState(0);
  return (
    <WizardBody
      key={instance}
      {...props}
      preselectedAssetId={instance === 0 ? props.preselectedAssetId : null}
      offerStoredDraft={instance === 0}
      onCreateAnother={() => setInstance((n) => n + 1)}
    />
  );
}

function WizardBody({
  assets,
  preselectedAssetId,
  dismissHref,
  activeWorkers = [],
  canAssignAtCreation = false,
  currentUserId,
  offerStoredDraft,
  onCreateAnother,
}: {
  currentUserId?: string;
  offerStoredDraft: boolean;
  onCreateAnother: () => void;
  assets: AssetOption[];
  preselectedAssetId?: string | null;
  // New Job Card Modal Wizard Refactor: where "Cancel"/"X"/"Discard and Exit"
  // navigate to once the modal is dismissed — the Job Cards list when opened
  // from its own standalone route, or the current page with the modal's own
  // query param stripped when opened as an overlay from Dashboard/Asset
  // Details/Vehicles.
  dismissHref: string;
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10:
  // omitted/false for any caller that can't hold work_orders.assign — the
  // "Assign work now" section simply never renders for them.
  activeWorkers?: WorkerProfileRow[];
  canAssignAtCreation?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId ?? "");
  // Smart Meter Field Unit 10G.60, Task 4/6 — meterReadingType only matters
  // for an "unknown" asset type (Task 4's fallback dropdown), defaulting to
  // "Not Applicable" so nothing is guessed; reset whenever the selected
  // asset changes so a stale choice from a previous unknown asset never
  // carries over. jobLocationTouched flips true only from the field's own
  // onChange (a real keystroke) — the asset-driven autofill below sets the
  // state directly, which never fires onChange, so it can never mark the
  // field "touched" itself (Task 6: never overwrite something the user
  // typed).
  const [meterReadingType, setMeterReadingType] = useState<"none" | "km" | "hours">("none");
  const [jobLocation, setJobLocation] = useState("");
  const [jobLocationTouched, setJobLocationTouched] = useState(false);
  // Unit 10F.5, Task 3 (Recommended): one empty row by default + Add Row,
  // instead of 3 always-visible rows that looked like real material lines.
  const [numPartRows, setNumPartRows] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Request Details fields — controlled so validation, Review & Save and
  // the local draft all read one source.
  const [fields, setFields] = useState<RequestFields>(() => ({
    ordered_by: "",
    date_of_order: new Date().toISOString().slice(0, 10),
    job_card_start_date: "",
    job_card_end_date: "",
    maintenance_type: DEFAULT_MAINTENANCE_TYPE,
    operator_complaint: "",
    description_of_work: "",
    kilometers: "",
    running_hours: "",
  }));
  // The two Job Card dates are checked together, so changing either one
  // clears a range message shown on the other.
  function updateJobCardDate(name: "job_card_start_date" | "job_card_end_date", value: string) {
    setFields((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev.job_card_start_date && !prev.job_card_end_date) return prev;
      const next = { ...prev };
      delete next.job_card_start_date;
      delete next.job_card_end_date;
      return next;
    });
  }
  function updateField(name: keyof RequestFields, value: string) {
    setFields((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }
  // Job Card Creation Reliability — see "Reliable save" above.
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [phase, setPhase] = useState<SavePhase>({ kind: "idle" });
  // Set synchronously on the first click, before React re-renders, so a
  // double click can never start two saves.
  const inFlightRef = useRef(false);
  // True once a request for this submission id may have reached the server
  // without us seeing the answer — the next attempt asks the server first.
  const outcomeUnknownRef = useRef(false);
  // The failure dialog closed with "Back to Job Card" for this exact failure;
  // a new failure (a new phase object) opens it again.
  const [dismissedFailure, setDismissedFailure] = useState<SavePhase | null>(null);
  const busy = phase.kind === "saving" || phase.kind === "checking";
  const saved = phase.kind === "success";
  const draftKey = draftStorageKey(currentUserId);
  const [storedDraft, setStoredDraft] = useState<StoredDraft | null>(null);
  // Set on Discard / successful save: no pending draft write may bring the
  // draft back while the page is navigating away.
  const draftStoppedRef = useRef(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Cancel/Close Confirmation Task 8: only interrupt with a confirmation
  // dialog once the user has actually entered something — a fresh, untouched
  // wizard can be dismissed immediately with nothing to lose.
  const [dirty, setDirty] = useState(false);

  // Required Materials Inventory Matching Unit 5, Tasks 3–5.
  const [partRows, setPartRows] = useState<RequiredMaterialRowState[]>(
    () => Array.from({ length: MAX_PART_ROWS }, () => emptyMaterialRow())
  );

  // Optional Work Assignment During Job Card Creation Unit 7C.
  const [assignment, setAssignment] = useState<WizardAssignmentState>(EMPTY_ASSIGNMENT);
  function updateAssignment(patch: Partial<WizardAssignmentState>) {
    setAssignment((prev) => ({ ...prev, ...patch }));
  }
  // Simplify Assignment Picker Unit 7D, Task 5: lifted from an uncontrolled
  // radio to state so the worker picker can sort matching skill_category
  // workers first — the field itself still submits identically via the same
  // `name="worker_type"` radios.
  const [workerTeam, setWorkerTeam] = useState("Mechanical");
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchSeq = useRef<Record<number, number>>({});

  // Job Card Required Materials Estimated Cost Visibility Unit 10G.73
  // (second unit of this name), Task 5 — fetched once on mount; defaults to
  // false (no cost UI) until resolved, so a non-cost-permitted viewer never
  // sees so much as a flash of cost fields.
  const [canViewCosts, setCanViewCosts] = useState(false);
  // Real per-file upload limit (Admin Settings); the built-in default until it loads.
  const [uploadMaxFileBytes, setUploadMaxFileBytes] = useState(MAX_PRIVATE_FILE_SIZE);
  useEffect(() => {
    let cancelled = false;
    getUploadLimitsAction()
      .then((l) => {
        if (!cancelled) setUploadMaxFileBytes(l.maxFileBytes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    getCostViewPermissionAction()
      .then((v) => {
        if (!cancelled) setCanViewCosts(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  function updateRow(index: number, patch: Partial<RequiredMaterialRowState>) {
    setPartRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    // Editing a line clears the message shown under it.
    if ("qty" in patch || "unit" in patch || "description" in patch || "materialKey" in patch) {
      const key = `req_row_${index}`;
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // Highlighted suggestion while choosing a material with the arrow keys.
  const [activeSuggestion, setActiveSuggestion] = useState<{ row: number; index: number }>({ row: -1, index: 0 });

  // Removes one material line; the lines below move up and an empty line is
  // added at the end, so the posted req_part_*_<n> fields stay contiguous.
  function removeMaterialRow(index: number) {
    // Cancel pending searches so a late answer cannot land on a moved line.
    Object.values(searchTimers.current).forEach((t) => clearTimeout(t));
    for (let k = 0; k < MAX_PART_ROWS; k++) searchSeq.current[k] = (searchSeq.current[k] ?? 0) + 1;
    setPartRows((prev) => [...prev.slice(0, index), ...prev.slice(index + 1), emptyMaterialRow()]);
    setNumPartRows((n) => Math.max(1, n - 1));
    // Line numbers shift, so per-line messages no longer point at the right line.
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith("req_row_"))));
    setConfirmRemoveRow(null);
    setDirty(true);
  }

  // A line with a material in it asks once before it is removed; an empty
  // line goes straight away.
  const [confirmRemoveRow, setConfirmRemoveRow] = useState<number | null>(null);
  function requestRemoveMaterialRow(index: number) {
    if (partRows[index]?.description.trim()) setConfirmRemoveRow(index);
    else removeMaterialRow(index);
  }

  function handleMaterialNameChange(index: number, value: string) {
    // Unit 10F.5, Task 2: quantity only ever defaults to 1 once the user has
    // actually entered a material name, and only if they haven't already
    // typed a quantity of their own — clearing the name back to blank does
    // not clear a quantity the user already entered.
    const currentQty = partRows[index]?.qty ?? "";
    const shouldDefaultQty = value.trim() !== "" && currentQty.trim() === "";
    // Task 5: editing the name after a suggestion was selected clears the
    // link — the row goes back to "New Material" until re-matched. Unit
    // 10G.73 (second unit of this name): inventoryUnit/lastUnitCost are
    // cleared alongside materialKey/balance — they describe THAT match, not
    // whatever gets typed next.
    // Typing unlinks the row: it is "not in Inventory" until a suggestion
    // is selected, and its units/part number are cleared with the link.
    updateRow(index, {
      description: value,
      partNumber: "",
      ssRecCode: "",
      unit: "",
      materialKey: null,
      balance: null,
      inventoryUnit: null,
      purchaseUnit: null,
      conversion: null,
      stockStatus: null,
      lastUnitCost: null,
      showSuggestions: true,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });
    setDirty(true);

    if (searchTimers.current[index]) clearTimeout(searchTimers.current[index]);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      updateRow(index, { suggestions: [], loading: false, searched: false });
      return;
    }

    updateRow(index, { loading: true });
    const seq = (searchSeq.current[index] ?? 0) + 1;
    searchSeq.current[index] = seq;

    searchTimers.current[index] = setTimeout(async () => {
      try {
        const results = await searchOfflineInventoryMaterialsAction(trimmed);
        // Ignore stale responses from an earlier keystroke that resolved late.
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: results, loading: false, searched: true });
      } catch {
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: [], loading: false, searched: true });
      }
    }, 300);
  }

  function handleSelectSuggestion(index: number, match: OfflineInventorySearchMatch) {
    // Task 2 — selecting a suggestion counts as entering a material name too.
    const currentQty = partRows[index]?.qty ?? "";
    const shouldDefaultQty = currentQty.trim() === "";
    // Everything comes from the Inventory record: name, part number, SS
    // Rec. Code, balance, Stock Unit (the default unit) and its unit setup.
    updateRow(index, {
      description: match.display_name,
      partNumber: match.part_number ?? "",
      ssRecCode: match.ss_rec_code ?? "",
      unit: match.unit,
      materialKey: match.key,
      balance: match.balance,
      inventoryUnit: match.unit,
      purchaseUnit: match.purchase_unit,
      conversion: match.conversion_quantity,
      stockStatus: match.stock_status,
      lastUnitCost: match.last_unit_cost,
      suggestions: [],
      showSuggestions: false,
      searched: false,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });
  }

  function requestClose() {
    // Never close while a save may still be in progress — the Job Card may
    // be committing right now.
    if (busy) return;
    if (saved) {
      router.push(dismissHref);
      return;
    }
    if (dirty) {
      setShowCancelConfirm(true);
    } else {
      router.push(dismissHref);
    }
  }

  function discardAndExit() {
    draftStoppedRef.current = true;
    clearDraft(draftKey);
    router.push(dismissHref);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A search list that closed itself on this Escape marks it handled.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // The created popup handles its own Escape.
      if (saved) return;
      if (showCancelConfirm) {
        setShowCancelConfirm(false);
      } else {
        requestClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCancelConfirm, dirty, busy, saved]);

  // Browser refresh / tab close with unsaved information, or mid-save.
  useEffect(() => {
    if (saved || (!dirty && !busy)) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, busy, saved]);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;
  const meterKind = meterKindForAsset(selectedAsset?.category);
  // Which meter input is on screen (and therefore submitted), if any.
  const showKilometers = meterKind === "km" || (meterKind === "unknown" && meterReadingType === "km");
  const showRunningHours = meterKind === "hours" || (meterKind === "unknown" && meterReadingType === "hours");

  // Smart Meter Field Unit 10G.60, Task 4/6 — "adjusting state when a prop
  // changes" during render (React's recommended alternative to an effect
  // for this exact case: https://react.dev/learn/you-might-not-need-an-effect)
  // rather than a useEffect, so there's no extra render pass. Whenever the
  // selected asset changes: reset the unknown-type fallback dropdown back
  // to "Not Applicable" (never carries a previous asset's choice), and
  // auto-fill Job location from the asset's own Current Location, but only
  // while the user hasn't typed one themselves (jobLocationTouched).
  const [lastSyncedAssetId, setLastSyncedAssetId] = useState(selectedAssetId);
  if (selectedAssetId !== lastSyncedAssetId) {
    setLastSyncedAssetId(selectedAssetId);
    setMeterReadingType("none");
    if (!jobLocationTouched && selectedAsset?.location) {
      setJobLocation(selectedAsset.location);
    }
  }

  // ── Local draft ──────────────────────────────────────────────────────────
  // Offer a draft left behind by a refresh / accidental close (first wizard
  // instance only — "Create Another" always starts empty).
  useEffect(() => {
    if (!offerStoredDraft) return;
    const d = readDraft(draftKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    if (d) setStoredDraft(d);
  }, [offerStoredDraft, draftKey]);

  useEffect(() => {
    // Once the user types, their new work replaces any older stored draft.
    if (!dirty || saved) return;
    const t = setTimeout(() => {
      if (draftStoppedRef.current) return;
      writeDraft(draftKey, {
        v: DRAFT_VERSION,
        savedAt: Date.now(),
        submissionId,
        step,
        selectedAssetId,
        fields,
        jobLocation,
        jobLocationTouched,
        meterReadingType,
        workerTeam,
        assignment,
        numPartRows,
        partRows: partRows.map((r) => ({
          description: r.description,
          partNumber: r.partNumber,
          ssRecCode: r.ssRecCode,
          qty: r.qty,
          unit: r.unit,
          notes: r.notes,
          materialKey: r.materialKey,
          balance: r.balance,
          inventoryUnit: r.inventoryUnit,
          purchaseUnit: r.purchaseUnit,
          conversion: r.conversion,
          stockStatus: r.stockStatus,
          lastUnitCost: r.lastUnitCost,
        })),
      });
    }, 500);
    return () => clearTimeout(t);
  }, [dirty, saved, draftKey, submissionId, step, selectedAssetId, fields, jobLocation, jobLocationTouched, meterReadingType, workerTeam, assignment, numPartRows, partRows]);

  function restoreStoredDraft() {
    const d = storedDraft;
    if (!d) return;
    // The same submission id: if the browser was refreshed while a save was
    // in flight, saving again returns that Job Card instead of a duplicate.
    setSubmissionId(d.submissionId);
    outcomeUnknownRef.current = true;
    setSelectedAssetId(d.selectedAssetId);
    setLastSyncedAssetId(d.selectedAssetId);
    // A draft saved before the Job Card Start / End Date fields existed has
    // no such keys — default them to "not entered".
    const notEnteredDates = { job_card_start_date: "", job_card_end_date: "" };
    setFields({ ...notEnteredDates, ...d.fields });
    setJobLocation(d.jobLocation);
    setJobLocationTouched(d.jobLocationTouched);
    setMeterReadingType(d.meterReadingType);
    setWorkerTeam(d.workerTeam);
    setAssignment({ ...EMPTY_ASSIGNMENT, ...d.assignment });
    setNumPartRows(Math.min(Math.max(d.numPartRows, 1), MAX_PART_ROWS));
    setPartRows(
      Array.from({ length: MAX_PART_ROWS }, (_, i) => ({ ...emptyMaterialRow(), ...(d.partRows[i] ?? {}) }))
    );
    setStep(Math.min(Math.max(d.step, 1), 6));
    setErrors({});
    setDirty(true);
    setStoredDraft(null);
  }

  function discardStoredDraft() {
    clearDraft(draftKey);
    setStoredDraft(null);
  }

  // ── Validation ───────────────────────────────────────────────────────────
  // Problems on one step, keyed by field name; the first key is the field to
  // highlight. Used by Next (current step) and by the final save (every step).
  // Pure: reads state only. The Attachments check gets the chosen files
  // from the caller (an event handler), so this can also run during render.
  function stepErrors(n: number, files: File[] = []): Record<string, string> {
    const errs: Record<string, string> = {};

    if (n === 1) {
      if (!selectedAssetId) errs.asset_id = "Please select an asset.";
      else if (!selectedAsset) errs.asset_id = "The selected asset is no longer in the list. Please select the asset again.";
    }

    if (n === 2) {
      // Same rule as the server: at least 2 characters.
      if (fields.ordered_by.trim().length < 2) errs.ordered_by = "Please enter who took the order (at least 2 letters).";
      if (!fields.date_of_order.trim()) errs.date_of_order = "Please enter the date of order.";
      // Same rule as the server (lib/work-orders/job-card-edit.ts).
      const dateProblem = checkJobCardDateRange(fields.job_card_start_date, fields.job_card_end_date);
      if (dateProblem) errs[dateProblem.field] = dateProblem.message;
      if (showKilometers && fields.kilometers.trim() && !isPlainNumber(fields.kilometers)) {
        errs.kilometers = "Please check the kilometer reading. Use numbers only, without commas or letters — for example 45000 or 45000.5.";
      }
      if (showRunningHours && fields.running_hours.trim() && !isPlainNumber(fields.running_hours)) {
        errs.running_hours = "Please check the running hours. Use numbers only, without commas or letters — for example 1250 or 1250.5.";
      }
      if (!fields.operator_complaint.trim()) errs.operator_complaint = "Please enter the operator complaint.";
    }

    if (n === 3) {
      if (!workerTeam.trim()) errs.worker_type = "Please select a maintenance team.";

      // Optional Work Assignment During Job Card Creation Unit 7C, Task 3/4/5:
      // fields are only required once "Assign work now" is on, and only for
      // whichever assignment type is currently selected.
      if (assignment.assignNow && canAssignAtCreation) {
        if (assignment.type === "INTERNAL_TEAM") {
          const ids = [
            ...(assignment.supervisorId ? [assignment.supervisorId] : []),
            ...assignment.technicianIds,
            ...assignment.helperIds,
          ];
          const missing = ids.find((id) => !activeWorkers.some((w) => w.id === id));
          const badEstimate = ids
            .map((id) => activeWorkers.find((w) => w.id === id))
            .find((w) => {
              const raw = (w ? assignment.workerEstimates[w.id] : "")?.trim() ?? "";
              return w && raw !== "" && !isPlainNumber(raw);
            });
          if (ids.length === 0) errs.assignment = "Select at least one worker or turn off Assign work now.";
          else if (missing) errs.assignment = "One selected worker is no longer available. Please review Work Team & Assignment.";
          else if (badEstimate) errs.assignment = `Please check the expected hours for ${badEstimate.name}. Use numbers only — for example 2 or 1.5.`;
        }
        if (assignment.type === "FREELANCER") {
          if (!assignment.freelancerName.trim()) errs.assignment = "Freelancer name is required.";
          else if (assignment.freelancerAmount.trim() && !isPlainNumber(assignment.freelancerAmount)) {
            errs.assignment = "Please check the agreed amount. Use numbers only — for example 25 or 25.500.";
          }
        }
        if (assignment.type === "EXTERNAL_COMPANY") {
          if (!assignment.companyName.trim()) errs.assignment = "Company name is required.";
          else if (assignment.companyAmount.trim() && !isPlainNumber(assignment.companyAmount)) {
            errs.assignment = "Please check the agreed amount. Use numbers only — for example 25 or 25.500.";
          }
        }
      }
    }

    if (n === 4) {
      // Unit 10F.5, Task 6: a completely blank row (no description) never
      // blocks Next. A row WITH a material name must be chosen from
      // Inventory and needs a quantity greater than 0 that comes to a whole
      // number of the stock unit (the server rule: e.g. 1.5 BOX of 10 PCS =
      // 15 PCS is fine). Every problem row gets its own message, shown under
      // that row (key req_row_<index>).
      for (let i = 0; i < numPartRows; i++) {
        const row = partRows[i];
        if (!row || !row.description.trim()) continue;
        const name = row.description.trim();
        if (row.materialKey === null) {
          errs[`req_row_${i}`] = `"${name}" is not chosen from Inventory. Pick it from the list, or add it to Inventory first.`;
          continue;
        }
        const qtyRaw = row.qty.trim();
        if (!qtyRaw) {
          errs[`req_row_${i}`] = `Enter the quantity needed for "${name}".`;
          continue;
        }
        if (!isPlainNumber(qtyRaw) || Number(qtyRaw) <= 0) {
          errs[`req_row_${i}`] = `Please check the quantity for "${name}". Use a number greater than 0 — for example 2 or 1.5.`;
          continue;
        }
        // Issued in whole stock units (the existing whole-quantity rule,
        // applied after conversion).
        const required = rowStockQty(row);
        if (required !== null && !Number.isInteger(required)) {
          errs[`req_row_${i}`] = `Please check the quantity for "${name}": it must come to a whole number of ${row.inventoryUnit} (now ${fmtQty(required)} ${row.inventoryUnit}).`;
        }
      }
    }

    if (n === 5) {
      const refused = files.find((f) => !ALLOWED_PRIVATE_FILE_TYPES.has(f.type));
      const tooBig = files.find((f) => f.size > uploadMaxFileBytes);
      if (refused) {
        errs.attachments = `"${refused.name}" cannot be attached — only photos (JPG, PNG, WEBP), PDF, Excel and Word files are allowed. Remove it to continue.`;
        return errs;
      }
      if (tooBig) {
        errs.attachments = `"${tooBig.name}" is ${formatBytesShort(tooBig.size)} — the limit is ${formatBytesShort(uploadMaxFileBytes)} per file. Remove it or choose a smaller file.`;
        return errs;
      }
      const total = files.reduce((sum, f) => sum + f.size, 0);
      // Leave room for the form fields and multipart overhead.
      if (total > JOB_CARD_MAX_REQUEST_BYTES - 512 * 1024) {
        errs.attachments = `The attachments are ${formatBytesShort(total)} together — more than can be sent at once (${formatBytesShort(JOB_CARD_MAX_REQUEST_BYTES)}). Remove or replace some files.`;
      }
    }

    return errs;
  }

  // The files currently chosen on the Attachments step (event handlers only).
  function chosenFiles(): File[] {
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? [];
    return Array.from(inputs).flatMap((input) => Array.from(input.files ?? []));
  }

  function showErrorsOn(n: number, errs: Record<string, string>) {
    setStep(n);
    setErrors(errs);
    const field = Object.keys(errs)[0];
    // After the step is visible: bring the first problem into view.
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const focusable = el.matches("input,textarea,select,button") ? el : el.querySelector<HTMLElement>("input,textarea,select,button");
      focusable?.focus({ preventScroll: true });
    });
  }

  function validate(): boolean {
    const errs = stepErrors(step, chosenFiles());
    if (Object.keys(errs).length) {
      showErrorsOn(step, errs);
      return false;
    }
    setErrors({});
    return true;
  }

  // Every step, first to last; on a problem, go there with the form intact.
  function validateAllSteps(): { step: JobCardWizardStep; message: string } | null {
    for (let n = 1; n <= 5; n++) {
      const errs = stepErrors(n, chosenFiles());
      const first = Object.values(errs)[0];
      if (first) {
        showErrorsOn(n, errs);
        return { step: n as JobCardWizardStep, message: first };
      }
    }
    return null;
  }

  // Files chosen on the Attachments step, listed on Review & Save.
  const [reviewFiles, setReviewFiles] = useState<{ name: string; size: number }[]>([]);
  function collectChosenFiles() {
    setReviewFiles(chosenFiles().map((f) => ({ name: f.name, size: f.size })));
  }

  function goToStep(n: number) {
    setErrors({});
    if (n === 6) collectChosenFiles();
    setStep(n);
  }

  function handleNext() {
    if (!validate()) return;
    goToStep(step + 1);
  }

  function handleBack() {
    setErrors({});
    setStep((p) => Math.max(p - 1, 1));
  }

  // ── Final save ───────────────────────────────────────────────────────────
  function succeed(jobCard: JobCardCreatedSummary, warnings: JobCardCreateWarnings | null, replayed: boolean) {
    outcomeUnknownRef.current = false;
    draftStoppedRef.current = true;
    clearDraft(draftKey);
    setDirty(false);
    setErrors({});
    // No router.refresh() here: on an empty Job Cards list the page renders
    // the wizard in a different branch once a card exists, which would
    // remount it and lose this confirmation. The server already revalidated
    // the lists; every button below navigates to fresh data.
    setPhase({ kind: "success", jobCard, warnings, replayed, requested: requestedRef.current });
  }
  const requestedRef = useRef<SaveRequest>({ assignment: false, materials: 0, attachments: 0 });

  // A Job Card found by a retry / status check may still be getting its
  // assignment, Materials Request and files from the request that created
  // it. Re-read it until that request has finished (or give up and show
  // what is stored), so nothing is reported missing — or complete — early.
  const pendingFinalize = phase.kind === "success" && !phase.jobCard.finalized ? phase.jobCard.id : null;
  useEffect(() => {
    if (!pendingFinalize) return;
    let cancelled = false;
    const started = Date.now();
    async function poll() {
      while (!cancelled && Date.now() - started < FINALIZE_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await checkSubmission(submissionId);
        if (cancelled) return;
        if (status.kind === "found") {
          const done = status.jobCard.finalized || Date.now() - started >= FINALIZE_WAIT_MS - 2000;
          setPhase((p) => (p.kind === "success" ? { ...p, jobCard: { ...status.jobCard, finalized: done } } : p));
          if (status.jobCard.finalized) return;
        }
      }
      if (!cancelled) setPhase((p) => (p.kind === "success" ? { ...p, jobCard: { ...p.jobCard, finalized: true } } : p));
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [pendingFinalize, submissionId]);

  async function save(intent: SaveIntent) {
    if (inFlightRef.current || saved) return;

    const problem = validateAllSteps();
    if (problem) {
      setPhase({
        kind: "failed",
        tone: "validation",
        step: problem.step,
        message: problem.message,
        canRetry: false,
      });
      return;
    }
    const form = formRef.current;
    if (!form) return;

    inFlightRef.current = true;
    requestedRef.current = {
      assignment:
        intent === "submit_for_approval" &&
        canAssignAtCreation &&
        assignment.assignNow &&
        (assignment.type === "INTERNAL_TEAM"
          ? Boolean(assignment.supervisorId || assignment.technicianIds.length || assignment.helperIds.length)
          : assignment.type === "FREELANCER"
            ? Boolean(assignment.freelancerName.trim())
            : Boolean(assignment.companyName.trim())),
      materials: partRows.slice(0, numPartRows).filter((p) => p.description.trim() && p.materialKey !== null).length,
      attachments: Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((i) => (i.files?.length ?? 0) > 0).length,
    };
    setPhase({ kind: "saving", intent, slow: false, upload: null });
    const slowTimer = setTimeout(() => {
      setPhase((p) => (p.kind === "saving" ? { ...p, slow: true } : p));
    }, SLOW_SAVE_MS);

    try {
      // A previous attempt may have gone through without us seeing the
      // answer: ask before sending anything again.
      if (outcomeUnknownRef.current) {
        const status = await checkSubmission(submissionId);
        if (status.kind === "found") {
          succeed(status.jobCard, null, true);
          return;
        }
        if (status.kind === "signed_out") {
          setPhase({
            kind: "failed",
            tone: "session",
            message: "Your session has expired. Sign in again in a new tab, then press Retry here. Your information is still here.",
            canRetry: true,
          });
          return;
        }
        // "unknown" (still offline) falls through: the server returns the
        // existing Job Card for this submission id if there is one.
      }

      const fd = new FormData(form);
      fd.set("intent", intent);
      fd.set("submission_id", submissionId);
      outcomeUnknownRef.current = true;
      const outcome = await sendJobCard(fd, (fraction) => {
        setPhase((p) => (p.kind === "saving" ? { ...p, upload: fraction } : p));
      });

      if (outcome.kind === "answer") {
        const body = outcome.body;
        if (body.ok) {
          // The answer to our own request: its follow-up steps are done.
          succeed(body.replayed ? body.jobCard : { ...body.jobCard, finalized: true }, body.warnings, body.replayed);
          return;
        }
        // An answer that says "not saved" is definite.
        outcomeUnknownRef.current = false;
        if (body.category === "validation" && body.step) {
          showErrorsOn(body.step, { [body.field ?? "form"]: body.message });
          setPhase({ kind: "failed", tone: "validation", step: body.step, message: body.message, reference: body.reference, canRetry: false });
          return;
        }
        setPhase({
          kind: "failed",
          tone: body.category === "session" ? "session" : "failed",
          step: body.step,
          message:
            body.category === "session"
              ? "Your session has expired. Sign in again in a new tab, then press Retry here. Your information is still here."
              : body.message,
          reference: body.reference,
          canRetry: body.retryable,
        });
        if (body.step) showErrorsOn(body.step, { [body.field ?? "form"]: body.message });
        return;
      }

      if (outcome.kind === "signed_out") {
        outcomeUnknownRef.current = false;
        setPhase({
          kind: "failed",
          tone: "session",
          message: "Your session has expired. Sign in again in a new tab, then press Retry here. Your information is still here.",
          canRetry: true,
        });
        return;
      }

      // No answer: find out whether it went through before offering Retry.
      setPhase({ kind: "checking" });
      const status = await checkSubmission(submissionId);
      if (status.kind === "found") {
        succeed(status.jobCard, null, true);
        return;
      }
      if (status.kind === "not_found") {
        setPhase({
          kind: "failed",
          tone: "failed",
          message:
            outcome.reason === "timeout"
              ? "The server took too long to answer and the Job Card was not saved. Please press Retry."
              : "The connection was interrupted and the Job Card was not saved. Please press Retry.",
          canRetry: true,
        });
        return;
      }
      if (status.kind === "signed_out") {
        setPhase({
          kind: "failed",
          tone: "session",
          message: "Your session has expired. Sign in again in a new tab, then press Retry here. Your information is still here.",
          canRetry: true,
        });
        return;
      }
      setPhase({
        kind: "failed",
        tone: "uncertain",
        message:
          "We could not reach the server to confirm whether the Job Card was saved. Check the network connection, then press Retry — it will check first and will not create a duplicate.",
        canRetry: true,
      });
    } finally {
      clearTimeout(slowTimer);
      inFlightRef.current = false;
    }
  }

  const lastIntentRef = useRef<SaveIntent>("submit_for_approval");
  function retry() {
    if (phase.kind === "failed" && phase.tone === "validation") return;
    void save(lastIntentRef.current);
  }
  function startSave(intent: SaveIntent) {
    lastIntentRef.current = intent;
    void save(intent);
  }

  const reviewData: Record<string, string> = Object.fromEntries(
    Object.entries({
      ordered_by: fields.ordered_by,
      // Same "27 Oct 2026" style as the Start / End dates below and the popup.
      date_of_order: fields.date_of_order ? formatJobCardDate(fields.date_of_order) : "",
      job_card_start_date: fields.job_card_start_date ? formatJobCardDate(fields.job_card_start_date) : "",
      job_card_end_date: fields.job_card_end_date ? formatJobCardDate(fields.job_card_end_date) : "",
      maintenance_type: fields.maintenance_type,
      job_location: jobLocation,
      kilometers: showKilometers ? fields.kilometers : "",
      running_hours: showRunningHours ? fields.running_hours : "",
      operator_complaint: fields.operator_complaint,
      description_of_work: fields.description_of_work,
      worker_type: workerTeam,
    }).filter(([, v]) => v.trim())
  );
  const errorStep = phase.kind === "failed" ? (phase.step ?? null) : null;
  // Anything still missing on steps 1–4, listed at the top of Review & Save
  // (Attachments are checked when Create is pressed).
  const reviewProblems =
    step === 6
      ? ([1, 2, 3, 4] as const)
          .map((n) => ({ step: n as JobCardWizardStep, message: Object.values(stepErrors(n))[0] }))
          .filter((p): p is { step: JobCardWizardStep; message: string } => Boolean(p.message))
      : [];

  // One meter-reading input (shown for the selected asset type). A text box
  // with the decimal keypad rather than type="number": the browser silently
  // turns "45,000" in a number box into an empty value, so the reading was
  // dropped without a word. Here the typed text is kept and checked.
  function renderMeterField(name: "kilometers" | "running_hours") {
    const km = name === "kilometers";
    return (
      <div key={name}>
        <label className="block">
          <FieldLabel label={km ? "Current kilometer reading" : "Current running hours"} hint="optional" />
          <input
            name={name}
            data-field={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={fields[name]}
            onChange={(e) => updateField(name, e.target.value)}
            aria-invalid={Boolean(errors[name])}
            className={`${inp}${fieldCls(name)}`}
            placeholder={km ? "e.g. 45000" : "e.g. 1250.5"}
          />
        </label>
        <p className={helpCls}>
          {km ? "The number on the odometer, if you have it." : "The number on the hour meter, if you have it."} Numbers only.
        </p>
        <FieldError message={errors[name]} />
      </div>
    );
  }
  const fieldCls = (name: string) => (errors[name] ? ` ${invalidCls}` : "");

  const reviewParts = partRows.slice(0, numPartRows).filter((p) => p.description.trim() && p.materialKey !== null);

  // Job Card Estimated Hours UX Simplification Unit 10G.22, Task 3/5: the
  // Job Card total is never typed — it's the sum of whatever the currently
  // selected workers have estimated, recomputed on every render. Only
  // Internal Team assignment has per-worker estimates; Freelancer/External
  // Company naturally yield an empty list (no per-worker concept there),
  // same as no assignment at all.
  const estimateSelectedIds = [
    ...(assignment.supervisorId ? [assignment.supervisorId] : []),
    ...assignment.technicianIds,
    ...assignment.helperIds,
  ];
  const enteredWorkerEstimates = estimateSelectedIds
    .map((id) => activeWorkers.find((w) => w.id === id))
    .filter((w): w is WorkerProfileRow => Boolean(w))
    .map((w) => {
      const raw = (assignment.workerEstimates[w.id] ?? "").trim();
      const hours = Number(raw);
      return raw !== "" && Number.isFinite(hours) && hours >= 0 ? { id: w.id, name: w.name, hours } : null;
    })
    .filter((w): w is { id: string; name: string; hours: number } => w !== null);
  const totalEstimatedHours =
    enteredWorkerEstimates.length > 0
      ? Math.round(enteredWorkerEstimates.reduce((sum, w) => sum + w.hours, 0) * 100) / 100
      : null;

  // Created (fully or partly): only the "Job Card Created Successfully"
  // popup is shown — no redirect happens before it is visible.
  if (phase.kind === "success") {
    return (
      <WizardCreatedPopup
        jobCard={phase.jobCard}
        warnings={phase.warnings}
        replayed={phase.replayed}
        requested={phase.requested}
        canAssign={canAssignAtCreation}
        onCreateAnother={onCreateAnother}
        onClose={() => router.push("/maintenance/work-orders")}
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={requestClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-job-card-heading"
          aria-busy={busy}
          className="flex max-h-[90vh] w-[min(92vw,1280px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling, stepper stays visible above the body's own scroll area */}
          <div className="shrink-0 border-b border-[#E5E7EB] px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="new-job-card-heading" className="text-xl font-black text-[#111827] sm:text-2xl">
                  New Job Card
                </h2>
                <p className="mt-1 text-sm text-[#4B5563]">
                  Fill in each step, then save. The Job Card number is given when it is saved.
                </p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#4B5563] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {!saved && (
              <div className="mt-6">
                <StepIndicator current={step} errorStep={errorStep} />
                {/* The step names above are hidden on phones; this line is
                    always shown so everyone knows where they are. */}
                <p className="mt-3 text-sm text-[#4B5563]" aria-live="polite">
                  <span className="font-bold text-[#111827]">
                    Step {step} of {STEP_LABELS.length}: {STEP_LABELS[step - 1]}
                  </span>
                  <span className="ml-2 hidden sm:inline">
                    Fields marked <span className="font-bold text-[#ED1C24]">*</span> are required.
                  </span>
                </p>
              </div>
            )}
          </div>

          {saved ? null : (
          <form
            ref={formRef}
            noValidate
            onSubmit={(e) => e.preventDefault()}
            onChange={(e) => {
              setDirty(true);
              // A new or removed file makes the old Attachments message stale.
              const changed: EventTarget = e.target;
              if (changed instanceof HTMLInputElement && changed.type === "file") {
                setErrors((prev) => {
                  if (!prev.attachments) return prev;
                  const nextErrs = { ...prev };
                  delete nextErrs.attachments;
                  return nextErrs;
                });
              }
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
        {/* Controlled fields derived from selected asset */}
        <input type="hidden" name="asset_category" value={selectedAsset?.category ?? ""} />
        <input type="hidden" name="serial_number" value={selectedAsset?.serial_number ?? ""} />
        <input type="hidden" name="plate_number" value={selectedAsset?.plate_number ?? ""} />
        {/* Fields not shown in wizard steps */}
        <input type="hidden" name="supervisor_verification" value="" />
        <input type="hidden" name="maintenance_manager_closure" value="" />
        <input type="hidden" name="operator_requester_confirmation" value="" />

        {/* Body — the only scrolling region */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">

        {storedDraft && !dirty && (
          <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              <span className="font-bold">Unsaved Job Card found</span> from{" "}
              {new Date(storedDraft.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Restore it to continue
              where you left off. Attachments need to be selected again.
            </span>
            <button
              type="button"
              onClick={restoreStoredDraft}
              className="inline-flex min-h-11 items-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={discardStoredDraft}
              className="inline-flex min-h-11 items-center rounded-md border border-amber-400 bg-white px-4 text-sm font-bold text-amber-900 hover:bg-amber-100"
            >
              Start fresh
            </button>
          </div>
        )}

        <SaveStatusBanner phase={phase} onRetry={retry} onGoToStep={(n) => setStep(n)} />

        {/* ── Step 1: Select Asset ───────────────────────────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <WizardCard
            title="Select Asset / Machine"
            description="Which machine or vehicle needs work? All repair records will be linked to it."
          >
            <div>
              <FieldLabel label="Asset / Machine" required />
              <p className={helpCls}>
                Type the asset code, name or plate number (for example <span className="font-semibold">AST-CAR-0001</span>{" "}
                or <span className="font-semibold">17174</span>), then press <span className="font-semibold">Select</span> on the
                right asset. You can also tap a type such as Car or Bobcat to narrow the list.
              </p>
              <input type="hidden" name="asset_id" value={selectedAssetId} />
              <div className={`mt-2 rounded-md${errors.asset_id ? " ring-2 ring-[#DC2626]" : ""}`} data-field="asset_id">
                <AssetSearchPicker
                  assets={assets}
                  value={selectedAssetId}
                  onChange={(id) => {
                    setSelectedAssetId(id);
                    setErrors({});
                    setDirty(true);
                  }}
                  required
                />
              </div>
              <FieldError message={errors.asset_id} />
            </div>
          </WizardCard>
        </div>

        {/* ── Step 2: Request Details ────────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <WizardCard
            title="Complaint / Request Details"
            description="Who reported the problem, when, and what is wrong."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="block">
                  <FieldLabel label="Order taken by" required />
                  <input
                    name="ordered_by"
                    data-field="ordered_by"
                    value={fields.ordered_by}
                    onChange={(e) => updateField("ordered_by", e.target.value)}
                    aria-invalid={Boolean(errors.ordered_by)}
                    autoComplete="off"
                    className={`${inp}${fieldCls("ordered_by")}`}
                    placeholder="e.g. Ahmed Ali"
                  />
                </label>
                <p className={helpCls}>Name of the person who reported the problem or gave the order.</p>
                <FieldError message={errors.ordered_by} />
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Date of order" required />
                  <input
                    name="date_of_order"
                    data-field="date_of_order"
                    type="date"
                    value={fields.date_of_order}
                    onChange={(e) => updateField("date_of_order", e.target.value)}
                    aria-invalid={Boolean(errors.date_of_order)}
                    className={`${inp}${fieldCls("date_of_order")}`}
                  />
                </label>
                <p className={helpCls}>Today&apos;s date is filled in. Change it only if the order was given on another day.</p>
                <FieldError message={errors.date_of_order} />
              </div>

              {/* Job Card Start / End Date — optional calendar dates for the
                  Job Card itself. Not worker time: worker hours still come
                  only from the worker timer / approved manual time. */}
              <div>
                <label className="block">
                  <FieldLabel label="Job Card Start Date" hint="optional" />
                  <input
                    name="job_card_start_date"
                    data-field="job_card_start_date"
                    type="date"
                    value={fields.job_card_start_date}
                    onChange={(e) => updateJobCardDate("job_card_start_date", e.target.value)}
                    aria-invalid={Boolean(errors.job_card_start_date)}
                    className={`${inp}${fieldCls("job_card_start_date")}`}
                  />
                </label>
                <p className={helpCls}>The day work on this Job Card starts. You can add or change it later.</p>
                <FieldError message={errors.job_card_start_date} />
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Job Card End Date" hint="optional" />
                  <input
                    name="job_card_end_date"
                    data-field="job_card_end_date"
                    type="date"
                    value={fields.job_card_end_date}
                    min={fields.job_card_start_date || undefined}
                    onChange={(e) => updateJobCardDate("job_card_end_date", e.target.value)}
                    aria-invalid={Boolean(errors.job_card_end_date)}
                    className={`${inp}${fieldCls("job_card_end_date")}`}
                  />
                </label>
                <p className={helpCls}>The day the work is finished. It cannot be before the Start Date.</p>
                <FieldError message={errors.job_card_end_date} />
              </div>

              <div>
                <label className="block">
                  <FieldLabel label="Job location" hint="optional" />
                  <input
                    name="job_location"
                    value={jobLocation}
                    onChange={(e) => {
                      setJobLocation(e.target.value);
                      setJobLocationTouched(true);
                    }}
                    className={inp}
                    placeholder="e.g. Workshop, Site 1604"
                  />
                </label>
                <p className={helpCls}>Filled in from the asset&apos;s location. Change it if the work is somewhere else.</p>
              </div>

              {/* priority defaulted to Normal — not shown to user */}
              <input type="hidden" name="priority" value="Normal" />

              {/* Smart Meter Field Unit 10G.60, Task 1/2/3/4 — only ONE
                  meter field ever shows at once (or none), driven by the
                  selected asset's type; both fields stay entirely optional
                  and, since whichever isn't rendered is never present in
                  the submitted form data at all, the unused one is simply
                  never set (Task 5's "keep the other field empty/null"). */}
              {meterKind === "km" && renderMeterField("kilometers")}
              {meterKind === "hours" && renderMeterField("running_hours")}

              {meterKind === "unknown" && (
                <div className="space-y-4 sm:col-span-2">
                  <label className="block">
                    <FieldLabel label="Meter reading" hint="optional" />
                    <select
                      value={meterReadingType}
                      onChange={(e) => setMeterReadingType(e.target.value as "none" | "km" | "hours")}
                      className={inp}
                    >
                      <option value="none">No meter reading</option>
                      <option value="km">Kilometers (vehicles)</option>
                      <option value="hours">Running hours (machines)</option>
                    </select>
                  </label>
                  {meterReadingType === "km" && renderMeterField("kilometers")}
                  {meterReadingType === "hours" && renderMeterField("running_hours")}
                </div>
              )}
            </div>

            <fieldset className="mt-6" data-field="maintenance_type">
              <legend>
                <FieldLabel label="Maintenance type" required />
              </legend>
              <p className={helpCls}>Choose the one that fits best.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MAINTENANCE_TYPES.map((t) => (
                  <label key={t} className={choiceCls}>
                    <input
                      type="radio"
                      name="maintenance_type"
                      value={t}
                      checked={fields.maintenance_type === t}
                      onChange={() => updateField("maintenance_type", t)}
                      className="h-4 w-4 accent-[#ED1C24]"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-6">
              <label className="block">
                <FieldLabel label="Operator complaint" required />
                <textarea
                  name="operator_complaint"
                  data-field="operator_complaint"
                  value={fields.operator_complaint}
                  onChange={(e) => updateField("operator_complaint", e.target.value)}
                  aria-invalid={Boolean(errors.operator_complaint)}
                  className={`${ta}${fieldCls("operator_complaint")}`}
                  placeholder="e.g. Engine does not start. Warning light on. Oil leaking under the machine."
                />
              </label>
              <p className={helpCls}>Write the problem the way the operator described it. Short sentences are fine.</p>
              <FieldError message={errors.operator_complaint} />
            </div>

            <div className="mt-5">
              <label className="block">
                <FieldLabel label="Description of work" hint="optional" />
                <textarea
                  name="description_of_work"
                  value={fields.description_of_work}
                  onChange={(e) => updateField("description_of_work", e.target.value)}
                  className={ta}
                  placeholder="e.g. Check battery and starter motor. Replace oil filter."
                />
              </label>
              <p className={helpCls}>What needs to be done, if you already know. Can be left empty.</p>
            </div>
          </WizardCard>
        </div>

        {/* ── Step 3: Work Team & Assignment ────────────────────────────────
            Worker team / division is a maintenance category/team type, not
            the actual work assignment — kept exactly as before. Optional Work
            Assignment During Job Card Creation Unit 7C adds an optional
            "Assign work now" section below it; if left off, assignment stays
            available later from the Job Card detail page exactly as before. */}
        <div className={step !== 3 ? "hidden" : ""}>
          <WizardCard
            title="Work Team & Assignment"
            description="Choose which team handles this job. Picking the actual workers now is optional."
          >
            <fieldset data-field="worker_type">
              <legend>
                <FieldLabel label="Worker team / division" required />
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {WORKER_TYPES.map((t) => (
                  <label key={t} className={`${choiceCls} items-start`}>
                    <input
                      type="radio"
                      name="worker_type"
                      value={t}
                      checked={workerTeam === t}
                      onChange={() => setWorkerTeam(t)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#ED1C24]"
                    />
                    <span>
                      <span className="block">{t}</span>
                      <span className="block text-xs font-normal text-[#4B5563]">{WORKER_TYPE_HINTS[t]}</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldError message={errors.worker_type} />
            </fieldset>
            {/* New Job Card Wizard Cleanup Unit Task 4: no Assigned Technician
                field here — the legacy single-technician self-service
                assignment still happens later from the Job Card detail page. */}
            <input type="hidden" name="assigned_supervisor_id" value="" />

            {/* Job Card Estimated Hours UX Simplification Unit 10G.22: the
                Job Card total is the sum of the per-worker estimates
                (totalEstimatedHours, computed above), carried to the backend
                via this one hidden field. */}
            <input
              type="hidden"
              name="estimated_labor_hours"
              value={totalEstimatedHours !== null ? String(totalEstimatedHours) : ""}
            />

            {!canAssignAtCreation && (
              <p className="mt-6 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#4B5563]">
                Workers are assigned later from the Job Card by a supervisor or manager. Press Next to continue.
              </p>
            )}

            {canAssignAtCreation && (
              <div className="mt-6 border-t border-[#F3F4F6] pt-5">
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    name="assign_now"
                    checked={assignment.assignNow}
                    onChange={(e) => updateAssignment({ assignNow: e.target.checked })}
                    className="h-5 w-5 accent-[#ED1C24]"
                  />
                  <span className="text-base font-bold text-[#111827]">Assign workers now</span>
                  <span className="text-xs text-[#6B7280]">(optional)</span>
                </label>
                <p className={helpCls}>
                  Leave this off if you don&apos;t know who will do the job yet — workers can be assigned later from the Job Card.
                </p>

                {assignment.assignNow && (
                  <div
                    data-field="assignment"
                    className={`mt-4 space-y-5 rounded-md border bg-gray-50 p-4 ${errors.assignment ? "border-[#DC2626] ring-1 ring-[#DC2626]" : "border-[#E5E7EB]"}`}
                  >
                    <input type="hidden" name="assignment_type" value={assignment.type} />

                    <div>
                      <FieldLabel label="Who will do the work?" />
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Who will do the work?">
                        {ASSIGNMENT_TYPE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={assignment.type === value}
                            onClick={() => updateAssignment({ type: value })}
                            className={`focus-ring min-h-11 rounded-md border px-3 text-sm font-bold transition ${
                              assignment.type === value
                                ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                                : "border-[#D1D5DB] bg-white text-[#4B5563] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {assignment.type === "INTERNAL_TEAM" && (
                      <InternalTeamWizardFields
                        assignment={assignment}
                        updateAssignment={updateAssignment}
                        activeWorkers={activeWorkers}
                        workerTeam={workerTeam}
                      />
                    )}

                    {assignment.type === "FREELANCER" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <LabeledInput label="Freelancer name" required name="assign_freelancer_name" value={assignment.freelancerName} onChange={(v) => updateAssignment({ freelancerName: v })} placeholder="e.g. Mohammed Khan" />
                        <LabeledInput label="Phone" name="assign_freelancer_phone" value={assignment.freelancerPhone} onChange={(v) => updateAssignment({ freelancerPhone: v })} placeholder="e.g. 9999 1234" inputMode="tel" />
                        <LabeledInput label="Type of work" name="assign_freelancer_trade" value={assignment.freelancerTrade} onChange={(v) => updateAssignment({ freelancerTrade: v })} placeholder="e.g. Welding" />
                        <LabeledInput label="Agreed amount (KWD)" name="assign_freelancer_amount" value={assignment.freelancerAmount} onChange={(v) => updateAssignment({ freelancerAmount: v })} placeholder="e.g. 25 or 25.500" inputMode="decimal" />
                        <label className="block sm:col-span-2">
                          <FieldLabel label="Notes" hint="optional" />
                          <textarea name="assign_notes" value={assignment.notes} onChange={(e) => updateAssignment({ notes: e.target.value })} rows={2} className={`${inp} resize-none`} />
                        </label>
                      </div>
                    )}

                    {assignment.type === "EXTERNAL_COMPANY" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <LabeledInput label="Company name" required name="assign_company_name" value={assignment.companyName} onChange={(v) => updateAssignment({ companyName: v })} placeholder="e.g. Gulf Hydraulics Co." />
                        <LabeledInput label="Contact person" name="assign_company_contact" value={assignment.companyContact} onChange={(v) => updateAssignment({ companyContact: v })} />
                        <LabeledInput label="Phone" name="assign_company_phone" value={assignment.companyPhone} onChange={(v) => updateAssignment({ companyPhone: v })} placeholder="e.g. 2222 3333" inputMode="tel" />
                        <LabeledInput label="Type of work" name="assign_company_trade" value={assignment.companyTrade} onChange={(v) => updateAssignment({ companyTrade: v })} placeholder="e.g. Crane repair" />
                        <LabeledInput label="Agreed amount (KWD)" name="assign_company_amount" value={assignment.companyAmount} onChange={(v) => updateAssignment({ companyAmount: v })} placeholder="e.g. 150 or 150.750" inputMode="decimal" />
                        <label className="block sm:col-span-2">
                          <FieldLabel label="Notes" hint="optional" />
                          <textarea name="assign_notes" value={assignment.notes} onChange={(e) => updateAssignment({ notes: e.target.value })} rows={2} className={`${inp} resize-none`} />
                        </label>
                      </div>
                    )}

                    <FieldError message={errors.assignment} />
                  </div>
                )}
              </div>
            )}
          </WizardCard>
        </div>

        {/* ── Step 4: Required Materials ─────────────────────────────────── */}
        <div className={step !== 4 ? "hidden" : ""}>
          <WizardCard
            title="Required Materials"
            description="List materials required for this Job Card. This is not a purchase order."
          >
            {/* New Job Card Required Materials Inventory Selection: the
                server only accepts Inventory-selected rows when this marker
                is posted (see parseRequiredPartRows). */}
            <input type="hidden" name="req_parts_inventory_first" value="1" />
            <div className="mb-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5 text-sm text-[#4B5563]">
              <p className="font-bold text-[#111827]">No materials needed? Leave this empty and click Next.</p>
              <p className="mt-0.5">
                Search for a material from Inventory, then enter the quantity needed. The unit and stock details come from
                Inventory.
              </p>
            </div>

            {/* One set of inputs for every screen size: a table from 768px
                up, the same rows stacked as compact blocks on phones (so the
                posted req_part_*_<n> fields are never duplicated). */}
            <table className="w-full border-separate border-spacing-0 text-sm max-lg:block lg:table-fixed">
              <colgroup className="max-lg:hidden">
                {/* #, Material (widest), Part No., Qty (compact), Unit, Stock, Notes (rest, incl. remove). */}
                <col className="w-10" />
                <col className="w-[30%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col />
              </colgroup>
              <thead className="max-lg:hidden">
                <tr className="bg-[#F3F4F6] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                  <th scope="col" className="rounded-tl-md border-y border-l border-[#E5E7EB] px-2 py-2.5 text-center">#</th>
                  <th scope="col" className="border-y border-l border-[#E5E7EB] px-3 py-2.5">Material Name / Description</th>
                  <th scope="col" className="border-y border-l border-[#E5E7EB] px-3 py-2.5">Part No. / Code</th>
                  <th scope="col" className="border-y border-l border-[#E5E7EB] px-3 py-2.5">Qty</th>
                  <th scope="col" className="border-y border-l border-[#E5E7EB] px-3 py-2.5">Unit</th>
                  <th scope="col" className="border-y border-l border-[#E5E7EB] px-3 py-2.5">Available Stock</th>
                  <th scope="col" className="rounded-tr-md border border-[#E5E7EB] px-3 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="max-lg:block max-lg:space-y-3">
                {partRows.map((row, i) => {
                  if (i >= numPartRows) {
                    // Hidden spare rows keep their (empty) fields out of the
                    // form entirely — nothing to post.
                    return null;
                  }
                  const linked = row.materialKey !== null;
                  const hasName = row.description.trim().length > 0;
                  const required = rowStockQty(row);
                  const availability = computeRowAvailability(row);
                  const options = unitOptionsFor(row);
                  const listId = `req-part-${i}-options`;
                  const open = row.showSuggestions && (row.loading || row.suggestions.length > 0 || row.searched);
                  const activeIdx = activeSuggestion.row === i ? Math.min(activeSuggestion.index, row.suggestions.length - 1) : 0;
                  const rowError = errors[`req_row_${i}`];
                  const qtyProblem = Boolean(rowError) && linked;
                  const nameProblem = Boolean(rowError) && !linked;
                  const last = i === numPartRows - 1;
                  const canRemove = numPartRows > 1 || hasName;
                  const removeButton = (
                    <button
                      type="button"
                      onClick={() => requestRemoveMaterialRow(i)}
                      className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-[#6B7280] hover:bg-red-50 hover:text-[#DC2626] lg:w-9"
                      aria-label={`Remove material ${i + 1}`}
                      title="Remove this material"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  );
                  const cell = `border-l border-b border-[#E5E7EB] px-2 py-2 align-top max-lg:border-0 max-lg:p-0 max-lg:block ${rowError ? "bg-[#FEF2F2]" : "bg-white"}`;
                  const mobileLabel = "mb-1 block text-xs font-semibold text-[#4B5563] lg:sr-only";
                  const ctrl = "focus-ring h-11 w-full rounded-md border bg-white px-2.5 text-base sm:text-sm";
                  return (
                    <Fragment key={i}>
                      <tr
                        className={`max-lg:grid max-lg:grid-cols-2 sm:max-lg:grid-cols-6 max-lg:gap-x-3 max-lg:gap-y-2 max-lg:rounded-lg max-lg:border max-lg:p-3 ${
                          rowError ? "max-lg:border-[#FCA5A5] max-lg:bg-[#FEF2F2]" : "max-lg:border-[#E5E7EB]"
                        }`}
                      >
                        <td className={`${cell} text-center font-semibold text-[#6B7280] max-lg:col-span-2 sm:max-lg:col-span-6 max-lg:flex max-lg:items-center max-lg:justify-between max-lg:text-left`}>
                          <span className="lg:block lg:pt-2.5">
                            <span className="lg:hidden">Material </span>
                            {i + 1}
                          </span>
                          {/* Phones / tablets: remove button in the line header (desktop: next to Notes). */}
                          {canRemove && confirmRemoveRow !== i && (
                            <span className="lg:hidden">{removeButton}</span>
                          )}
                        </td>

                        <td className={`${cell} relative max-lg:col-span-2 sm:max-lg:col-span-3`}>
                          <label className="block">
                            <span className={mobileLabel}>Material Name / Description</span>
                            <input
                              name={`req_part_description_${i}`}
                              data-field={!linked ? `req_row_${i}` : undefined}
                              role="combobox"
                              aria-label={`Material ${i + 1}`}
                              aria-expanded={Boolean(open)}
                              aria-controls={listId}
                              aria-autocomplete="list"
                              aria-invalid={nameProblem}
                              aria-activedescendant={open && row.suggestions[activeIdx] ? `${listId}-${activeIdx}` : undefined}
                              value={row.description}
                              onChange={(e) => {
                                setActiveSuggestion({ row: i, index: 0 });
                                handleMaterialNameChange(i, e.target.value);
                              }}
                              onFocus={() => updateRow(i, { showSuggestions: true })}
                              onBlur={() => updateRow(i, { showSuggestions: false })}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setActiveSuggestion({ row: i, index: Math.min(activeIdx + 1, row.suggestions.length - 1) });
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setActiveSuggestion({ row: i, index: Math.max(activeIdx - 1, 0) });
                                } else if (e.key === "Enter") {
                                  e.preventDefault();
                                  const match = open ? row.suggestions[activeIdx] : undefined;
                                  if (match) handleSelectSuggestion(i, match);
                                } else if (e.key === "Escape" && open) {
                                  // Handled here: the wizard must not also ask to discard.
                                  e.preventDefault();
                                  updateRow(i, { showSuggestions: false });
                                }
                              }}
                              autoComplete="off"
                              className={`${ctrl} ${nameProblem ? invalidCls : "border-[#D1D5DB]"} ${linked ? "font-semibold text-[#111827]" : ""}`}
                              placeholder="Search Inventory... e.g. oil filter"
                            />
                          </label>
                          <input type="hidden" name={`req_part_material_key_${i}`} value={row.materialKey ?? ""} />

                          {open && (
                            <div className="absolute left-0 top-full z-30 mt-1 w-[min(32rem,calc(100vw-3rem))] rounded-md border border-[#E5E7EB] bg-white shadow-lg max-lg:right-0 max-lg:w-auto">
                              {row.loading ? (
                                <div className="flex items-center gap-2 px-3 py-3 text-sm text-[#6B7280]">
                                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                  Searching Inventory…
                                </div>
                              ) : row.suggestions.length === 0 ? (
                                <p className="px-3 py-3 text-sm text-[#6B7280]">
                                  Nothing in Inventory matches &quot;{row.description.trim()}&quot;. Check the spelling or try the part number.
                                </p>
                              ) : (
                                <ul id={listId} role="listbox" aria-label="Inventory materials" className="max-h-64 divide-y divide-[#F3F4F6] overflow-y-auto">
                                  {row.suggestions.map((s, si) => (
                                    <li
                                      key={s.key}
                                      id={`${listId}-${si}`}
                                      role="option"
                                      aria-selected={si === activeIdx}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelectSuggestion(i, s);
                                      }}
                                      onMouseEnter={() => setActiveSuggestion({ row: i, index: si })}
                                      className={`cursor-pointer px-3 py-2.5 ${si === activeIdx ? "bg-[#FEF2F2]" : "hover:bg-gray-50"}`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm font-bold text-[#111827]">
                                          {s.display_name}
                                          <span className="font-normal text-[#4B5563]">
                                            {" "}— {fmtQty(s.balance)} {s.unit} in stock
                                          </span>
                                        </p>
                                        <StatusBadge label={stockStatusLabel(s.stock_status)} tone={stockStatusTone(s.stock_status)} />
                                      </div>
                                      <p className="mt-0.5 text-xs text-[#6B7280]">
                                        {[
                                          s.part_number ? `Part No: ${s.part_number}` : null,
                                          s.ss_rec_code ? `SS Rec. Code: ${s.ss_rec_code}` : null,
                                          s.purchase_unit && s.conversion_quantity
                                            ? `1 ${s.purchase_unit} = ${fmtQty(s.conversion_quantity)} ${s.unit}`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" • ")}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </td>

                        <td className={`${cell} max-lg:col-span-2 sm:max-lg:col-span-1`}>
                          <span className={mobileLabel}>Part No. / Code</span>
                          {/* From Inventory for a selected material; posted read-only. */}
                          <input type="hidden" name={`req_part_part_number_${i}`} value={row.partNumber} />
                          <div className="flex min-h-11 flex-col justify-center text-sm text-[#111827] max-lg:min-h-0">
                            {row.partNumber || row.ssRecCode ? (
                              <>
                                {row.partNumber && <span className="[overflow-wrap:anywhere]">{row.partNumber}</span>}
                                {row.ssRecCode && <span className="text-xs text-[#6B7280] [overflow-wrap:anywhere]">SS Rec. {row.ssRecCode}</span>}
                              </>
                            ) : (
                              <span className="text-[#9CA3AF]">—</span>
                            )}
                          </div>
                        </td>

                        <td className={cell}>
                          <label className="block">
                            <span className={mobileLabel}>Qty</span>
                            <input
                              name={`req_part_quantity_${i}`}
                              data-field={linked ? `req_row_${i}` : undefined}
                              aria-label={`Quantity for material ${i + 1}`}
                              aria-invalid={qtyProblem}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={linked ? row.qty : ""}
                              onChange={(e) => updateRow(i, { qty: e.target.value })}
                              disabled={!linked}
                              placeholder={linked ? "" : "—"}
                              className={`${ctrl} text-right ${qtyProblem ? invalidCls : "border-[#D1D5DB]"} disabled:border-[#E5E7EB] disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]`}
                            />
                          </label>
                        </td>

                        <td className={cell}>
                          {/* Only the selected material's own units: its Stock
                              Unit (default) and, when its Inventory setup has
                              one, its Purchase Unit. */}
                          <label className="block">
                            <span className={mobileLabel}>Unit</span>
                            {linked ? (
                              <select
                                aria-label={`Unit for material ${i + 1}`}
                                value={row.unit}
                                onChange={(e) => updateRow(i, { unit: e.target.value })}
                                className={`${ctrl} border-[#D1D5DB] px-2`}
                              >
                                {options.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="flex h-11 items-center px-1 text-[#9CA3AF]">—</span>
                            )}
                          </label>
                          <input type="hidden" name={`req_part_entered_unit_${i}`} value={row.unit} />
                          <input type="hidden" name={`req_part_uom_${i}`} value={row.inventoryUnit ?? ""} />
                        </td>

                        <td className={`${cell} max-lg:col-span-2 sm:max-lg:col-span-3`} aria-live="polite">
                          <span className={mobileLabel}>Available Stock</span>
                          {linked && row.balance !== null ? (
                            <div className="flex min-h-11 flex-col justify-center text-sm leading-snug max-lg:min-h-0">
                              <span className="font-semibold text-[#111827]">
                                {fmtQty(row.balance)} {row.inventoryUnit}
                              </span>
                              {usesPurchaseUnit(row) && required !== null && (
                                <span className="text-xs text-[#4B5563]">
                                  = {fmtQty(required)} {row.inventoryUnit} needed (1 {row.purchaseUnit} = {fmtQty(row.conversion!)} {row.inventoryUnit})
                                </span>
                              )}
                              {required !== null && Number(row.qty) > 0 && (
                                availability?.kind === "available" ? (
                                  <span className="text-xs font-semibold text-green-700">Enough in stock</span>
                                ) : availability?.kind === "partial" || availability?.kind === "unavailable" ? (
                                  <span className="text-xs font-semibold text-[#B91C1C]">
                                    Short by {fmtQty(availability.shortage)} {row.inventoryUnit}
                                  </span>
                                ) : null
                              )}
                              {canViewCosts && (
                                <span className="text-xs text-[#6B7280]">
                                  {row.lastUnitCost !== null
                                    ? `Est. ${rowEstimatedTotal(row) !== null ? `${rowEstimatedTotal(row)!.toFixed(3)} KWD` : "—"}`
                                    : "Unpriced"}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className={`flex min-h-11 items-center max-lg:min-h-0 ${hasName ? "text-sm font-semibold text-[#B91C1C]" : "text-[#9CA3AF]"}`}>
                              {hasName ? "Not chosen from Inventory" : "—"}
                            </span>
                          )}
                        </td>

                        <td className={`${cell} border-r max-lg:col-span-2 sm:max-lg:col-span-3 ${last && !rowError && !(hasName && !linked && !row.showSuggestions) ? "lg:rounded-br-md" : ""}`}>
                          <label className="block">
                            <span className={mobileLabel}>Notes (optional)</span>
                            <span className="flex items-center gap-1">
                              <input
                                name={`req_part_notes_${i}`}
                                aria-label={`Notes for material ${i + 1}`}
                                value={row.notes}
                                onChange={(e) => updateRow(i, { notes: e.target.value })}
                                placeholder="Optional"
                                className={`${ctrl} min-w-0 border-[#D1D5DB]`}
                              />
                              {canRemove && confirmRemoveRow !== i && (
                                <span className="hidden shrink-0 lg:block">{removeButton}</span>
                              )}
                            </span>
                          </label>
                        </td>
                      </tr>

                      {/* Confirm removing a line that already has a material. */}
                      {confirmRemoveRow === i && (
                        <tr className="max-lg:block">
                          <td colSpan={7} className="border-x border-b border-[#E5E7EB] bg-[#FFFBEB] px-3 py-2 max-lg:block max-lg:rounded-lg max-lg:border">
                            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                              <span className="font-semibold">Remove &quot;{row.description.trim()}&quot; from this Job Card?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmRemoveRow(null);
                                  removeMaterialRow(i);
                                }}
                                className="focus-ring inline-flex min-h-11 items-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700"
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveRow(null)}
                                className="focus-ring inline-flex min-h-11 items-center rounded-md border border-[#D1D5DB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50"
                              >
                                Keep
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Problem with this line, right under it. */}
                      {rowError && (
                        <tr className="max-lg:block">
                          <td colSpan={7} className="border-x border-b border-[#E5E7EB] bg-[#FEF2F2] px-3 py-2 max-lg:block max-lg:border-0 max-lg:bg-transparent max-lg:px-1">
                            <p role="alert" className="text-sm font-semibold text-[#DC2626]">
                              {rowError}
                            </p>
                          </td>
                        </tr>
                      )}

                      {/* Typed but not chosen: offer the two ways forward. */}
                      {hasName && !linked && !row.showSuggestions && (
                        <tr className="max-lg:block">
                          <td colSpan={7} className="border-x border-b border-[#E5E7EB] bg-[#FFFBEB] px-3 py-2 max-lg:block max-lg:rounded-lg max-lg:border">
                            <div className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                              <span>Choose it from the Inventory list, or add it to Inventory first.</span>
                              <button
                                type="button"
                                onClick={() => handleMaterialNameChange(i, row.description)}
                                className="focus-ring inline-flex min-h-11 items-center rounded-md border border-amber-400 bg-white px-3 text-sm font-bold text-amber-900 hover:bg-amber-100"
                              >
                                Search again
                              </button>
                              <a
                                href="/store/offline-inventory/add-material"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="focus-ring inline-flex min-h-11 items-center rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#111827] hover:bg-gray-50"
                              >
                                Add New Material (new tab)
                              </a>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Estimated Material Cost — cost-permitted viewers only, summed
                over selected rows that have a known cost; planning only. */}
            {canViewCosts && (() => {
              const describedRows = partRows.slice(0, numPartRows).filter((r) => r.materialKey !== null);
              if (describedRows.length === 0) return null;
              const lineTotals = describedRows.map(rowEstimatedTotal);
              const pricedTotals = lineTotals.filter((t): t is number => t !== null);
              const hasUnpriced = lineTotals.some((t) => t === null);
              const estimatedMaterialCost = pricedTotals.reduce((sum, t) => sum + t, 0);
              return (
                <div className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                  <p className="text-sm font-bold text-[#111827]">
                    Estimated Material Cost (planning only):{" "}
                    {pricedTotals.length > 0 ? `${estimatedMaterialCost.toFixed(3)} KWD` : "Not available"}
                  </p>
                  {hasUnpriced && pricedTotals.length > 0 && (
                    <p className="mt-0.5 text-xs text-amber-700">
                      Some material lines do not have cost. Estimated total excludes unpriced lines.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Server-side material problems (shown when a save is refused). */}
            <div data-field="required_parts" tabIndex={-1}>
              <FieldError message={errors.required_parts} />
            </div>

            {numPartRows < MAX_PART_ROWS ? (
              <button
                type="button"
                onClick={() => {
                  setNumPartRows((n) => n + 1);
                  setDirty(true);
                }}
                className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#ED1C24] bg-white px-4 text-sm font-bold text-[#ED1C24] hover:bg-red-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Material
              </button>
            ) : (
              <p className="mt-3 text-sm text-[#6B7280]">Up to {MAX_PART_ROWS} materials per Job Card.</p>
            )}
          </WizardCard>
        </div>

        {/* ── Step 5: Attachments ─────────────────────────────────── */}
        {/* New Job Card Required Materials and Attachment Simplification
            Task 3/4: category dropdown and the desktop-confusing Take Photo
            button are hidden here (showCategory={false} showCamera={false})
            — every attachment on this form is silently filed under
            "Other Document" (the existing safest category, already the
            server's own fallback in parsePendingAttachments when no category
            is submitted at all — kept explicit here via the hidden field
            rather than relying on that implicit fallback). Mobile camera
            capture was only ever reachable through the now-removed separate
            Take Photo button, so there is no progressive-mobile behavior to
            preserve inside the single Upload Attachment button itself. */}
        <div className={step !== 5 ? "hidden" : ""}>
          <WizardCard
            title="Attachments"
            description="Optional — add photos of the problem or documents such as quotations and invoices."
          >
            <div className="mb-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#4B5563]">
              <p>
                <span className="font-bold text-[#111827]">No files to add?</span> Press Next.
              </p>
              <p className="mt-1">
                Allowed: photos (JPG, PNG, WEBP), PDF, Excel (XLS, XLSX) and Word (DOC, DOCX). Up to{" "}
                <span className="font-semibold text-[#111827]">{formatBytesShort(uploadMaxFileBytes)} per file</span>, up to{" "}
                {MAX_ATTACHMENT_ROWS} files. Files are uploaded when you press Create Job Card.
              </p>
            </div>
            <div data-field="attachments" tabIndex={-1} className={errors.attachments ? "rounded-md p-1 ring-2 ring-[#DC2626]" : ""}>
            <AttachmentUploadFields
              namePrefix="doc_attachment"
              categories={JOB_CARD_ATTACHMENT_CATEGORIES}
              defaultCategory="Other Document"
              accept={ATTACHMENT_FILE_ACCEPT}
              maxRows={MAX_ATTACHMENT_ROWS}
              showCategory={false}
              showCamera={false}
              showPreview
              large
              maxFileBytes={uploadMaxFileBytes}
              allowedTypes={ALLOWED_PRIVATE_FILE_TYPES}
            />
            </div>
            <FieldError message={errors.attachments} />
          </WizardCard>
        </div>

        {/* ── Step 6: Review & Save ──────────────────────────────────────── */}
        <div className={step !== 6 ? "hidden" : ""}>
          <WizardCard
            title="Review & Save"
            description="Check everything below. Press Edit to change a section, then come back here with Next."
          >
            <div className="space-y-5">
              {reviewProblems.length > 0 ? (
                <div role="alert" className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#7F1D1D]">
                  <p className="font-black">Before saving, please fix:</p>
                  <ul className="mt-2 space-y-2">
                    {reviewProblems.map((p) => (
                      <li key={`${p.step}-${p.message}`} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-bold">Step {p.step} – {STEP_LABELS[p.step - 1]}:</span> {p.message}
                        </span>
                        <button
                          type="button"
                          onClick={() => showErrorsOn(p.step, stepErrors(p.step))}
                          className="focus-ring inline-flex min-h-11 items-center rounded-md border border-[#FCA5A5] bg-white px-4 text-sm font-bold text-[#7F1D1D] hover:bg-red-50"
                        >
                          Fix
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Everything needed is filled in. Check the details, then press <span className="font-bold">Create Job Card</span>.
                  </span>
                </p>
              )}

              <ReviewSection title="Asset / Machine" onEdit={() => goToStep(1)}>
                {selectedAsset ? (
                  <div>
                    <p className="font-bold text-[#111827]">
                      {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    </p>
                    <p className="mt-0.5 text-sm text-[#4B5563]">
                      {[selectedAsset.category, selectedAsset.plate_number ? `Plate ${selectedAsset.plate_number}` : null, selectedAsset.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-[#4B5563]">Status: {selectedAsset.status}</p>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[#DC2626]">No asset selected</p>
                )}
              </ReviewSection>

              <ReviewSection title="Request Details" onEdit={() => goToStep(2)}>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <ReviewRow label="Order taken by" value={reviewData.ordered_by} />
                  <ReviewRow label="Date of order" value={reviewData.date_of_order} />
                  <ReviewRow label="Job Card Start Date" value={reviewData.job_card_start_date ?? NOT_ENTERED} />
                  <ReviewRow label="Job Card End Date" value={reviewData.job_card_end_date ?? NOT_ENTERED} />
                  <ReviewRow label="Maintenance type" value={reviewData.maintenance_type} />
                  <ReviewRow label="Job location" value={reviewData.job_location} />
                  {/* Smart Meter Field Unit 10G.60, Task 8 — only whichever
                      one was actually entered shows. */}
                  <ReviewRow label="Kilometer reading" value={reviewData.kilometers} />
                  <ReviewRow label="Running hours" value={reviewData.running_hours} />
                  <div className="sm:col-span-2">
                    <ReviewRow label="Operator complaint" value={reviewData.operator_complaint} />
                  </div>
                  <div className="sm:col-span-2">
                    <ReviewRow label="Description of work" value={reviewData.description_of_work} />
                  </div>
                </dl>
              </ReviewSection>

              <ReviewSection title="Work Team & Assignment" onEdit={() => goToStep(3)}>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <ReviewRow label="Worker team / division" value={reviewData.worker_type} />
                  {!assignment.assignNow ? (
                    <ReviewRow label="Workers" value="Not assigned yet — can be done later from the Job Card" />
                  ) : assignment.type === "INTERNAL_TEAM" ? (
                    <>
                      <ReviewRow label="Supervisor" value={activeWorkers.find((w) => w.id === assignment.supervisorId)?.name ?? "None"} />
                      <ReviewRow
                        label="Technicians"
                        value={activeWorkers.filter((w) => assignment.technicianIds.includes(w.id)).map((w) => w.name).join(", ") || "None"}
                      />
                      <ReviewRow
                        label="Helpers / Labor"
                        value={activeWorkers.filter((w) => assignment.helperIds.includes(w.id)).map((w) => w.name).join(", ") || "None"}
                      />
                    </>
                  ) : assignment.type === "FREELANCER" ? (
                    <>
                      <ReviewRow label="Freelancer" value={assignment.freelancerName} />
                      <ReviewRow label="Agreed amount" value={assignment.freelancerAmount ? `${assignment.freelancerAmount} KWD` : undefined} />
                    </>
                  ) : (
                    <>
                      <ReviewRow label="External company" value={assignment.companyName} />
                      <ReviewRow label="Agreed amount" value={assignment.companyAmount ? `${assignment.companyAmount} KWD` : undefined} />
                    </>
                  )}
                </dl>
                {/* Job Card Estimated Hours UX Simplification Unit 10G.22,
                    Task 5: shown as calculated from the worker-level fields. */}
                {enteredWorkerEstimates.length > 0 && (
                  <div className="mt-3 border-t border-[#F3F4F6] pt-3">
                    <p className="text-sm font-bold text-[#111827]">Expected hours in total: {totalEstimatedHours} h</p>
                    <dl className="mt-1 space-y-1">
                      {enteredWorkerEstimates.map((w) => (
                        <div key={w.id} className="flex items-center justify-between gap-3 text-sm">
                          <dt className="min-w-0 truncate text-[#4B5563]">{w.name}</dt>
                          <dd className="shrink-0 font-semibold text-[#111827]">{w.hours} h</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {assignment.assignNow && (
                  <p className="mt-3 text-xs text-[#6B7280]">
                    Save Draft does not save the workers — they are saved when you press Create Job Card.
                  </p>
                )}
              </ReviewSection>

              <ReviewSection title="Required Materials" onEdit={() => goToStep(4)}>
                {reviewParts.length > 0 ? (
                  <ul className="divide-y divide-[#F3F4F6]">
                    {reviewParts.map((p, i) => {
                      const required = rowStockQty(p);
                      const availability = computeRowAvailability(p);
                      return (
                        <li key={i} className="py-2 text-sm first:pt-0 last:pb-0">
                          <p className="font-semibold text-[#111827]">
                            {p.description}
                            {p.partNumber ? <span className="font-normal text-[#6B7280]"> · Part No. {p.partNumber}</span> : null}
                          </p>
                          <p className="text-[#4B5563]">
                            {p.qty} {p.unit}
                            {usesPurchaseUnit(p) && required !== null && <> = {fmtQty(required)} {p.inventoryUnit}</>}
                            {" · "}In store: {fmtQty(p.balance ?? 0)} {p.inventoryUnit}
                            {availability && (availability.kind === "partial" || availability.kind === "unavailable") && (
                              <span className="font-semibold text-[#B91C1C]">
                                {" "}· Short by {fmtQty(availability.shortage)} {p.inventoryUnit}
                              </span>
                            )}
                            {availability?.kind === "available" && <span className="font-semibold text-green-700"> · Enough in store</span>}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-[#6B7280]">No materials</p>
                )}
              </ReviewSection>

              <ReviewSection title="Attachments" onEdit={() => goToStep(5)}>
                {reviewFiles.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {reviewFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex flex-wrap justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold text-[#111827]">{f.name}</span>
                        <span className="text-[#6B7280]">{formatBytesShort(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[#6B7280]">No attachments</p>
                )}
              </ReviewSection>

              {/* New Job Card Button Wording and Success Popup Clarity Unit
                  10F.2, Task 2: "Create Job Card" makes the Job Card Active —
                  it does not start worker time, which only ever starts from
                  Daily Activity. */}
              <p className="text-sm text-[#4B5563]">
                <span className="font-semibold text-[#111827]">Create Job Card</span> saves it as Active. Worker time is
                recorded later from Daily Activity. Not ready yet? <span className="font-semibold text-[#111827]">Save Draft</span>{" "}
                keeps it so you can finish it later.
              </p>
            </div>
          </WizardCard>
        </div>
        </div>

        {/* Footer — sticky, non-scrolling, always-visible action buttons */}
        <div className="shrink-0 border-t border-[#E5E7EB] px-4 py-3 sm:px-8 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              {step > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={busy}
                  className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] shadow-sm transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
              )}
            </div>
            <div className={`flex items-center gap-2 ${step === 6 ? "w-full sm:w-auto" : ""}`}>
              {step < 6 ? (
                <button
                  key="next"
                  type="button"
                  onClick={handleNext}
                  disabled={busy}
                  className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    Next<span className="hidden sm:inline">: {STEP_LABELS[step]}</span>
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <>
                  {/* Buttons, not form submits: the form never submits by
                      itself (Enter key, implicit submission) — only save()
                      sends it, once, with the submission id. */}
                  <button
                    key="save-draft"
                    type="button"
                    onClick={() => startSave("save_draft")}
                    disabled={busy}
                    className="focus-ring inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                  >
                    {phase.kind === "saving" && phase.intent === "save_draft" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Saving Draft…
                      </>
                    ) : (
                      "Save Draft"
                    )}
                  </button>
                  <button
                    key="create"
                    type="button"
                    onClick={() => startSave("submit_for_approval")}
                    disabled={busy}
                    className="focus-ring inline-flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-md bg-[#ED1C24] px-6 py-2 text-base font-black text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-[#ED1C24]/70 sm:flex-none"
                  >
                    {phase.kind === "saving" && phase.intent === "submit_for_approval" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Creating Job Card…
                      </>
                    ) : phase.kind === "checking" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Checking…
                      </>
                    ) : (
                      <>
                        <Check className="h-5 w-5" aria-hidden="true" />
                        Create Job Card
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </form>
          )}
        </div>
      </div>

      {showCancelConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setShowCancelConfirm(false)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-jc-heading"
              className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
            >
              <h2 id="cancel-jc-heading" className="text-lg font-black text-[#111827]">
                Discard Job Card?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                You have entered information that has not been saved. Are you sure you want to discard it?
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={discardAndExit}
                  className="flex-1 rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
                >
                  Discard and Exit
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
                >
                  Continue Editing
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {phase.kind === "failed" && phase.tone === "failed" && dismissedFailure !== phase && (
        <SaveFailedDialog
          message={phase.canRetry ? null : phase.message}
          reference={phase.reference ?? null}
          canRetry={phase.canRetry}
          onRetry={() => {
            setDismissedFailure(phase);
            retry();
          }}
          onBack={() => setDismissedFailure(phase)}
        />
      )}
    </>
  );
}

// ── Local sub-components ──────────────────────────────────────────────────────

// Job Card Creation 500 / Success Popup Fix: shown when the server answered
// definitely "not saved" (or a status check confirmed nothing exists). Plain
// words only — never the raw server/database error; the reference matches
// the server log line and system_error_logs row for this attempt. The form
// behind it is untouched, so Back to Job Card returns to everything entered.
function SaveFailedDialog({
  message,
  reference,
  canRetry,
  onRetry,
  onBack,
}: {
  // Shown only when Retry cannot help (e.g. the system needs an update).
  message: string | null;
  reference: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={onBack} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="jc-failed-heading"
          aria-describedby="jc-failed-text"
          className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-8 w-8 text-[#DC2626]" aria-hidden="true" />
          </div>
          <h2 id="jc-failed-heading" className="mt-3 text-lg font-black text-[#111827]">
            Job Card could not be created
          </h2>
          <p id="jc-failed-text" className="mt-2 text-sm leading-relaxed text-[#4B5563]">
            {message ?? "Your information is safe. Please try again."}
          </p>
          {reference && (
            <p className="mt-3 text-xs text-[#6B7280]">
              Support reference: <span className="font-mono font-bold text-[#111827]">{reference}</span>
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              ref={canRetry ? undefined : primaryRef}
              onClick={onBack}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Back to Job Card
            </button>
            {canRetry && (
              <button
                type="button"
                ref={primaryRef}
                onClick={onRetry}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white transition hover:bg-red-700"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Save progress / problem shown at the top of the wizard body. Validation
// problems also stay next to their field; this says which step they are on.
function SaveStatusBanner({
  phase,
  onRetry,
  onGoToStep,
}: {
  phase: SavePhase;
  onRetry: () => void;
  onGoToStep: (step: JobCardWizardStep) => void;
}) {
  if (phase.kind === "saving") {
    const uploading = phase.upload !== null && phase.upload < 1;
    return (
      <div role="status" aria-live="polite" className="mb-5 flex items-start gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#111827]">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#ED1C24] motion-reduce:animate-none" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {phase.intent === "save_draft" ? "Saving Draft…" : "Creating Job Card…"}
            {uploading && ` Uploading attachments ${Math.round((phase.upload ?? 0) * 100)}%`}
          </p>
          {uploading && (
            <div
              role="progressbar"
              aria-label="Uploading attachments"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((phase.upload ?? 0) * 100)}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB]"
            >
              <div className="h-full bg-[#ED1C24]" style={{ width: `${Math.round((phase.upload ?? 0) * 100)}%` }} />
            </div>
          )}
          {phase.slow && (
            <p className="mt-0.5 font-semibold text-amber-800">
              Still {phase.intent === "save_draft" ? "saving your draft" : "creating your Job Card"}. Please do not close this window.
            </p>
          )}
        </div>
      </div>
    );
  }
  if (phase.kind === "checking") {
    return (
      <div role="status" aria-live="polite" className="mb-5 flex items-start gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#111827]">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#ED1C24] motion-reduce:animate-none" aria-hidden="true" />
        <p className="font-bold">Checking whether your Job Card was saved… Please do not close this window.</p>
      </div>
    );
  }
  if (phase.kind !== "failed") return null;

  const title =
    phase.tone === "validation"
      ? "Please check the Job Card before saving."
      : phase.tone === "uncertain"
        ? "We could not confirm whether the Job Card was saved."
        : "Job Card could not be created. Your information is safe.";
  return (
    <div role="alert" className="mb-5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#7F1D1D]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-black">{title}</p>
          <p className="mt-1">
            {phase.step && (
              <span className="font-bold">
                Step {phase.step} – {STEP_LABELS[phase.step - 1]}:{" "}
              </span>
            )}
            {phase.message}
          </p>
          {phase.reference && (
            <p className="mt-1 text-xs text-[#991B1B]">
              Reference: <span className="font-mono font-bold">{phase.reference}</span> — give this to the system administrator if it keeps happening.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {phase.step && (
              <button
                type="button"
                onClick={() => onGoToStep(phase.step!)}
                className="inline-flex min-h-11 items-center rounded-md border border-[#FCA5A5] bg-white px-4 text-sm font-bold text-[#7F1D1D] hover:bg-red-50"
              >
                Go to {STEP_LABELS[phase.step - 1]}
              </button>
            )}
            {phase.tone === "session" && (
              <a
                href="/login"
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center rounded-md border border-[#FCA5A5] bg-white px-4 text-sm font-bold text-[#7F1D1D] hover:bg-red-50"
              >
                Sign in (opens a new tab)
              </a>
            )}
            {phase.canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shown only after the server confirmed the Job Card exists: the "Job Card
// Created Successfully" popup (JobCardCreatedSuccessDialog), filled from the
// stored record — never a guessed number. Anything the user entered that
// was not stored turns it into the partial-success (warning) version.
function WizardCreatedPopup({
  jobCard,
  warnings,
  replayed,
  requested,
  canAssign,
  onCreateAnother,
  onClose,
}: {
  jobCard: JobCardCreatedSummary;
  warnings: JobCardCreateWarnings | null;
  replayed: boolean;
  requested: SaveRequest;
  // work_orders.assign — limits the recommended next step to what this user can do.
  canAssign: boolean;
  onCreateAnother: () => void;
  onClose: () => void;
}) {
  const finishing = !jobCard.finalized;

  // Compare what was entered with what is stored. The server's own warnings
  // (when this answer came from the request that saved it) count too.
  const missing: string[] = [];
  if (!finishing) {
    if ((requested.assignment && jobCard.assignedTeam.length === 0) || warnings?.assignmentFailed) {
      missing.push("Workers were not assigned. Assign them from the Job Card.");
    }
    if ((requested.materials > 0 && jobCard.materialsRequests.length === 0) || warnings?.materialsRequestFailed) {
      missing.push(
        `The ${jobCard.requiredMaterialsCount} required material line(s) are saved, but no Materials Request was created. Use "Request Materials" from the Job Card.`
      );
    }
    if (jobCard.attachmentsCount < requested.attachments || warnings?.attachmentsFailed) {
      missing.push(`Only ${jobCard.attachmentsCount} of ${requested.attachments} attachment(s) were saved. Add the rest from the Job Card.`);
    }
  }

  const notes: string[] = [];
  if (replayed) {
    notes.push(
      "This Job Card had already been saved by your earlier attempt, so it was not saved twice. Changes made in the form after that attempt were not applied."
    );
  }

  return (
    <JobCardCreatedSuccessDialog
      jobCard={jobCard}
      missing={missing}
      notes={notes}
      checking={finishing}
      canAssign={canAssign}
      onCreateAnother={onCreateAnother}
      onClose={onClose}
    />
  );
}

// Optional Work Assignment During Job Card Creation Unit 7C, Task 3.
// Simplify Assignment Picker Unit 7D, Task 1: Supervisor uses the same
// searchable picker as Technicians/Helpers (capped to one selection).
function InternalTeamWizardFields({
  assignment,
  updateAssignment,
  activeWorkers,
  workerTeam,
}: {
  assignment: WizardAssignmentState;
  updateAssignment: (patch: Partial<WizardAssignmentState>) => void;
  activeWorkers: WorkerProfileRow[];
  workerTeam: string;
}) {
  const supervisors = activeWorkers.filter((w) => w.worker_type === "Supervisor");
  const technicians = activeWorkers.filter((w) => w.worker_type === "Technician");
  const helpers = activeWorkers.filter((w) => w.worker_type === "Helper/Labor");

  if (activeWorkers.length === 0) {
    return (
      <p className="text-sm text-[#4B5563]">
        No workers have been set up yet. Turn off &quot;Assign workers now&quot; and continue — workers can be assigned
        from the Job Card once they are added under Worker Profiles.
      </p>
    );
  }

  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 2:
  // every currently-selected worker across all three roles, in one list.
  const selectedIds = [
    ...(assignment.supervisorId ? [assignment.supervisorId] : []),
    ...assignment.technicianIds,
    ...assignment.helperIds,
  ];
  const selectedWorkers = selectedIds
    .map((id) => activeWorkers.find((w) => w.id === id))
    .filter((w): w is WorkerProfileRow => Boolean(w));

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#4B5563]">
        Pick at least one person. Type a name or employee ID in a box, then choose from the list (mouse, finger, or
        arrow keys and Enter).
      </p>
      <div>
        <WorkerPickerField
          label="Supervisor"
          hint="Optional"
          fieldName="assign_supervisor_id"
          workers={supervisors}
          selectedIds={assignment.supervisorId ? [assignment.supervisorId] : []}
          onChange={(ids) => updateAssignment({ supervisorId: ids[0] ?? "" })}
          multiple={false}
          emptyMessage="No supervisors are set up."
          preferredSkillCategory={workerTeam}
        />
        <p className={helpCls}>One supervisor. The same supervisor can look after several Job Cards at the same time.</p>
      </div>

      <WorkerPickerField
        label="Technicians"
        hint="Optional"
        fieldName="assign_technician_ids"
        workers={technicians}
        selectedIds={assignment.technicianIds}
        onChange={(ids) => updateAssignment({ technicianIds: ids })}
        multiple
        emptyMessage="No technicians are set up."
        preferredSkillCategory={workerTeam}
      />

      <WorkerPickerField
        label="Helpers / Labor"
        hint="Optional"
        fieldName="assign_helper_ids"
        workers={helpers}
        selectedIds={assignment.helperIds}
        onChange={(ids) => updateAssignment({ helperIds: ids })}
        multiple
        emptyMessage="No helpers or labor are set up."
        preferredSkillCategory={workerTeam}
      />

      {selectedWorkers.length > 0 && (
        <SelectedWorkersEstimateList
          workers={selectedWorkers}
          estimates={assignment.workerEstimates}
          onChangeEstimate={(workerId, value) =>
            updateAssignment({ workerEstimates: { ...assignment.workerEstimates, [workerId]: value } })
          }
        />
      )}
      {/* Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 2:
          one JSON hidden field carries the whole { workerId: hours } map —
          see parseWorkerEstimates in lib/work-orders/job-card-form.ts. */}
      <input type="hidden" name="assign_worker_estimates" value={JSON.stringify(assignment.workerEstimates)} />

      <label className="block">
        <FieldLabel label="Notes for the team" hint="Optional" />
        <textarea
          name="assign_notes"
          value={assignment.notes}
          onChange={(e) => updateAssignment({ notes: e.target.value })}
          rows={2}
          placeholder="e.g. Bring the hydraulic jack."
          className={`${inp} resize-none`}
        />
      </label>
    </div>
  );
}

// Job Card Estimated Hours UX Simplification Unit 10G.22, Task 2/3: one
// combined "Selected workers" list with an optional per-worker estimate —
// the only place an estimate is entered; the Job Card total is their sum
// (totalEstimatedHours in the wizard).
function SelectedWorkersEstimateList({
  workers,
  estimates,
  onChangeEstimate,
}: {
  workers: WorkerProfileRow[];
  estimates: Record<string, string>;
  onChangeEstimate: (workerId: string, value: string) => void;
}) {
  return (
    <div className="border-t border-[#E5E7EB] pt-4">
      <p className="text-sm font-bold text-[#111827]">
        Selected: {workers.length} {workers.length === 1 ? "person" : "people"}
      </p>
      <FieldLabel label="Expected hours for each person" hint="Optional" />
      <p className={helpCls}>
        About how many hours will this person work on this job? For example <span className="font-semibold">2</span> or{" "}
        <span className="font-semibold">1.5</span>. Leave empty if you don&apos;t know. The manager compares this with the
        real time recorded later.
      </p>
      <div className="mt-2 space-y-2">
        {workers.map((w) => (
          <div
            key={w.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2"
          >
            <span className="min-w-0 text-sm font-semibold text-[#111827]">
              {w.name}
              <span className="ml-1.5 text-xs font-normal text-[#6B7280]">{w.worker_type}</span>
            </span>
            <label className="flex shrink-0 items-center gap-2 text-sm text-[#4B5563]">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Expected hours for ${w.name}`}
                value={estimates[w.id] ?? ""}
                onChange={(e) => onChangeEstimate(w.id, e.target.value)}
                placeholder="—"
                className="focus-ring min-h-11 w-24 rounded-md border border-[#D1D5DB] px-2 py-1 text-right text-base text-[#111827] sm:text-sm"
              />
              hours
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function normalizeSearchText(s: string): string {
  return s.trim().toLowerCase();
}

// Worker Profile Form Simplification and Division Rename Unit 10G.6, Task 6:
// also matches Employee ID — name/phone/division/type matching unchanged.
function matchesWorkerQuery(w: WorkerProfileRow, q: string): boolean {
  if (!q) return true;
  return [w.employee_id, w.name, w.phone, w.skill_category, w.worker_type]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(q));
}

// Simplify Assignment Picker Unit 7D, Tasks 1–5: a search-to-add / chip-to-
// remove picker. Reused for Supervisor (multiple=false, capped at one chip),
// Technicians, and Helpers/Labor. Search runs client-side over the already-
// fetched active worker list. Works as a combobox: arrow keys move through
// the list, Enter adds, Escape closes the list (not the wizard).
function WorkerPickerField({
  label,
  hint,
  fieldName,
  workers,
  selectedIds,
  onChange,
  multiple,
  emptyMessage,
  preferredSkillCategory,
}: {
  label: string;
  hint?: string;
  fieldName: string;
  workers: WorkerProfileRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple: boolean;
  emptyMessage: string;
  preferredSkillCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = `${fieldName}-options`;

  // Task 4: no active workers of this type at all — nothing to search.
  if (workers.length === 0) {
    return (
      <div>
        <FieldLabel label={label} hint={hint} />
        <p className="mt-1.5 text-sm text-[#6B7280]">{emptyMessage}</p>
      </div>
    );
  }

  const selectedWorkers = selectedIds
    .map((id) => workers.find((w) => w.id === id))
    .filter((w): w is WorkerProfileRow => Boolean(w));

  const q = normalizeSearchText(query);
  const available = workers.filter((w) => !selectedIds.includes(w.id) && matchesWorkerQuery(w, q));
  // Task 5: workers whose skill category matches the selected Work Team /
  // Division float to the top.
  const sorted = [...available].sort((a, b) => {
    if (preferredSkillCategory) {
      const aMatch = (a.skill_category ?? "").toLowerCase() === preferredSkillCategory.toLowerCase();
      const bMatch = (b.skill_category ?? "").toLowerCase() === preferredSkillCategory.toLowerCase();
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const results = sorted.slice(0, 8);
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  function addWorker(id: string) {
    onChange(multiple ? [...selectedIds, id] : [id]);
    setQuery("");
    setOpen(false);
    setActive(0);
  }
  function removeWorker(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  // Supervisor (multiple=false): once one is picked, hide the search box —
  // "Remove" first, then search again.
  const showSearch = multiple || selectedWorkers.length === 0;
  const singular = label === "Helpers / Labor" ? "helper" : label.toLowerCase().replace(/s$/, "");

  return (
    <div>
      <FieldLabel label={label} hint={hint} />

      {selectedWorkers.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Selected ${label.toLowerCase()}`}>
          {selectedWorkers.map((w) => (
            <li
              key={w.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#ED1C24]/40 bg-[#FEF2F2] py-1 pl-3 pr-1 text-sm font-semibold text-[#111827]"
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-[#ED1C24]" aria-hidden="true" />
              <span className="truncate">{w.name}</span>
              <button
                type="button"
                onClick={() => removeWorker(w.id)}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6B7280] hover:bg-white hover:text-[#DC2626]"
                aria-label={`Remove ${w.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {showSearch && (
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
          <input
            type="text"
            role="combobox"
            aria-label={`Find a ${singular}`}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && results[activeIndex] ? `${listId}-${results[activeIndex].id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (open && results[activeIndex]) addWorker(results[activeIndex].id);
              } else if (e.key === "Escape" && open) {
                // Handled here: the wizard must not also ask to discard.
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={`Type a ${singular}'s name or employee ID…`}
            autoComplete="off"
            className={`${inp} mt-0 pl-9`}
          />

          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#E5E7EB] bg-white shadow-lg">
              {results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#6B7280]">
                  {q ? `No ${singular} matches "${query.trim()}". Check the spelling or try the employee ID.` : "Everyone in this list is already selected."}
                </p>
              ) : (
                <ul id={listId} role="listbox" aria-label={label} className="divide-y divide-[#F3F4F6]">
                  {results.map((w, i) => (
                    <li
                      key={w.id}
                      id={`${listId}-${w.id}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addWorker(w.id);
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={`cursor-pointer px-3 py-2.5 ${i === activeIndex ? "bg-[#FEF2F2]" : "hover:bg-gray-50"}`}
                    >
                      <p className="text-sm font-bold text-[#111827]">
                        {w.employee_id ? `${w.employee_id} • ` : ""}
                        {w.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#6B7280]">
                        {w.worker_type}
                        {w.skill_category ? ` • ${w.skill_category}` : ""}
                        {w.phone ? ` • ${w.phone}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {selectedIds.map((id) => (
        <input key={id} type="hidden" name={fieldName} value={id} />
      ))}
    </div>
  );
}

function WizardCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="mb-5 border-b border-[#E5E7EB] pb-4">
        <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-[#4B5563]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// A labelled text input used by the Freelancer / External Company fields.
function LabeledInput({
  label,
  name,
  value,
  onChange,
  placeholder,
  required,
  inputMode,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "text" | "tel" | "decimal";
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} hint={required ? undefined : "optional"} />
      <input
        name={name}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inp}
      />
    </label>
  );
}

// Error text under a field — large enough to notice, announced to screen readers.
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm font-semibold text-[#DC2626]">
      {message}
    </p>
  );
}

// Digits with an optional decimal point (no commas, signs or letters).
function isPlainNumber(raw: string): boolean {
  return /^\d+(\.\d+)?$|^\.\d+$/.test(raw.trim());
}

function FieldLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <span className="block text-sm font-semibold text-[#111827]">
      {label}
      {required && (
        <span className="ml-0.5 text-[#ED1C24]">
          {" "}*<span className="sr-only"> (required)</span>
        </span>
      )}
      {hint && <span className="ml-2 text-xs font-normal text-[#6B7280]">({hint.replace(/^Optional$/i, "optional")})</span>}
    </span>
  );
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  // Goes back to the step where this information is entered.
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-wide text-[#4B5563]">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="focus-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-bold text-[#ED1C24] hover:bg-red-50"
            aria-label={`Edit ${title}`}
          >
            Edit
          </button>
        )}
      </div>
      <div className="rounded-md border border-[#E5E7EB] p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined | null;
}) {
  if (!value) return null;
  return (
    <div className="py-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[#111827]">{value}</dd>
    </div>
  );
}

