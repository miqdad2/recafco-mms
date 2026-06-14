import { AlertTriangle } from "lucide-react";

export function SystemErrorCard({ title = "System check failed", message = "This status check is temporarily unavailable." }: { title?: string; message?: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ED1C24]" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-black text-[#111827]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[#4B5563]">{message}</p>
        </div>
      </div>
    </div>
  );
}
