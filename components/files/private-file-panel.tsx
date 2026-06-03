import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

type PrivateFilePanelProps = {
  title: string;
  description: string;
  action: (formData: FormData) => Promise<void>;
  hiddenFields: Record<string, string>;
  typeFieldName: string;
  typeOptions: string[];
};

export function PrivateFilePanel({ title, description, action, hiddenFields, typeFieldName, typeOptions }: PrivateFilePanelProps) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-[#ED1C24]">
          <Upload className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
          <p className="text-sm text-[#4B5563]">{description}</p>
        </div>
      </div>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto]">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <select name={typeFieldName} className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
          {typeOptions.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <input
          required
          type="file"
          name="file"
          className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#111827] file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white"
          accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx"
        />
        <Button type="submit">Upload</Button>
      </form>
      <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs leading-5 text-[#4B5563]">
        Private files only. Accepted formats: PDF, JPG, PNG, XLS, XLSX, DOC, and DOCX. Signed viewing links expire after 10 minutes.
      </div>
    </section>
  );
}
