import { useState } from "react";
import { api } from "../lib/api";
import type { Contact } from "../lib/contacts";
import { Avatar } from "./PageHeader";

const MAX_OTHERS = 9;

type Props = { contacts: Contact[]; onAsked: () => void; onClose: () => void; onAuthError: (err: unknown) => boolean };

/** Ask the administrator for a group with some of my contacts (up to 10 people, me included). */
export function NewGroupSheet({ contacts, onAsked, onClose, onAuthError }: Props) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : p.size >= MAX_OTHERS ? p : new Set(p).add(id)));

  async function ask() {
    setBusy(true);
    setError("");
    try {
      await api("/api/groups/requests", { body: { name: name.trim(), memberIds: [...picked] } });
      onAsked();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't send the request");
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="newgroup-title"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex max-h-[92dvh] w-full max-w-[560px] flex-col gap-3 overflow-y-auto rounded-t-[26px] border-t border-line-strong bg-panel px-[18px] pb-6 pt-3"
      >
        <span className="h-1 w-10 self-center rounded-full bg-line-strong" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 id="newgroup-title" className="m-0 text-xl font-extrabold">
            New group
          </h2>
          <p className="m-0 text-[13px] leading-normal text-dim">The administrator approves it and sets its rules. Up to 10 people, you included.</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-dim">group name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="Site team"
            className="min-h-[46px] rounded-[14px] border border-line-strong bg-sunken px-3.5 text-[15px] text-ink outline-none focus:border-accent"
          />
        </label>
        <span className="font-mono text-[11px] text-dim">
          contacts · {picked.size} of {MAX_OTHERS}
        </span>
        <ul className="m-0 flex list-none flex-col p-0">
          {contacts.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 border-t border-line px-1 py-2">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  disabled={!picked.has(c.id) && picked.size >= MAX_OTHERS}
                  className="size-5 accent-[#C7707E]"
                />
                <Avatar username={c.username} size={34} online={c.online} />
                <span className="text-[14.5px] font-semibold">{c.username}</span>
              </label>
            </li>
          ))}
        </ul>
        {error ? <p className="m-0 rounded-xl border border-dashed border-danger px-3 py-2 text-[13px] text-danger-ink">{error}</p> : null}
        <button
          type="button"
          disabled={busy || name.trim().length < 2 || !picked.size}
          onClick={() => void ask()}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to the administrator"}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 bg-transparent text-[13.5px] font-semibold text-link">
          Cancel
        </button>
      </section>
    </div>
  );
}
