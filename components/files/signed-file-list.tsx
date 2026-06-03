import Link from "next/link";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

type SignedFile = {
  id: string;
  label: string;
  fileName: string;
  signedUrl: string | null;
  createdAt?: string | null;
};

export function SignedFileList({ title, files }: { title: string; files: SignedFile[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
      <div className="mt-4 divide-y divide-[#E5E7EB]">
        {files.length ? (
          files.map((file) => (
            <div key={file.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-[#111827]">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-[#111827]">{file.label}</p>
                  <p className="text-sm text-[#4B5563]">{file.fileName}</p>
                </div>
              </div>
              {file.signedUrl ? (
                <Link className="text-sm font-bold text-[#ED1C24]" href={file.signedUrl} target="_blank">
                  View signed file
                </Link>
              ) : (
                <span className="text-sm text-[#4B5563]">Signed link unavailable</span>
              )}
            </div>
          ))
        ) : (
          <EmptyState title="No files uploaded" message="Upload supporting documents or photos when they are available. Private signed links will appear here." />
        )}
      </div>
    </section>
  );
}
