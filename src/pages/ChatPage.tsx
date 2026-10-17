import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { ensureMyKey, forgetChat, keepChatKey, latestKey, longDuration, makeChatKey, modeLabel, theirVerifiedKey, type Chat, type WireMessage } from "../lib/chats";
import { lastSeen } from "../lib/contacts";
import { decryptMessage, encryptMessage } from "../lib/e2e";
import { live } from "../lib/live";
import type { LiveSession } from "../lib/liveChat";
import { StartChatSheet } from "../components/StartChatSheet";
import { AttachSheet } from "../components/AttachSheet";
import { ExportSheet } from "../components/ExportSheet";
import { ExportCards } from "../components/ExportCards";
import type { ExportReq } from "../lib/exports";
import { FileBubble } from "../components/FileBubble";
import { MediaViewer } from "../components/MediaViewer";
import { useViewOnlyProtection } from "../lib/protect";
import { bytes, downloadFile, forgetFiles, saveBlob, uploadFile, type FileInfo, type FileRef } from "../lib/files";

type Shown = { id: string; mine: boolean; text: string | null; file?: FileRef; sentAt: string; deliveredAt: string | null; readAt: string | null; expiresAt: string };
type Props = {
  chatId: string;
  userId: string;
  onBack: () => void;
  /** The chat ended (either side, the rules, the admin): back to the list, with this explanation. */
  onClosed: (text: string) => void;
  onSafety: (chat: Chat) => void;
  /** The chat's media (photos, videos, documents). */
  onMedia: (chatId: string) => void;
  /** Open (or start) a live chat with the same person, next to this one. */
  onLive: (sessionId: string) => void;
  onAuthError: (err: unknown) => boolean;
};

const MAX_LENGTH = 4000;
const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

const ENDED: Record<string, (who: string, byMe: boolean) => string> = {
  ended_by_user: (who, byMe) => (byMe ? "You ended this chat. All messages were deleted." : `Chat ended by ${who}. All messages were deleted.`),
  declined: (who, byMe) => (byMe ? "You declined the chat." : `${who} declined the chat.`),
  cancelled: (who, byMe) => (byMe ? "You cancelled the invitation." : `${who} cancelled the invitation.`),
  invite_expired: () => "The invitation expired without an answer.",
  expired: () => "This chat ended: all its messages had expired.",
  deleted_by_admin: () => "This chat was closed by the administrator. All messages were deleted.",
  rules_changed: () => "This chat was closed: its duration is no longer allowed for this contact. All messages were deleted.",
  contact_unavailable: (who) => `This chat was closed: ${who} is no longer available as a contact. All messages were deleted.`,
};
const endedText = (reason: string, who: string, byMe: boolean) => (ENDED[reason] ?? (() => "This chat was closed."))(who, byMe);

