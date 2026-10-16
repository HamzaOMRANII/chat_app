import type { ReactNode } from "react";
import { Logo, Wordmark } from "./Logo";

/** Full-height phone column on the faint grid, used by every signed-out screen. */
export function AuthScreen({ children, compactBrand = false }: { children: ReactNode; compactBrand?: boolean }) {
  return (
    <main className="bg-grid mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-6 px-6 pb-7 pt-12">
      {compactBrand ? (
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-lg">
            <Wordmark />
          </span>
        </div>
      ) : null}
      {children}
    </main>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-4 rounded-card border border-line bg-panel px-5 py-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.45)] ${className}`}>
      {children}
    </div>
  );
}

type Tone = "error" | "warning" | "info";
const tones: Record<Tone, string> = {
  error: "border-dashed border-danger text-[#FFC9C9]",
  warning: "border-keep-line bg-keep/10 text-[#F3E3BF]",
  info: "border-line-strong bg-sunken text-ink-soft",
};

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-field border px-3.5 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 bg-transparent p-0 text-[13.5px] font-semibold text-link hover:text-ink">
      {children}
    </button>
  );
}
