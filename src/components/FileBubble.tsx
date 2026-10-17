import { useEffect, useState } from "react";
import { AUTO_PREVIEW, bytes, fileUrl, knownUrl, type FileInfo, type FileRef } from "../lib/files";

const icons = {
  doc: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
  video: <path d="M3 6h13v12H3zM16 10l5-3v10l-5-3" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  down: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
};
export function Icon({ d, size = 18 }: { d: keyof typeof icons; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[d]}
    </svg>
  );
}

export const removedText = (reason: string | null) =>
  reason === "removed_by_admin" ? "removed by an administrator" : reason === "expired" ? "expired" : "deleted";

type Props = {
  file: FileRef;
  info?: FileInfo;
  mine: boolean;
  /** Opens the viewer (photos, videos) or downloads (other files). */
  onOpen: (file: FileRef) => void;
};

/** A file in a chat: photo preview (up to 10 MB without a tap), or a card with its name and size. */
export function FileBubble({ file, info, mine, onOpen }: Props) {
  const [url, setUrl] = useState(knownUrl(file.id));
  const [loading, setLoading] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const deleted = info?.status === "deleted";
  const image = file.mime.startsWith("image/");

  useEffect(() => {
    if (!image || deleted || url || file.size > AUTO_PREVIEW) return;
    let gone = false;
    fileUrl(file)
      .then((u) => !gone && setUrl(u))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [image, deleted, url, file]);

  const shape = mine ? "rounded-[16px_16px_4px_16px]" : "rounded-[16px_16px_16px_4px]";
  if (deleted) {
    return (
      <p className={`m-0 flex items-center gap-2.5 border border-dashed border-line-strong px-3.5 py-2.5 text-[13.5px] text-dim ${shape}`}>
        <Icon d="trash" size={16} />
        <span className="break-all">
          {file.name} · {removedText(info?.deletedReason ?? null)}
        </span>
      </p>
    );
  }
  if (image && url) {
    return (
      <button
        type="button"
        onClick={() => onOpen(file)}
        aria-label={`Open ${file.name}`}
        data-view-only={file.view ? "" : undefined}
        className={`relative block border border-line bg-raised p-1 ${shape}`}
      >
        <img src={url} alt={file.name} draggable={false} className="block max-h-[260px] max-w-[240px] rounded-xl object-cover" />
        {/* View only: the pointer lands on this layer, never on the image, so the browser has nothing to "save as" */}
        {file.view ? <span className="absolute inset-0" aria-hidden="true" /> : null}
      </button>
    );
  }
  async function tap() {
    if (image && !url) {
      setLoading(0);
      try {
        setUrl(await fileUrl(file, (d) => setLoading(d)));
      } catch {
        setFailed(true);
      }
      setLoading(null);
      return;
    }
    onOpen(file);
  }
  return (
    <button
      type="button"
      onClick={tap}
      aria-label={`${image ? "Show" : "Open"} ${file.name}`}
      data-view-only={file.view ? "" : undefined}
      className={`flex w-[250px] max-w-full flex-col gap-2 border px-3 py-2.5 text-left ${mine ? "border-brand-stripe bg-brand-deep text-white" : "border-line bg-raised text-ink"} ${shape}`}
    >
      <span className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-[11px] ${mine ? "bg-black/20" : "bg-[#22252F] text-ink-soft"}`}>
          <Icon d={file.mime.startsWith("video/") ? "video" : "doc"} size={20} />
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-sm font-bold">{file.name}</span>
          <span className={`font-mono text-[11px] ${mine ? "text-white/70" : "text-dim"}`}>
            {!mine && file.view ? "view only · " : ""}
            {failed ? "couldn't open it" : loading !== null ? `${bytes(loading)} of ${bytes(file.size)}` : `${/\.([a-z0-9]{1,6})$/i.exec(file.name)?.[1]?.toUpperCase() ?? "FILE"} · ${bytes(file.size)}`}
          </span>
        </span>
        <span className={`grid size-[38px] shrink-0 place-items-center rounded-[10px] border ${mine ? "border-white/30" : "border-line-strong"}`}>
          <Icon d="down" size={17} />
        </span>
      </span>
      {loading !== null ? (
        <span className="h-1 overflow-hidden rounded-full bg-black/30">
          <span className="block h-full bg-accent" style={{ width: `${Math.round((loading / file.size) * 100)}%` }} />
        </span>
      ) : null}
    </button>
  );
}
