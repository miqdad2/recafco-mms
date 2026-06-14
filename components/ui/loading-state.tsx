import { Loader2 } from "lucide-react";

export function LoadingState({ title = "Loading", message = "Preparing the latest system data." }: { title?: string; message?: string }) {
  return (
    <div className="rounded-md border border-[#DDE2EA] bg-white p-6 text-center shadow-sm">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#ED1C24]" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-black text-[#111827]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#4B5563]">{message}</p>
    </div>
  );
}
