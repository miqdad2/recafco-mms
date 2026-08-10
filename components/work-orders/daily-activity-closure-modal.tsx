"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Plus, X, XCircle } from "lucide-react";

import { requestJobCardClosureModalAction } from "@/app/actions/workflow";
import { uploadWorkOrderFileModalAction } from "@/app/actions/files";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";
import type { DailyActivityCardData } from "@/components/work-orders/daily-activity-card";

// Daily Activity Closure Request Modal with Attachments Unit 10F.6, extended
// by Closure Request Modal Optional Note and Multiple Custom Attachments
// Unit 10F.6B.
//
// Task 1's summary/readiness data still comes entirely from the `card` prop
// the parent panel already has loaded — no new fetch. Only the two submit
// actions (requestJobCardClosureModalAction / uploadWorkOrderFileModalAction)
// are real network calls, and both are thin non-redirecting wrappers around
// the real, unmodified backend logic (see their own comments in app/actions/).

// Unit 10F.6B, Task 5 — suggestions for the one existing attachment_type
// text field (2-80 chars, no separate description column in
// work_order_attachments — see app/actions/files.ts), offered via a native
// <input list="..."> combobox so the user can pick one OR type anything
// else freely (Task 5: "Do not force the user to use only dropdown
// values."). Local to this modal only; does not touch
// lib/files/attachment-constants.ts's JOB_CARD_ATTACHMENT_CATEGORIES, which
// has no closure-specific option.
const CLOSURE_ATTACHMENT_SUGGESTIONS = [
  "Completed Work Photo",
  "Technician Report",
  "Invoice / Bill",
  "Before/After Photo",
  "Inspection Document",
  "Other",
];

// Unit 10F.6B, Task 4 — UI cap only; the loop below just calls the existing
// one-file-per-call upload action once per row, so nothing backend-side
// limits this — 5 keeps the form manageable, per the task's own minimum.
const MAX_ATTACHMENT_ROWS = 5;

type AttachmentRow = { id: string; type: string; file: File | null };

function emptyAttachmentRow(): AttachmentRow {
  return { id: crypto.randomUUID(), type: "", file: null };
}

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "mb-1 block text-xs font-bold text-[#4B5563]";

function ChecklistRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
      )}
      <span className={ok ? "text-[#111827]" : "text-[#6B7280]"}>{label}</span>
    </li>
  );
}

