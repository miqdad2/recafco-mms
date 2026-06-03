type FormSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
        {description ? <p className="mt-1 text-sm text-[#4B5563]">{description}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
