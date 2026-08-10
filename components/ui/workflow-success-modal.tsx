"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

// Popup and Feedback Design Standardization Unit 8D, Task 2.
//
// Shared shell for every "major workflow action completed — here's what
// changed and what to do next" popup: Job Card Started/Created/Closed,
// Closure Requested/Approved, Materials Request Created/Received,
// Correction Sent, etc. Extracted from the (already near-identical)
// hand-rolled markup those screens had converged on independently — same
// backdrop, dialog shell, icon circle, title/description, summary card,
// status badge, and footer button row, just previously copy-pasted into
// each modal with small drifts (see context/feedback-standard.md for the
// full usage rules and the drift this fixed).
//
// Rendered conditionally by the host page (`{show && <WorkflowSuccessModal
// .../>}`), matching every other modal/popup convention already used across
// this codebase (LargeFormModal, the quick-view popup, etc.) — no `open`
// prop, no portal, no animation library.

export type WorkflowSuccessIconVariant = "success" | "warning" | "info";

export type WorkflowSuccessSummaryItem = {
  label: string;
  value: ReactNode;
};

export type WorkflowSuccessAction =
  | { kind: "link"; label: string; href: string; onClick?: () => void }
  | { kind: "button"; label: string; onClick: () => void }
  // For the one case (Activate Job Card on a just-created Draft) where the
  // primary action is a real server-action form submit, not a navigation —
  // hiddenFields become <input type="hidden"> children of the <form>.
  | { kind: "form"; label: string; action: (formData: FormData) => void | Promise<void>; hiddenFields?: Record<string, string> };

export type WorkflowSuccessModalProps = {
  title: string;
  description: ReactNode;
  iconVariant?: WorkflowSuccessIconVariant;
  /** Small amber inline notices under the description — e.g. "some attachments failed to upload". */
  warnings?: string[];
  statusLabel?: { label: string; tone?: "green" | "amber" | "red" | "blue" | "gray" };
  summaryItems?: WorkflowSuccessSummaryItem[];
  nextStepTitle?: string;
  nextStepDescription?: ReactNode;
  /** Simple stage pill row (e.g. Draft → Active → Closure Requested → Closed). */
  progressSteps?: { steps: readonly string[]; currentIndex: number };
  primaryAction?: WorkflowSuccessAction;
  secondaryActions?: WorkflowSuccessAction[];
  /** Dismiss handler shared by the backdrop click, the X button, Esc, and the trailing "Close" text button. */
  closeAction: () => void;
  closeLabel?: string;
  headingId?: string;
};

const ICON_STYLE: Record<WorkflowSuccessIconVariant, { bg: string; fg: string; Icon: typeof CheckCircle2 }> = {
  success: { bg: "bg-green-50", fg: "text-[#16A34A]", Icon: CheckCircle2 },
  warning: { bg: "bg-amber-50", fg: "text-amber-600", Icon: AlertTriangle },
  info: { bg: "bg-blue-50", fg: "text-blue-600", Icon: Info },
};

function ActionButton({ action, variant }: { action: WorkflowSuccessAction; variant: "primary" | "secondary" }) {
  const cls =
    variant === "primary"
      ? "flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
      : "flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50";

  if (action.kind === "link") {
    return (
      <Link href={action.href} onClick={action.onClick} className={cls}>
        {action.label}
      </Link>
    );
  }
  if (action.kind === "form") {
    return (
      <form action={action.action} className="contents">
        {Object.entries(action.hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button type="submit" className={cls}>
          {action.label}
        </button>
      </form>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}

export function WorkflowSuccessModal({
  title,
  description,
  iconVariant = "success",
  warnings = [],
  statusLabel,
  summaryItems = [],
  nextStepTitle = "Next Recommended Step",
  nextStepDescription,
  progressSteps,
  primaryAction,
  secondaryActions = [],
  closeAction,
  closeLabel = "Close",
  headingId = "workflow-success-heading",
}: WorkflowSuccessModalProps) {
  const primaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusable = primaryRef.current?.querySelector<HTMLElement>("a, button");
    focusable?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAction();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const { bg, fg, Icon } = ICON_STYLE[iconVariant];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={closeAction} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh]"
        >
          <button
            onClick={closeAction}
            className="absolute right-4 top-4 rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
              <div className={`flex h-16 w-16 items-center justify-center rounded-full ${bg}`}>
                <Icon className={`h-9 w-9 ${fg}`} aria-hidden="true" />
              </div>
              <h2 id={headingId} className="mt-4 text-xl font-black text-[#111827]">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{description}</p>

              {warnings.map((w) => (
                <div
                  key={w}
                  className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{w}</span>
                </div>
              ))}
            </div>

            <div className="px-6 py-4">
              {summaryItems.length > 0 && (
                <div className="mb-4 space-y-1.5 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-left text-sm">
                  {summaryItems.map((item) => (
                    <div key={item.label}>
                      <span className="font-semibold text-[#111827]">{item.label}:</span>{" "}
                      <span className="text-[#4B5563]">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {statusLabel && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Current status</span>
                  <StatusBadge label={statusLabel.label} tone={statusLabel.tone ?? "blue"} />
                </div>
              )}

              {nextStepDescription && (
                <div className="mt-4 rounded-md border border-[#FEE2E2] bg-red-50 px-4 py-3 text-left">
                  <p className="text-[11px] font-black uppercase tracking-wide text-[#ED1C24]">{nextStepTitle}</p>
                  <p className="mt-1 text-sm font-semibold leading-relaxed text-[#111827]">{nextStepDescription}</p>
                </div>
              )}

              {progressSteps && (
                <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md bg-[#F5F6F8] px-3 py-2.5">
                  {progressSteps.steps.map((stage, idx) => (
                    <div key={stage} className="flex shrink-0 items-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          idx === progressSteps.currentIndex
                            ? "bg-[#ED1C24] text-white"
                            : idx < progressSteps.currentIndex
                              ? "bg-green-100 text-[#16A34A]"
                              : "bg-white text-[#9CA3AF]"
                        }`}
                      >
                        {stage}
                      </span>
                      {idx < progressSteps.steps.length - 1 && (
                        <span className="mx-1 text-xs text-[#9CA3AF]" aria-hidden="true">→</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div ref={primaryRef} className="flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row sm:flex-wrap">
            {primaryAction && <ActionButton action={primaryAction} variant="primary" />}
            {secondaryActions.map((action) => (
              <ActionButton key={action.label} action={action} variant="secondary" />
            ))}
            <button
              type="button"
              onClick={closeAction}
              className="flex min-h-[44px] items-center justify-center whitespace-nowrap px-3 text-xs font-semibold text-[#9CA3AF] transition hover:text-[#4B5563] sm:flex-none"
            >
              {closeLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
