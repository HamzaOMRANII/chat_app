import { useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { AuthScreen, Notice, TextLink } from "../components/Screen";
import { api } from "../lib/api";
import { deviceInfo } from "../lib/device";

export function SignUpPage({ onDone, onBack }: { onDone: (username: string) => void; onBack: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("passcode") !== form.get("passcode2")) {
      setError("The two passcodes don't match.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await api<{ username: string }>("/api/auth/signup", {
        body: {
          username: String(form.get("username") ?? "").trim().toLowerCase(),
          email: String(form.get("email") ?? "").trim(),
          password: form.get("password"),
          passcode: form.get("passcode"),
          privacyAccepted: form.get("privacy") === "on",
          device: await deviceInfo(),
        },
      });
      onDone(res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen compactBrand>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.02em]">Request access</h1>
        <p className="m-0 text-[13.5px] leading-snug text-dim">An administrator approves every account before it can be used.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <TextField label="Username" name="username" autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]{3,32}" title="3 to 32 letters, digits, dots, dashes or underscores" />
        <TextField label="Email (for login codes)" name="email" type="email" autoComplete="email" required />
        <div className="flex flex-col gap-1.5">
          <TextField label="Password" name="password" type="password" autoComplete="new-password" required minLength={12} />
          <span className="text-xs text-faint">At least 12 characters. A passphrase works best.</span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-control border border-brand bg-brand/12 px-3.5 py-3">
          <TextField label="Recovery passcode · 8 digits" name="passcode" type="password" inputMode="numeric" mono required pattern="\d{8}" title="Exactly 8 digits" autoComplete="off" />
          <TextField label="Repeat the passcode" name="passcode2" type="password" inputMode="numeric" mono required pattern="\d{8}" title="Exactly 8 digits" autoComplete="off" />
          <p className="m-0 text-[12.5px] leading-snug text-ink-soft">
            Learn it by heart. It's your only way in if you lose access to your email, and it is never shown again.
          </p>
        </div>
        <label className="flex items-start gap-2.5 text-[12.5px] leading-snug text-ink-soft">
          <input type="checkbox" name="privacy" required className="mt-0.5 size-5 shrink-0 accent-brand" />
          <span>
            For your account's safety, H_CHAT records the device, IP address and approximate location of each sign-in, and the
            administrator can see who you chat with and when, never what you write.
          </span>
        </label>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block disabled={busy}>
          {busy ? "Sending…" : "Request access"}
        </Button>
      </form>
      <p className="m-0 mt-auto text-center text-[13px] text-dim">
        Already approved? <TextLink onClick={onBack}>Sign in</TextLink>
      </p>
    </AuthScreen>
  );
}
