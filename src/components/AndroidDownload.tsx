import { useEffect, useState } from "react";
import { serverUrl } from "../lib/platform";
import { fetchLatestRelease, formatSize, type LatestRelease } from "../lib/releases";

/** Latest APK with install steps; shown in the web app only (sign-in page and Settings). */
export function AndroidDownload() {
  const [release, setRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLatestRelease(ctrl.signal).then(setRelease);
    return () => ctrl.abort();
  }, []);

  if (!release) return null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-3">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-accent"
          aria-hidden="true"
        >
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M12 7v7M9 11l3 3 3-3M10 18h4" />
        </svg>
        <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[14.5px] font-bold">Android app</h2>
          <p className="m-0 font-mono text-[11px] text-dim">
            h_chat.apk · v{release.version} · {formatSize(release.size)}
          </p>
        </div>
        <a
          // Versioned file name: a new release always gets a new URL, so no cache can serve an old APK
          href={serverUrl(`/download/${release.file}`)}
          download
          className="ml-auto inline-flex min-h-11 items-center rounded-field border border-line-strong bg-raised px-3.5 text-[13.5px] font-bold text-ink no-underline"
        >
          Download
        </a>
      </div>
      <details className="text-[13px] text-ink-soft">
        <summary className="cursor-pointer text-link">How to install without the Play Store</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 leading-relaxed">
          <li>Open chat.omranisystems.com on your Android phone and tap Download.</li>
          <li>
            Open the downloaded file. If Android asks, allow <strong>Install unknown apps</strong> for your browser (Settings → Apps → your browser → Install
            unknown apps).
          </li>
          <li>
            If Play Protect warns about an unknown app, tap <strong>More details → Install anyway</strong>.
          </li>
          <li>Open H_CHAT and sign in. You can switch “Install unknown apps” off again afterwards.</li>
        </ol>
        <p className="mt-3 break-all font-mono text-[11px] text-faint">SHA-256 {release.sha256}</p>
      </details>
    </section>
  );
}
