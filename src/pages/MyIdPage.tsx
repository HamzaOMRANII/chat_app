import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QrCode } from "../components/QrCode";
import { Notice } from "../components/Screen";
import { api } from "../lib/api";
import { timeLeft, type MyId } from "../lib/contacts";
import { canShare, copyText, shareText } from "../lib/native";

const secondary = "min-h-11 flex-1 rounded-field border border-line-strong bg-raised text-sm font-semibold text-ink disabled:opacity-50";

export function MyIdPage({ onBack, onAuthError }: { onBack: () => void; onAuthError: (err: unknown) => boolean }) {
  const [me, setMe] = useState<MyId | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmNewId, setConfirmNewId] = useState(false);
  const [now, setNow] = useState(Date.now());

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError("");
      setStatus("");
      try {
        await fn();
      } catch (err) {
        if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [onAuthError],
  );
  const load = useCallback(() => run(async () => setMe(await api<MyId>("/api/contacts/me"))), [run]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const invite = me?.invite && new Date(me.invite.expiresAt).getTime() > now ? me.invite : null;

  async function copy(text: string, what: string) {
    await run(async () => {
      await copyText(text);
      setStatus(`${what} copied.`);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="My ID" onBack={onBack} />
      <div className="flex flex-col gap-3.5 px-4 py-[18px]">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {status ? <p role="status" className="sr-only">{status}</p> : null}

        <section className="flex flex-col items-center gap-3.5 rounded-[20px] border border-line-strong bg-panel px-4 pb-4 pt-5">
          {me ? <QrCode text={me.personalId} label="QR code of your ID" /> : <span className="size-[192px] rounded-[14px] bg-raised" aria-hidden="true" />}
          <div className="flex flex-col items-center gap-1">
            <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">personal ID</p>
            <p className="m-0 font-mono text-[26px] font-bold tracking-[0.08em]">{me?.personalId ?? "…"}</p>
          </div>
          <div className="flex w-full gap-2">
            <button type="button" disabled={!me} onClick={() => copy(me!.personalId, "ID")} className={secondary}>
              {status === "ID copied." ? "Copied" : "Copy"}
            </button>
            {canShare ? (
              <button type="button" disabled={!me} onClick={() => shareText("My H_CHAT ID", `Add me on H_CHAT: ${me!.personalId}`)} className={secondary}>
                Share
              </button>
            ) : null}
          </div>
          <p className="m-0 text-center text-[12.5px] leading-normal text-dim">People with your ID can send you a request. You decide who to accept.</p>
        </section>

        <section className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-2.5">
            <h2 className="eyebrow m-0 text-[11px] font-normal">one-time invite</h2>
            {invite ? <span className="font-mono text-[11px] text-keep">{timeLeft(invite.expiresAt, now)}</span> : null}
          </div>
          {invite ? (
            <div className="flex items-center gap-2.5">
              <p className="m-0 grow font-mono text-[22px] font-bold tracking-[0.12em]">{invite.code}</p>
              <button
                type="button"
                onClick={() => copy(invite.code, "Invite code")}
                aria-label="Copy invite code"
                className="grid size-11 place-items-center rounded-field border border-line-strong bg-raised text-ink"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a1 1 0 0 1 1-1h10" />
                </svg>
              </button>
            </div>
          ) : null}
          {status === "Invite code copied." ? <p className="m-0 text-xs text-online">Copied.</p> : null}
          <p className="m-0 text-[12.5px] leading-normal text-dim">
            Whoever enters this code becomes your contact right away, no request. Works once, for 24 hours.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run(async () => setMe({ ...me!, invite: await api<{ code: string; expiresAt: string }>("/api/contacts/invite", { method: "POST" }) }))}
              disabled={!me}
              className="min-h-11 flex-1 rounded-field bg-brand text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {invite ? "New invite" : "Create invite code"}
            </button>
            {invite ? (
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    await api("/api/contacts/invite", { method: "DELETE" });
                    setMe({ ...me!, invite: null });
                  })
                }
                className="min-h-11 flex-1 rounded-field border border-dashed border-danger bg-transparent font-mono text-xs font-bold uppercase text-danger-ink before:content-['[_'] after:content-['_]'] hover:bg-danger/10"
              >
                Cancel it
              </button>
            ) : null}
          </div>
        </section>

        {confirmNewId ? (
          <Notice tone="warning">
            <span className="flex flex-col gap-3">
              <span>Your current ID stops working at once. People who saved it can't find you with it any more. Your contacts stay.</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const { personalId } = await api<{ personalId: string }>("/api/contacts/me/new-id", { method: "POST" });
                      setMe({ ...me!, personalId });
                      setConfirmNewId(false);
                    })
                  }
                  className="min-h-10 rounded-field bg-brand px-3.5 text-[13.5px] font-bold text-white"
                >
                  Change my ID
                </button>
                <button type="button" onClick={() => setConfirmNewId(false)} className="min-h-10 rounded-field border border-line-strong bg-transparent px-3.5 text-[13.5px] font-semibold text-ink">
                  Keep it
                </button>
              </span>
            </span>
          </Notice>
        ) : (
          <div className="flex flex-col items-center">
            <button type="button" onClick={() => setConfirmNewId(true)} className="min-h-11 bg-transparent px-3 text-[13.5px] font-semibold text-link">
              Change my ID
            </button>
            <p className="m-0 text-center text-xs leading-normal text-faint">The old ID stops working at once. Your contacts stay.</p>
          </div>
        )}
      </div>
    </main>
  );
}
