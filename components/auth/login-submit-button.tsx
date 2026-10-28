"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

// Same pending/disabled contract as components/ui/submit-button.tsx (the
// button is disabled while the sign-in action is in flight, so a double
// click can't submit twice), styled for the login card.
export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="group flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-[#ED1C24] px-5 text-lg font-semibold text-white shadow-[0_8px_20px_-8px_rgba(237,28,36,0.55)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[#D3141C] hover:shadow-[0_10px_24px_-8px_rgba(237,28,36,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ED1C24] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#EF5A60] disabled:shadow-none motion-reduce:transition-none"
    >
      {pending ? (
        <>
          <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Signing in…
        </>
      ) : (
        <>
          Sign in
          <ArrowRight
            className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  );
}
