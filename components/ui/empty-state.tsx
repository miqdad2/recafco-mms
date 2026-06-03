import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[#D1D5DB] bg-gray-50 p-5 text-center">
      <Inbox className="mx-auto h-8 w-8 text-[#4B5563]" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-bold text-[#111827]">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-[#4B5563]">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
