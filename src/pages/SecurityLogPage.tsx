import { useEffect, useState } from "react";
import { Notice } from "../components/Screen";
import { api } from "../lib/api";
import { place, when } from "../app/types";

type Event = { _id: string; type: string; deviceName?: string; city?: string; country?: string; ip?: string; at: string };
type Current = { name?: string; platform?: string; osVersion?: string; appVersion?: string; os?: string };

const LABELS: Record<string, [string, "ok" | "warn" | "bad"]> = {
  signup: ["Requested access", "ok"],
  login: ["Signed in", "ok"],
  logout: ["Signed out", "ok"],
  kicked: ["Session closed by a new sign-in", "warn"],
  failed_password: ["Wrong password", "bad"],
  failed_code: ["Wrong email code", "bad"],
  failed_passcode: ["Wrong recovery passcode", "bad"],
  passcode_used: ["Recovery passcode used", "warn"],
  admin_reset_used: ["Administrator reset code used", "warn"],
  credentials_reset: ["New password and passcode set", "ok"],
  email_changed: ["Email changed", "warn"],
  locked: ["Sign-in locked for 30 minutes", "bad"],
};
const DOT = { ok: "bg-online", warn: "bg-keep", bad: "bg-danger" };

export function SecurityLogPage({ onBack, onAuthError }: { onBack: () => void; onAuthError: (err: unknown) => boolean }) {
  const [data, setData] = useState<{ events: Event[]; current?: Current } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ events: Event[]; current?: Current }>("/api/me/security-log")
      .then(setData)
      .catch((err) => {
        if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't load the log");
      });
  }, [onAuthError]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 pb-3 pt-4">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-11 place-items-center rounded-field bg-transparent text-ink">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="m-0 text-lg font-extrabold">My security log</h1>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {data?.current ? (
          <section className="flex flex-col gap-2 rounded-2xl border border-line-strong bg-raised px-4 py-3.5">
            <p className="eyebrow m-0">this device</p>
            <p className="m-0 flex items-center gap-2.5 text-[15.5px] font-bold">
              <span className="size-2 rounded-full bg-online" aria-hidden="true" />
              {data.current.name}
            </p>
            <p className="m-0 font-mono text-xs text-ink-soft">
              {[data.current.platform === "android" ? `Android ${data.current.osVersion ?? ""}`.trim() : data.current.os, data.current.appVersion && `app ${data.current.appVersion}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </section>
        ) : null}

        <p className="eyebrow m-0">last 90 days</p>
        <ul className="m-0 flex list-none flex-col rounded-2xl border border-line bg-panel p-0">
          {data === null && !error ? <li className="px-3.5 py-3 text-sm text-dim">Loading…</li> : null}
          {data?.events.map((e, i) => {
            const [label, tone] = LABELS[e.type] ?? [e.type, "ok"];
            return (
              <li key={e._id} className={`flex gap-3 px-3.5 py-3 ${i ? "border-t border-line" : ""}`}>
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
                <span className="flex grow flex-col gap-0.5">
                  <span className="text-sm font-bold">{label}</span>
                  <span className="text-[12.5px] text-dim">
                    {e.deviceName ?? "unknown device"} · {place(e.city, e.country)}
                    {e.ip ? ` · ${e.ip}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-faint">{when(e.at)}</span>
              </li>
            );
          })}
        </ul>
        <p className="m-0 text-[12.5px] leading-relaxed text-faint">
          IP address, device and approximate location are kept 90 days to protect your account. The administrator can see this
          log, never your messages.
        </p>
      </div>
    </main>
  );
}
