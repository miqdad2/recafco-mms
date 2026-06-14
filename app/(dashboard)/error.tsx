"use client";

import { useEffect } from "react";

import { logClientModuleErrorAction } from "@/app/actions/system-health";
import { ErrorState } from "@/components/ui/error-state";

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error("Dashboard error", { message: error.message, digest: error.digest });
    void logClientModuleErrorAction({
      message: error.message,
      digest: error.digest,
      route: window.location.pathname
    });
  }, [error]);

  return (
    <ErrorState
      title="This module could not load"
      message="A dashboard module failed while loading data or rendering the page. Try again, or return to the dashboard."
      reset={reset}
    />
  );
}
