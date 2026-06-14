"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";

export function PasswordInput() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <span className="mt-1 flex min-h-12 items-center gap-2 rounded-md border border-[#D9DDE3] bg-white px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#ED1C24]">
      <LockKeyhole className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
      <input
        className="min-h-11 w-full border-0 bg-transparent text-sm outline-none"
        type={showPassword ? "text" : "password"}
        name="password"
        required
        autoComplete="current-password"
      />
      <button
        type="button"
        className="focus-ring -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#4B5563] hover:bg-[#F3F5F8] hover:text-[#111827]"
        onClick={() => setShowPassword((value) => !value)}
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </span>
  );
}
