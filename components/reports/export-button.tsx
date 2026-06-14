import Link from "next/link";
import { Download } from "lucide-react";

import { cn } from "@/lib/utils";

export function ExportButton({ kind, searchParams, className, label }: { kind: string; searchParams?: URLSearchParams; className?: string; label?: string }) {
  const query = searchParams?.toString();
  return (
    <Link
      className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50", className)}
      href={`/api/exports/${kind}${query ? `?${query}` : ""}`}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {label ?? "Export Excel"}
    </Link>
  );
}
