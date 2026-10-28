"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";

type PasswordInputProps = {
  id?: string;
  placeholder?: string;
};

export function PasswordInput({ id, placeholder }: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <span className="mt-2 flex h-[52px] items-center gap-3 rounded-xl border border-[#D7DDE6] bg-white px-4 transition-[border-color,box-shadow] duration-150 focus-within:border-[#ED1C24] focus-within:shadow-[0_0_0_3px_rgba(237,28,36,0.14)] motion-reduce:transition-none">
      <LockKeyhole className="h-5 w-5 shrink-0 text-[#6B7280]" aria-hidden="true" />
      <input
        id={id}
        className="h-full min-h-0 w-full border-0 bg-transparent text-[15px] text-[#0F172A] outline-none placeholder:text-[#8A94A6]"
        type={showPassword ? "text" : "password"}
        name="password"
        required
        autoComplete="current-password"
        placeholder={placeholder}
      />
      <button
        type="button"
        className="-mr-2 flex h-10 min-h-0 w-10 shrink-0 items-center justify-center rounded-lg text-[#4B5563] transition-colors hover:bg-[#F1F4F8] hover:text-[#111827] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#ED1C24]"
        onClick={() => setShowPassword((value) => !value)}
        aria-label={showPassword ? "Hide password" : "Show password"}
        aria-pressed={showPassword}
      >
        {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </span>
  );
}
