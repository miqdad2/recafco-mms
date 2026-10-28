"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { headerBackBtn } from "@/components/layout/header-actions";
import { backTarget, isInternalPath, recordPageVisit } from "@/lib/navigation/page-history";

// Page-header Back button.
//
// The sidebar handles moving between modules; page headers carry only Back
// plus the page's own actions. Back returns to the previous in-app page this
// tab visited (with the filters it had) — never another website or the login
// page, because NavigationHistoryTracker (mounted once in AppLayout, i.e.
// only on signed-in pages) records the list in sessionStorage. Opened
// directly, refreshed as the first page, or reached from an external link →
// `fallbackHref`. Rules: lib/navigation/page-history.ts.

const STORAGE_KEY = "recafco.pageHistory";

type StoredHistory = { userId: string; entries: string[] };

function readHistory(): StoredHistory | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as StoredHistory | null;
    if (!parsed || typeof parsed.userId !== "string" || !Array.isArray(parsed.entries)) return null;
    return { userId: parsed.userId, entries: parsed.entries.filter(isInternalPath) };
  } catch {
    return null;
  }
}

function writeHistory(history: StoredHistory) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage blocked (private mode etc.): Back simply uses its fallback.
  }
}

export function NavigationHistoryTracker({ userId }: { userId: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const stored = readHistory();
    // A different signed-in user in this tab starts a fresh history.
    const entries = stored && stored.userId === userId ? stored.entries : [];
    writeHistory({ userId, entries: recordPageVisit(entries, search ? `${pathname}?${search}` : pathname) });
  }, [pathname, search, userId]);

  return null;
}

export function PageBackButton({ fallbackHref = "/dashboard" }: { fallbackHref?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <button
      type="button"
      onClick={() => router.push(backTarget(readHistory()?.entries ?? [], pathname, fallbackHref))}
      className={headerBackBtn}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back
    </button>
  );
}
