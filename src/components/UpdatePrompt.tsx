import { useEffect, useState } from "react";
import { isNativeApp, serverUrl } from "../lib/platform";
import { api } from "../lib/api";
import { fetchLatestRelease, formatSize, type LatestRelease } from "../lib/releases";

declare const __APP_VERSION__: string;

/** 0.8.10 > 0.8.9 */
export function newer(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

const LATER = "hc.update.later";

/** Android app: when a newer APK is published, "Update available · Install" (checked at start and on return). */
export function UpdatePrompt() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  // Below the administrator's minimum: the app can't be used until it's updated
  const [required, setRequired] = useState<{ min: string; latest: LatestRelease | null } | null>(null);
  useEffect(() => {
    if (!isNativeApp) return;
    const check = () => {
      void Promise.all([api<{ minAppVersion: string }>("/api/app/config").catch(() => null), fetchLatestRelease()]).then(([config, latest]) => {
        setRequired(config && newer(config.minAppVersion, __APP_VERSION__) ? { min: config.minAppVersion, latest } : null);
      });
      void fetchLatestRelease().then((r) => {
        if (!r || !newer(r.version, __APP_VERSION__)) return setRelease(null);
        let later: string | null = null;
        try {
          later = sessionStorage.getItem(LATER);
        } catch {
          /* storage unavailable */
        }
        setRelease(later === r.version ? null : r);
      });
    };
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  if (required) {
    return (
      <div role="alertdialog" aria-label="Update required" className="fixed inset-0 z-[70] grid place-items-center bg-bg px-6">
        <section className="flex w-full max-w-[400px] flex-col items-center gap-4 text-center">
          <span className="grid size-16 place-items-center rounded-[20px] bg-brand/20 text-accent-soft" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
          </span>
          <h1 className="m-0 text-2xl font-extrabold">Update required</h1>
          <p className="m-0 text-sm leading-relaxed text-dim">
            This version of H_CHAT ({__APP_VERSION__}) is no longer supported. Install version {required.latest?.version ?? required.min} or newer to keep using
            it. Your chats stay.
          </p>
          {required.latest ? (
            <a
              href={serverUrl(`/download/${required.latest.file}`)}
              target="_blank"
              rel="noreferrer"
              className="grid min-h-12 w-full place-items-center rounded-[14px] bg-brand text-[15px] font-bold text-white no-underline"
            >
              Install {required.latest.version} ({formatSize(required.latest.size)})
            </a>
          ) : null}
        </section>
      </div>
    );
  }
  if (!release) return null;
  const later = () => {
    try {
      sessionStorage.setItem(LATER, release.version);
    } catch {
      /* storage unavailable */
    }
    setRelease(null);
  };
  return (
    <div role="alertdialog" aria-label="Update available" className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-[560px] px-3 pb-4">
      <section className="flex flex-col gap-2.5 rounded-2xl border border-line-strong bg-panel p-4 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[15px] font-extrabold">Update available</h2>
          <span className="font-mono text-[11px] text-dim">
            {__APP_VERSION__} → <span className="text-online">{release.version}</span>
          </span>
        </div>
        <p className="m-0 text-[13px] leading-normal text-ink-soft">
          A new version of H_CHAT is ready ({formatSize(release.size)}). Install it to get the latest fixes.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={later}
            className="min-h-11 flex-1 rounded-xl border border-line-strong bg-transparent text-[13.5px] font-semibold text-ink"
          >
            Later
          </button>
          <a
            href={serverUrl(`/download/${release.file}`)}
            target="_blank"
            rel="noreferrer"
            className="grid min-h-11 flex-1 place-items-center rounded-xl bg-brand text-[13.5px] font-bold text-white no-underline"
          >
            Install
          </a>
        </div>
        <p className="m-0 text-[11.5px] leading-normal text-faint">
          The download opens in your browser; then tap the file to install. Your chats and settings stay.
        </p>
      </section>
    </div>
  );
}
