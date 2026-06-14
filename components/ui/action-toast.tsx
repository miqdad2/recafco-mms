"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { resolveToastMessage, type ToastMessage, type ToastTone } from "@/lib/action-messages";

// ── Tone config ────────────────────────────────────────────────────────────────

const TONE: Record<
  ToastTone,
  {
    bar:       string;
    iconBg:    string;
    iconColor: string;
    border:    string;
    shadow:    string;
  }
> = {
  success: {
    bar:       "bg-green-500",
    iconBg:    "bg-green-50",
    iconColor: "text-green-600",
    border:    "border-[#E5E7EB]",
    shadow:    "0 24px 64px rgba(0,0,0,0.13), 0 0 0 1px rgba(22,163,74,0.08)",
  },
  error: {
    bar:       "bg-[#ED1C24]",
    iconBg:    "bg-red-50",
    iconColor: "text-red-600",
    border:    "border-red-100",
    shadow:    "0 24px 64px rgba(0,0,0,0.16), 0 0 0 1px rgba(220,38,38,0.12)",
  },
  warning: {
    bar:       "bg-amber-400",
    iconBg:    "bg-amber-50",
    iconColor: "text-amber-600",
    border:    "border-amber-100",
    shadow:    "0 24px 64px rgba(0,0,0,0.14), 0 0 0 1px rgba(217,119,6,0.10)",
  },
  info: {
    bar:       "bg-blue-500",
    iconBg:    "bg-blue-50",
    iconColor: "text-blue-600",
    border:    "border-[#E5E7EB]",
    shadow:    "0 24px 64px rgba(0,0,0,0.13), 0 0 0 1px rgba(37,99,235,0.08)",
  },
};

// ── Icon inside a soft circle ──────────────────────────────────────────────────

function ToastIcon({ tone }: { tone: ToastTone }) {
  const t = TONE[tone];
  const iconCls = `h-6 w-6 ${t.iconColor}`;
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.iconBg}`}
    >
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
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        opacity:   item.visible ? 1 : 0,
        transform: item.visible
          ? "translateY(0) scale(1)"
          : "translateY(20px) scale(0.94)",
        transition: item.visible
          ? "opacity 0.30s cubic-bezier(0.16,1,0.3,1), transform 0.30s cubic-bezier(0.16,1,0.3,1)"
          : "opacity 0.20s ease-in, transform 0.20s ease-in",
        boxShadow: t.shadow,
      }}
      className={`relative w-full overflow-hidden rounded-2xl border bg-white ${t.border}`}
    >
      {/* 4px top accent bar */}
      <div className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />

      {/* Card body */}
      <div className="flex items-start gap-5 px-7 pb-7 pt-8">
        {/* Icon circle */}
        <ToastIcon tone={item.tone} />

        {/* Text block */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[17px] font-semibold leading-snug text-[#111827]">
            {item.title}
          </p>
          {item.description && (
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#6B7280]">
              {item.description}
            </p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="-mr-1 -mt-0.5 shrink-0 rounded-lg p-1.5 text-[#9CA3AF] transition-colors hover:bg-[#F3F5F8] hover:text-[#4B5563] focus:outline-none focus:ring-2 focus:ring-[#ED1C24]"
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
      className={`${toneBar} h-[3px] opacity-20`}
      style={{ width: `${width}%`, transition: `width ${AUTO_DISMISS_MS}ms linear` }}
    />
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function ActionToast() {
  const searchParams = useSearchParams();
  const [toasts, setToasts]   = useState<ToastItem[]>([]);
  const shownRef              = useRef<Set<string>>(new Set());

  useEffect(() => {
    const success = searchParams.get("success");
    const error   = searchParams.get("error");
    const saved   = searchParams.get("saved");
    const key     = `${success ?? ""}|${error ?? ""}|${saved ?? ""}`;

    if (key === "||") return;
    if (shownRef.current.has(key)) return;

    const msg = resolveToastMessage({ success, error, saved });
    if (!msg) return;

    shownRef.current.add(key);
    const id = nextId++;

    startTransition(() => {
      setToasts((prev) => [...prev, { ...msg, id, visible: false }]);
    });

    // Strip URL params without triggering a navigation.
    const url = new URL(window.location.href);
    url.searchParams.delete("success");
    url.searchParams.delete("error");
    url.searchParams.delete("saved");
    window.history.replaceState(null, "", url.pathname + (url.search || ""));

    // Kick the enter animation one frame after mount.
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
    }, 16);

    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [searchParams]);

  function dismiss(id: number) {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
  }

  if (toasts.length === 0) return null;

  return (
    <>
      {/* Full-screen backdrop — focused feel for every tone */}
      <div
        className="pointer-events-none fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        aria-hidden="true"
      />

      {/*
        Centered container.
        `pb-[8vh]` shifts the effective center 4 vh above pure middle,
        which reads as more balanced against a top nav/sidebar.
        Responsive: full-width with px-4 on small screens, 480 px cap on larger.
      */}
      <div
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4 pb-[8vh]"
        aria-label="Action notifications"
      >
        <div className="pointer-events-auto flex w-full max-w-[480px] flex-col gap-3">
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
          ))}
        </div>
      </div>
    </>
  );
}
