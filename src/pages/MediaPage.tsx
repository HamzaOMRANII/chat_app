import { useCallback, useEffect, useState } from "react";
import { Notice } from "../components/Screen";
import { Icon, removedText } from "../components/FileBubble";
import { api, ApiError } from "../lib/api";
import { longDuration, type Chat, type WireMessage } from "../lib/chats";
import { decryptMessage } from "../lib/e2e";
import { AUTO_PREVIEW, bytes, deleteFiles, downloadFile, fileUrl, knownUrl, saveBlob, type FileInfo, type FileRef, type MediaSummary } from "../lib/files";
import { live } from "../lib/live";

type Item = { file: FileRef; info: FileInfo; chat: Chat; mine: boolean; canSave: boolean };

type Props = {
  /** One chat's media, or all of this user's media when absent. */
  chatId?: string;
  userId: string;
  onBack: () => void;
  onAuthError: (err: unknown) => boolean;
};

/** "2d 23h", "9h", "40 min" */
function left(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return d ? `${d}d ${String(h).padStart(2, "0")}h` : h ? `${h}h` : `${minutes % 60} min`;
}

/** Decrypts a chat's messages to find its files (their names and keys are only inside the messages). */
async function chatMedia(chatId: string, userId: string): Promise<Item[]> {
  const [{ chat }, { messages }, { files }] = await Promise.all([
    api<{ chat: Chat }>(`/api/chats/${chatId}`),
    api<{ messages: (WireMessage & { fileId?: string | null })[] }>(`/api/chats/${chatId}/messages?limit=200`),
    api<{ files: FileInfo[] }>(`/api/chats/${chatId}/files`),
  ]);
  const peerId = chat.with?.id ?? "";
  const options = await api<{ options: { export: boolean } }>(`/api/chats/options/${peerId}`).catch(() => ({ options: { export: false } }));
  const byId = new Map(files.map((f) => [f.id, f]));
  const items: Item[] = [];
  for (const m of messages) {
    if (!m.fileId || byId.get(m.fileId)?.status !== "ready") continue;
    const mine = m.senderId === userId;
    const myKey = chat.keys.find((k) => k.userId === userId && k.version === (mine ? m.senderKeyVersion : m.recipientKeyVersion));
    const theirKey = chat.keys.find((k) => k.userId === peerId && k.version === (mine ? m.recipientKeyVersion : m.senderKeyVersion));
    if (!myKey || !theirKey) continue;
    const plain = await decryptMessage({ userId, chatId, senderId: m.senderId, myKey, theirKey, ciphertext: m.ciphertext, nonce: m.nonce, senderKeyVersion: m.senderKeyVersion, recipientKeyVersion: m.recipientKeyVersion });
    if (plain?.f) items.push({ file: plain.f, info: byId.get(m.fileId)!, chat, mine, canSave: options.options.export });
  }
  return items.reverse();
}

