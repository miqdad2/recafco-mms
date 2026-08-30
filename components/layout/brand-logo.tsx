import Image from "next/image";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "dark" | "light";
  size?: "sm" | "lg" | "xl";
  showText?: boolean;
  subtitle?: string;
};

// "xl" (Unit 10G.42): login page only, where the logo is the sole brand
// mark on the card (no "RECAFCO" text next to it — the logo already says
// that), so it needs to read clearly on its own at a larger size. "sm"/"lg"
// stay exactly as they were for every other caller (sidebar, mobile nav,
// auth hero panel).
export function BrandLogo({ variant = "dark", size = "sm", showText = true, subtitle }: BrandLogoProps) {
  const imageSize = size === "xl" ? 150 : size === "lg" ? 96 : 54;

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-md bg-white shadow-sm",
          // Final Polish Unit 10G.45, Task 2: a modest further bump
          // (112x94/140x118 -> 118x98/150x126) — desktop now sits at the
          // top of the previously-suggested 120-150px range instead of the
          // middle of it.
          size === "xl"
            ? "h-[98px] w-[118px] border border-white/20 sm:h-[126px] sm:w-[150px]"
            : size === "lg"
              ? "h-[88px] w-[104px] border border-white/20"
              : "h-14 w-16 border border-gray-200"
        )}
      >
        <Image
          src="/recafco-logo.png"
          alt="RECAFCO logo"
          fill
          className="object-contain p-1"
          sizes={`${imageSize}px`}
          priority={size === "lg" || size === "xl"}
        />
      </div>
      {showText ? (
        <div>
          <p className={cn("font-black tracking-wide", size === "lg" ? "text-2xl" : "text-xl", variant === "dark" ? "text-white" : "text-[#111827]")}>
            RECAFCO
          </p>
          <p className={cn("text-sm", variant === "dark" ? "text-gray-300" : "text-[#4B5563]")}>{subtitle ?? "Maintenance & Asset Management"}</p>
        </div>
      ) : null}
    </div>
  );
}
