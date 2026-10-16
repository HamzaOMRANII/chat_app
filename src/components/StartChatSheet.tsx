import { useEffect, useState } from "react";
import { Notice } from "./Screen";
import { api } from "../lib/api";
import { keepChatKey, makeChatKey, type Chat, type ChatMode, type ChatOptions } from "../lib/chats";

type Props = { userId: string; peer: { id: string; username: string }; onStarted: (chat: Chat) => void; onClose: () => void; onAuthError: (err: unknown) => boolean };

/** "Start a chat": only the modes and durations the pair's rules allow. The other side sees the choice before accepting. */
export function StartChatSheet({ userId, peer, onStarted, onClose, onAuthError }: Props) {
  const [options, setOptions] = useState<ChatOptions | null>(null);
  const [mode, setMode] = useState<ChatMode>("keep");
  const [days, setDays] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ options: ChatOptions }>(`/api/chats/options/${peer.id}`)
      .then(({ options: o }) => {
        setOptions(o);
        setMode(o.keepMaxDays ? "keep" : "auto");
        setDays((d) => Math.min(Math.max(1, d), Math.max(1, o.keepMaxDays)));
      })
      .catch((err) => {
        if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't load the options");
      });
  }, [peer.id, onAuthError]);

  const stored = options && (options.keepMaxDays > 0 || options.auto);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const key = await makeChatKey(userId, peer.id);
      const retentionDays = mode === "auto" ? 7 : days;
      const { chat } = await api<{ chat: Chat }>("/api/chats", { body: { userId: peer.id, mode, retentionDays, key: { pub: key.pub, sig: key.sig } } });
      keepChatKey(userId, chat.id, 1, key.secret);
      onStarted(chat);
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't start the chat");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="start-title"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex max-h-[92dvh] w-full max-w-[560px] flex-col gap-3.5 overflow-y-auto rounded-t-[26px] border-t border-line-strong bg-panel px-[18px] pb-[26px] pt-3"
      >
        <span className="h-1 w-10 self-center rounded-full bg-line-strong" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 id="start-title" className="m-0 text-xl font-extrabold">
            Start a chat with {peer.username}
          </h2>
          <p className="m-0 text-[13px] leading-normal text-dim">Choose how long messages stay. {peer.username} sees it before accepting, and it can't be changed later.</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {options === null && !error ? <p className="m-0 text-sm text-dim">Loading…</p> : null}

        {options?.keepMaxDays ? (
          <label className={`flex cursor-pointer flex-col gap-3 rounded-2xl border p-3.5 ${mode === "keep" ? "border-[1.5px] border-keep-line bg-keep/[0.08]" : "border-line-strong"}`}>
            <span className="flex items-center gap-2.5">
              <input type="radio" name="mode" checked={mode === "keep"} onChange={() => setMode("keep")} className="size-5 accent-[#C99A3E]" />
              <span className="grow text-[15.5px] font-extrabold">Keep-alive</span>
              <span className="rounded-full border border-keep-line px-2 py-px font-mono text-[10.5px] font-bold text-keep">KEEP · {days}D</span>
            </span>
            <span className="text-[12.5px] text-ink-soft">
              Each message is deleted <strong>{days} day{days > 1 ? "s" : ""}</strong> after it's sent.
            </span>
            {options.keepMaxDays > 1 ? (
              <span className="flex flex-col gap-1.5">
                <input
                  type="range"
                  min={1}
                  max={options.keepMaxDays}
                  value={days}
                  onChange={(e) => {
                    setMode("keep");
                    setDays(Number(e.target.value));
                  }}
                  aria-label="Days"
                  className="w-full accent-[#C99A3E]"
                />
                <span className="flex justify-between font-mono text-[10.5px] text-faint">
                  <span>1 day</span>
                  <span>{options.keepMaxDays} days</span>
                </span>
              </span>
            ) : null}
          </label>
        ) : null}

        {options?.auto ? (
          <label className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-3.5 ${mode === "auto" ? "border-[1.5px] border-auto-line bg-auto/[0.08]" : "border-line-strong"}`}>
            <span className="flex items-center gap-2.5">
              <input type="radio" name="mode" checked={mode === "auto"} onChange={() => setMode("auto")} className="size-5 accent-[#5672E0]" />
              <span className="grow text-[15.5px] font-extrabold">Automatic</span>
              <span className="rounded-full border border-auto-line px-2 py-px font-mono text-[10.5px] font-bold text-auto">AUTO · 7D</span>
            </span>
            <span className="text-[12.5px] text-dim">Messages stay 7 days, the longest allowed.</span>
          </label>
        ) : null}

        {options?.live ? (
          <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line-strong px-3.5 py-3 text-faint">
            <span className="rounded-full border border-[#2C4F55] px-2 py-px font-mono text-[10.5px] font-bold text-[#4E8A93]">LIVE</span>
            <span className="text-[12.5px]">{stored ? "Live chat arrives in the next update." : "Only Live chat is allowed with this contact. It arrives in the next update."}</span>
          </div>
        ) : null}

        {options && !stored && !options.live ? <Notice>No chat mode is available with this contact.</Notice> : null}

        <button
          type="button"
          disabled={!stored || busy}
          onClick={start}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send chat invitation"}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 bg-transparent text-[13.5px] font-semibold text-link">
          Cancel
        </button>
      </section>
    </div>
  );
}
