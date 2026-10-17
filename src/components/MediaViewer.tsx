import { useEffect, useState } from "react";
import { bytes, canShareFiles, downloadFile, fileUrl, saveBlob, shareBlob, type FileRef } from "../lib/files";

type Props = { file: FileRef; from: string; sentAt?: string; expiresIn?: string; canSave: boolean; viewOnly?: boolean; onClose: () => void };

/** A photo or video full screen, with Save and Share where the contact's rules allow it. */
export function MediaViewer({ file, from, sentAt, expiresIn, canSave, viewOnly = false, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [note, setNote] = useState("");
  const [text, setText] = useState<string | null>(null);
  const isText = file.mime.startsWith("text/") || file.mime === "application/json";
  useEffect(() => {
    if (!isText || !url) return;
    void downloadFile(file)
      .then((b) => b.slice(0, 2_000_000).text())
      .then(setText)
      .catch(() => {});
  }, [isText, url, file]);

  useEffect(() => {
    let gone = false;
    fileUrl(file, (d) => !gone && setDone(d))
      .then((u) => !gone && setUrl(u))
      .catch(() => !gone && setNote("This file couldn't be opened."));
    return () => {
      gone = true;
    };
  }, [file]);

  async function act(kind: "save" | "share") {
    try {
      const blob = await downloadFile(file);
      if (kind === "save") setNote(await saveBlob(blob, file.name));
      else await shareBlob(blob, file.name);
    } catch {
      if (kind === "save") setNote("Couldn't save it.");
    }
  }

  return (
    <div role="dialog" aria-label={file.name} className="fixed inset-0 z-50 flex flex-col bg-[#05060A]">
      <header className="flex items-center gap-2 px-3 pb-2.5 pt-3.5">
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-field bg-transparent text-ink">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-[15px] font-extrabold">from {from}</span>
          <span className="truncate font-mono text-[10.5px] text-dim">
            {sentAt ? `${sentAt} · ` : ""}
            {file.name} · {bytes(file.size)}
          </span>
        </div>
      </header>
      {/* The whole photo or video, fitted to the space left between the top and bottom bars */}
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        {url ? (
          file.mime.startsWith("video/") ? (
            <video src={url} controls autoPlay className="absolute inset-0 size-full object-contain" />
          ) : file.mime.startsWith("image/") ? (
            <img src={url} alt={file.name} className="absolute inset-0 size-full object-contain" />
          ) : isText ? (
            <pre className="absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed text-ink-soft">{text ?? ""}</pre>
          ) : (
            <p className="text-sm text-dim">{file.name} is ready.</p>
          )
        ) : (
          <p className="font-mono text-xs text-dim">{note || `decrypting · ${bytes(done)} of ${bytes(file.size)}`}</p>
        )}
      </div>
      <footer className="flex flex-col gap-2.5 border-t border-line bg-sunken px-[18px] pb-[26px] pt-3">
        {expiresIn ? (
          <p className="m-0 flex items-center gap-2 font-mono text-[11px] text-keep">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            deleted from the chat {expiresIn}
          </p>
        ) : null}
        {canSave ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => void act("save")} className="min-h-12 flex-1 rounded-[14px] border border-line-strong bg-transparent text-sm font-semibold text-ink">
              Save to {navigator.userAgent.includes("Android") ? "phone" : "device"}
            </button>
            {canShareFiles ? (
              <button type="button" onClick={() => void act("share")} className="min-h-12 flex-1 rounded-[14px] border border-line-strong bg-transparent text-sm font-semibold text-ink">
                Share
              </button>
            ) : null}
          </div>
        ) : null}
        {note && url ? <p className="m-0 font-mono text-[11px] text-ok">{note}</p> : null}
        <p className="m-0 text-xs leading-normal text-faint">
          Media is kept only as long as the chat allows, then deleted automatically.
          {canSave ? " A saved copy is yours: it leaves H_CHAT." : viewOnly ? ` ${from} shared it as view only: it can't be saved.` : " Saving isn't allowed with this contact."}
        </p>
      </footer>
    </div>
  );
}
