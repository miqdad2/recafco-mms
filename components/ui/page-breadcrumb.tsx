import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

// Simple 2-4 level breadcrumb trail. The final item is always plain text
// (the current page); every earlier item with an `href` is a link.
export function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs font-semibold text-[#6B7280]">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[#D1D5DB]" aria-hidden="true" />}
            {item.href && !isLast ? (
              <Link href={item.href} className="hover:text-[#111827] hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-[#111827]" : undefined} aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
