import Image from "next/image";

type PageLoadingProps = {
  message?: string;
  fullScreen?: boolean;
};

export function PageLoading({ message = "Loading page", fullScreen = false }: PageLoadingProps) {
  return (
    <div className={fullScreen ? "flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4" : "flex min-h-[60vh] items-center justify-center px-4 py-16"}>
      <div className="flex flex-col items-center gap-7 text-center">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-[7px] border-[#DDE2EA]" />
          <div className="absolute inset-0 rounded-full border-[7px] border-transparent border-t-[#ED1C24] border-r-[#ED1C24] page-loading-spin" />
          <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-md">
            <Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-1.5" sizes="80px" priority={fullScreen} />
          </div>
        </div>
        <div>
          <p className="text-xl font-black uppercase tracking-wide text-[#111827]">{message}</p>
          <p className="mt-2 text-sm font-semibold text-[#4B5563]">Please wait while the system prepares the next screen.</p>
        </div>
      </div>
    </div>
  );
}
