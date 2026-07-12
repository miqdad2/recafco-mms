"use client";

import { useRouter } from "next/navigation";

export function QuickViewRow({
  children,
  previewHref,
  className,
}: {
  children: React.ReactNode;
  previewHref: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <tr
      onClick={(e) => {
        // Let link and button clicks handle their own navigation
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(previewHref, { scroll: false });
      }}
      className={`cursor-pointer transition ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
