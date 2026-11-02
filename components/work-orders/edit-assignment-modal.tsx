"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { getEditAssignmentDataAction } from "@/app/actions/work-order-roster";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { EditAssignmentForm } from "@/components/work-orders/edit-assignment-form";
import { EDIT_ASSIGNMENT_SUBTITLE, type EditAssignmentData } from "@/lib/work-orders/assignment-edit";

// The Edit Assignment popup over a page that stays where it is (Daily
// Activity): loads its own data when opened, and the caller refreshes after a
// save. The Job Card page opens the same form from the server.

type LoadState = { kind: "loading" } | { kind: "ready"; data: EditAssignmentData } | { kind: "unavailable"; message: string };

export function EditAssignmentModal({ workOrderId, onClose, onSaved }: { workOrderId: string; onClose: () => void; onSaved: () => void }) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    getEditAssignmentDataAction(workOrderId)
      .then((data) => {
        if (!current) return;
        setLoad(data ? { kind: "ready", data } : { kind: "unavailable", message: "This assignment cannot be changed right now." });
      })
      .catch(() => {
        if (current) setLoad({ kind: "unavailable", message: "The assignment could not be loaded. Please try again." });
      });
    return () => {
      current = false;
    };
  }, [workOrderId]);

  return (
    <LargeFormModal title="Edit Assignment" subtitle={EDIT_ASSIGNMENT_SUBTITLE} onClose={onClose}>
      {load.kind === "ready" ? <EditAssignmentForm {...load.data} onSaved={onSaved} /> : null}
      {load.kind === "loading" ? (
        <p className="flex items-center gap-2 py-8 text-sm text-[#4B5563]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading assignment…
        </p>
      ) : null}
      {load.kind === "unavailable" ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {load.message}
        </p>
      ) : null}
    </LargeFormModal>
  );
}
