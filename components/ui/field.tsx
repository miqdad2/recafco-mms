type FieldProps = {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  min?: string | number;
  step?: string | number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  children?: React.ReactNode;
};

export function Field({ label, name, defaultValue, type = "text", required, min, step, inputMode, children }: FieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#111827]">{label}</span>
      {children ?? (
        <input
          className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
          type={type}
          name={name}
          defaultValue={defaultValue ?? ""}
          required={required}
          min={min}
          step={step}
          inputMode={inputMode}
        />
      )}
    </label>
  );
}
