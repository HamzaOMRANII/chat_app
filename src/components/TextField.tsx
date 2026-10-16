import { useId, type InputHTMLAttributes } from "react";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Monospace value, for IDs, codes and passcodes. */
  mono?: boolean;
};

export function TextField({ label, mono, className = "", id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={inputId} className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
        {label}
      </label>
      <input
        id={inputId}
        className={`min-h-12 rounded-field border border-line-strong bg-bg px-3.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(199,112,126,0.18)] ${mono ? "font-mono tracking-[0.06em]" : ""} ${className}`}
        {...rest}
      />
    </div>
  );
}
