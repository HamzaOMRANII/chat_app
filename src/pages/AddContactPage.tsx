import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { QrScanner } from "../components/QrScanner";
import { personalIdFromScan, type Contact } from "../lib/contacts";
import { canScanQr, scanQr } from "../lib/native";
import { readQrFromImage } from "../lib/qrImage";
import { isNativeApp } from "../lib/platform";

type Mode = "id" | "invite";
type AddResult = { status: "requested"; username: string; searchesLeft: number } | { status: "contact"; contact: Contact; searchesLeft: number };

type Props = {
  /** Filled in from a scanned link (#add=…); the person still presses Send. */
  initialId?: string;
  onBack: () => void;
  onAdded: (contact: Contact) => void;
  onAuthError: (err: unknown) => boolean;
};

export function AddContactPage({ initialId, onBack, onAdded, onAuthError }: Props) {
  const [mode, setMode] = useState<Mode>("id");
  const [value, setValue] = useState(initialId ?? "");
  const [webScanner, setWebScanner] = useState(false);
  const [reading, setReading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
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

  const applyScan = useCallback((text: string) => {
    setWebScanner(false);
    const id = personalIdFromScan(text);
    if (!id) {
      setError("This QR code isn't an H_CHAT ID.");
      return;
    }
    setMode("id");
    setValue(id);
    setError("");
    setSentTo("");
  }, []);

  // A QR code saved as a picture (sent by the person, a screenshot of their My ID…)
  function pickImage() {
    setWebScanner(false);
    setError("");
    imageInput.current?.click();
  }
  async function onImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same picture can be picked again
    if (!file) return;
    setReading(true);
    const text = await readQrFromImage(file);
    setReading(false);
    if (text) applyScan(text);
    else setError("No QR code found in this picture. Try a sharper or closer image, or type the ID.");
  }

  // The scanned ID lands in the field; the person checks it and presses Send request.
  async function scan() {
    setError("");
    if (!isNativeApp) return setWebScanner(true);
    try {
      const text = await scanQr();
      if (text) applyScan(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The QR scanner isn't available on this phone. Type the ID instead.");
    }
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

        <div className="flex flex-col gap-2">
          <label htmlFor="contact-code" className="font-mono text-[11px] uppercase tracking-[0.12em] text-dim">
            {mode === "id" ? "Their ID" : "Their invite code"}
          </label>
          <div className="flex gap-2">
            <input
              id="contact-code"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === "id" ? "HC-XXXX-XXXX" : "XXXX-XXXX"}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
              required
              aria-invalid={Boolean(error)}
              className={`min-h-[54px] min-w-0 grow rounded-[14px] border bg-panel px-4 font-mono text-xl tracking-[0.1em] text-ink outline-none placeholder:text-faint focus:border-accent ${error ? "border-dashed border-danger" : "border-line-strong"}`}
            />
            {mode === "id" && canScanQr ? (
              <button
                type="button"
                onClick={scan}
                aria-label="Scan QR code"
                title="Scan QR code"
                className="grid size-[54px] shrink-0 place-items-center rounded-[14px] border border-line-strong bg-raised text-ink hover:border-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {sentTo ? (
          <Notice tone="ok">
            Request sent to <strong>{sentTo}</strong>. They'll appear in your contacts once they accept.
          </Notice>
        ) : null}

        <button
          type="submit"
          disabled={busy || searchesLeft === 0}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {mode === "id" ? "Send request" : "Add contact"}
        </button>

        {mode === "id" ? (
          <>
            <div className="flex items-center gap-3 font-mono text-[11px] text-faint" aria-hidden="true">
              <span className="h-px grow bg-line" />
              or
              <span className="h-px grow bg-line" />
            </div>
            <div className="flex flex-col gap-2">
              {canScanQr ? (
                <button
                  type="button"
                  onClick={scan}
                  disabled={busy || searchesLeft === 0}
                  className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-[14px] border border-line-strong bg-panel px-3 text-[15px] font-semibold text-ink disabled:opacity-50"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10" />
                  </svg>
                  Scan QR code
                </button>
              ) : null}
              <button
                type="button"
                onClick={pickImage}
                disabled={busy || reading || searchesLeft === 0}
                className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-[14px] border border-line-strong bg-panel px-3 text-[15px] font-semibold text-ink disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                {reading ? "Reading…" : "Upload QR image"}
              </button>
            </div>
            <input ref={imageInput} type="file" accept="image/*" onChange={onImage} className="hidden" aria-hidden="true" tabIndex={-1} />
          </>
        ) : null}

        <p className="m-0 text-[12.5px] leading-normal text-faint">
          {searchesLeft === null ? "" : `${searchesLeft} of 10 searches left this hour. `}
          {initialId ? "Check the ID from the QR code, then send the request. " : ""}
          For your safety, the app never says why a search failed.
          {mode === "invite" ? " An invite code connects you at once, no request." : ""}
        </p>
      </form>
      {webScanner ? <QrScanner onResult={applyScan} onClose={() => setWebScanner(false)} onUpload={pickImage} /> : null}
    </main>
  );
}
