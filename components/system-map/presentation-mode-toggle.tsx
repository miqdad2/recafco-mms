import Link from "next/link";
import { Maximize2, Minimize2 } from "lucide-react";

export function PresentationModeToggle({ enabled }: { enabled: boolean }) {
  return (
    <Link
      href={enabled ? "/admin/system-map" : "/admin/system-map?presentation=1"}
      className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c9151c]"
    >
      {enabled ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
      {enabled ? "Exit presentation" : "Presentation mode"}
    </Link>
  );
}
