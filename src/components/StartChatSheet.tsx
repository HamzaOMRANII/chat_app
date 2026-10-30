import { useEffect, useState } from "react";
import { Notice } from "./Screen";
import { api } from "../lib/api";
import { startLive, type LiveSession } from "../lib/liveChat";
import {
  AUTO_MINUTES,
  keepChatKey,
  longDuration,
  makeChatKey,
  RETENTION_MINUTES,
  shortDuration,
  type Chat,
  type ChatMode,
  type ChatOptions,
} from "../lib/chats";

/** A day by default (or the longest allowed, if shorter). */
const DEFAULT_MINUTES = 1440;

type Props = {
  userId: string;
  peer: { id: string; username: string; online?: boolean };
  onStarted: (chat: Chat) => void;
  onLiveStarted: (live: LiveSession) => void;
  /** A stored chat is already open with them: only Live can be started next to it. */
  liveOnly?: boolean;
  onClose: () => void;
  onAuthError: (err: unknown) => boolean;
};

/** "Start a chat": only the modes and durations the pair's rules allow. The other side sees the choice before accepting. */
export function StartChatSheet({ userId, peer, onStarted, onLiveStarted, liveOnly = false, onClose, onAuthError }: Props) {
  const [options, setOptions] = useState<ChatOptions | null>(null);
  const [mode, setMode] = useState<ChatMode | "live">("keep");
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ options: ChatOptions }>(`/api/chats/options/${peer.id}`)
      .then(({ options: o }) => {
        const shown = liveOnly ? { ...o, keepMaxDays: 0, auto: false } : o;
        setOptions(shown);
        setMode(shown.keepMaxDays ? "keep" : shown.auto ? "auto" : "live");
        setMinutes((m) => Math.min(m, Math.max(RETENTION_MINUTES[0]!, o.keepMaxDays * 1440)));
      })
      .catch((err) => {
        if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't load the options");
      });
  }, [peer.id, liveOnly, onAuthError]);

  const stored = options && (options.keepMaxDays > 0 || options.auto);
  // The steps this contact's rules allow: 30 min, 1 h, 3 h, 6 h, 12 h, then days up to the maximum
  const steps = RETENTION_MINUTES.filter((m) => m <= (options?.keepMaxDays ?? 0) * 1440);
  const step = Math.max(0, steps.indexOf(minutes));

  async function start() {
    setBusy(true);
    setError("");
    try {
      if (mode === "live") return onLiveStarted(await startLive(userId, peer.id));
      const key = await makeChatKey(userId, peer.id);
      const retentionMinutes = mode === "auto" ? AUTO_MINUTES : minutes;
      const { chat } = await api<{ chat: Chat }>("/api/chats", { body: { userId: peer.id, mode, retentionMinutes, key: { pub: key.pub, sig: key.sig } } });
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
          <p className="m-0 text-[13px] leading-normal text-dim">Choose the kind of chat. {peer.username} sees it before accepting.</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {options === null && !error ? <p className="m-0 text-sm text-dim">Loading…</p> : null}

        {options?.keepMaxDays ? (
          <label
            className={`flex cursor-pointer flex-col gap-3 rounded-2xl border p-3.5 ${mode === "keep" ? "border-[1.5px] border-keep-line bg-keep/[0.08]" : "border-line-strong"}`}
          >
            <span className="flex items-center gap-2.5">
              <input type="radio" name="mode" checked={mode === "keep"} onChange={() => setMode("keep")} className="size-5 accent-[#C99A3E]" />
              <span className="grow text-[15.5px] font-extrabold">Keep-alive</span>
              <span className="rounded-full border border-keep-line px-2 py-px font-mono text-[10.5px] font-bold text-keep">
                KEEP · {shortDuration(minutes)}
              </span>
            </span>
            <span className="text-[12.5px] text-ink-soft">
              Each message is deleted <strong>{longDuration(minutes)}</strong> after it's sent.
            </span>
            {steps.length > 1 ? (
              <span className="flex flex-col gap-1.5">
                <input
                  type="range"
                  min={0}
                  max={steps.length - 1}
                  step={1}
                  value={step}
                  onChange={(e) => {
                    setMode("keep");
                    setMinutes(steps[Number(e.target.value)]!);
                  }}
                  aria-label="How long messages stay"
                  aria-valuetext={longDuration(minutes)}
                  className="w-full accent-[#C99A3E]"
                />
                <span className="flex justify-between font-mono text-[10.5px] text-faint">
                  <span>{longDuration(steps[0]!)}</span>
                  <span>{longDuration(steps.at(-1)!)}</span>
                </span>
              </span>
            ) : null}
          </label>
        ) : null}

        {options?.auto ? (
          <label
            className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-3.5 ${mode === "auto" ? "border-[1.5px] border-auto-line bg-auto/[0.08]" : "border-line-strong"}`}
          >
            <span className="flex items-center gap-2.5">
              <input type="radio" name="mode" checked={mode === "auto"} onChange={() => setMode("auto")} className="size-5 accent-[#5672E0]" />
              <span className="grow text-[15.5px] font-extrabold">Automatic</span>
              <span className="rounded-full border border-auto-line px-2 py-px font-mono text-[10.5px] font-bold text-auto">AUTO · 7D</span>
            </span>
            <span className="text-[12.5px] text-dim">Messages stay 7 days, the longest allowed.</span>
          </label>
        ) : null}

        {options?.live ? (
          <label
            className={`flex cursor-pointer flex-col gap-2.5 rounded-2xl border p-3.5 ${mode === "live" ? "border-[1.5px] border-live-line bg-live/[0.07]" : "border-line-strong"}`}
          >
            <span className="flex items-center gap-2.5">
              <input type="radio" name="mode" checked={mode === "live"} onChange={() => setMode("live")} className="size-5 accent-[#3FA9B8]" />
              <span className="grow text-[15.5px] font-extrabold">Live</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-live-line px-2 py-px font-mono text-[10.5px] font-bold text-live">
                <span className="size-1.5 rounded-full bg-live" />
                LIVE
              </span>
            </span>
            <span className="text-[12.5px] leading-normal text-ink-soft">
              You see each other type, letter by letter. <strong>Nothing is stored</strong>, not even on the phones: it's wiped when either of you leaves.
            </span>
            {peer.online !== undefined ? (
              <span className={`flex items-center gap-2 font-mono text-[11px] ${peer.online ? "text-online" : "text-dim"}`}>
                <span className={`size-[7px] rounded-full ${peer.online ? "bg-online" : "bg-faint"}`} />
                {peer.online ? `${peer.username} is online now` : `${peer.username} is offline: they'll get a notification`}
              </span>
            ) : null}
          </label>
        ) : null}

        {options && !stored && !options.live ? <Notice>No chat mode is available with this contact.</Notice> : null}

        <button
          type="button"
          disabled={!(stored || options?.live) || busy}
          onClick={start}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Sending…" : mode === "live" ? "Invite to a live chat" : "Send chat invitation"}
        </button>
        {mode === "live" ? <p className="m-0 -mt-2 text-center font-mono text-[11px] text-faint">{peer.username} has 5 minutes to answer</p> : null}
        <button type="button" onClick={onClose} className="min-h-11 bg-transparent text-[13.5px] font-semibold text-link">
          Cancel
        </button>
      </section>
    </div>
  );
}
