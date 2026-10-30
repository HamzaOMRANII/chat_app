import { useState } from "react";
import { api } from "../lib/api";
import type { ExportReq } from "../lib/exports";

type Props = { chatId: string; peerName: string; onAsked: (e: ExportReq) => void; onClose: () => void; onAuthError: (err: unknown) => boolean };

/** "Export this chat": what to include and which period. The other side must approve. */
export function ExportSheet({ chatId, peerName, onAsked, onClose, onAuthError }: Props) {
  const [messages, setMessages] = useState(true);
  const [media, setMedia] = useState(true);
  const [period, setPeriod] = useState<ExportReq["period"]>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    setBusy(true);
    setError("");
    try {
      const { export: e } = await api<{ export: ExportReq }>(`/api/chats/${chatId}/exports`, { body: { messages, media, period } });
      onAsked(e);
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't ask");
      setBusy(false);
    }
  }

  const box = (on: boolean, set: (v: boolean) => void, label: string, sub: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[14px] border px-3.5 py-3 ${on ? "border-line-strong" : "border-line"}`}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5 size-5 accent-[#C7707E]" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14.5px] font-bold">{label}</span>
        <span className="text-[12.5px] leading-normal text-dim">{sub}</span>
      </span>
    </label>
  );
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex w-full max-w-[560px] flex-col gap-3 rounded-t-[26px] border-t border-line-strong bg-panel px-[18px] pb-6 pt-3"
      >
        <span className="h-1 w-10 self-center rounded-full bg-line-strong" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 id="export-title" className="m-0 text-xl font-extrabold">
            Export this chat
          </h2>
          <p className="m-0 text-[13px] leading-normal text-dim">
            {peerName} must approve first. Then you have <strong className="text-ink">24 hours</strong> to save it. The zip is built on this device: the server
            never sees what's inside.
          </p>
        </div>
        {box(messages, setMessages, "Messages", "All messages still in the chat, as a readable file")}
        {box(media, setMedia, "Media", "Photos, videos and documents still in the chat")}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] text-dim">period</span>
          <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1.5">
            {(["all", "24h", "7d"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] ${period === p ? "border-accent bg-accent/15 font-bold text-ink" : "border-line-strong bg-transparent text-dim"}`}
              >
                {p === "all" ? "Everything" : p === "24h" ? "Last 24 hours" : "Last 7 days"}
              </button>
            ))}
          </div>
        </div>
        <p className="m-0 text-[11.5px] leading-normal text-faint">
          Files {peerName} shared as view only are never exported. What already expired can't be exported.
        </p>
        {error ? <p className="m-0 rounded-xl border border-dashed border-danger px-3 py-2 text-[13px] text-danger-ink">{error}</p> : null}
        <button
          type="button"
          disabled={busy || (!messages && !media)}
          onClick={ask}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Asking…" : `Ask ${peerName} to approve`}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 bg-transparent text-[13.5px] font-semibold text-link">
          Cancel
        </button>
      </section>
    </div>
  );
}