export function DailyActivityClosureModal({
  card,
  onClose,
}: {
  card: DailyActivityCardData;
  onClose: () => void;
}) {
  const router = useRouter();
  const datalistId = useId();
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<AttachmentRow[]>([emptyAttachmentRow()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Unit 10F.6B, Task 3 — readiness checklist no longer includes the note
  // (it's not a blocker); only the two real closure guards this page mirrors
  // remain. Materials/session data is the same read-only mirror of the real
  // backend guards used everywhere else on this page — never re-derived.
  const materialsReady = card.materialsChip.label === "Materials Completed";
  const noActiveSession = !card.laborSummary.has_active_session;
  const isReady = card.closureChip.label === "Ready";
  const blockers = card.closureReasons;

  // Task 6 — a row with a typed name but no chosen file can't be uploaded;
  // a fully blank row is simply ignored (never blocks submit).
  const invalidRows = rows.filter((r) => r.type.trim() !== "" && !r.file);
  const uploadableRows = rows.filter((r) => r.file !== null);

  function updateRow(id: string, patch: Partial<AttachmentRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => (prev.length >= MAX_ATTACHMENT_ROWS ? prev : [...prev, emptyAttachmentRow()]));
  }
  function removeRow(id: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (invalidRows.length > 0) {
      setSubmitError("Choose a file or remove this row.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Task 7 — every selected attachment is uploaded first (Manager sees
      // them immediately once closure is requested), then the closure
      // request itself is submitted regardless of individual upload
      // outcomes: closure is the primary action here and attachments are
      // optional, so one failed/flaky file must never block the Job Card
      // from reaching Manager review. Uploaded sequentially (not
      // Promise.all) — each call is a real disk write + DB insert + audit
      // log + notification, and predictable one-at-a-time behavior is
      // safer than raising several of those concurrently for the same Job
      // Card. Chosen deliberately over blocking closure on upload failure
      // (Task 7's documented alternative) for this reason.
      let anyUploadFailed = false;
      for (const row of uploadableRows) {
        const uploadForm = new FormData();
        uploadForm.set("work_order_id", card.id);
        uploadForm.set("attachment_type", row.type.trim() || row.file!.name);
        uploadForm.set("file", row.file!);
        const uploadResult = await uploadWorkOrderFileModalAction(null, uploadForm);
        if (!uploadResult?.ok) anyUploadFailed = true;
      }

      const closureForm = new FormData();
      closureForm.set("work_order_id", card.id);
      closureForm.set("note", note.trim());
      const closureResult = await requestJobCardClosureModalAction(null, closureForm);

      if (!closureResult?.ok) {
        setSubmitError(closureResult?.error ?? "Failed to request closure.");
        return;
      }

      // Task 7 — do not create a partial confusing state: closure success
      // is always reported, with a clear separate warning if any (optional)
      // attachment did not make it.
      if (anyUploadFailed) {
        dispatchActionToast({
          tone: "warning",
          title: "Closure Request Sent",
          description: "Closure request was sent, but some attachments failed to upload. You can upload them from the Job Card Attachments tab.",
        });
      } else {
        dispatchActionToast({
          tone: "success",
          title: "Closure Request Sent",
          description: "Manager will be notified to review and approve.",
        });
      }
      onClose();
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <LargeFormModal title="Request Job Card Closure" subtitle="Submit completed work for Manager approval." onClose={onClose}>
      <div className="space-y-4">
        {/* Job Card summary */}
        <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-[#111827]">{card.workOrderNumber ?? "Job Card"}</p>
            <StatusBadge label={card.displayStatus} tone={card.displayStatusTone} />
          </div>
          <p className="mt-1 text-xs text-[#4B5563]">{card.assetLabel ?? "No asset linked"}</p>
          <p className="mt-0.5 text-xs text-[#374151]">{card.issue}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#6B7280] sm:grid-cols-3">
            <span>Workers: <strong className="text-[#111827]">{card.laborSummary.workers.length}</strong></span>
            <span>Materials: <strong className="text-[#111827]">{card.materialsChip.label}</strong></span>
            <span>Work time: <strong className="text-[#111827]">{card.workTimeChip.label}</strong></span>
          </div>
        </div>

        {/* Readiness checklist / blockers */}
        <div className="rounded-md border border-[#E5E7EB] p-3">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Closure Readiness</p>
          <ul className="space-y-1.5">
            <ChecklistRow ok={materialsReady} label="Materials completed" />
            <ChecklistRow ok={noActiveSession} label="No active worker session" />
          </ul>
          {!isReady && blockers.length > 0 ? (
            <div className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{blockers.join(" · ")}</span>
            </div>
          ) : null}
        </div>

        {/* Unit 10F.6B, Task 1 — completion note is optional. */}
        <div>
          <label htmlFor="closure-note" className={lbl}>
            Completion note / remarks (optional)
          </label>
          <textarea
            id="closure-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add remarks about completed work, if needed."
            className={`${inp} resize-none`}
            disabled={isSubmitting}
          />
          <p className="mt-1 text-[11px] text-[#9CA3AF]">Optional. Add remarks if needed.</p>
        </div>

        {/* Unit 10F.6B, Task 4/5/6 — repeatable attachment rows, each a free
            combobox (suggestions + free typing) + file picker. */}
        <div className="rounded-md border border-dashed border-[#E5E7EB] p-3">
          <p className={lbl}>Completion attachments (optional)</p>
          <datalist id={datalistId}>
            {CLOSURE_ATTACHMENT_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="space-y-2.5">
            {rows.map((row, i) => {
              const rowInvalid = row.type.trim() !== "" && !row.file;
              return (
                <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    {i === 0 ? <label className="mb-1 block text-[11px] text-[#6B7280]">Attachment name / type</label> : null}
                    <input
                      type="text"
                      list={datalistId}
                      value={row.type}
                      onChange={(e) => updateRow(row.id, { type: e.target.value })}
                      placeholder="e.g. Completed work photo"
                      className={inp}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    {i === 0 ? <label className="mb-1 block text-[11px] text-[#6B7280]">File</label> : null}
                    <input
                      type="file"
                      onChange={(e) => updateRow(row.id, { file: e.target.files?.[0] ?? null })}
                      className={inp}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className={i === 0 ? "sm:pb-0.5" : ""}>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={isSubmitting}
                        aria-label="Remove this attachment row"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] transition hover:bg-gray-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {rowInvalid ? (
                    <p className="sm:col-span-3 text-[11px] font-semibold text-[#B45309]">Choose a file or remove this row.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {rows.length < MAX_ATTACHMENT_ROWS ? (
            <button
              type="button"
              onClick={addRow}
              disabled={isSubmitting}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add another file
            </button>
          ) : null}
          <p className="mt-1.5 text-[11px] text-[#9CA3AF]">
            Up to {MAX_ATTACHMENT_ROWS} files here — you can upload more later from the Job Card&apos;s Attachments tab.
          </p>
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isReady || invalidRows.length > 0 || isSubmitting}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? "Requesting…" : "Request Closure"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </LargeFormModal>
  );
}
