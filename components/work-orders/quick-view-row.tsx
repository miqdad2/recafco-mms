"use client";

import { useRouter } from "next/navigation";

// Job Cards Direct Detail Navigation Unit 10G.26: this row used to push a
// `?preview=<id>` query onto the current URL to open the quick-view popup
// (hence the original `previewHref` prop name) — the Job Cards page no
// longer does that (see app/(dashboard)/maintenance/work-orders/page.tsx),
// so `href` here is now a real page navigation (the Job Card detail route).
// The "whole row is clickable except for its own nested links/buttons"
// mechanic itself is unchanged and still exactly what's needed.
export function QuickViewRow({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <tr
      onClick={(e) => {
        // Let link and button clicks handle their own navigation
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
      className={`cursor-pointer transition ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
