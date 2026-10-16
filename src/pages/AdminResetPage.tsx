import { useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { AuthScreen, Card, Notice, TextLink } from "../components/Screen";
import { api } from "../lib/api";
import { deviceInfo } from "../lib/device";
import type { User } from "../app/types";

/** For someone who lost both their email and their passcode: a one-time code from the administrator. */
export function AdminResetPage({ onSignedIn, onBack }: { onSignedIn: (user: User) => void; onBack: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("/api/auth/admin-reset", {
        body: { username: String(form.get("username") ?? "").trim().toLowerCase(), code: String(form.get("code") ?? "").replace(/\s/g, ""), device: await deviceInfo() },
      });
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen compactBrand>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.02em]">Reset code</h1>
        <p className="m-0 text-[14px] leading-relaxed text-ink-soft">
          Lost both your email and your passcode? The administrator can give you a 10-digit code. It works once, for 24 hours.
        </p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField label="Username" name="username" autoComplete="username" autoCapitalize="none" required />
          <TextField label="Reset code" name="code" inputMode="numeric" mono required pattern="[\d ]{10,13}" title="10 digits" autoComplete="off" />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>
      </Card>
      <div className="mt-auto text-center">
        <TextLink onClick={onBack}>Back to sign in</TextLink>
      </div>
    </AuthScreen>
  );
}
