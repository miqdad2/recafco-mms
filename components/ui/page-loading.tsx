import Image from "next/image";

type PageLoadingProps = {
  message?: string;
  fullScreen?: boolean;
};

export function PageLoading({ message = "Loading page", fullScreen = false }: PageLoadingProps) {
  return (
    <div className={fullScreen ? "flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4" : "flex min-h-[60vh] items-center justify-center px-4 py-16"}>
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <div className="absolute inset-3 rounded-full border border-[#E5E7EB]" />
          <div className="absolute inset-0 rounded-full border-[6px] border-[#E1E5EB]" />
          <div className="absolute inset-0 rounded-full border-[6px] border-transparent border-t-[#ED1C24] border-r-[#ED1C24] page-loading-spin shadow-[0_0_0_1px_rgba(237,28,36,0.04)]" />
          <div className="absolute inset-5 rounded-full border border-[#F1F3F6]" />
          <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-[#DDE2EA] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
            <Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-2" sizes="80px" priority={fullScreen} />
          </div>
        </div>

        <div className="mt-7 w-full">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#ED1C24]">RECAFCO MMS</p>
          <h1 className="mt-3 text-2xl font-black text-[#111827]">{message}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm font-semibold leading-6 text-[#4B5563]">Preparing your maintenance workspace.</p>
          <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-[#DDE2EA]">
            <div className="page-loading-bar h-full w-1/2 rounded-full bg-[#ED1C24]" />
          </div>
        </div>
      </div>
    </div>
  );
}
