import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { bytes, MAX_FILE, type MediaSummary } from "../lib/files";

type Props = { peerName: string; keptFor: string; canExport: boolean; onPick: (files: File[], viewOnly: boolean) => void; onClose: () => void };

/** "Send a file": photo or video, camera, or any document. Shows the space left. */
export function AttachSheet({ peerName, keptFor, canExport, onPick, onClose }: Props) {
  const [viewOnly, setViewOnly] = useState(!canExport);
  const [media, setMedia] = useState<MediaSummary | null>(null);
  const [error, setError] = useState("");
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<MediaSummary>("/api/media")
      .then(setMedia)
      .catch(() => {});
  }, []);

  function picked(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const big = files.find((f) => f.size > MAX_FILE);
    if (big) return setError(`${big.name} is over 100 MB.`);
    if (media && files.reduce((a, f) => a + f.size, 0) + media.used > media.limit)
      return setError("Not enough space left in your 2 GB. Delete some media first.");
    onPick(files, viewOnly);
  }

  const tile =
    "flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-line-strong bg-raised text-[13px] font-bold text-ink hover:border-accent";
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="attach-title"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex w-full max-w-[560px] flex-col gap-3 rounded-t-[26px] border-t border-line-strong bg-panel px-[18px] pb-6 pt-3"
      >
        <span className="h-1 w-10 self-center rounded-full bg-line-strong" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 id="attach-title" className="m-0 text-xl font-extrabold">
            Send a file to {peerName}
          </h2>
          <p className="m-0 text-[13px] leading-normal text-dim">
            Encrypted on this device before it leaves. The server only keeps scrambled pieces, deleted <strong className="text-keep">{keptFor}</strong> after
            sending, like the messages.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={tile} onClick={() => gallery.current?.click()}>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="10" r="2" />
              <path d="M21 16l-5-5-9 9" />
            </svg>
            Photo or video
          </button>
          <button type="button" className={tile} onClick={() => camera.current?.click()}>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Camera
          </button>
          <button type="button" className={tile} onClick={() => doc.current?.click()}>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
            Document
          </button>
        </div>
        <ViewChoice peerName={peerName} canExport={canExport} viewOnly={viewOnly} onChange={setViewOnly} />
        <input
          ref={gallery}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          aria-label="Choose photos or videos"
          onChange={(e) => picked(e.target.files)}
        />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label="Take a photo" onChange={(e) => picked(e.target.files)} />
        <input ref={doc} type="file" multiple hidden aria-label="Choose documents" onChange={(e) => picked(e.target.files)} />
        {error ? <p className="m-0 rounded-xl border border-dashed border-danger px-3 py-2 text-[13px] text-danger-ink">{error}</p> : null}
        {media ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-sunken px-3.5 py-3">
            <div className="flex justify-between font-mono text-[11px] text-dim">
              <span>your files on the server</span>
              <span className="text-ink">
                {bytes(media.used)} of {bytes(media.limit)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full ${media.used / media.limit > 0.8 ? "bg-keep" : "bg-accent"}`}
                style={{ width: `${Math.min(100, (media.used / media.limit) * 100)}%` }}
              />
            </div>
            <div className="font-mono text-[11px] text-faint">up to 100 MB per file · space comes back as files expire</div>
          </div>
        ) : null}
        <button type="button" onClick={onClose} className="min-h-11 bg-transparent text-[13.5px] font-semibold text-link">
          Cancel
        </button>
      </section>
    </div>
  );
}

/** The sender decides: the other side can download the file, or only look at it in H_CHAT. */
export function ViewChoice({
  peerName,
  canExport,
  viewOnly,
  onChange,
  compact = false,
}: {
  peerName: string;
  canExport: boolean;
  viewOnly: boolean;
  onChange: (viewOnly: boolean) => void;
  compact?: boolean;
}) {
  const option = (value: boolean, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={viewOnly === value}
      disabled={!value && !canExport}
      onClick={() => onChange(value)}
      className={`min-h-9 flex-1 rounded-[10px] border px-2.5 text-[12.5px] ${viewOnly === value ? "border-accent bg-accent/15 font-bold text-ink" : "border-line-strong bg-transparent font-semibold text-dim"} disabled:opacity-40`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {compact ? null : <span className="font-mono text-[11px] text-dim">what {peerName} can do with it</span>}
      <div role="radiogroup" aria-label={`What ${peerName} can do with the file`} className="flex gap-1.5">
        {option(false, "Can download")}
        {option(true, "View only")}
      </div>
      {!canExport && !compact ? <span className="text-[11.5px] text-faint">This contact's rules don't allow downloads: files are view only.</span> : null}
    </div>
  );
}
