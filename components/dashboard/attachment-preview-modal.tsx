"use client";

import Link from "next/link";
import { ExternalLink, FileText, X } from "lucide-react";

import type { ClosureReviewAttachment } from "@/app/actions/closure-requests";

// Manager Closure Review Cleanup and Attachment Preview Unit 10G.25, Task 7.
//
// Stacks ABOVE the still-open Closure Review popup (z-[60]/z-[70], one tier
// above LargeFormModal's z-40/z-50 — the same convention
// components/store/store-send-materials-popup.tsx already uses for a modal
// opened from inside another modal) rather than swapping it out in place, so
// closing this preview returns to the same Closure Review popup, still
// scrolled to the same place, instead of losing it.
//
// Lazy by construction, not by an extra loading flag: this component (and
// the <img>/<iframe> it renders) is only ever mounted once the Manager
// clicks Preview — before that, only the lightweight attachment ROW data
// (type/name/uploader/date, no binary) has ever been fetched by
// getClosureReviewDetailAction. The actual file bytes are only requested
// once the <img>/<iframe> src below is rendered, via the exact same signed
// proxy route (/api/files/[bucket]/[...path]) every other attachment link in
// this app already uses — same bucket+entity authorization check, same
// storage path, nothing new added to the file-access surface.

function attachmentKind(fileName: string): "image" | "pdf" | "other" {
  const ext = fileName.match(/\.[^./?#]+$/)?.[0]?.toLowerCase() ?? "";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  return "other";
}

export function AttachmentPreviewModal({ attachment, onClose }: { attachment: ClosureReviewAttachment; onClose: () => void }) {
  const kind = attachmentKind(attachment.fileName);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attachment-preview-heading"
          className="flex max-h-[90vh] w-[min(92vw,720px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Task 7/8 — attachment type/name + uploaded-by/date audit info,
              same fields the Attachments list row already shows, repeated
              here so the Manager doesn't lose that context while previewing. */}
          <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
            <div className="min-w-0">
              <h2 id="attachment-preview-heading" className="text-lg font-black text-[#111827]">
                Attachment Preview
              </h2>
              <p className="mt-0.5 truncate text-sm font-semibold text-[#374151]">
                {attachment.type} <span className="font-normal text-[#6B7280]">— {attachment.fileName}</span>
              </p>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">
                Uploaded by {attachment.uploadedByName ?? "Unknown"} · {attachment.uploadedAtLabel}
              </p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#F5F6F8] p-4">
            {!attachment.viewUrl ? (
              <p className="rounded-md border border-[#E5E7EB] bg-white p-4 text-sm text-[#6B7280]">
                Access restricted — you do not have permission to view this file.
              </p>
            ) : kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, authorization-gated file proxy URL; next/image's static domain allowlist does not apply to /api/files/*
              <img
                src={attachment.viewUrl}
                alt={attachment.fileName}
                className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md border border-[#E5E7EB] bg-white object-contain"
              />
            ) : kind === "pdf" ? (
              // Attachment Preview URL Fix Unit 10G.29: attachment.viewUrl
              // was always a same-origin relative path (/api/files/...,
              // from createSignedFileUrl) — never hardcoded localhost. What
              // actually broke this <iframe> ("localhost refused to
              // connect") was next.config.ts's blanket
              // X-Frame-Options: DENY on every route, which blocks ALL
              // framing of the file-serving route, even by this same app.
              // Fixed there (overridden to SAMEORIGIN for /api/files/:path*
              // only) — same-origin framing now works on any origin this
              // app is served from, dev or deployed, with no URL change
              // needed here.
              <div className="space-y-2">
                <iframe src={attachment.viewUrl} title={attachment.fileName} className="h-[70vh] w-full rounded-md border border-[#E5E7EB] bg-white" />
                <p className="text-xs text-[#9CA3AF]">
                  If the PDF preview doesn&apos;t display,{" "}
                  <Link href={attachment.viewUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[#2563EB] hover:underline">
                    open it in a new tab
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border border-[#E5E7EB] bg-white p-8 text-center">
                <FileText className="h-10 w-10 text-[#9CA3AF]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-[#111827]">{attachment.fileName}</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">Preview is not available for this file type.</p>
                </div>
                <Link
                  href={attachment.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open / Download
                </Link>
              </div>
            )}
          </div>

          {attachment.viewUrl && kind !== "other" ? (
            <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] px-5 py-3">
              <Link
                href={attachment.viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open in new tab
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-8 items-center rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 border-t border-[#E5E7EB] px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-8 items-center rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
