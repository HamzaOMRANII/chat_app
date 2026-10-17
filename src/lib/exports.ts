import { strToU8, zipSync, type Zippable } from "fflate";
import { api } from "./api";
import type { Chat, WireMessage } from "./chats";
import { decryptMessage, type Plain } from "./e2e";
import { downloadFile, type FileInfo } from "./files";

export type ExportReq = {
  id: string;
  chatId: string;
  requestedBy: string;
  approverId: string;
  messages: boolean;
  media: boolean;
  period: "all" | "24h" | "7d";
  counts: { messages: number; files: number; bytes: number };
  status: "pending" | "approved" | "refused" | "expired" | "cancelled";
  requestedAt: string;
  answeredAt: string | null;
  until: string;
  downloadedAt: string | null;
};

export const PERIOD_TEXT = { all: "everything", "24h": "last 24 hours", "7d": "last 7 days" } as const;
const PERIOD_MS = { all: 0, "24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000 } as const;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

/** Every message of the chat still on the server (pages of 200, oldest first). */
async function allMessages(chatId: string) {
  const out: WireMessage[] = [];
  let before: string | undefined;
  for (;;) {
    const { messages } = await api<{ messages: WireMessage[] }>(`/api/chats/${chatId}/messages?limit=200${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    out.unshift(...messages);
    if (messages.length < 200) return out;
    before = messages[0]!.sentAt;
  }
}

/**
 * Builds the zip on this device: chat.html (readable, photos inline), chat.txt and media/. Messages and files are
 * decrypted here; the other side's view-only files are left out.
 */
export async function buildExport(opts: { chat: Chat; userId: string; req: ExportReq; onProgress: (text: string, ratio: number) => void }) {
  const { chat, userId, req, onProgress } = opts;
  const peer = chat.with!;
  const since = PERIOD_MS[req.period] ? Date.now() - PERIOD_MS[req.period] : 0;
  onProgress("reading the messages", 0);
  const [wire, { files }] = await Promise.all([allMessages(chat.id), api<{ files: FileInfo[] }>(`/api/chats/${chat.id}/files`)]);
  const ready = new Set(files.filter((f) => f.status === "ready").map((f) => f.id));
  const rows: { at: string; mine: boolean; plain: Plain | null }[] = [];
  for (const m of wire.filter((m) => Date.parse(m.sentAt) >= since)) {
    const mine = m.senderId === userId;
    const myKey = chat.keys.find((k) => k.userId === userId && k.version === (mine ? m.senderKeyVersion : m.recipientKeyVersion));
    const theirKey = chat.keys.find((k) => k.userId === peer.id && k.version === (mine ? m.recipientKeyVersion : m.senderKeyVersion));
    const plain =
      myKey && theirKey
        ? await decryptMessage({ userId, chatId: chat.id, senderId: m.senderId, myKey, theirKey, ciphertext: m.ciphertext, nonce: m.nonce, senderKeyVersion: m.senderKeyVersion, recipientKeyVersion: m.recipientKeyVersion })
        : null;
    rows.push({ at: m.sentAt, mine, plain });
  }

  const zip: Zippable = {};
  const media = new Map<string, string>(); // file id → path in the zip
  const left: string[] = [];
  const used = new Set<string>();
  if (req.media) {
    const wanted = rows.filter((r) => r.plain?.f && ready.has(r.plain.f.id));
    for (const [i, r] of wanted.entries()) {
      const f = r.plain!.f!;
      if (!r.mine && f.view) {
        left.push(f.name);
        continue;
      }
      onProgress(`decrypting media ${i + 1} of ${wanted.length} · ${f.name}`, 0.1 + (0.85 * i) / Math.max(1, wanted.length));
      let name = f.name.replace(/[\\/:*?"<>|]/g, "_") || "file";
      for (let n = 2; used.has(name); n++) name = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
      used.add(name);
      const bytes = new Uint8Array(await (await downloadFile(f)).arrayBuffer());
      zip[`media/${name}`] = [bytes, { level: 0 }];
      media.set(f.id, `media/${name}`);
    }
  }

  onProgress("writing chat.html and chat.txt", 0.96);
  const who = (mine: boolean) => (mine ? "You" : peer.username);
  const shown = req.messages ? rows : rows.filter((r) => r.plain?.f);
  const txt: string[] = [`H_CHAT export · chat with ${peer.username} · ${PERIOD_TEXT[req.period]} · built ${stamp(new Date().toISOString())}`, ""];
  const html: string[] = [];
  for (const r of shown) {
    const f = r.plain?.f;
    const path = f ? media.get(f.id) : undefined;
    const fileText = f ? (path ? `[file: ${path}]` : `[file not included: ${f.name}]`) : "";
    const text = r.plain ? [r.plain.t, fileText].filter(Boolean).join(" ") : "[couldn't be read on this device]";
    txt.push(`[${stamp(r.at)}] ${who(r.mine)}: ${text}`);
    const body = r.plain
      ? `${r.plain.t ? `<p>${escapeHtml(r.plain.t)}</p>` : ""}${
          f
            ? path
              ? f.mime.startsWith("image/")
                ? `<a href="${escapeHtml(path)}"><img src="${escapeHtml(path)}" alt="${escapeHtml(f.name)}"></a>`
                : f.mime.startsWith("video/")
                  ? `<video src="${escapeHtml(path)}" controls></video>`
                  : `<a class="file" href="${escapeHtml(path)}">${escapeHtml(f.name)}</a>`
              : `<p class="gone">${escapeHtml(f.name)} · not included</p>`
            : ""
        }`
      : `<p class="gone">couldn't be read on this device</p>`;
    html.push(`<div class="m ${r.mine ? "me" : "them"}"><div class="b">${body}</div><div class="t">${escapeHtml(who(r.mine))} · ${stamp(r.at)}</div></div>`);
  }
  if (left.length) txt.push("", `Left out (shared as view only): ${left.join(", ")}`);
  zip["chat.txt"] = strToU8(txt.join("\n"));
  zip["chat.html"] = strToU8(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat with ${escapeHtml(peer.username)}</title>
<style>body{margin:0;background:#0A0B10;color:#F3F4F8;font:15px/1.45 system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:10px}h1{font-size:20px;margin:0}.sub{color:#9EA3B5;font-size:13px;margin:0 0 12px}.m{display:flex;flex-direction:column;max-width:80%}.me{align-self:flex-end;align-items:flex-end}.b{padding:10px 14px;border-radius:16px;background:#181A24;border:1px solid #262938}.me .b{background:#7E2234;border-color:#7E2234}.b p{margin:0;white-space:pre-wrap;word-break:break-word}.b img,.b video{display:block;max-width:100%;max-height:360px;border-radius:10px;margin-top:4px}.file{color:#E3A3AE}.gone{color:#9EA3B5;font-style:italic}.t{color:#6E7387;font:11px ui-monospace,monospace;margin-top:3px}</style></head>
<body><main><h1>Chat with ${escapeHtml(peer.username)}</h1><p class="sub">H_CHAT export · ${PERIOD_TEXT[req.period]} · built ${escapeHtml(stamp(new Date().toISOString()))}${left.length ? ` · ${left.length} view-only file${left.length > 1 ? "s" : ""} left out` : ""}</p>${html.join("\n")}</main></body></html>`);
  const blob = new Blob([zipSync(zip, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  onProgress("done", 1);
  return { blob, name: `H_CHAT-${peer.username}-${new Date().toISOString().slice(0, 10)}.zip`, files: media.size, left: left.length };
}
