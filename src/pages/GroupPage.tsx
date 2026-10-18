import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AttachSheet } from "../components/AttachSheet";
import { FileBubble } from "../components/FileBubble";
import { MediaViewer } from "../components/MediaViewer";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { longDuration, modeLabel } from "../lib/chats";
import { decryptGroupMessage, encryptGroupMessage, verifyKey, type FileRef, type Plain, type PublishedKey } from "../lib/e2e";
import { bytes, downloadFile, forgetFiles, saveBlob, uploadFile, type FileInfo } from "../lib/files";
import { ensureGroupKey, latestGroupKey, memberColor, recipientKeys, type Group, type GroupWire } from "../lib/groups";
import { live } from "../lib/live";
import { useViewOnlyProtection } from "../lib/protect";
import { calls } from "../lib/calls";

const MAX_LENGTH = 4000;
const TYPING_SHOWN_MS = 4000;

type Shown = {
  id: string;
  senderId: string | null;
  mine: boolean;
  system: GroupWire["system"];
  text: string | null;
  file?: FileRef;
  readBy: number;
  recipients: number;
  sentAt: string;
  expiresAt: string;
};

type Props = { groupId: string; userId: string; onBack: () => void; onInfo: () => void; onClosed: (text: string) => void; onAuthError: (err: unknown) => boolean };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const SYSTEM: Record<string, (name: string) => string> = {
  created: () => "the administrator created the group",
  added: (n) => `the administrator added ${n}`,
  removed: (n) => `the administrator removed ${n} · new messages use new keys`,
  left: (n) => `${n} left · new messages use new keys`,
  settings: () => "the administrator changed the group's settings",
};

