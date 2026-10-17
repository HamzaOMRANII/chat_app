import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { openLive, sealLive, type PublishedKey } from "../lib/e2e";
import { live } from "../lib/live";
import { acceptLive, clock, countdown, forgetLive, liveKeys, liveSecret, type LiveSession } from "../lib/liveChat";

const MAX_LENGTH = 1000;

type Line = { id: number; mine: boolean; text: string };
/** What travels in a live chat: the whole current draft on every keystroke, or a finished line. `n` keeps them in order. */
type LivePlain = { t: "draft" | "line"; text: string; n: number };

type Props = {
  sessionId: string;
  userId: string;
  onBack: () => void;
  /** The live chat is over: back to the contacts, with a banner saying why. */
  onClosed: (title: string, text: string) => void;
  onAuthError: (err: unknown) => boolean;
};

const ENDED: Record<string, (peer: string) => string> = {
  left: (peer) => `${peer} left. Everything was wiped on both phones.`,
  connection_lost: (peer) => `${peer}'s connection was lost for 30 seconds. Everything was wiped on both phones.`,
  declined: (peer) => `${peer} declined the live chat.`,
  cancelled: (peer) => `${peer} cancelled the invitation.`,
  invite_expired: () => "The invitation expired without an answer.",
  rules_changed: () => "Live chat is no longer allowed with this contact.",
  contact_unavailable: (peer) => `${peer} is no longer available.`,
  deleted_by_admin: () => "An administrator ended it. Everything was wiped.",
};

