"use client";

import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title?: string;
  message?: string;
  reset?: () => void;
  showHome?: boolean;
};

export function ErrorState({
  title = "Something went wrong",
  message = "The system could not complete this request. Try again, or return to the dashboard.",
  reset,
  showHome = true
}: ErrorStateProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-md border border-[#DDE2EA] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-red-50 text-[#ED1C24]">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-[#111827]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#4B5563]">{message}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          {reset ? (
            <Button type="button" onClick={reset}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          ) : null}
          {showHome ? (
            <Link
              href="/dashboard"
              className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#DDE2EA] bg-white px-4 py-2 text-sm font-semibold text-[#111827] hover:bg-gray-50"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Dashboard
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
