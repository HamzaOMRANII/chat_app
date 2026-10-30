import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { CodeInput } from "../components/CodeInput";
import { TextField } from "../components/TextField";
import { AuthScreen, Card, Notice, TextLink } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import type { Challenge, LastLogin, User } from "../app/types";

type Props = {
  challenge: Challenge;
  onSignedIn: (user: User, lastLogin: LastLogin) => void;
  onUsePasscode: () => void;
  onRestart: (notice: string) => void;
};

export function CodePage({ challenge, onSignedIn, onUsePasscode, onRestart }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(5 * 60);
  // Hidden: 5 taps on the title within 3 s reveal the secure-code field (set in Settings)
  const [showSecure, setShowSecure] = useState(false);
  const [secureError, setSecureError] = useState("");
  const taps = useRef<number[]>([]);
  function onTitleTap() {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) setShowSecure(true);
  }

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => Math.max(s - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User; lastLogin: LastLogin }>("/api/auth/verify-code", { body: { challengeId: challenge.challengeId, code } });
      onSignedIn(res.user, res.lastLogin);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "challenge_expired" || err.details?.attemptsLeft === 0)) onRestart(err.message);
      else setError(err instanceof Error ? err.message : "Something went wrong");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function onSecureSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const secureCode = String(new FormData(form).get("secureCode") ?? "");
    setBusy(true);
    setSecureError("");
    try {
      const res = await api<{ user: User; lastLogin: LastLogin }>("/api/auth/verify-secure-code", { body: { challengeId: challenge.challengeId, secureCode } });
      onSignedIn(res.user, res.lastLogin);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "challenge_expired" || err.code === "locked" || err.details?.attemptsLeft === 0)) onRestart(err.message);
      else setSecureError(err instanceof Error ? err.message : "Something went wrong");
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  const expired = seconds === 0;
  return (
    <AuthScreen>
      <p className="eyebrow m-0">step 2 of 2</p>
      <div className="flex flex-col gap-2">
        <h1 onClick={onTitleTap} className="m-0 select-none text-[26px] font-extrabold tracking-[-0.02em]">
          Check your email
        </h1>
        <p className="m-0 text-[14.5px] leading-relaxed text-ink-soft">
          We sent a 6-digit code to <span className="font-mono text-ink">{challenge.emailHint}</span>. It works for 5 minutes.
        </p>
      </div>
      {showSecure ? (
        <Card>
          <form onSubmit={onSecureSubmit} className="flex flex-col gap-4">
            <TextField
              label="Secure code"
              name="secureCode"
              type="password"
              inputMode="numeric"
              mono
              required
              pattern="\d{8,12}"
              title="8 to 12 digits"
              autoComplete="off"
              autoFocus
              className="text-[22px] tracking-[0.3em]"
            />
            {secureError ? <Notice tone="error">{secureError}</Notice> : null}
            <Button type="submit" block disabled={busy}>
              {busy ? "Checking…" : "Sign in with secure code"}
            </Button>
          </form>
        </Card>
      ) : null}
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 p-0 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">Login code</legend>
            <CodeInput value={code} onChange={setCode} />
          </fieldset>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block disabled={busy || code.length !== 6 || expired}>
            {busy ? "Checking…" : "Verify and sign in"}
          </Button>
          <div className="flex items-center justify-between font-mono text-xs text-dim">
            <span>{expired ? "code expired" : `expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
            <TextLink onClick={() => onRestart("Sign in again to get a new code.")}>New code</TextLink>
          </div>
        </form>
      </Card>
      <section className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-line-strong px-[18px] py-4">
        <h2 className="m-0 text-sm font-bold">Lost access to your email?</h2>
        <p className="m-0 text-[13px] leading-snug text-dim">
          Use the recovery passcode you memorised. It works once, then you choose a new password and passcode.
        </p>
        <Button variant="secondary" onClick={onUsePasscode} className="self-start">
          Use recovery passcode
        </Button>
      </section>
    </AuthScreen>
  );
}