/** A group chat: each message is encrypted on this device and locked for each current member. */
export function GroupPage({ groupId, userId, onBack, onInfo, onClosed, onAuthError }: Props) {
  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<Shown[]>([]);
  const [files, setFiles] = useState<Map<string, FileInfo>>(new Map());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState<Map<string, number>>(new Map());
  const [now, setNow] = useState(Date.now());
  const [attaching, setAttaching] = useState(false);
  const [uploads, setUploads] = useState<{ key: number; name: string; size: number; done: number; abort: AbortController }[]>([]);
  const [viewing, setViewing] = useState<Shown | null>(null);
  const groupRef = useRef<Group | null>(null);
  groupRef.current = group;
  const verified = useRef(new Map<string, boolean>());
  const bottom = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const uploadKey = useRef(0);
  const closed = useRef(false);

  const fail = useCallback(
    (err: unknown) => {
      if (onAuthError(err)) return;
      if (err instanceof ApiError && err.status === 404 && !closed.current) {
        closed.current = true;
        return onClosed("You're no longer in this group.");
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [onAuthError, onClosed],
  );

  /** The sender's key, if its signature checks out (cached). */
  const senderKey = useCallback(
    async (g: Group, senderId: string, version: number): Promise<PublishedKey | null> => {
      const k = g.keys.find((x) => x.userId === senderId && x.version === version);
      if (!k) return null;
      const id = `${senderId}:${version}:${k.pub}`;
      if (!verified.current.has(id)) verified.current.set(id, await verifyKey(k, g.id));
      return verified.current.get(id) ? k : null;
    },
    [],
  );

  const open = useCallback(
    async (g: Group, wire: GroupWire[]): Promise<Shown[]> =>
      Promise.all(
        wire.map(async (m) => {
          let plain: Plain | null = null;
          if (!m.system && m.senderId && m.wrap && m.ciphertext && m.nonce && m.senderKeyVersion) {
            const key = await senderKey(g, m.senderId, m.senderKeyVersion);
            plain = key ? await decryptGroupMessage({ userId, groupId: g.id, senderId: m.senderId, senderKey: key, wrap: m.wrap, ciphertext: m.ciphertext, nonce: m.nonce }) : null;
          }
          return { id: m.id, senderId: m.senderId, mine: m.senderId === userId, system: m.system, text: plain?.t ?? null, file: plain?.f, readBy: m.readBy, recipients: m.recipients, sentAt: m.sentAt, expiresAt: m.expiresAt };
        }),
      ),
    [userId, senderKey],
  );

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") void api(`/api/groups/${groupId}/read`, { method: "POST" }).catch(() => {});
  }, [groupId]);

  const load = useCallback(async () => {
    try {
      let { group: g } = await api<{ group: Group }>(`/api/groups/${groupId}`);
      if (await ensureGroupKey(g, userId)) ({ group: g } = await api<{ group: Group }>(`/api/groups/${groupId}`));
      setGroup(g);
      const [{ messages: wire }, { files: list }] = await Promise.all([
        api<{ messages: GroupWire[] }>(`/api/groups/${groupId}/messages`),
        api<{ files: FileInfo[] }>(`/api/groups/${groupId}/files`),
      ]);
      setFiles(new Map(list.map((f) => [f.id, f])));
      setMessages(await open(g, wire));
      markRead();
    } catch (err) {
      fail(err);
    }
  }, [groupId, userId, open, markRead, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const offs = [
      live.on<{ groupId: string; message: GroupWire }>("group:msg", async ({ groupId: id, message }) => {
        if (id !== groupId || !groupRef.current) return;
        const [shown] = await open(groupRef.current, [message]);
        setMessages((list) => (list.some((m) => m.id === shown!.id) ? list : [...list, shown!]));
        setTyping((t) => new Map([...t].filter(([who]) => who !== message.senderId)));
        markRead();
      }),
      live.on<{ groupId: string; ids: string[] }>("group:read", ({ groupId: id, ids }) => {
        if (id !== groupId) return;
        setMessages((list) => list.map((m) => (ids.includes(m.id) ? { ...m, readBy: m.readBy + 1 } : m)));
      }),
      live.on<{ groupId: string; removed?: boolean }>("group:changed", ({ groupId: id, removed }) => {
        if (id !== groupId) return;
        if (removed && !closed.current) {
          closed.current = true;
          forgetFiles(messages.flatMap((m) => (m.file ? [m.file.id] : [])));
          return onClosed("You're no longer in this group.");
        }
        void load();
      }),
      live.on<{ groupId: string; userId: string }>("group:typing", ({ groupId: id, userId: who }) => {
        if (id === groupId) setTyping((t) => new Map(t).set(who, Date.now() + TYPING_SHOWN_MS));
      }),
      live.on<{ groupId?: string }>("files:deleted", ({ groupId: id }) => id === groupId && void load()),
      live.on("resync", () => void load()),
      live.on<{ groupId: string; call: Group["call"] }>("group:call", ({ groupId: id, call }) => {
        if (id === groupId) setGroup((g) => (g ? { ...g, call } : g));
      }),
    ];
    const visible = () => markRead();
    document.addEventListener("visibilitychange", visible);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener("visibilitychange", visible);
    };
  }, [groupId, open, load, markRead, onClosed, messages]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, uploads.length]);

  useViewOnlyProtection(messages.some((m) => m.file?.view && files.get(m.file.id)?.status !== "deleted"));

  /** Locks a message for every current member and sends it; once more after reloading if the members changed. */
  async function post(plain: Plain, fileId?: string, retry = true): Promise<{ id: string; sentAt: string; expiresAt: string; recipients: number }> {
    const g = groupRef.current!;
    const myKey = latestGroupKey(g, userId);
    if (!myKey) throw new Error("This device's group key isn't ready. Try again in a moment.");
    const recipients = await recipientKeys(g);
    const body = await encryptGroupMessage({ userId, groupId: g.id, myKey, recipients, plain });
    try {
      return (await api<{ message: { id: string; sentAt: string; expiresAt: string; recipients: number } }>(`/api/groups/${g.id}/messages`, { body: { ...body, ...(fileId ? { fileId } : {}) } })).message;
    } catch (err) {
      if (retry && err instanceof ApiError && (err.code === "stale_members" || err.code === "stale_keys")) {
        const { group: fresh } = await api<{ group: Group }>(`/api/groups/${g.id}`);
        groupRef.current = fresh;
        setGroup(fresh);
        return post(plain, fileId, false);
      }
      throw err;
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !group || sending) return;
    setSending(true);
    setError("");
    try {
      const m = await post({ t: text });
      setMessages((list) => [...list, { id: m.id, senderId: userId, mine: true, system: null, text, readBy: 1, recipients: m.recipients, sentAt: m.sentAt, expiresAt: m.expiresAt }]);
      setDraft("");
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  }

  async function sendFiles(picked: File[], viewOnly: boolean) {
    setAttaching(false);
    for (const file of picked) {
      const key = ++uploadKey.current;
      const abort = new AbortController();
      setUploads((list) => [...list, { key, name: file.name, size: file.size, done: 0, abort }]);
      try {
        const ref = { ...(await uploadFile({ groupId }, file, (done) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, done } : u))), abort.signal)), view: viewOnly };
        const m = await post({ t: "", f: ref }, ref.id);
        setFiles((map) => new Map(map).set(ref.id, { id: ref.id, senderId: userId, kind: "other", size: ref.size, status: "ready", deletedReason: null, messageId: m.id, expiresAt: m.expiresAt }));
        setMessages((list) => [...list, { id: m.id, senderId: userId, mine: true, system: null, text: "", file: ref, readBy: 1, recipients: m.recipients, sentAt: m.sentAt, expiresAt: m.expiresAt }]);
      } catch (err) {
        if (!abort.signal.aborted) fail(err);
      } finally {
        setUploads((list) => list.filter((u) => u.key !== key));
      }
    }
  }

  async function openFile(m: Shown) {
    if (!m.file) return;
    if (/^(image|video|text)\//.test(m.file.mime)) return setViewing(m);
    if (!m.mine && m.file.view) return setError(`${m.file.name} was shared as view only: it can't be downloaded.`);
    try {
      await saveBlob(await downloadFile(m.file), m.file.name);
    } catch (err) {
      fail(err);
    }
  }

  function onDraft(value: string) {
    setDraft(value.slice(0, MAX_LENGTH));
    if (value && Date.now() - lastTyping.current > 2500) {
      lastTyping.current = Date.now();
      live.send("group:typing", { groupId });
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
      e.preventDefault();
      void send();
    }
  }

  const name = (id: string | null) => group?.members.find((m) => m.id === id)?.username ?? "a former member";
  const typingNames = [...typing].filter(([, until]) => until > now).map(([who]) => name(who));
  const online = group?.members.filter((m) => m.online && m.id !== userId).length ?? 0;
  const visible = messages.filter((m) => Date.parse(m.expiresAt) > now);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[640px] flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 pb-2.5 pt-3.5">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-field bg-transparent text-ink">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button type="button" onClick={onInfo} aria-label="Group info" className="flex min-w-0 grow items-center gap-2.5 bg-transparent p-0 text-left text-ink">
          <GroupAvatar size={38} />
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="truncate text-base font-extrabold">{group?.name ?? "Group"}</span>
            {group ? (
              <span className="flex items-center gap-2">
                <span className={`whitespace-nowrap rounded-full border px-2 py-px font-mono text-[10.5px] font-bold ${group.mode === "auto" ? "border-auto-line text-auto" : "border-keep-line text-keep"}`}>
                  {modeLabel(group)}
                </span>
                <span className="truncate font-mono text-[10.5px] text-dim">
                  {group.members.length} members{online ? ` · ${online} online` : ""}
                </span>
              </span>
            ) : null}
          </span>
        </button>
        {group ? (
          <>
            <button
              type="button"
              onClick={() => void calls.startGroup({ id: group.id, name: group.name }, "voice")}
              disabled={Boolean(group.call)}
              aria-label="Group voice call"
              title="Group voice call"
              className="grid size-11 shrink-0 place-items-center rounded-field border border-[#1F8A5B] bg-[#1F8A5B]/[0.12] text-[#7FE3B6] disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void calls.startGroup({ id: group.id, name: group.name }, "video")}
              disabled={Boolean(group.call)}
              aria-label="Group video call"
              title="Group video call"
              className="grid size-11 shrink-0 place-items-center rounded-field border border-[#1F8A5B] bg-[#1F8A5B]/[0.12] text-[#7FE3B6] disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h12v12H3zM15 10l6-3v10l-6-3" />
              </svg>
            </button>
          </>
        ) : null}
      </header>
      {group?.call && !group.call.joined.includes(userId) ? (
        <div role="status" className="flex items-center gap-3 border-b border-[#1F8A5B] bg-[#1F8A5B]/[0.12] px-4 py-2.5">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-[#7FE3B6]" aria-hidden="true" />
          <span className="grow text-[13.5px] text-ink">
            {group.call.kind === "video" ? "Video call" : "Call"} in progress · {group.call.joined.length} {group.call.joined.length === 1 ? "person" : "people"}
          </span>
          <button
            type="button"
            disabled={group.call.joined.length >= 6}
            onClick={() => void calls.joinRunning({ id: group.id, name: group.name }, group.call!.callId, group.call!.kind)}
            className="min-h-9 shrink-0 rounded-[10px] bg-[#1F8A5B] px-3.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {group.call.joined.length >= 6 ? "Full" : "Join"}
          </button>
        </div>
      ) : null}
      {group ? (
        <p className="m-0 flex items-center gap-2.5 border-b border-line bg-panel px-[18px] py-2 font-mono text-[11px] text-dim">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`shrink-0 ${group.mode === "auto" ? "text-auto" : "text-keep"}`} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>End-to-end encrypted for each member · deleted {longDuration(group.retentionMinutes)} after they're sent</span>
        </p>
      ) : null}

      <div className="flex grow flex-col gap-2.5 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="grow" />
        {!group && !error ? <p className="text-sm text-dim">Loading…</p> : null}
        {group && visible.length === 0 ? <p className="m-0 self-center text-sm text-faint">No messages yet. Say hello.</p> : null}
        {visible.map((m) =>
          m.system ? (
            <p key={m.id} className="m-0 self-center text-center font-mono text-[11px] text-faint">
              // {(SYSTEM[m.system.kind] ?? (() => "the group changed"))(m.system.name ?? "someone")} · {time(m.sentAt)}
            </p>
          ) : (
            <div key={m.id} className={`flex max-w-[86%] gap-2 ${m.mine ? "self-end" : "self-start"}`}>
              <div className={`flex min-w-0 flex-col gap-1 ${m.mine ? "items-end" : "items-start"}`}>
                {m.file ? <FileBubble file={m.file} info={files.get(m.file.id)} mine={m.mine} onOpen={() => void openFile(m)} /> : null}
                {m.text || (!m.file && m.text === null) ? (
                  <div className={`px-3.5 py-2.5 text-[14.5px] leading-snug ${m.mine ? "rounded-[16px_16px_4px_16px] bg-brand text-white" : "rounded-[16px_16px_16px_4px] border border-line bg-raised"}`}>
                    {m.mine ? null : (
                      <p className="m-0 mb-0.5 text-xs font-bold" style={{ color: memberColor(name(m.senderId)) }}>
                        {name(m.senderId)}
                      </p>
                    )}
                    <p className={`m-0 whitespace-pre-wrap break-words ${m.text === null ? "italic text-dim" : ""}`}>{m.text ?? "This message can't be read on this device."}</p>
                  </div>
                ) : !m.mine ? (
                  <p className="m-0 text-xs font-bold" style={{ color: memberColor(name(m.senderId)) }}>
                    {name(m.senderId)}
                  </p>
                ) : null}
                <p className="m-0 font-mono text-[10.5px] text-faint">
                  {time(m.sentAt)}
                  {m.mine ? (m.readBy - 1 >= m.recipients && m.recipients > 0 ? <span className="text-accent-soft"> · ✓✓ read by all</span> : m.readBy > 1 ? ` · ✓✓ read by ${m.readBy - 1} of ${m.recipients}` : " · sent") : null}
                </p>
              </div>
            </div>
          ),
        )}
        {uploads.map((u) => (
          <div key={u.key} className="flex w-[78%] max-w-[320px] flex-col gap-2 self-end rounded-[16px_16px_4px_16px] border border-dashed border-accent bg-accent/[0.08] px-3 py-2.5">
            <span className="flex items-center gap-2.5">
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate text-[13.5px] font-bold text-[#F3D3D9]">{u.name}</span>
                <span className="font-mono text-[10.5px] text-ink-soft">
                  encrypting + sending · {bytes(u.done)} of {bytes(u.size)}
                </span>
              </span>
              <button type="button" onClick={() => u.abort.abort()} aria-label={`Cancel sending ${u.name}`} className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-[#5A3640] bg-transparent text-[#F3D3D9]">
                ✕
              </button>
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-[#3A1A22]">
              <span className="block h-full bg-accent" style={{ width: `${Math.round((u.done / u.size) * 100)}%` }} />
            </span>
          </div>
        ))}
        {typingNames.length ? <p className="m-0 font-mono text-[11px] text-dim">{typingNames.join(", ")} {typingNames.length > 1 ? "are" : "is"} typing…</p> : null}
        <div ref={bottom} />
      </div>

      {error ? (
        <div className="px-4 pb-2">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-sunken px-3.5 pb-4 pt-2.5">
        <button
          type="button"
          disabled={!group?.files}
          onClick={() => setAttaching(true)}
          aria-label={group && !group.files ? "Files aren't allowed in this group" : "Attach a file"}
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
            className="min-h-[46px] w-full resize-none rounded-[14px] border border-line-strong bg-panel px-3.5 py-3 text-[15px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <button type="submit" aria-label="Send" disabled={!draft.trim() || sending} className="grid size-[46px] shrink-0 place-items-center rounded-[14px] bg-brand text-white disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      {attaching && group ? (
        <AttachSheet peerName="the group" keptFor={longDuration(group.retentionMinutes)} canExport onPick={(picked, viewOnly) => void sendFiles(picked, viewOnly)} onClose={() => setAttaching(false)} />
      ) : null}
      {viewing?.file ? (
        <MediaViewer
          file={viewing.file}
          from={viewing.mine ? "you" : name(viewing.senderId)}
          sentAt={time(viewing.sentAt)}
          canSave={viewing.mine || !viewing.file.view}
          viewOnly={Boolean(viewing.file.view)}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </main>
  );
}

/** The group icon (several people). */
export function GroupAvatar({ size = 46 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center bg-[#1F2A44] text-auto" style={{ width: size, height: size, borderRadius: size * 0.32 }}>
      <svg viewBox="0 0 24 24" width={size * 0.48} height={size * 0.48} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <circle cx="17" cy="9" r="2.6" />
        <path d="M15.5 14.2A5 5 0 0 1 21 19" />
      </svg>
    </span>
  );
}
