type FormSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
        {description ? <p className="mt-1 text-sm text-[#4B5563]">{description}</p> : null}
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
