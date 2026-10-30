import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { bytes, type MediaSummary } from "../lib/files";

/** Settings › My media: the space my files take, and the way to all of them. */
export function MyMedia({ onOpen }: { onOpen: () => void }) {
  const [media, setMedia] = useState<MediaSummary | null>(null);
  useEffect(() => {
    api<MediaSummary>("/api/media")
      .then(setMedia)
      .catch(() => {});
  }, []);
  if (!media) return null;
  const ratio = media.used / media.limit;
  return (
    <section aria-labelledby="my-media" className="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-3.5">
      <div className="flex justify-between text-sm font-bold">
        <h2 id="my-media" className="m-0 text-sm font-bold">
          My media
        </h2>
        <span className="font-mono text-xs text-ink-soft">
          {bytes(media.used)} of {bytes(media.limit)}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-line">
        <div className={`h-full ${ratio > 0.8 ? "bg-keep" : "bg-accent"}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <p className="m-0 text-[12.5px] leading-normal text-dim">
        All your chats' media in one place: download all, delete all, or pick files one by one. Each file is deleted automatically when its chat's time limit is
        reached.
      </p>
      <button type="button" onClick={onOpen} className="self-start bg-transparent p-0 text-[13.5px] font-bold text-link">
        Open my media →
      </button>
    </section>
  );
}
