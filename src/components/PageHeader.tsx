import type { ReactNode } from "react";
import { initials } from "../lib/contacts";

/** Signed-in sub-screen header: back arrow and title. */
export function PageHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <header className="flex items-center gap-2.5 border-b border-line px-3.5 pb-3 pt-4">
      <button type="button" onClick={onBack} aria-label="Back" className="grid size-11 place-items-center rounded-field bg-transparent text-ink">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className="m-0 grow text-lg font-extrabold">{title}</h1>
      {children}
    </header>
  );
}

export function Avatar({ username, online, size = 46, muted = false }: { username: string; online?: boolean; size?: number; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: size / 3, fontSize: size * 0.33 }}
      className={`relative grid shrink-0 place-items-center font-extrabold ${
        muted ? "border border-dashed border-line-strong bg-panel text-faint" : online ? "bg-[#2A1A20] text-accent-soft" : "bg-raised text-dim"
      }`}
    >
      {initials(username)}
      {online ? <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-bg bg-online" /> : null}
    </span>
  );
}
