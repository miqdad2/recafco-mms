"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

// Shared large-popup shell for the four converted forms (New Materials
// Request, Add New Material, Receive Material, Issue Material) — same
// visual system as the New Job Card page (wide centered card, generous
// spacing, strong header). Confirmation/success popups elsewhere in the app
// stay their existing small/medium size; this shell is only for these four
// data-entry forms.
//
// Dirty tracking is intentionally coarse: any input/change anywhere in the
// body (event delegation via onInputCapture/onChangeCapture) flips `dirty`
// to true once. This matches "if user has entered data" well enough without
// requiring each wrapped form to separately report its own field state.

type LargeFormModalContextValue = {
  requestClose: () => void;
};

const LargeFormModalContext = createContext<LargeFormModalContextValue | null>(null);

// Used by a wrapped form's own Cancel button so it goes through the same
// dirty-check as the modal's X button, instead of navigating directly.
// Returns null when rendered outside a LargeFormModal (i.e. the form's
// existing standalone-page usage), so callers can fall back to a plain link.
export function useLargeFormModal() {
  return useContext(LargeFormModalContext);
}

export function LargeFormModal({
  title,
  subtitle,
  onClose,
  closeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  // Client callers (already-client parent components, e.g. StoreBalanceView)
  // pass onClose. Server-component parents (e.g. the Materials Requests
  // page) can't hold a callback, so they pass closeHref instead and the
  // modal navigates there itself. Provide exactly one.
  onClose?: () => void;
  closeHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  function doClose() {
    if (onClose) onClose();
    else if (closeHref) router.push(closeHref, { scroll: false });
  }

  function requestClose() {
    if (dirty) {
      setShowDiscardConfirm(true);
    } else {
      doClose();
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showDiscardConfirm) setShowDiscardConfirm(false);
      else requestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, showDiscardConfirm]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={requestClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="large-form-modal-heading"
          className="flex max-h-[90vh] w-[min(85vw,1250px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling */}
          <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-5">
            <div className="min-w-0">
              <h2 id="large-form-modal-heading" className="text-xl font-black text-[#111827]">
                {title}
              </h2>
              {subtitle && <p className="mt-1 text-sm text-[#4B5563]">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body — the only scrolling region; also owns dirty-detection */}
          <div
            className="flex-1 overflow-y-auto px-6 py-5"
            onInputCapture={() => setDirty(true)}
            onChangeCapture={() => setDirty(true)}
          >
            <LargeFormModalContext.Provider value={{ requestClose }}>
              {children}
            </LargeFormModalContext.Provider>
          </div>
        </div>
      </div>

      {showDiscardConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            aria-hidden="true"
            onClick={() => setShowDiscardConfirm(false)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="discard-changes-heading"
              className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
            >
              <h3 id="discard-changes-heading" className="text-lg font-black text-[#111827]">
                Discard changes?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                Your entered information will be lost if you close this form.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={doClose}
                  className="flex-1 rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="flex-1 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
                >
                  Continue Editing
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
