import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white font-bold shadow-[0_10px_26px_rgba(126,34,52,0.35)] hover:bg-brand-hover",
  secondary: "bg-panel text-ink font-semibold border border-line-strong hover:border-accent",
  // Destructive actions read like the Pass manager: mono, bracketed, dashed
  danger:
    "bg-transparent text-danger-ink border border-dashed border-danger font-mono text-[13px] font-bold tracking-[0.06em] uppercase before:content-['[_'] after:content-['_]'] hover:bg-danger/10",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean };

export function Button({ variant = "primary", block, className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-[50px] items-center justify-center gap-2 rounded-control px-5 text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    />
  );
}
