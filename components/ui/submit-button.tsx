"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
};

export function SubmitButton({ idleLabel, pendingLabel, className }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button className={className} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
