import { useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { CodeInput } from "../components/CodeInput";
import { TextField } from "../components/TextField";
import { AuthScreen, Card, Notice, TextLink } from "../components/Screen";
import { api } from "../lib/api";
import type { User } from "../app/types";

type EmailStep = { challengeId: string; emailHint: string };

/** Required after a passcode or admin-code sign-in: new password + passcode, then optionally a new email. */
export function ResetPage({ user, onDone, onSignOut }: { user: User; onDone: (user: User) => void; onSignOut: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<User | null>(null);
  const [emailStep, setEmailStep] = useState<EmailStep | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("passcode") !== form.get("passcode2")) {
      setError("The two passcodes don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("/api/auth/reset-credentials", { body: { password: form.get("password"), passcode: form.get("passcode") } });
      const email = String(form.get("email") ?? "").trim();
      if (email && email.toLowerCase() !== user.email) {
        setUpdated(res.user);
        setEmailStep(await api<EmailStep>("/api/me/email", { body: { email } }));
      } else {
        onDone(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmail(e: FormEvent) {
    e.preventDefault();
    if (!emailStep) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("/api/me/email/verify", { body: { challengeId: emailStep.challengeId, code } });
      onDone(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (emailStep && updated) {
    return (
      <AuthScreen>
        <p className="eyebrow m-0">confirm new email</p>
        <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.02em]">Check your new inbox</h1>
        <p className="m-0 text-[14px] leading-relaxed text-ink-soft">
          Your password and passcode are saved. Enter the code sent to <span className="font-mono text-ink">{emailStep.emailHint}</span> to switch your email.
        </p>
        <Card>
          <form onSubmit={confirmEmail} className="flex flex-col gap-4">
            <CodeInput value={code} onChange={setCode} />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button type="submit" block disabled={busy || code.length !== 6}>
              Confirm email
            </Button>
          </form>
        </Card>
        <div className="text-center">
          <TextLink onClick={() => onDone(updated)}>Keep my current email</TextLink>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <p className="eyebrow m-0 text-accent-soft">required before continuing</p>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.02em]">Secure your account</h1>
        <p className="m-0 text-[14px] leading-relaxed text-ink-soft">
          You signed in without your email code. Choose a new password and a new passcode. You can also change your email.
        </p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
          <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={12} />
          <TextField label="New recovery passcode · 8 digits" name="passcode" type="password" inputMode="numeric" mono required pattern="\d{8}" title="Exactly 8 digits" autoComplete="off" />
          <TextField label="Repeat the passcode" name="passcode2" type="password" inputMode="numeric" mono required pattern="\d{8}" title="Exactly 8 digits" autoComplete="off" />
          <div className="flex flex-col gap-1.5">
            <TextField label="Email (optional change)" name="email" type="email" defaultValue={user.email} autoComplete="email" />
            <span className="text-xs text-faint">A new email is confirmed with a code before it's used.</span>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </Card>
      <p className="m-0 text-[12.5px] leading-relaxed text-faint">Saving signs out every other session.</p>
      <div className="mt-auto text-center">
        <TextLink onClick={onSignOut}>Sign out</TextLink>
      </div>
    </AuthScreen>
  );
}
