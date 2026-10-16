import { useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { AuthScreen, Card, Notice, TextLink } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import type { Challenge, User } from "../app/types";

type Props = { challenge: Challenge; onSignedIn: (user: User) => void; onBack: () => void; onRestart: (notice: string) => void };

export function PasscodePage({ challenge, onSignedIn, onBack, onRestart }: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const passcode = String(new FormData(e.currentTarget).get("passcode") ?? "");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("/api/auth/verify-passcode", { body: { challengeId: challenge.challengeId, passcode } });
      onSignedIn(res.user);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "challenge_expired" || err.code === "locked")) onRestart(err.message);
      else setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <div className="self-start">
        <TextLink onClick={onBack}>← Back to email code</TextLink>
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.02em]">Recovery passcode</h1>
        <p className="m-0 text-[14.5px] leading-relaxed text-ink-soft">Enter the 8-digit passcode you chose when you signed up.</p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField label="Passcode" name="passcode" type="password" inputMode="numeric" mono required pattern="\d{8}" title="Exactly 8 digits" autoComplete="off" autoFocus className="text-[22px] tracking-[0.4em]" />
          <Notice tone="warning">
            This passcode works <strong>once</strong>. Next you must set a new password and a new passcode before using H_CHAT.
          </Notice>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </Button>
          <p className="m-0 text-center font-mono text-[11.5px] text-dim">5 wrong tries lock the account for 30 minutes</p>
        </form>
      </Card>
      <p className="m-0 mt-auto text-center text-[13px] leading-relaxed text-faint">
        Forgot the passcode too? Ask the administrator for a reset code.
      </p>
    </AuthScreen>
  );
}
