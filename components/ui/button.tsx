import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
        variant === "primary" && "bg-[#ED1C24] text-white hover:bg-[#c9151c]",
        variant === "secondary" && "border border-[#E5E7EB] bg-white text-[#111827] hover:bg-gray-50",
        variant === "danger" && "bg-[#DC2626] text-white hover:bg-[#b91c1c]",
        variant === "ghost" && "text-[#4B5563] hover:bg-gray-100",
        className
      )}
      {...props}
    />
  );
}
