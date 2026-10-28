"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Box,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Hammer,
  List,
  Loader2,
  PackageSearch,
  Paperclip,
  Plus,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { JobCardCreatedSummary } from "@/lib/work-orders/job-card-create-result";
import { formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import { formatJobCardDate, NOT_ENTERED } from "@/lib/work-orders/job-card-edit";

// Job Card Success Popup UI/UX Improvement — the confirmation the New Job
// Card wizard shows once the server has confirmed the Job Card exists.
// Presentation only: every value comes from the stored record the server
// returned (JobCardCreatedSummary), the caller decides what is missing, and
// the buttons only navigate (or restart the wizard) — none can send another
// create request.

const WORKFLOW_STAGES = ["Draft", "Active", "Closure Requested", "Closed"] as const;

const btnBase =
  "inline-flex min-h-12! w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24] focus-visible:ring-offset-2 motion-reduce:transition-none";
const btnPrimary = `${btnBase} bg-[#ED1C24] text-white hover:bg-[#c8181e]`;
const btnSecondary = `${btnBase} border border-[#D1D5DB] bg-white text-[#111827] hover:border-[#9CA3AF] hover:bg-[#F9FAFB]`;

function InfoRow({ icon: Icon, label, value, wide = false }: { icon: LucideIcon; label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 items-start gap-2.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-[#6B7280]">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-semibold text-[#111827]">{value}</dd>
      </div>
    </div>
  );
}

const muted = (text: string) => <span className="font-medium text-[#9CA3AF]">{text}</span>;

function recommendation(jobCard: JobCardCreatedSummary, partial: boolean, canAssign: boolean): string {
  if (partial) return "Open the Job Card to add the details that were not saved. Do not create this Job Card again — it already exists.";
  if (jobCard.isDraft) return "Open the Job Card and activate it when work is ready to begin.";
  // Only actions this user can take: worker assignment / time tracking need
  // work_orders.assign (the same flag that showed "Assign workers now" in
  // the wizard); following materials and monitoring are open to everyone
  // who can create Job Cards.
  const parts: string[] = [];
  if (canAssign) parts.push(jobCard.assignedTeam.length > 0 ? "track worker time" : "assign workers");
  if (jobCard.requiredMaterialsCount > 0) parts.push("follow the materials");
  parts.push("monitor this Job Card");
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0];
  return `Open Daily Activity to ${list}.`;
}

export function JobCardCreatedSuccessDialog({
  jobCard,
  missing,
  notes,
  checking,
  canAssign,
  onCreateAnother,
  onClose,
}: {
  jobCard: JobCardCreatedSummary;
  // Entered but not stored — non-empty means partial success.
  missing: string[];
  notes: string[];
  // The request that created it may still be adding its follow-up details.
  checking: boolean;
  canAssign: boolean;
  onCreateAnother: () => void;
  // Go to Job Cards / close / Escape.
  onClose: () => void;
}) {
  const partial = missing.length > 0;
  const primaryRef = useRef<HTMLAnchorElement>(null);
  const restartingRef = useRef(false);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const detailHref = `/maintenance/work-orders/${jobCard.id}`;
  // Daily Activity's existing free-text search (matches the Job Card number).
  const dailyActivityHref = jobCard.number ? `/maintenance/daily-activity?q=${encodeURIComponent(jobCard.number)}` : "/maintenance/daily-activity";
  // The three Job Card dates as saved, in the same "27 Oct 2026" format as
  // the Job Card page, print and Daily Activity; "Not entered" when blank.
  // Created On is the system time and never stands in for Order Date.
  const dateValue = (value: string | null) => (value ? formatJobCardDate(value) : muted(NOT_ENTERED));
  const title = partial
    ? `${jobCard.isDraft ? "Draft" : "Job Card"} Created — Some Details Were Not Saved`
    : jobCard.isDraft
      ? "Job Card Draft Saved"
      : "Job Card Created Successfully";
  const stageIndex = jobCard.isDraft ? 0 : 1;

  function createAnother() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    onCreateAnother();
  }

  // Draft Job Cards are not on Daily Activity, so a Draft leads with its own page.
  const showDailyActivity = !jobCard.isDraft;
  const firstIsDetails = partial || jobCard.isDraft;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jc-created-title"
          aria-describedby="jc-created-number"
          className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5 sm:px-8 sm:pt-6">
            {/* Heading block */}
            <div className="text-center" role="status" aria-live="polite">
              <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${partial ? "bg-amber-50" : "bg-green-50"}`}>
                {partial ? (
                  <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-9 w-9 text-[#16A34A]" aria-hidden="true" />
                )}
              </div>
              <h2 id="jc-created-title" className="mt-3 text-xl font-black leading-tight text-[#111827] sm:text-2xl">
                {title}
              </h2>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Job Card Number</p>
              <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <p id="jc-created-number" className="break-all font-mono text-2xl font-black tracking-wide text-[#ED1C24] sm:text-[26px]">
                  {jobCard.number ?? "—"}
                </p>
                <StatusBadge label={jobCard.isDraft ? "Draft" : "Active"} tone={jobCard.isDraft ? "gray" : "blue"} />
              </div>
              {checking && (
                <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#4B5563]">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Checking the assignment, materials and attachments…
                </p>
              )}
            </div>

            {partial && (
              <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-bold">The Job Card is saved, but these details were not:</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  {missing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {notes.map((n) => (
              <p key={n} className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-xs text-[#4B5563]">
                {n}
              </p>
            ))}

            {/* Saved information — two columns from sm:, one on phones */}
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-lg border border-[#E5E7EB] p-4 sm:grid-cols-2">
              <InfoRow icon={Box} label="Asset" value={[jobCard.assetCode, jobCard.assetName].filter(Boolean).join(" — ") || muted("Not linked")} />
              <InfoRow icon={Hammer} label="Maintenance Type" value={jobCard.maintenanceType ?? muted("—")} />
              <InfoRow icon={CalendarDays} label="Order Date" value={dateValue(jobCard.dateOfOrder)} />
              <InfoRow icon={Users} label="Team / Division" value={jobCard.workerTeam ?? muted("—")} />
              <InfoRow icon={CalendarDays} label="Job Card Open Date" value={dateValue(jobCard.jobCardStartDate)} />
              <InfoRow icon={CalendarDays} label="Job Card Closed Date" value={dateValue(jobCard.jobCardEndDate)} />
              {jobCard.createdAt ? (
                <InfoRow icon={Clock} label="Created On (system)" wide value={formatKuwaitDateTime(jobCard.createdAt)} />
              ) : null}
              <InfoRow
                icon={UserCheck}
                label="Assigned Team"
                wide
                value={jobCard.assignedTeam.length ? jobCard.assignedTeam.join(", ") : muted("Not assigned")}
              />
              <InfoRow
                icon={PackageSearch}
                label="Required Materials"
                value={jobCard.requiredMaterialsCount ? `${jobCard.requiredMaterialsCount} line${jobCard.requiredMaterialsCount === 1 ? "" : "s"}` : muted("None")}
              />
              <InfoRow
                icon={ClipboardList}
                label="Materials Request"
                value={
                  jobCard.materialsRequests.length
                    ? jobCard.materialsRequests.map((r) => `${r.number ?? "Request"} (${r.status})`).join(", ")
                    : muted("None")
                }
              />
              <InfoRow
                icon={Paperclip}
                label="Attachments"
                value={jobCard.attachmentsCount ? `${jobCard.attachmentsCount} file${jobCard.attachmentsCount === 1 ? "" : "s"}` : muted("None")}
              />
            </dl>

            {/* Recommended next step */}
            <div className="mt-3 rounded-lg border border-[#FECACA] bg-red-50/60 px-4 py-2.5">
              <p className="text-[11px] font-black uppercase tracking-wider text-[#ED1C24]">Recommended Next Step</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-[#111827]">{recommendation(jobCard, partial, canAssign)}</p>
              <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px] font-bold" aria-label="Job Card stages">
                {WORKFLOW_STAGES.map((stage, i) => (
                  <li key={stage} className="flex items-center gap-1">
                    <span
                      aria-current={i === stageIndex ? "step" : undefined}
                      className={`rounded-full px-2 py-0.5 ${
                        i === stageIndex ? "bg-[#ED1C24] text-white" : i < stageIndex ? "bg-green-100 text-[#15803D]" : "bg-white text-[#6B7280] ring-1 ring-[#E5E7EB]"
                      }`}
                    >
                      {stage}
                    </span>
                    {i < WORKFLOW_STAGES.length - 1 && <span className="text-[#9CA3AF]" aria-hidden="true">→</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Actions — always visible; 2×2 from sm:, stacked on phones */}
          <div className="shrink-0 border-t border-[#E5E7EB] bg-white px-5 py-3 sm:px-8">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {firstIsDetails ? (
                <Link ref={primaryRef} href={detailHref} className={`${btnPrimary} ${showDailyActivity ? "" : "sm:col-span-2"}`}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {partial ? "Open Job Card to Complete" : "View Job Card Details"}
                </Link>
              ) : (
                <Link ref={primaryRef} href={dailyActivityHref} className={btnPrimary}>
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  Open in Daily Activity
                </Link>
              )}
              {firstIsDetails ? (
                showDailyActivity ? (
                  <Link href={dailyActivityHref} className={btnSecondary}>
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    Open in Daily Activity
                  </Link>
                ) : null
              ) : (
                <Link href={detailHref} className={btnSecondary}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  View Job Card Details
                </Link>
              )}
              <button type="button" onClick={createAnother} className={btnSecondary}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Another Job Card
              </button>
              <Link href="/maintenance/work-orders" className={btnSecondary}>
                <List className="h-4 w-4" aria-hidden="true" />
                Go to Job Cards
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
