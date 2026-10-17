import { api, apiBytes } from "./api";
import { newFileKey, openPiece, sealPiece, type FileRef } from "./e2e";
import { isNativeApp } from "./platform";

export type { FileRef };
export type FileKind = "image" | "video" | "audio" | "document" | "archive" | "other";
/** What the server knows about a chat's file: no name, no content. */
export type FileInfo = { id: string; senderId: string; kind: FileKind; size: number; status: "ready" | "deleted"; deletedReason: string | null; messageId: string | null; expiresAt: string };
export type MediaSummary = { used: number; files: number; limit: number; maxFile: number; request: { deadline: string } | null; chats: { chatId: string; files: number }[] };

export const PIECE = 4 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;
/** Photos up to this size show their preview without a tap. */
export const AUTO_PREVIEW = 10 * 1024 * 1024;

export function kindOf(mime: string, name = ""): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/zip|rar|7z|tar|gzip|compressed/.test(mime) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return "archive";
  if (/pdf|word|excel|sheet|presentation|powerpoint|text|document|rtf|csv|json/.test(mime)) return "document";
  return "other";
}

/** "2.4 MB", "340 KB" */
export function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Encrypts a file here, piece by piece, and uploads it. The key never leaves the message. */
export async function uploadFile(chatId: string, file: File, onProgress: (done: number) => void, signal: AbortSignal): Promise<FileRef> {
  const mime = file.type || "application/octet-stream";
  const { file: started } = await api<{ file: { id: string; chunks: number } }>(`/api/chats/${chatId}/files`, { body: { kind: kindOf(mime, file.name), size: file.size } });
  const key = await newFileKey();
  for (let n = 0; n < started.chunks; n++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const plain = new Uint8Array(await file.slice(n * PIECE, (n + 1) * PIECE).arrayBuffer());
    const sealed = await sealPiece(key, started.id, n, started.chunks, plain);
    await apiBytes(`/api/files/${started.id}/chunks/${n}`, { body: sealed, signal });
    onProgress(Math.min(file.size, (n + 1) * PIECE));
  }
  return { id: started.id, name: file.name.slice(0, 200) || "file", mime, size: file.size, key, chunks: started.chunks };
}

// Opened files stay in memory while the app runs (never written to storage by H_CHAT)
const opened = new Map<string, Blob>();
const urls = new Map<string, string>();

/** Downloads and decrypts a file. */
export async function downloadFile(ref: FileRef, onProgress?: (done: number) => void): Promise<Blob> {
  const cached = opened.get(ref.id);
  if (cached) return cached;
  const parts: BlobPart[] = [];
  for (let n = 0; n < ref.chunks; n++) {
    const sealed = new Uint8Array(await apiBytes(`/api/files/${ref.id}/chunks/${n}`));
    parts.push((await openPiece(ref.key, ref.id, n, ref.chunks, sealed)) as Uint8Array<ArrayBuffer>);
    onProgress?.(Math.min(ref.size, (n + 1) * PIECE));
  }
  const blob = new Blob(parts, { type: ref.mime });
  opened.set(ref.id, blob);
  return blob;
}

export async function fileUrl(ref: FileRef, onProgress?: (done: number) => void) {
  const known = urls.get(ref.id);
  if (known) return known;
  const url = URL.createObjectURL(await downloadFile(ref, onProgress));
  urls.set(ref.id, url);
  return url;
}
export const knownUrl = (id: string) => urls.get(id) ?? null;

/** Forgets opened files (deleted, expired, or the chat ended). */
export function forgetFiles(ids?: string[]) {
  for (const id of ids ?? [...opened.keys()]) {
    opened.delete(id);
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

async function blobToBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let out = "";
  for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Saves a copy on the device: the browser's download, or the phone's Documents/H_CHAT folder. */
export async function saveBlob(blob: Blob, name: string) {
  if (isNativeApp) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const path = `H_CHAT/${Date.now()}-${name.replace(/[\\/:*?"<>|]/g, "_")}`;
    await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
    return `Saved in Documents/H_CHAT`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "Downloaded";
}

/** The system share sheet with the file (Android app), or the browser's when it can share files. */
export async function shareBlob(blob: Blob, name: string) {
  if (isNativeApp) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const written = await Filesystem.writeFile({ path: `share/${name}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
    await Share.share({ files: [written.uri], dialogTitle: name });
    return;
  }
  await navigator.share({ files: [new File([blob], name, { type: blob.type })] });
}
export const canShareFiles = isNativeApp || (typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.txt")] }));

export const deleteFiles = (ids: string[]) => api<{ deleted: number }>("/api/files/delete", { body: { ids } });
