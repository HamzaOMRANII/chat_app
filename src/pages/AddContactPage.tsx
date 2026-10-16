import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { looksLikePersonalId, type Contact } from "../lib/contacts";
import { scanQr } from "../lib/native";
import { isNativeApp } from "../lib/platform";

type Mode = "id" | "invite";
type AddResult = { status: "requested"; username: string; searchesLeft: number } | { status: "contact"; contact: Contact; searchesLeft: number };

type Props = { onBack: () => void; onAdded: (contact: Contact) => void; onAuthError: (err: unknown) => boolean };

export function AddContactPage({ onBack, onAdded, onAuthError }: Props) {
  const [mode, setMode] = useState<Mode>("id");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ searchesLeft: number }>("/api/contacts/me")
      .then((r) => setSearchesLeft(r.searchesLeft))
      .catch(onAuthError);
  }, [onAuthError]);

  async function add(text: string, as: Mode) {
    setBusy(true);
    setError("");
    setSentTo("");
    try {
      const res = await api<AddResult>("/api/contacts/add", { body: as === "id" ? { personalId: text } : { inviteCode: text } });
      setSearchesLeft(res.searchesLeft);
      if (res.status === "contact") return onAdded(res.contact);
      setSentTo(res.username);
      setValue("");
    } catch (err) {
      if (onAuthError(err)) return;
      if (err instanceof ApiError && typeof err.details?.searchesLeft === "number") setSearchesLeft(err.details.searchesLeft);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) void add(value.trim(), mode);
  }

  async function scan() {
    setError("");
    let text: string | null;
    try {
      text = await scanQr();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The QR scanner isn't available on this phone. Type the ID instead.");
      return;
    }
    if (!text) return;
    if (!looksLikePersonalId(text)) {
      setError("This QR code isn't an H_CHAT ID.");
      return;
    }
    setMode("id");
    setValue(text.trim().toUpperCase());
    await add(text.trim(), "id");
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setError("");
        setValue("");
      }}
      className={`min-h-[42px] rounded-[10px] text-sm ${mode === m ? "bg-raised font-bold text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "bg-transparent font-semibold text-dim"}`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="Add contact" onBack={onBack} />
      <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-5">
        <div role="tablist" aria-label="Add with" className="grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-panel p-1">
          {tab("id", "Personal ID")}
          {tab("invite", "Invite code")}
        </div>

        <label className="flex flex-col gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-dim">
          {mode === "id" ? "Their ID" : "Their invite code"}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === "id" ? "HC-XXXX-XXXX" : "XXXX-XXXX"}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            required
            aria-invalid={Boolean(error)}
            className={`min-h-[54px] rounded-[14px] border bg-panel px-4 font-mono text-xl normal-case tracking-[0.1em] text-ink outline-none placeholder:text-faint focus:border-accent ${error ? "border-dashed border-danger" : "border-line-strong"}`}
          />
        </label>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {sentTo ? (
          <Notice tone="ok">
            Request sent to <strong>{sentTo}</strong>. They'll appear in your contacts once they accept.
          </Notice>
        ) : null}

        <button type="submit" disabled={busy || searchesLeft === 0} className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover disabled:opacity-50">
          {mode === "id" ? "Send request" : "Add contact"}
        </button>

        {isNativeApp ? (
          <>
            <div className="flex items-center gap-3 font-mono text-[11px] text-faint" aria-hidden="true">
              <span className="h-px grow bg-line" />
              or
              <span className="h-px grow bg-line" />
            </div>
            <button
              type="button"
              onClick={scan}
              disabled={busy || searchesLeft === 0}
              className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-[14px] border border-line-strong bg-panel text-[15px] font-semibold text-ink disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10" />
              </svg>
              Scan their QR code
            </button>
          </>
        ) : null}

        <p className="m-0 text-[12.5px] leading-normal text-faint">
          {searchesLeft === null ? "" : `${searchesLeft} of 10 searches left this hour. `}
          For your safety, the app never says why a search failed.
          {mode === "invite" ? " An invite code connects you at once, no request." : ""}
        </p>
      </form>
    </main>
  );
}