/** A live chat: each side sees the other type, letter by letter. Nothing is stored, not even here. */
export function LivePage({ sessionId, userId, onBack, onClosed, onAuthError }: Props) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [theirDraft, setTheirDraft] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const keys = useRef<{ mine: PublishedKey; theirs: PublishedKey } | null>(null);
  const sent = useRef(0);
  const received = useRef(0);
  const lineId = useRef(0);
  // Set once it is over (or being closed here): nothing more is sent and leaving doesn't end it twice
  const over = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const bottom = useRef<HTMLDivElement>(null);

  const peerName = session?.with?.username ?? "your contact";
  const peerRef = useRef(peerName);
  peerRef.current = peerName;

  const close = useCallback(
    (reason: string, byMe = false) => {
      if (over.current) return;
      over.current = true;
      forgetLive(sessionId);
      const peer = peerRef.current;
      onClosedRef.current(`Live chat with ${peer} ended`, byMe ? "Everything was wiped on both phones." : (ENDED[reason] ?? (() => "Everything was wiped on both phones."))(peer));
    },
    [sessionId],
  );

  const load = useCallback(async () => {
    try {
      const { live: open } = await api<{ live: LiveSession[] }>("/api/live");
      const found = open.find((s) => s.id === sessionId);
      if (!found) return close("ended");
      if (found.status === "active") {
        // The key only ever lived in this app's memory: after a restart this live chat can't go on
        if (!liveSecret(sessionId)) {
          over.current = true;
          await api(`/api/live/${sessionId}`, { method: "DELETE" }).catch(() => {});
          over.current = false;
          return close("restarted", true);
        }
        keys.current = await liveKeys(found, userId);
        if (!keys.current) setError("The other side's key couldn't be verified. Leave this live chat.");
      }
      setSession(found);
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't load the live chat");
    }
  }, [sessionId, userId, close, onAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const offs = [
      live.on<{ sessionId: string; nonce: string; ct: string }>("live", async (p) => {
        const s = sessionRef.current;
        const secret = liveSecret(sessionId);
        if (p.sessionId !== sessionId || !s?.with || !secret || !keys.current) return;
        const plain = (await openLive({ secret, sessionId, senderId: s.with.id, myKey: keys.current.mine, theirKey: keys.current.theirs, nonce: p.nonce, ct: p.ct })) as LivePlain | null;
        if (!plain || typeof plain.text !== "string" || typeof plain.n !== "number" || plain.n <= received.current) return;
        received.current = plain.n;
        if (plain.t === "line") {
          setLines((list) => [...list, { id: ++lineId.current, mine: false, text: plain.text.slice(0, MAX_LENGTH) }]);
          setTheirDraft("");
        } else setTheirDraft(plain.text.slice(0, MAX_LENGTH));
      }),
      live.on<{ sessionId: string; online: boolean; deadline?: number }>("live:peer", (p) => {
        if (p.sessionId !== sessionId) return;
        setSession((s) => (s ? { ...s, waitingFor: p.online ? null : { mine: false, deadline: p.deadline ?? Date.now() + 30_000 } } : s));
        if (!p.online) setTheirDraft("");
      }),
      live.on<{ sessionId: string; reason: string; by: string | null }>("live:ended", (p) => {
        if (p.sessionId === sessionId) close(p.reason, p.by === userId);
      }),
      live.on("live:changed", () => void load()),
      live.on("resync", () => void load()),
    ];
    return () => offs.forEach((off) => off());
  }, [sessionId, userId, close, load]);

  // Leaving the screen (back button, Android back, another screen) leaves the live chat: it is wiped for both
  useEffect(
    () => () => {
      if (over.current || !sessionRef.current) return;
      over.current = true;
      forgetLive(sessionId);
      void api(sessionRef.current.status === "invited" ? `/api/live/${sessionId}/decline` : `/api/live/${sessionId}`, {
        method: sessionRef.current.status === "invited" ? "POST" : "DELETE",
      }).catch(() => {});
    },
    [sessionId],
  );

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, theirDraft, draft]);

  async function push(t: LivePlain["t"], text: string) {
    const s = sessionRef.current;
    const secret = liveSecret(sessionId);
    if (!s?.with || !secret || !keys.current || over.current) return;
    const sealed = await sealLive({ secret, sessionId, userId, myKey: keys.current.mine, theirKey: keys.current.theirs, plain: { t, text, n: ++sent.current } as LivePlain });
    live.send("live", { sessionId, ...sealed });
  }

  function onDraft(value: string) {
    const text = value.slice(0, MAX_LENGTH);
    setDraft(text);
    void push("draft", text);
  }

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void push("line", text);
    setLines((list) => [...list, { id: ++lineId.current, mine: true, text }]);
    setDraft("");
  }

  async function answer(kind: "accept" | "decline" | "leave") {
    const s = sessionRef.current;
    if (!s) return;
    setError("");
    try {
      if (kind === "accept") {
        const accepted = await acceptLive(userId, s);
        keys.current = await liveKeys(accepted, userId);
        setSession(accepted);
        return;
      }
      over.current = true;
      await api(kind === "decline" ? `/api/live/${sessionId}/decline` : `/api/live/${sessionId}`, { method: kind === "decline" ? "POST" : "DELETE" });
      over.current = false;
      close(s.status === "invited" ? (s.createdByMe ? "cancelled" : "declined") : "left", true);
    } catch (err) {
      over.current = false;
      if (onAuthError(err)) return;
      if (err instanceof ApiError && err.status === 404) return close("ended");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const leave = () => (session ? void answer(session.status === "invited" && !session.createdByMe ? "decline" : "leave") : onBack());
  const peer = session?.with;
  const waiting = session?.waitingFor && !session.waitingFor.mine ? session.waitingFor : null;
  const leftMs = session?.inviteExpiresAt ? new Date(session.inviteExpiresAt).getTime() - now : 0;
  const total = 5 * 60_000;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[640px] flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 pb-2.5 pt-3.5">
        <button type="button" onClick={leave} aria-label="Leave and wipe" className="grid size-11 shrink-0 place-items-center rounded-field bg-transparent text-ink">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex min-w-0 grow flex-col gap-[3px]">
          <h1 className="m-0 truncate text-base font-extrabold">{peerName}</h1>
          {session ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-live-line px-2 py-px font-mono text-[10.5px] font-bold text-live">
                {session.status === "active" ? <span className={`size-1.5 rounded-full ${waiting ? "bg-[#4E8A93]" : "bg-live shadow-[0_0_0_4px_rgba(127,220,232,0.2)]"}`} /> : null}
                LIVE{session.status === "active" && session.startedAt ? ` · ${clock(now - new Date(session.startedAt).getTime())}` : ""}
              </span>
              {session.status === "active" ? (
                <span className={`font-mono text-[10.5px] ${waiting ? "text-keep" : "text-online"}`}>{waiting ? "connection lost" : "here"}</span>
              ) : peer ? (
                <span className={`font-mono text-[10.5px] ${peer.online ? "text-online" : "text-dim"}`}>{peer.online ? "online" : "offline"}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {session?.status === "active" ? (
          <button
            type="button"
            onClick={() => void answer("leave")}
            aria-label="End live chat"
            className="min-h-11 shrink-0 rounded-field border border-dashed border-danger bg-transparent px-2.5 font-mono text-[11px] font-bold text-danger-ink before:content-['[_'] after:content-['_]'] hover:bg-danger/10"
          >
            END
          </button>
        ) : null}
      </header>

      {!session ? (
        <div className="grow p-6">{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-dim">Loading…</p>}</div>
      ) : session.status === "invited" ? (
        <div className="flex grow flex-col items-center justify-center gap-[18px] px-7 text-center">
          {peer ? <Avatar username={peer.username} online={peer.online} size={76} /> : null}
          <h2 className="m-0 text-[22px] font-extrabold">{session.createdByMe ? `Waiting for ${peerName}` : `${peerName} wants to chat live`}</h2>
          <p className="m-0 max-w-[38ch] text-[14px] leading-relaxed text-dim">
            You'll see each other type, letter by letter. <strong className="text-live">Nothing is stored</strong>: everything is wiped when either of you leaves, or after 30
            seconds without connection.
          </p>
          <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
            <p className="m-0 font-mono text-xs text-dim">
              {session.createdByMe ? `${peerName} has ` : "answer within "}
              <strong className="text-ink">{countdown(leftMs)}</strong>
              {session.createdByMe ? " to answer" : ""}
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full bg-live-line" style={{ width: `${Math.max(0, Math.min(100, (leftMs / total) * 100))}%` }} />
            </div>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {session.createdByMe ? (
            <button type="button" onClick={() => void answer("leave")} className="min-h-12 rounded-control border border-line-strong bg-transparent px-5 text-[14.5px] font-semibold text-ink">
              Cancel invitation
            </button>
          ) : (
            <div className="flex w-full max-w-[320px] gap-2">
              <button type="button" onClick={() => void answer("decline")} className="min-h-[50px] flex-1 rounded-[14px] border border-line-strong bg-transparent text-[14.5px] font-semibold text-ink">
                Decline
              </button>
              <button type="button" onClick={() => void answer("accept")} className="min-h-[50px] flex-1 rounded-[14px] bg-brand text-[14.5px] font-bold text-white hover:bg-brand-hover">
                Go live
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="m-0 flex items-center gap-2.5 border-b border-line bg-panel px-[18px] py-2 font-mono text-[11px] text-dim">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-live" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span>End-to-end encrypted · nothing is stored · wiped when either of you leaves</span>
          </p>
          {waiting ? (
            <div role="status" className="flex flex-col gap-2 border-b border-[#5C4A22] bg-keep/[0.08] px-[18px] py-3">
              <p className="m-0 text-[13.5px] leading-snug text-[#F3E3BF]">
                {peerName}'s connection dropped. The chat is wiped in <strong>{Math.max(0, Math.ceil((waiting.deadline - now) / 1000))} s</strong> unless they come back.
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-[#3A3220]" aria-hidden="true">
                <div className="h-full bg-keep" style={{ width: `${Math.max(0, Math.min(100, ((waiting.deadline - now) / 30_000) * 100))}%` }} />
              </div>
            </div>
          ) : null}

          <div className={`flex grow flex-col gap-2 overflow-y-auto p-4 ${waiting ? "opacity-55" : ""}`} aria-live="polite">
            <div className="grow" />
            {session.startedAt ? (
              <p className="m-0 self-center font-mono text-[11px] text-faint">// live since {new Date(session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            ) : null}
            {lines.map((l) => (
              <p
                key={l.id}
                className={`m-0 max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[14.5px] leading-snug ${
                  l.mine ? "self-end rounded-[16px_16px_4px_16px] bg-brand text-white" : "self-start rounded-[16px_16px_16px_4px] border border-line bg-raised"
                }`}
              >
                {l.text}
              </p>
            ))}
            {theirDraft ? (
              <div className="flex max-w-[80%] flex-col gap-1 self-start">
                <p className="m-0 whitespace-pre-wrap break-words rounded-[16px_16px_16px_4px] border border-dashed border-live-line bg-live/[0.06] px-3.5 py-2.5 text-[14.5px] leading-snug text-live">
                  {theirDraft}
                  <span className="ml-px inline-block h-[15px] w-0.5 bg-live align-[-2px]" aria-hidden="true" />
                </p>
                <p className="m-0 font-mono text-[10.5px] text-dim">{peerName} is typing live</p>
              </div>
            ) : null}
            {draft ? (
              <div className="flex max-w-[80%] flex-col items-end gap-1 self-end">
                <p className="m-0 whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border border-dashed border-accent bg-accent/[0.08] px-3.5 py-2.5 text-[14.5px] leading-snug text-[#F3D3D9]">
                  {draft}
                  <span className="ml-px inline-block h-[15px] w-0.5 bg-[#F3D3D9] align-[-2px]" aria-hidden="true" />
                </p>
                <p className="m-0 font-mono text-[10.5px] text-dim">your draft · {peerName} sees it now</p>
              </div>
            ) : null}
            <div ref={bottom} />
          </div>

          {error ? (
            <div className="px-4 pb-2">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}

          <form onSubmit={send} className="flex flex-col gap-2 border-t border-line bg-sunken px-3.5 pb-[22px] pt-2.5">
            <p className={`m-0 font-mono text-[10.5px] ${waiting ? "text-dim" : "text-live"}`}>
              {waiting ? `Writing is paused until ${peerName} is back` : `● ${peerName} sees every letter as you type · Enter sends the line`}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 grow">
                <span className="sr-only">Live message</span>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => onDraft(e.target.value)}
                  disabled={Boolean(waiting) || !keys.current}
                  placeholder={waiting ? `Waiting for ${peerName}…` : "Type live"}
                  autoComplete="off"
                  className="min-h-[46px] w-full rounded-[14px] border border-live-line bg-panel px-3.5 text-[15px] text-ink outline-none placeholder:text-faint disabled:border-line disabled:text-faint"
                />
              </label>
              <button
                type="submit"
                aria-label="Send the line"
                disabled={!draft.trim() || Boolean(waiting)}
                className="grid size-[46px] shrink-0 place-items-center rounded-[14px] bg-brand text-white disabled:bg-[#3A1A22] disabled:text-[#8A6A72]"
              >
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
