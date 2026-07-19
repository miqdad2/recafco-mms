import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Two variants matching the two "back to X" styles already established
// ad hoc across the app before this component existed:
// - "button": bordered button (used in a PageHeader's actions area)
// - "text": small inline text link (used in custom, non-PageHeader headers)
export function BackLink({
  href,
  label,
  variant = "button",
}: {
  href: string;
  label: string;
  variant?: "button" | "text";
}) {
  if (variant === "text") {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#111827]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
