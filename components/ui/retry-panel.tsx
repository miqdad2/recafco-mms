"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function RetryPanel({ title = "Data could not load", message = "Refresh this section and try again.", onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-black text-[#111827]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[#4B5563]">{message}</p>
      {onRetry ? (
        <Button type="button" variant="secondary" className="mt-3" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
