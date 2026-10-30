import { useEffect, useRef } from "react";
import { Avatar } from "./PageHeader";

export type Banner = {
  id: number;
  tag: string;
  title: string;
  body: string /** Who it's about: shows their initials; none = a plain notice. */;
  who?: string;
  onOpen?: () => void;
};

const SHOWN_MS = 6000;

/** In-app notifications at the top of every screen: tap to open, × or wait to dismiss. */
export function Banners({ banners, onDismiss }: { banners: Banner[]; onDismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex w-full max-w-[560px] flex-col gap-2 px-3 pt-3">
      {banners.map((b) => (
        <BannerCard key={b.id} banner={b} onDismiss={() => onDismiss(b.id)} />
      ))}
    </div>
  );
}

function BannerCard({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  // A replaced banner (same tag) gets a new id, so a new timer
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const t = setTimeout(() => dismiss.current(), SHOWN_MS);
    return () => clearTimeout(t);
  }, [banner.id]);

  const content = (
    <>
      {banner.who ? <Avatar username={banner.who} size={36} /> : null}
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-[14px] font-bold text-ink">{banner.title}</span>
        <span className="text-[13px] leading-snug text-ink-soft">{banner.body}</span>
      </span>
    </>
  );
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-line-strong bg-raised py-1 pl-1 pr-1 shadow-[0_14px_36px_rgba(0,0,0,0.45)]"
    >
      {banner.onOpen ? (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            banner.onOpen!();
          }}
          className="flex min-h-12 min-w-0 grow items-center gap-3 rounded-xl bg-transparent px-2.5 py-1.5 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-h-12 min-w-0 grow items-center gap-3 px-2.5 py-1.5">{content}</div>
      )}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid size-10 shrink-0 place-items-center rounded-xl bg-transparent text-dim">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
