"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/error-state";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("Application error", { message: error.message, digest: error.digest });
  }, [error]);

  return <ErrorState reset={reset} />;
}
