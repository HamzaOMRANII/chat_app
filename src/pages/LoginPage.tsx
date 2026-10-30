import { useState, type FormEvent } from "react";
import { Logo, Wordmark } from "../components/Logo";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { Notice, TextLink } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { deviceInfo } from "../lib/device";
import { AndroidDownload } from "../components/AndroidDownload";
import { isNativeApp, } from "../lib/platform";
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
