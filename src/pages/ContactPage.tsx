import { useEffect, useState } from "react";
import { Avatar, PageHeader } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api, ApiError } from "../lib/api";
import { lastSeen, type Contact } from "../lib/contacts";
import { StartChatSheet } from "../components/StartChatSheet";
import type { Chat } from "../lib/chats";

type Props = { contact: Contact; userId: string; version: number; onBack: () => void; onChat: (chatId: string) => void; onAuthError: (err: unknown) => boolean };

export function ContactPage({ contact: initial, userId, version, onBack, onChat, onAuthError }: Props) {
  const [contact, setContact] = useState(initial);
  const [confirm, setConfirm] = useState<"remove" | "block" | null>(null);
  const [error, setError] = useState("");
  const [chat, setChat] = useState<Chat | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api<{ chats: Chat[] }>("/api/chats")
      .then(({ chats }) => setChat(chats.find((c) => c.with?.id === initial.id) ?? null))
      .catch(() => {});
  }, [initial.id, version]);

  // Live online status; a contact that disappeared (removed, blocked, paused) sends us back.
  useEffect(() => {
    api<{ contact: Contact }>(`/api/contacts/${initial.id}`)
      .then((r) => setContact(r.contact))
      .catch((err) => {
        if (onAuthError(err)) return;
        if (err instanceof ApiError && err.status === 404) onBack();
      });
  }, [initial.id, version, onAuthError, onBack]);

  async function act(kind: "remove" | "block") {
    try {
      if (kind === "remove") await api(`/api/contacts/${contact.id}`, { method: "DELETE" });
      else await api(`/api/contacts/${contact.id}/block`, { method: "POST" });
      onBack();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="Contact" onBack={onBack} />
      <div className="flex grow flex-col gap-4 px-4 py-6">
        <div className="flex flex-col items-center gap-2.5">
          <Avatar username={contact.username} online={contact.online} size={88} />
          <h2 className="m-0 text-[22px] font-extrabold">{contact.username}</h2>
          <p className={`m-0 font-mono text-xs ${contact.online ? "text-online" : "text-dim"}`}>{lastSeen(contact)}</p>
        </div>

        <dl className="m-0 flex flex-col gap-1.5 rounded-2xl border border-line bg-panel px-4 py-3.5 font-mono text-[12.5px] text-ink-soft">
          <div className="flex gap-1.5">
            <dt className="text-faint">contact since</dt>
            <dd className="m-0">{new Date(contact.since).toLocaleDateString()}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-faint">added with</dt>
            <dd className="m-0">{contact.via === "invite" ? "invite code" : "ID request"}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => (chat ? onChat(chat.id) : setStarting(true))}
          className="min-h-[52px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover"
        >
          {chat ? (chat.status === "active" ? "Open chat" : chat.createdByMe ? "Invitation sent · open" : "Chat invitation · open") : "Start chat"}
        </button>

        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grow" />

        {confirm ? (
          <Notice tone="warning">
            <span className="flex flex-col gap-3">
              <span>
                {confirm === "remove"
                  ? `Remove ${contact.username}? Any chat between you ends and its messages are deleted. You can add each other again later.`
                  : `Block ${contact.username}? They're removed and can never find you again, even with a new code. They aren't told.`}
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => act(confirm)} className="min-h-10 rounded-field bg-brand px-3.5 text-[13.5px] font-bold text-white">
                  {confirm === "remove" ? "Remove" : "Block"}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="min-h-10 rounded-field border border-line-strong bg-transparent px-3.5 text-[13.5px] font-semibold text-ink">
                  Cancel
                </button>
              </span>
            </span>
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setConfirm("remove")} className="min-h-12 rounded-[14px] border border-line-strong bg-transparent text-[14.5px] font-semibold text-ink">
              Remove contact
            </button>
            <button
              type="button"
              onClick={() => setConfirm("block")}
              className="min-h-12 rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-[12.5px] font-bold uppercase text-danger-ink before:content-['[_'] after:content-['_]'] hover:bg-danger/10"
            >
              Block {contact.username}
            </button>
            <p className="m-0 text-center text-xs leading-normal text-faint">Neither is announced, and any chat between you ends. A blocked person can't find you again, even with a new code.</p>
          </div>
        )}
      </div>
      {starting ? (
        <StartChatSheet userId={userId} peer={contact} onStarted={(c) => onChat(c.id)} onClose={() => setStarting(false)} onAuthError={onAuthError} />
      ) : null}
    </main>
  );
}
