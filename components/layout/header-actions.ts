// Page-header action button styles, shared so every page header looks the
// same: Back (charcoal), the page's main create/new action (RECAFCO red), and
// secondary actions such as Print Report (subtle outline). 44px tall on
// phones, 40px from sm: up. Plain strings (no "use client") so server and
// client components can both use them.

const base =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 py-2 text-sm font-bold shadow-sm transition active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 sm:min-h-10";

export const headerBackBtn = `${base} border-[#2b2b2b] bg-[#2b2b2b] text-white hover:bg-[#111827]`;
export const headerPrimaryBtn = `${base} border-[#ED1C24] bg-[#ED1C24] text-white hover:border-[#c8181e] hover:bg-[#c8181e]`;
export const headerSecondaryBtn = `${base} border-[#D1D5DB] bg-white text-[#111827] hover:bg-gray-50`;
