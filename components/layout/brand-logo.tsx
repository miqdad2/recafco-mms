import Image from "next/image";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "dark" | "light";
  size?: "sm" | "lg";
  showText?: boolean;
  subtitle?: string;
};

export function BrandLogo({ variant = "dark", size = "sm", showText = true, subtitle }: BrandLogoProps) {
  const imageSize = size === "lg" ? 104 : 54;

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-md bg-white shadow-sm",
          size === "lg" ? "h-28 w-32 border border-white/20" : "h-14 w-16 border border-gray-200"
        )}
      >
        <Image
          src="/recafco-logo.png"
          alt="RECAFCO logo"
          fill
          className="object-contain p-1"
          sizes={`${imageSize}px`}
          priority={size === "lg"}
        />
      </div>
      {showText ? (
        <div>
          <p className={cn("font-black tracking-wide", size === "lg" ? "text-2xl" : "text-xl", variant === "dark" ? "text-white" : "text-[#111827]")}>
            RECAFCO
          </p>
          <p className={cn("text-sm", variant === "dark" ? "text-gray-300" : "text-[#4B5563]")}>{subtitle ?? "Enterprise Maintenance Management"}</p>
        </div>
      ) : null}
    </div>
  );
}
