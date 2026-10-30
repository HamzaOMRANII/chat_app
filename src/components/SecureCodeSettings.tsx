import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Notice } from "./Screen";
import { TextField } from "./TextField";

type State = { set: boolean; setAt: string | null; allowed: boolean };

/** Settings › Secure code: your own 8–12 digits, typed instead of the emailed code (tap the code screen's title 5 times). */
export function SecureCodeSettings() {
  const [state, setState] = useState<State | null>(null);
  const [mode, setMode] = useState<"view" | "set" | "remove">("view");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<State>("/api/me/secure-code")
      .then(setState)
      .catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const secureCode = String(form.get("secureCode") ?? "");
    if (mode === "set" && secureCode !== String(form.get("confirm") ?? "")) return setError("The two codes don't match.");
    setBusy(true);
    setError("");
    try {
      const next =
        mode === "set"
          ? await api<State>("/api/me/secure-code", { method: "PUT", body: { password, secureCode } })
          : await api<State>("/api/me/secure-code", { method: "DELETE", body: { password } });
      setState(next);
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  return (
    <section aria-labelledby="secure-code-title" className="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-3.5">
      <h2 id="secure-code-title" className="m-0 text-sm font-bold">
        Secure code
      </h2>
      <p className="m-0 text-[12.5px] leading-normal text-dim">
        Sign in without waiting for the email: after your password, tap the title “Check your email” 5 times and type this code. Each use sends
        you an alert email.
      </p>
      {!state.allowed ? (
        <Notice tone="warning">The administrator switched the secure code off for your account.</Notice>
      ) : mode === "view" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="grow font-mono text-xs text-dim">{state.set && state.setAt ? `set on ${new Date(state.setAt).toLocaleDateString()}` : "not set"}</span>
          <Button variant="secondary" onClick={() => setMode("set")}>
            {state.set ? "Change" : "Set a secure code"}
          </Button>
          {state.set ? (
            <Button variant="secondary" onClick={() => setMode("remove")}>
              Remove
            </Button>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <TextField label="Current password" name="password" type="password" required autoComplete="current-password" />
          {mode === "set" ? (
            <>
              <TextField label="New secure code (8 to 12 digits)" name="secureCode" type="password" inputMode="numeric" mono required pattern="\d{8,12}" title="8 to 12 digits" autoComplete="off" />
              <TextField label="Type it again" name="confirm" type="password" inputMode="numeric" mono required pattern="\d{8,12}" title="8 to 12 digits" autoComplete="off" />
            </>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : mode === "set" ? "Save code" : "Remove code"}
            </Button>
            <Button variant="secondary" onClick={() => (setMode("view"), setError(""))}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
