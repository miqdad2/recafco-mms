"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { ACTION_TOAST_EVENT, resolveToastMessage, type ToastMessage, type ToastTone } from "@/lib/action-messages";

// Popup and Feedback Design Standardization Unit 8D, Task 5.
//
// This used to be a full-screen, backdrop-blurred, centered card — visually
// indistinguishable from a modal, which is exactly the inconsistency this
// unit fixes (see components/notifications/notification-toast-center.tsx's
// own long-standing comment calling this out: "that one is a full-screen
// centered modal-style overlay... which [it] explicitly says a real-time
// popup must not be"). Now a compact, corner-anchored, non-blocking card —
// same rounded-corner/icon-circle/close-X visual language as
// WorkflowSuccessModal and NotificationToastCenter, just smaller and with no
// backdrop. See context/feedback-standard.md for the full usage rules (when
// to use this vs. WorkflowSuccessModal).
//
// Anchored bottom-right (NotificationToastCenter, a different kind of
// feedback — pushed from elsewhere, not this tab's own action — keeps
// top-right) so the two never physically overlap, and lifted above the
// fixed mobile bottom nav bar on small screens.

// ── Tone config ────────────────────────────────────────────────────────────────

const TONE: Record<
  ToastTone,
  {
    bar:       string;
    iconBg:    string;
    iconColor: string;
    border:    string;
    live:      "polite" | "assertive";
    role:      "status" | "alert";
  }
> = {
  success: { bar: "bg-green-500",  iconBg: "bg-green-50",  iconColor: "text-green-600",  border: "border-[#E5E7EB]",  live: "polite",    role: "status" },
  error:   { bar: "bg-[#ED1C24]",  iconBg: "bg-red-50",    iconColor: "text-red-600",    border: "border-red-100",   live: "assertive", role: "alert"  },
  warning: { bar: "bg-amber-400",  iconBg: "bg-amber-50",  iconColor: "text-amber-600",  border: "border-amber-100", live: "assertive", role: "alert"  },
  info:    { bar: "bg-blue-500",   iconBg: "bg-blue-50",   iconColor: "text-blue-600",   border: "border-[#E5E7EB]", live: "polite",    role: "status" },
};

// ── Icon inside a soft circle (same shapes as WorkflowSuccessModal, smaller) ───

function ToastIcon({ tone }: { tone: ToastTone }) {
  const t = TONE[tone];
  const iconCls = `h-4 w-4 ${t.iconColor}`;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.iconBg}`}>
      {tone === "success" && <CheckCircle2  className={iconCls} aria-hidden="true" />}
      {tone === "error"   && <XCircle       className={iconCls} aria-hidden="true" />}
      {tone === "warning" && <AlertTriangle className={iconCls} aria-hidden="true" />}
      {tone === "info"    && <Info          className={iconCls} aria-hidden="true" />}
    </div>
  );
}

// ── Single popup card ──────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 6000;
let nextId = 1;

type ToastItem = ToastMessage & { id: number; visible: boolean };

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const t = TONE[item.tone];

  return (
    <div
      role={t.role}
      aria-live={t.live}
      aria-atomic="true"
      style={{
        opacity:   item.visible ? 1 : 0,
        transform: item.visible ? "translateY(0)" : "translateY(12px)",
        transition: item.visible
          ? "opacity 0.25s cubic-bezier(0.16,1,0.3,1), transform 0.25s cubic-bezier(0.16,1,0.3,1)"
          : "opacity 0.18s ease-in, transform 0.18s ease-in",
      }}
      className={`pointer-events-auto relative w-full overflow-hidden rounded-xl border bg-white shadow-lg ${t.border}`}
    >
      {/* Top accent line — same tone system as the icon */}
      <div className={`absolute inset-x-0 top-0 h-[3px] ${t.bar}`} aria-hidden="true" />

      <div className="flex items-start gap-3 p-4">
        <ToastIcon tone={item.tone} />

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-bold leading-snug text-[#111827]">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-[#4B5563]">{item.description}</p>
          )}
        </div>

        <button
          onClick={onClose}
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-[#9CA3AF] transition-colors hover:bg-[#F3F5F8] hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Auto-dismiss progress strip */}
      <DismissBar toneBar={t.bar} />
    </div>
  );
}

function DismissBar({ toneBar }: { toneBar: string }) {
  const [width, setWidth] = useState(100);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setWidth(0));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`${toneBar} h-[2px] opacity-25`}
      style={{ width: `${width}%`, transition: `width ${AUTO_DISMISS_MS}ms linear` }}
    />
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function ActionToast() {
  const searchParams = useSearchParams();
  const [toasts, setToasts]   = useState<ToastItem[]>([]);
  const shownRef              = useRef<Set<string>>(new Set());

  function pushToast(msg: ToastMessage) {
    const id = nextId++;
    startTransition(() => {
      setToasts((prev) => [...prev, { ...msg, id, visible: false }]);
    });
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
    }, 16);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }

  // Task 6: imperative trigger for client components that don't navigate on
  // success (work sessions, manual time entries, worker profile saves, etc).
  useEffect(() => {
    function onActionToast(e: Event) {
      const detail = (e as CustomEvent<ToastMessage>).detail;
      if (detail) pushToast(detail);
    }
    window.addEventListener(ACTION_TOAST_EVENT, onActionToast);
    return () => window.removeEventListener(ACTION_TOAST_EVENT, onActionToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const success  = searchParams.get("success");
    const error    = searchParams.get("error");
    const saved    = searchParams.get("saved");
    const category = searchParams.get("category");
    const key      = `${success ?? ""}|${error ?? ""}|${saved ?? ""}|${category ?? ""}`;

    if (key === "|||") return;
    if (shownRef.current.has(key)) return;

    const msg = resolveToastMessage({ success, error, saved, category });
    if (!msg) return;

    shownRef.current.add(key);
    pushToast(msg);

    // Strip URL params without triggering a navigation.
    const url = new URL(window.location.href);
    url.searchParams.delete("success");
    url.searchParams.delete("error");
    url.searchParams.delete("saved");
    url.searchParams.delete("category");
    window.history.replaceState(null, "", url.pathname + (url.search || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function dismiss(id: number) {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
  }

  if (toasts.length === 0) return null;

  return (
    // Bottom-right, non-blocking, lifted above the fixed mobile bottom nav
    // (same "5rem" bar height convention app-layout.tsx already uses for
    // page padding) — no backdrop, doesn't steal focus, doesn't cover the
    // bottom nav or a page's own form action buttons.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[55] flex flex-col-reverse items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
      aria-label="Action notifications"
    >
      <div className="flex w-full max-w-[380px] flex-col-reverse gap-2">
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
        ))}
      </div>
    </div>
  );
}