/** "deleted in 2d 04h" */
function deletedIn(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `deleted in ${d ? `${d}d ${String(h).padStart(2, "0")}h` : h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`}`;
}
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "today";
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

const badgeTone = (mode: Chat["mode"]) => (mode === "auto" ? "border-auto-line text-auto" : "border-keep-line text-keep");

/** True on a wide screen (tablet, computer): the chat header has room for every button. */
function useWide() {
  const query = "(min-width: 640px)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function ChatPage({ chatId, userId, onBack, onClosed, onSafety, onMedia, onLive, onAuthError }: Props) {
  // Files: what the server says about them (deleted?), what this pair may do, uploads in progress, the viewer
  const [files, setFiles] = useState<Map<string, FileInfo>>(new Map());
  const [rules, setRules] = useState<{ files: "all" | "p2p" | "none"; export: boolean } | null>(null);
  const [uploads, setUploads] = useState<{ key: number; name: string; size: number; done: number; abort: AbortController }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [viewing, setViewing] = useState<{ file: FileRef; mine: boolean; sentAt: string; expiresAt: string } | null>(null);
  const [fileNote, setFileNote] = useState("");
  const uploadKey = useRef(0);
  const [exportsList, setExportsList] = useState<ExportReq[]>([]);
  const [exporting, setExporting] = useState(false);
  const wide = useWide();
  // Live chat with the same person: allowed by their rules? already running?
  const [liveAllowed, setLiveAllowed] = useState(false);
  const [liveWith, setLiveWith] = useState<LiveSession | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Shown[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUntil, setTypingUntil] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(Date.now());
  const chatRef = useRef<Chat | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);
  // ✓ / ✓✓ that arrived before the server's answer to my own send: applied as soon as the message is shown
  const earlyStatus = useRef(new Map<string, { deliveredAt: string; readAt: string | null }>());
  chatRef.current = chat;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Ended chats leave the screen (and the list) at once
  const closedRef = useRef(false);
  // In a ref: a new onClosed from the parent mustn't reload the chat
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const close = useCallback(
    (reason: string, byMe: boolean) => {
      forgetChat(userId, chatId);
      forgetFiles(messagesRef.current.flatMap((m) => (m.file ? [m.file.id] : [])));
      if (closedRef.current) return;
      closedRef.current = true;
      onClosedRef.current(endedText(reason, chatRef.current?.with?.username ?? "Your contact", byMe));
    },
    [userId, chatId],
  );

  const fail = useCallback(
    (err: unknown) => {
      if (onAuthError(err)) return;
      if (err instanceof ApiError && err.status === 404) return close("closed", false);
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [onAuthError, close],
  );

  /** Turns wire messages into what's shown, decrypting with the keys this device has. */
  const open = useCallback(
    async (current: Chat, wire: WireMessage[]): Promise<Shown[]> => {
      const peerId = current.with?.id ?? "";
      return Promise.all(
        wire.map(async (m) => {
          const mine = m.senderId === userId;
          const myVersion = mine ? m.senderKeyVersion : m.recipientKeyVersion;
          const theirVersion = mine ? m.recipientKeyVersion : m.senderKeyVersion;
          const myKey = current.keys.find((k) => k.userId === userId && k.version === myVersion);
          const theirKey = current.keys.find((k) => k.userId === peerId && k.version === theirVersion);
          const plain =
            myKey && theirKey
              ? await decryptMessage({ userId, chatId: current.id, senderId: m.senderId, myKey, theirKey, ciphertext: m.ciphertext, nonce: m.nonce, senderKeyVersion: m.senderKeyVersion, recipientKeyVersion: m.recipientKeyVersion })
              : null;
          return { id: m.id, mine, text: plain?.t ?? null, file: plain?.f, sentAt: m.sentAt, deliveredAt: m.deliveredAt, readAt: m.readAt, expiresAt: m.expiresAt };
        }),
      );
    },
    [userId],
  );

  const receipts = useCallback(() => {
    void api(`/api/chats/${chatId}/receipts`, { body: { read: document.visibilityState === "visible" } }).catch(() => {});
  }, [chatId]);

  const loadExports = useCallback(async () => {
    try {
      setExportsList((await api<{ exports: ExportReq[] }>(`/api/chats/${chatId}/exports`)).exports);
    } catch {
      /* shown again on the next reload */
    }
  }, [chatId]);

  const load = useCallback(async () => {
    try {
      let { chat: current } = await api<{ chat: Chat }>(`/api/chats/${chatId}`);
      if (await ensureMyKey(current, userId)) ({ chat: current } = await api<{ chat: Chat }>(`/api/chats/${chatId}`));
      setChat(current);
      if (current.status !== "active") return;
      const [{ messages: wire }, { files: list }] = await Promise.all([
        api<{ messages: WireMessage[] }>(`/api/chats/${chatId}/messages`),
        api<{ files: FileInfo[] }>(`/api/chats/${chatId}/files`),
      ]);
      setFiles(new Map(list.map((f) => [f.id, f])));
      void loadExports();
      setMessages(await open(current, wire));
      if (wire.some((m) => m.senderId !== userId && !m.readAt)) receipts();
    } catch (err) {
      fail(err);
    }
  }, [chatId, userId, open, receipts, fail, loadExports]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: new messages, receipts, typing, keys, end
  useEffect(() => {
    const offs = [
      live.on<{ chatId: string; message: WireMessage }>("msg:new", async ({ chatId: id, message }) => {
        if (id !== chatId || !chatRef.current) return;
        const [shown] = await open(chatRef.current, [message]);
        setMessages((list) => (list.some((m) => m.id === shown!.id) ? list : [...list, shown!]));
        setTypingUntil(0);
        receipts();
      }),
      live.on<{ chatId: string; delivered: string[]; read: string[]; at: string }>("msg:status", ({ chatId: id, delivered, read, at }) => {
        if (id !== chatId) return;
        // Recorded at once (not inside a state update, which React runs later)
        const shown = new Set(messagesRef.current.map((m) => m.id));
        for (const mid of [...delivered, ...read]) {
          if (!shown.has(mid)) earlyStatus.current.set(mid, { deliveredAt: earlyStatus.current.get(mid)?.deliveredAt ?? at, readAt: read.includes(mid) ? at : null });
        }
        setMessages((list) =>
          list.map((m) => (read.includes(m.id) ? { ...m, deliveredAt: m.deliveredAt ?? at, readAt: at } : delivered.includes(m.id) ? { ...m, deliveredAt: at } : m)),
        );
      }),
      live.on<{ chatId: string }>("typing", ({ chatId: id }) => id === chatId && setTypingUntil(Date.now() + TYPING_SHOWN_MS)),
      live.on<{ chatId: string; reason: string; by: string | null }>("chat:ended", ({ chatId: id, reason, by }) => {
        if (id !== chatId) return;
        setMessages([]);
        close(reason, by === userId);
      }),
      live.on<{ chatId: string }>("chat:keys", ({ chatId: id }) => id === chatId && void load()),
      live.on<{ chatId: string }>("exports:changed", ({ chatId: id }) => id === chatId && void loadExports()),
      live.on<{ chatId: string; fileIds: string[] }>("files:deleted", ({ chatId: id, fileIds }) => {
        if (id !== chatId) return;
        forgetFiles(fileIds);
        void api<{ files: FileInfo[] }>(`/api/chats/${chatId}/files`)
          .then(({ files: list }) => setFiles(new Map(list.map((f) => [f.id, f]))))
          .catch(() => {});
      }),
      live.on("chats:changed", () => void load()),
      // Reconnected or back on screen: fetch what arrived meanwhile
      live.on("resync", () => void load()),
    ];
    const visible = () => document.visibilityState === "visible" && receipts();
    document.addEventListener("visibilitychange", visible);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener("visibilitychange", visible);
    };
  }, [chatId, userId, open, receipts, load, close, loadExports]);

  // Safety net: while the live connection is down and the chat is on screen, check for new messages every 5 s
  useEffect(() => {
    const t = setInterval(() => {
      if (!live.connected() && document.visibilityState === "visible") void load();
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Countdowns, typing indicator expiry, and messages disappearing on time
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => setNow(Date.now()), typingUntil - Date.now() + 50);
    return () => clearTimeout(t);
  }, [typingUntil]);

  const visibleMessages = messages.filter((m) => new Date(m.expiresAt).getTime() > now);
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [visibleMessages.length, typingUntil]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !chat || sending) return;
    setSending(true);
    setError("");
    try {
      const myKey = latestKey(chat, userId);
      const theirKey = await theirVerifiedKey(chat, userId);
      if (!myKey || !theirKey) throw new Error("The chat keys aren't ready. Try again in a moment.");
      const body = await encryptMessage({ userId, chatId, myKey, theirKey, plain: { t: text } });
      const { message } = await api<{ message: WireMessage }>(`/api/chats/${chatId}/messages`, { body });
      const early = earlyStatus.current.get(message.id);
      earlyStatus.current.delete(message.id);
      setMessages((list) => [
        ...list.filter((m) => m.id !== message.id),
        { id: message.id, mine: true, text, sentAt: message.sentAt, deliveredAt: early?.deliveredAt ?? null, readAt: early?.readAt ?? null, expiresAt: message.expiresAt },
      ]);
      setDraft("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale_keys") await load();
      fail(err);
    } finally {
      setSending(false);
    }
  }

  /** Each picked file: encrypted and uploaded here with a progress bar, then sent as a message. */
  async function sendFiles(picked: File[], viewOnly: boolean) {
    setAttaching(false);
    for (const file of picked) {
      const key = ++uploadKey.current;
      const abort = new AbortController();
      setUploads((list) => [...list, { key, name: file.name, size: file.size, done: 0, abort }]);
      try {
        const current = chatRef.current;
        if (!current) throw new Error("The chat isn't ready.");
        const ref = { ...(await uploadFile(chatId, file, (done) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, done } : u))), abort.signal)), view: viewOnly };
        const myKey = latestKey(current, userId);
        const theirKey = await theirVerifiedKey(current, userId);
        if (!myKey || !theirKey) throw new Error("The chat keys aren't ready. Try again in a moment.");
        const body = await encryptMessage({ userId, chatId, myKey, theirKey, plain: { t: "", f: ref } });
        const { message } = await api<{ message: WireMessage }>(`/api/chats/${chatId}/messages`, { body: { ...body, fileId: ref.id } });
        setFiles((map) => new Map(map).set(ref.id, { id: ref.id, senderId: userId, kind: "other", size: ref.size, status: "ready", deletedReason: null, messageId: message.id, expiresAt: message.expiresAt }));
        setMessages((list) => [...list.filter((m) => m.id !== message.id), { id: message.id, mine: true, text: "", file: ref, sentAt: message.sentAt, deliveredAt: null, readAt: null, expiresAt: message.expiresAt }]);
      } catch (err) {
        if (!abort.signal.aborted) fail(err);
      } finally {
        setUploads((list) => list.filter((u) => u.key !== key));
      }
    }
  }

  /** Saving a copy: only where the rules allow export, and never a file the other side shared as view only. */
  const canSave = (file: FileRef, mine: boolean) => Boolean(rules?.export) && (mine || !file.view);

  /** Photos and videos open in the viewer; other files download (where the rules allow it). */
  async function openFile(m: Shown) {
    if (!m.file) return;
    if (/^(image|video|text)\//.test(m.file.mime) || m.file.mime === "application/json") return setViewing({ file: m.file, mine: m.mine, sentAt: m.sentAt, expiresAt: m.expiresAt });
    if (!canSave(m.file, m.mine)) return setFileNote(m.file.view ? `${peerName} shared ${m.file.name} as view only: it can't be downloaded.` : "Downloading files isn't allowed with this contact.");
    try {
      setFileNote(`Opening ${m.file.name}…`);
      setFileNote(`${await saveBlob(await downloadFile(m.file), m.file.name)}: ${m.file.name}`);
    } catch (err) {
      fail(err);
      setFileNote("");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
      e.preventDefault();
      void send();
    }
  }

  function onDraft(value: string) {
    setDraft(value.slice(0, MAX_LENGTH));
    if (value && Date.now() - lastTypingSent.current > TYPING_SEND_EVERY_MS) {
      lastTypingSent.current = Date.now();
      live.send("typing", { chatId });
    }
  }

  async function act(kind: "accept" | "decline" | "end") {
    if (!chat?.with) return;
    setError("");
    try {
      if (kind === "accept") {
        const key = await makeChatKey(userId, chat.with.id);
        const { chat: accepted } = await api<{ chat: Chat }>(`/api/chats/${chatId}/accept`, { body: { key: { pub: key.pub, sig: key.sig } } });
        keepChatKey(userId, chatId, 1, key.secret);
        setChat(accepted);
        await load();
      } else {
        await api(kind === "end" ? `/api/chats/${chatId}` : `/api/chats/${chatId}/decline`, { method: kind === "end" ? "DELETE" : "POST" });
        setConfirmEnd(false);
        close(kind === "end" ? "ended_by_user" : chat.createdByMe ? "cancelled" : "declined", true);
      }
    } catch (err) {
      fail(err);
    }
  }

  // A view-only file from the other side is on screen: no screenshots (Android), no right-click (web)
  useViewOnlyProtection(messages.some((m) => m.file?.view && files.get(m.file.id)?.status !== "deleted"));
  const peer = chat?.with;
  const peerId = chat?.status === "active" ? peer?.id : undefined;
  useEffect(() => {
    if (!peerId) return;
    const check = () => {
      api<{ live: LiveSession[] }>("/api/live")
        .then(({ live: open }) => setLiveWith(open.find((s) => s.with?.id === peerId) ?? null))
        .catch(() => {});
    };
    api<{ options: { live: boolean; files: "all" | "p2p" | "none"; export: boolean } }>(`/api/chats/options/${peerId}`)
      .then(({ options }) => {
        setLiveAllowed(options.live);
        setRules({ files: options.files, export: options.export });
      })
      .catch(() => {});
    check();
    const offs = [live.on("live:changed", check), live.on("live:ended", check), live.on("resync", check)];
    return () => offs.forEach((off) => off());
  }, [peerId]);
  const peerName = peer?.username ?? "your contact";
  const theirLatest = chat && peer ? latestKey(chat, peer.id) : null;
  const peerMoved = Boolean(chat?.status === "active" && peer?.identityPub && theirLatest && theirLatest.identityPub !== peer.identityPub);
  const locked = visibleMessages.filter((m) => m.text === null).length;
  const typing = typingUntil > now;

  /** Media and Live: in the header on a wide screen, in their own row (with words) on a phone. */
  function extras(row: boolean) {
    const live = liveWith || liveAllowed;
    return (
      <>
        {live ? (
          <button
            type="button"
            onClick={() => (liveWith ? onLive(liveWith.id) : setStartingLive(true))}
            aria-label={liveWith ? "Back to the live chat" : "Start a live chat"}
            title={liveWith ? "Back to the live chat" : "Start a live chat"}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-field border border-live-line font-mono text-[11px] font-bold text-live ${row ? "min-h-10 flex-1" : "min-h-11 px-2.5"} ${liveWith ? "bg-live/10" : "border-dashed bg-transparent"}`}
          >
            <span className={`size-1.5 rounded-full bg-live ${liveWith ? "shadow-[0_0_0_3px_rgba(127,220,232,0.2)]" : ""}`} aria-hidden="true" />
            {row && liveWith ? "BACK TO LIVE" : "LIVE"}
          </button>
        ) : null}
        {rules ? (
          <button
            type="button"
            onClick={() => setExporting(true)}
            aria-label="Export this chat"
            title="Export this chat"
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-field border border-line bg-panel text-ink ${row ? "min-h-10 flex-1 text-[13px] font-semibold" : "size-11"}`}
          >
            <svg viewBox="0 0 24 24" width={row ? 17 : 19} height={row ? 17 : 19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15V3M7 8l5-5 5 5M5 14v6h14v-6" />
            </svg>
            {row ? <span aria-hidden="true">Export</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onMedia(chatId)}
          aria-label="Media in this chat"
          title="Media in this chat"
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-field border border-line bg-panel text-ink ${row ? "min-h-10 flex-1 text-[13px] font-semibold" : "size-11"}`}
        >
          <svg viewBox="0 0 24 24" width={row ? 17 : 19} height={row ? 17 : 19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path d="M21 16l-5-5-9 9" />
          </svg>
          {row ? <span aria-hidden="true">Media</span> : null}
        </button>
      </>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[640px] flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 pb-2.5 pt-3.5">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-field bg-transparent text-ink">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex min-w-0 grow flex-col gap-[3px]">
          <h1 className="m-0 truncate text-base font-extrabold">{peerName}</h1>
          {chat ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={`whitespace-nowrap rounded-full border px-2 py-px font-mono text-[10.5px] font-bold ${badgeTone(chat.mode)} ${chat.status === "invited" ? "border-dashed" : ""}`}>{modeLabel(chat)}</span>
              {peer ? <span className={`font-mono text-[10.5px] ${peer.online ? "text-online" : "text-dim"}`}>{lastSeen(peer)}</span> : null}
            </div>
          ) : null}
        </div>
        {chat?.status === "active" ? (
          <>
            {wide ? extras(false) : null}
            <button type="button" onClick={() => onSafety(chat)} aria-label="Safety code" className="grid size-11 shrink-0 place-items-center rounded-field border border-line bg-panel text-ink">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              aria-label="End chat"
              className="min-h-11 shrink-0 rounded-field border border-dashed border-danger bg-transparent px-2.5 font-mono text-[11px] font-bold text-danger-ink before:content-['[_'] after:content-['_]'] hover:bg-danger/10"
            >
              END
            </button>
          </>
        ) : null}
      </header>
      {chat?.status === "active" && !wide ? <div className="flex gap-2 border-b border-line px-3 py-2">{extras(true)}</div> : null}

      {chat?.status === "active" ? (
        <p className="m-0 flex items-center gap-2.5 border-b border-line bg-panel px-[18px] py-2 font-mono text-[11px] text-dim">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`shrink-0 ${chat.mode === "auto" ? "text-auto" : "text-keep"}`} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>
            End-to-end encrypted · messages and files are deleted {longDuration(chat.retentionMinutes)} after they're sent
          </span>
        </p>
      ) : null}

      {!chat ? (
        <div className="grow p-6">{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-dim">Loading…</p>}</div>
      ) : chat.status === "invited" ? (
        <div className="flex grow flex-col items-center justify-center gap-4 px-7 text-center">
          {peer ? <Avatar username={peer.username} online={peer.online} size={72} /> : null}
          <h2 className="m-0 text-[22px] font-extrabold">{chat.createdByMe ? `Waiting for ${peerName}` : `${peerName} wants to chat`}</h2>
          <p className="m-0 max-w-[36ch] text-[14px] leading-relaxed text-dim">
            {chat.createdByMe ? "You invited them to " : "They invite you to "}
            {chat.mode === "auto" ? "an Automatic" : "a Keep-alive"} chat: each message is deleted {longDuration(chat.retentionMinutes)} after it's sent. This can't be
            changed later.
            {chat.createdByMe ? " You can write once they accept." : ""}
          </p>
          {chat.inviteExpiresAt ? <p className="m-0 font-mono text-[11.5px] text-faint">the invitation expires {new Date(chat.inviteExpiresAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {chat.createdByMe ? (
            <button type="button" onClick={() => act("decline")} className="min-h-12 rounded-control border border-line-strong bg-transparent px-5 text-[14.5px] font-semibold text-ink">
              Cancel invitation
            </button>
          ) : (
            <div className="flex w-full max-w-[320px] gap-2">
              <button type="button" onClick={() => act("decline")} className="min-h-12 flex-1 rounded-control border border-line-strong bg-transparent text-[14.5px] font-semibold text-ink">
                Decline
              </button>
              <button type="button" onClick={() => act("accept")} className="min-h-12 flex-1 rounded-control bg-brand text-[14.5px] font-bold text-white hover:bg-brand-hover">
                Accept
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex grow flex-col gap-2.5 overflow-y-auto px-4 py-4" aria-live="polite">
            <div className="grow" />
            {locked ? (
              <p className="m-0 flex items-center gap-2 self-center rounded-field border border-dashed border-line-strong px-3 py-2 text-xs leading-normal text-dim">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {locked} earlier message{locked > 1 ? "s were" : " was"} sent to your other device and can't be read here.
              </p>
            ) : null}
            {visibleMessages.length === 0 && !locked ? <p className="m-0 self-center text-sm text-faint">No messages yet. Say hello.</p> : null}
            {visibleMessages
              .filter((m) => m.text !== null)
              .map((m, i, list) => {
                const day = dayLabel(m.sentAt);
                const showDay = i === 0 || dayLabel(list[i - 1]!.sentAt) !== day;
                return (
                  <div key={m.id} className="contents">
                    {showDay ? <p className="m-0 self-center font-mono text-[11px] text-faint">// {day}</p> : null}
                    <div className={`flex max-w-[82%] flex-col gap-1 ${m.mine ? "items-end self-end" : "items-start self-start"}`}>
                      {m.file ? <FileBubble file={m.file} info={files.get(m.file.id)} mine={m.mine} onOpen={() => void openFile(m)} /> : null}
                      {m.text ? (
                        <p
                          className={`m-0 whitespace-pre-wrap break-words px-3.5 py-2.5 text-[14.5px] leading-snug ${
                            m.mine ? "rounded-[16px_16px_4px_16px] bg-brand text-white" : "rounded-[16px_16px_16px_4px] border border-line bg-raised"
                          }`}
                        >
                          {m.text}
                        </p>
                      ) : null}
                      <p className="m-0 font-mono text-[10.5px] text-faint">
                        {time(m.sentAt)}
                        {m.mine ? (m.readAt ? <span className="text-accent-soft"> · ✓✓ read</span> : m.deliveredAt ? " · ✓ delivered" : " · sent") : null} · {deletedIn(m.expiresAt, now)}
                      </p>
                    </div>
                  </div>
                );
              })}
            {uploads.map((u) => (
              <div key={u.key} className="flex w-[78%] max-w-[320px] flex-col items-end gap-1 self-end">
                <div className="flex w-full flex-col gap-2 rounded-[16px_16px_4px_16px] border border-dashed border-accent bg-accent/[0.08] px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="truncate text-[13.5px] font-bold text-[#F3D3D9]">{u.name}</span>
                      <span className="font-mono text-[10.5px] text-ink-soft">
                        encrypting + sending · {bytes(u.done)} of {bytes(u.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => u.abort.abort()}
                      aria-label={`Cancel sending ${u.name}`}
                      className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-[#5A3640] bg-transparent text-[#F3D3D9]"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-[#3A1A22]">
                    <span className="block h-full bg-accent" style={{ width: `${Math.round((u.done / u.size) * 100)}%` }} />
                  </span>
                </div>
                <span className="font-mono text-[10.5px] text-dim">{Math.round((u.done / u.size) * 100)}%</span>
              </div>
            ))}
            {chat ? <ExportCards exports={exportsList} chat={chat} userId={userId} onChanged={() => void loadExports()} onError={fail} /> : null}
            {typing ? (
              <p className="m-0 flex items-center gap-2 font-mono text-[11px] text-dim">
                <span className="flex gap-[3px]" aria-hidden="true">
                  <span className="size-[5px] animate-pulse rounded-full bg-accent" />
                  <span className="size-[5px] animate-pulse rounded-full bg-accent opacity-60" />
                  <span className="size-[5px] animate-pulse rounded-full bg-accent opacity-30" />
                </span>
                {peerName} is typing…
              </p>
            ) : null}
            <div ref={bottom} />
          </div>

          {error ? (
            <div className="px-4 pb-2">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
          {fileNote ? (
            <div className="px-4 pb-2">
              <p role="status" className="m-0 font-mono text-[11px] text-dim">
                {fileNote}
              </p>
            </div>
          ) : null}
          {peerMoved ? (
            <div className="px-4 pb-2">
              <Notice tone="warning">{peerName} signed in on a new device. You can write again once they open H_CHAT there.</Notice>
            </div>
          ) : null}

          <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-sunken px-3.5 pb-4 pt-2.5">
            <button
              type="button"
              disabled={rules?.files !== "all" || peerMoved}
              onClick={() => setAttaching(true)}
              aria-label={rules && rules.files !== "all" ? "Files aren't allowed with this contact" : "Attach a file"}
              title={rules && rules.files !== "all" ? "Files aren't allowed with this contact" : "Attach a file"}
              className="grid size-11 shrink-0 place-items-center rounded-field border border-line-strong bg-panel text-ink disabled:border-line disabled:text-[#4A4F63]"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
              </svg>
            </button>
            <label className="flex min-w-0 grow">
              <span className="sr-only">Message</span>
              <textarea
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={Math.min(5, Math.max(1, draft.split("\n").length))}
                placeholder="Message"
                disabled={peerMoved}
                className="min-h-[46px] w-full resize-none rounded-[14px] border border-line-strong bg-panel px-3.5 py-3 text-[15px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || sending || peerMoved}
              className="grid size-[46px] shrink-0 place-items-center rounded-[14px] bg-brand text-white disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </>
      )}

      {attaching && chat ? <AttachSheet
          peerName={peerName}
          keptFor={longDuration(chat.retentionMinutes)}
          canExport={Boolean(rules?.export)}
          onPick={(picked, viewOnly) => void sendFiles(picked, viewOnly)}
          onClose={() => setAttaching(false)}
        /> : null}
      {exporting ? (
        <ExportSheet
          chatId={chatId}
          peerName={peerName}
          onAsked={(e) => {
            setExporting(false);
            setExportsList((list) => [e, ...list]);
          }}
          onClose={() => setExporting(false)}
          onAuthError={onAuthError}
        />
      ) : null}
      {viewing ? (
        <MediaViewer
          file={viewing.file}
          from={viewing.mine ? "you" : peerName}
          sentAt={time(viewing.sentAt)}
          expiresIn={deletedIn(viewing.expiresAt, now).replace(/^deleted /, "")}
          canSave={canSave(viewing.file, viewing.mine)}
          viewOnly={Boolean(viewing.file.view)}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {startingLive && peer ? (
        <StartChatSheet
          userId={userId}
          peer={peer}
          liveOnly
          onStarted={() => setStartingLive(false)}
          onLiveStarted={(s) => onLive(s.id)}
          onClose={() => setStartingLive(false)}
          onAuthError={onAuthError}
        />
      ) : null}

      {confirmEnd ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 px-[18px]">
          <section role="alertdialog" aria-labelledby="end-title" className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[22px] border border-line-strong bg-panel px-5 py-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-danger-ink">// end chat</p>
            <h2 id="end-title" className="m-0 text-[21px] font-extrabold">
              End this chat with {peerName}?
            </h2>
            <p className="m-0 text-sm leading-relaxed text-ink-soft">
              Every message is deleted <strong>now, for both of you</strong>, and the chat's keys are destroyed. This can't be undone. {peerName} sees "Chat ended".
            </p>
            <button
              type="button"
              onClick={() => act("end")}
              className="min-h-[50px] rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-[13px] font-bold text-danger-ink before:content-['[_'] after:content-['_]'] hover:bg-danger/10"
            >
              END AND DELETE
            </button>
            <button type="button" onClick={() => setConfirmEnd(false)} className="min-h-[50px] rounded-[14px] border border-line-strong bg-raised text-[14.5px] font-semibold text-ink">
              Keep chatting
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