function Thumb({ item, selected, now, onToggle }: { item: Item; selected: boolean; now: number; onToggle: () => void }) {
  const [url, setUrl] = useState(knownUrl(item.file.id));
  const image = item.file.mime.startsWith("image/");
  useEffect(() => {
    if (!image || url || item.file.size > AUTO_PREVIEW) return;
    let gone = false;
    fileUrl(item.file)
      .then((u) => !gone && setUrl(u))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [image, url, item.file]);
  const soon = Date.parse(item.info.expiresAt) - now < 24 * 3600_000;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${item.file.name}, ${bytes(item.file.size)}`}
      onClick={onToggle}
      className={`relative aspect-square overflow-hidden rounded-[10px] bg-gradient-to-br from-[#2A3A55] to-[#3B2A44] p-0 ${selected ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
    >
      {url ? <img src={url} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-ink-soft">{<Icon d={image ? "doc" : "video"} size={22} />}</span>}
      <span
        className={`absolute left-1.5 top-1.5 grid size-[22px] place-items-center rounded-full border-2 ${selected ? "border-ink bg-brand text-white" : "border-ink-soft bg-black/35"}`}
        aria-hidden="true"
      >
        {selected ? (
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        ) : null}
      </span>
      <span className="absolute bottom-1 left-1.5 font-mono text-[9.5px] text-ink [text-shadow:0_1px_2px_#000]">{bytes(item.file.size)}</span>
      <span className={`absolute bottom-1 right-1.5 font-mono text-[9.5px] [text-shadow:0_1px_2px_#000] ${soon ? "text-keep" : "text-ink-soft"}`}>{left(item.info.expiresAt, now)}</span>
    </button>
  );
}

/** Media of a chat, or of all chats: download all, delete all, or pick files one by one. */
export function MediaPage({ chatId, userId, onBack, onAuthError }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [summary, setSummary] = useState<MediaSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const media = await api<MediaSummary>("/api/media");
      setSummary(media);
      const ids = chatId ? [chatId] : media.chats.map((c) => c.chatId);
      const all = (await Promise.all(ids.map((id) => chatMedia(id, userId).catch(() => [] as Item[])))).flat();
      setItems(all);
      setSelected((sel) => new Set([...sel].filter((id) => all.some((i) => i.file.id === id))));
    } catch (err) {
      if (onAuthError(err)) return;
      if (err instanceof ApiError && err.status === 404) return onBack();
      setError(err instanceof Error ? err.message : "Couldn't load the media");
    }
  }, [chatId, userId, onAuthError, onBack]);

  useEffect(() => {
    void load();
    const offs = [live.on("files:deleted", () => void load()), live.on("resync", () => void load())];
    return () => offs.forEach((off) => off());
  }, [load]);

  const toggle = (id: string) => setSelected((sel) => (sel.has(id) ? new Set([...sel].filter((x) => x !== id)) : new Set(sel).add(id)));
  const visual = items?.filter((i) => i.file.mime.startsWith("image/") || i.file.mime.startsWith("video/")) ?? [];
  const docs = items?.filter((i) => !visual.includes(i)) ?? [];
  const total = items?.reduce((a, i) => a + i.file.size, 0) ?? 0;
  const picked = items?.filter((i) => selected.has(i.file.id)) ?? [];
  const pickedSize = picked.reduce((a, i) => a + i.file.size, 0);
  const peer = chatId ? items?.[0]?.chat.with?.username : undefined;
  const keptFor = chatId && items?.[0] ? longDuration(items[0].chat.retentionMinutes) : null;

  async function download(list: Item[]) {
    const allowed = list.filter((i) => i.canSave);
    const skipped = list.length - allowed.length;
    setError("");
    for (const [n, item] of allowed.entries()) {
      setBusy(`Downloading ${n + 1} of ${allowed.length} · ${item.file.name}`);
      try {
        await saveBlob(await downloadFile(item.file), item.file.name);
      } catch (err) {
        setError(err instanceof Error ? `${item.file.name}: ${err.message}` : `Couldn't download ${item.file.name}`);
      }
    }
    setBusy("");
    setNote(
      `${allowed.length} file${allowed.length === 1 ? "" : "s"} downloaded${skipped ? ` · ${skipped} not allowed with ${skipped === 1 ? "that contact" : "those contacts"}` : ""}.`,
    );
  }

  async function remove(ids: string[]) {
    setConfirm(null);
    setBusy("Deleting…");
    try {
      const { deleted } = await deleteFiles(ids);
      setNote(`${deleted} file${deleted === 1 ? "" : "s"} deleted for both of you.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't delete");
    }
    setBusy("");
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
          <h1 className="m-0 truncate text-base font-extrabold">{chatId ? `Media with ${peer ?? "…"}` : "My media"}</h1>
          <span className="font-mono text-[10.5px] text-dim">
            {items ? `${items.length} file${items.length === 1 ? "" : "s"} · ${bytes(total)}` : "loading…"}
            {summary && !chatId ? ` · my space ${bytes(summary.used)} of ${bytes(summary.limit)}` : ""}
          </span>
        </div>
        {items?.length ? (
          <button
            type="button"
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.file.id)))}
            className="min-h-10 shrink-0 rounded-[11px] border border-line-strong bg-transparent px-3 text-[13px] font-semibold text-ink"
          >
            {selected.size === items.length ? "Select none" : "Select all"}
          </button>
        ) : null}
      </header>

      {summary?.request ? (
        <p role="alert" className="m-0 border-b border-[#5C4A22] bg-keep/[0.08] px-4 py-2.5 text-[12.5px] leading-normal text-[#F3E3BF]">
          The administrator asked you to download your media: <strong>your files will be deleted on {new Date(summary.request.deadline).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>.
        </p>
      ) : null}
      <p role="note" className="m-0 flex gap-2.5 border-b border-[#5C4A22] bg-keep/[0.08] px-4 py-2.5 text-[12.5px] leading-normal text-[#F3E3BF]">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#F2C46B" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-px shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>
          Media is kept only as long as {keptFor ? <>this chat allows (<strong>{keptFor}</strong> after it's sent)</> : "each chat allows"}, then deleted automatically for both of you. Download
          what you want to keep.
        </span>
      </p>

      <div className="flex grow flex-col gap-3 overflow-y-auto px-4 py-3.5">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {items === null && !error ? <p className="text-sm text-dim">Decrypting…</p> : null}
        {items?.length === 0 ? <p className="m-0 mt-6 self-center text-sm text-faint">No media.</p> : null}
        {visual.length ? (
          <>
            <h2 className="eyebrow m-0 text-[11px] font-normal">photos and videos · {visual.length}</h2>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {visual.map((i) => (
                <Thumb key={i.file.id} item={i} selected={selected.has(i.file.id)} now={now} onToggle={() => toggle(i.file.id)} />
              ))}
            </div>
          </>
        ) : null}
        {docs.length ? (
          <>
            <h2 className="eyebrow m-0 mt-1 text-[11px] font-normal">documents · {docs.length}</h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {docs.map((i) => {
                const on = selected.has(i.file.id);
                return (
                  <li key={i.file.id} className="border-t border-line">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(i.file.id)}
                      className="flex w-full items-center gap-3 bg-transparent px-1 py-2.5 text-left text-ink"
                    >
                      <span className={`grid size-[22px] shrink-0 place-items-center rounded-full border-2 ${on ? "border-ink bg-brand text-white" : "border-faint"}`} aria-hidden="true">
                        {on ? (
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12l5 5 9-10" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#22252F] text-ink-soft">
                        <Icon d="doc" />
                      </span>
                      <span className="flex min-w-0 grow flex-col gap-0.5">
                        <span className="truncate text-sm font-bold">{i.file.name}</span>
                        <span className="font-mono text-[10.5px] text-dim">
                          {bytes(i.file.size)}
                          {chatId ? "" : ` · ${i.mine ? "to" : "from"} ${i.chat.with?.username ?? "?"}`}
                        </span>
                      </span>
                      <span className={`shrink-0 font-mono text-[10.5px] ${Date.parse(i.info.expiresAt) - now < 24 * 3600_000 ? "text-keep" : "text-dim"}`}>
                        deleted in {left(i.info.expiresAt, now)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      <footer className="flex flex-col gap-2 border-t border-line bg-sunken px-4 pb-6 pt-3">
        <p role="status" className="m-0 font-mono text-[11px] text-ink-soft">
          {busy || note || (picked.length ? `${picked.length} selected · ${bytes(pickedSize)}` : "Tap files to select them")}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!picked.length || Boolean(busy)}
            onClick={() => void download(picked)}
            className="min-h-12 flex-1 rounded-[14px] bg-brand text-sm font-bold text-white disabled:opacity-50"
          >
            Download{picked.length ? ` ${picked.length}` : ""}
          </button>
          <button
            type="button"
            disabled={!picked.length || Boolean(busy)}
            onClick={() => setConfirm(picked.map((i) => i.file.id))}
            className="min-h-12 flex-1 rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-[12.5px] font-bold text-danger-ink before:content-['[_'] after:content-['_]'] disabled:opacity-50"
          >
            DELETE{picked.length ? ` ${picked.length}` : ""}
          </button>
        </div>
        {items?.length ? (
          <div className="flex justify-between text-[12.5px]">
            <button type="button" disabled={Boolean(busy)} onClick={() => void download(items)} className="bg-transparent p-0 font-semibold text-link">
              Download all ({items.length})
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setConfirm(items.map((i) => i.file.id))} className="bg-transparent p-0 font-semibold text-danger-ink">
              Delete all
            </button>
          </div>
        ) : null}
        <p className="m-0 text-[11.5px] leading-normal text-faint">
          Deleting removes the file for both of you. Downloads are decrypted on this device; contacts whose rules don't allow export can't be downloaded.
        </p>
      </footer>

      {confirm ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 px-[18px]">
          <section role="alertdialog" aria-labelledby="del-title" className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[22px] border border-line-strong bg-panel px-5 py-[22px]">
            <h2 id="del-title" className="m-0 text-[20px] font-extrabold">
              Delete {confirm.length} file{confirm.length === 1 ? "" : "s"}?
            </h2>
            <p className="m-0 text-sm leading-relaxed text-ink-soft">They're deleted from the server now, for both of you. This can't be undone.</p>
            <button
              type="button"
              onClick={() => void remove(confirm)}
              className="min-h-[50px] rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-[13px] font-bold text-danger-ink before:content-['[_'] after:content-['_]']"
            >
              DELETE
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="min-h-[50px] rounded-[14px] border border-line-strong bg-raised text-[14.5px] font-semibold text-ink">
              Keep them
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export { removedText };
