import { useEffect, useState, type FormEvent } from "react";
import { Logo, Wordmark } from "../components/Logo";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { Notice, TextLink } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { deviceInfo } from "../lib/device";
import { fetchLatestRelease, formatSize, type LatestRelease } from "../lib/releases";
import { isNativeApp, serverUrl } from "../lib/platform";
import type { Challenge } from "../app/types";

type Props = {
  notice?: string;
  onChallenge: (challenge: Challenge) => void;
  onPending: (username: string) => void;
  onSignUp: () => void;
  onAdminReset: () => void;
};

export function LoginPage({ notice, onChallenge, onPending, onSignUp, onAdminReset }: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    setError("");
    setBusy(true);
    try {
      const res = await api<{ challengeId: string; emailHint: string }>("/api/auth/login", {
        body: { username, password: form.get("password"), device: await deviceInfo() },
      });
      onChallenge({ ...res, username });
    } catch (err) {
      if (err instanceof ApiError && err.code === "pending") onPending(username);
      else setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-grid mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-7 px-6 pb-7 pt-14">
      <header className="flex flex-col items-center gap-3.5">
        <Logo size={84} />
        <h1 className="m-0 text-[26px]">
          <Wordmark />
        </h1>
        <p className="eyebrow m-0">private · end-to-end encrypted</p>
      </header>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-card border border-line bg-panel px-5 py-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      >
        <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">Sign in</h2>
        {notice ? <Notice>{notice}</Notice> : null}
        <TextField label="Username or email" name="username" autoComplete="username" autoCapitalize="none" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
        <p className="m-0 text-center text-[13px] text-dim">Next step: a 6-digit code sent to your email</p>
      </form>

      {!isNativeApp && <AndroidDownload />}

      <div className="mt-auto flex flex-col items-center gap-1 text-center text-[13px] text-dim">
        <p className="m-0">
          No account? <TextLink onClick={onSignUp}>Request access</TextLink>
        </p>
        <TextLink onClick={onAdminReset}>I have a reset code from the administrator</TextLink>
      </div>
    </main>
  );
}

function AndroidDownload() {
  const [release, setRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLatestRelease(ctrl.signal).then(setRelease);
    return () => ctrl.abort();
  }, []);

  if (!release) return null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong px-[18px] py-4">
      <div className="flex items-center gap-3">
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
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 className="m-0 text-[14.5px] font-bold">Android app</h2>
          <p className="m-0 font-mono text-[11px] text-dim">
            h_chat.apk · v{release.version} · {formatSize(release.size)}
          </p>
        </div>
        <a
          // Versioned file name: a new release always gets a new URL, so no cache can serve an old APK
          href={serverUrl(`/download/${release.file}`)}
          download
          className="inline-flex min-h-11 items-center rounded-field border border-line-strong bg-raised px-3.5 text-[13.5px] font-bold text-ink no-underline"
        >
          Download
        </a>
      </div>
      <details className="text-[13px] text-ink-soft">
        <summary className="cursor-pointer text-link">How to install without the Play Store</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 leading-relaxed">
          <li>Open this page on your Android phone and tap Download.</li>
          <li>
            Open the downloaded file. If Android asks, allow <strong>Install unknown apps</strong> for your browser
            (Settings → Apps → your browser → Install unknown apps).
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
