"use client";

import { useEffect } from "react";

import "@/app/globals.css";
import { ErrorState } from "@/components/ui/error-state";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Global application error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorState
          title="RECAFCO MMS is temporarily unavailable"
          message="A critical application error occurred. Try again, or reopen the system from the dashboard."
          reset={reset}
        />
      </body>
    </html>
  );
}
