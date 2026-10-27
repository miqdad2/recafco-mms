import type { CSSProperties } from "react";
import Image from "next/image";

type PageLoadingProps = {
  message?: string;
  fullScreen?: boolean;
};

// Route loading screen (Next.js `loading.tsx` fallback). Shown only while a
// route segment is actually streaming and removed by Next.js as soon as it
// is ready — no timers or minimum display time here.
//
// One size variable drives the whole loader: 320px on desktop, ~230px on a
// 390px phone, and limited by height on short screens so the rings never
// clip. Only the two rings rotate (CSS transform, app/globals.css); the logo
// is always stationary. The logo asset is square with white padding, so its
// box is 52% of the loader (artwork ≈ 150px desktop / 110px phone) and
// nudged up 5% so the artwork itself sits in the optical centre.
const loaderStyle = { "--page-loader-size": "clamp(200px, min(60vw, 40vh), 320px)" } as CSSProperties;

export function PageLoading({ message = "Loading workspace", fullScreen = false }: PageLoadingProps) {
  return (
    <div
      className={
        fullScreen
          ? "flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#F5F6F8] px-4 py-8"
          : "flex min-h-[60vh] items-center justify-center overflow-hidden px-4 py-12"
      }
    >
      <div role="status" aria-live="polite" className="flex w-full max-w-md flex-col items-center text-center" style={loaderStyle}>
        <div className="relative h-[var(--page-loader-size)] w-[var(--page-loader-size)] shrink-0">
          {/* Static track + inner hairline ring */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <circle cx="50" cy="50" r="46" fill="none" stroke="#E8EBF0" strokeWidth="2.6" />
            <circle cx="50" cy="50" r="33.5" fill="none" stroke="#E5E7EB" strokeWidth="0.6" />
          </svg>
          {/* Outer ring — RECAFCO red arc, clockwise */}
          <svg viewBox="0 0 100 100" className="page-loading-ring-outer absolute inset-0 h-full w-full" aria-hidden="true">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="#ED1C24"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="24 76"
            />
          </svg>
          {/* Middle ring — neutral segments, slower, counter-clockwise */}
          <svg viewBox="0 0 100 100" className="page-loading-ring-middle absolute inset-0 h-full w-full" aria-hidden="true">
            <circle
              cx="50"
              cy="50"
              r="39.5"
              fill="none"
              stroke="#C7CDD6"
              strokeWidth="1.4"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="4.5 5.5"
            />
          </svg>
          {/* Stationary white centre with the logo */}
          <div className="absolute inset-[19%] flex items-center justify-center rounded-full bg-white shadow-[0_16px_40px_rgba(15,23,42,0.10),0_0_28px_rgba(237,28,36,0.07)]">
            <div className="relative h-[calc(var(--page-loader-size)*0.52)] w-[calc(var(--page-loader-size)*0.52)] -translate-y-[5%]">
              <Image
                src="/recafco-logo.png"
                alt="RECAFCO"
                fill
                className="object-contain"
                sizes="(max-width: 640px) 130px, 170px"
                priority={fullScreen}
              />
            </div>
          </div>
        </div>

        <h1 className="mt-8 text-[26px] font-black leading-tight tracking-tight text-[#0F172A] sm:mt-10 sm:text-[32px]">{message}</h1>
        <p className="mt-2 max-w-xs text-[15px] font-medium leading-6 text-[#5B6472] sm:text-base">Preparing your maintenance workspace...</p>
        <div className="mt-6 h-1.5 w-[min(340px,80vw)] overflow-hidden rounded-full bg-[#E3E7ED] sm:mt-7" aria-hidden="true">
          <div className="page-loading-bar h-full w-2/5 rounded-full bg-[#ED1C24]" />
        </div>
      </div>
    </div>
  );
}
