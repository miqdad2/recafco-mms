"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

// Edit Job Card — "Cancel Edit" beside Save Changes. It never submits the
// form: with nothing changed it goes straight back; with changes it asks
// first ("Keep Editing" leaves every typed value in place). `returnHref` is
// built by the edit page from a fixed list of internal pages, never from
// the URL as typed.

// Everything the form would post, as one comparable string (a chosen file
// counts by name and size).
function snapshot(form: HTMLFormElement): string {
  const entries: string[] = [];
  new FormData(form).forEach((value, key) => {
    entries.push(`${key}=${typeof value === "string" ? value : `${value.name}:${value.size}`}`);
  });
  return entries.join("\n");
}

export function CancelEditButton({ returnHref }: { returnHref: string }) {
  const router = useRouter();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const initialRef = useRef<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const form = anchorRef.current?.closest("form");
    if (form) initialRef.current = snapshot(form);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    document.getElementById("discard-edit-keep")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  function cancel() {
    const form = anchorRef.current?.closest("form");
    const changed = form && initialRef.current !== null ? snapshot(form) !== initialRef.current : false;
    if (changed) setConfirming(true);
    else router.push(returnHref);
  }

  return (
    <span ref={anchorRef} className="contents">
      <Button type="button" variant="secondary" onClick={cancel} className="min-h-11">
        Cancel Edit
      </Button>

      {confirming ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={() => setConfirming(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-edit-heading"
              aria-describedby="discard-edit-message"
              className="relative w-full max-w-md rounded-xl bg-white shadow-2xl"
            >
              <div className="border-b border-[#F3F4F6] px-5 py-4">
                <h2 id="discard-edit-heading" className="text-lg font-black text-[#111827]">
                  Discard your changes?
                </h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                <p id="discard-edit-message" className="text-base text-[#374151]">
                  Your changes have not been saved.
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button id="discard-edit-keep" type="button" variant="secondary" onClick={() => setConfirming(false)} className="min-h-11">
                    Keep Editing
                  </Button>
                  <Button type="button" variant="danger" onClick={() => router.push(returnHref)} className="min-h-11">
                    Discard Changes
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
