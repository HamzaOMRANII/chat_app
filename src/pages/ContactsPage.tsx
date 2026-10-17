import { useCallback, useEffect, useState } from "react";
import { Logo, Wordmark } from "../components/Logo";
import { Avatar } from "../components/PageHeader";
import { NotificationPrompt } from "../components/NotificationSettings";
import { Notice } from "../components/Screen";
import { api } from "../lib/api";
import { modeLabel, type Chat } from "../lib/chats";
import { isNativeApp } from "../lib/platform";
import { ago, lastSeen, type Contact, type ContactList } from "../lib/contacts";
import { place, when, type LastLogin } from "../app/types";

type Props = {
  lastLogin: LastLogin;
  /** Bumped by the socket when contacts or requests change. */
  version: number;
  onMyId: () => void;
  onAdd: () => void;
  onOpen: (contact: Contact) => void;
  onOpenChat: (chatId: string) => void;
  onSettings: () => void;
  /** Web only: Settings, where the Android app download is. */
  onGetApp: () => void;
  onAuthError: (err: unknown) => boolean;
};

const iconButton =
  "grid size-11 place-items-center rounded-field border border-line bg-panel text-ink";

export function ContactsPage({
  lastLogin,
  version,
  onMyId,
  onAdd,
  onOpen,
  onOpenChat,
  onSettings,
  onGetApp,
  onAuthError,
}: Props) {
  const [list, setList] = useState<ContactList | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showLastLogin, setShowLastLogin] = useState(Boolean(lastLogin));

  const load = useCallback(async () => {
    try {
      const [contacts, open] = await Promise.all([api<ContactList>("/api/contacts"), api<{ chats: Chat[] }>("/api/chats")]);
      setList(contacts);
      setChats(open.chats);
      setError("");
    } catch (err) {
      if (!onAuthError(err))
        setError(
          err instanceof Error ? err.message : "Couldn't load your contacts",
        );
    }
  }, [onAuthError]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function answer(id: string, action: "accept" | "decline") {
    setBusy(id);
    try {
      await api(`/api/contacts/requests/${id}/${action}`, { method: "POST" });
    } catch (err) {
      if (!onAuthError(err))
        setError(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(null);
    await load();
  }

  const chatWith = new Map(chats.filter((c) => c.with).map((c) => [c.with!.id, c]));
  const invitations = chats.filter((c) => c.status === "invited" && !c.createdByMe && c.with);
  const requests = list ? list.incoming.length + list.outgoing.length : 0;
  const online = list?.contacts.filter((c) => c.online).length ?? 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 pb-3.5 pt-5">
        <Logo size={30} />
        <span className="grow text-xl">
          <Wordmark />
        </span>
        {isNativeApp ? null : (
          <button
            type="button"
            onClick={onGetApp}
            aria-label="Get the Android app"
            title="Get the Android app"
            className={iconButton}
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
              <rect x="6" y="2" width="12" height="20" rx="2.5" />
              <path d="M12 7v7M9 11l3 3 3-3M10 18h4" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onMyId}
          aria-label="My ID and invite codes"
          className={iconButton}
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
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3M21 14v7h-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className={iconButton}
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
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
        </button>
      </header>

      <div className="flex grow flex-col gap-4 px-5 pb-4 pt-4">
        {showLastLogin && lastLogin ? (
          <Notice>
            <span className="flex items-start gap-3">
              <span className="grow">
                Last sign-in:{" "}
                <strong className="text-ink">
                  {lastLogin.deviceName ?? "a device"}
                </strong>
                , {place(lastLogin.city, lastLogin.country)},{" "}
                {when(lastLogin.at)}. Not you? Change your password.
              </span>
              <button
                type="button"
                onClick={() => setShowLastLogin(false)}
                aria-label="Dismiss"
                className="min-h-6 bg-transparent px-1 text-dim"
              >
                ×
              </button>
            </span>
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <NotificationPrompt />

        {invitations.length ? (
          <section aria-labelledby="invitations" className="flex flex-col gap-2.5">
            <h2 id="invitations" className="eyebrow m-0 text-[11px] font-normal">
              chat invitation{invitations.length > 1 ? "s" : ""}
            </h2>
            {invitations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenChat(c.id)}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line-strong bg-raised p-3.5 text-left text-ink"
              >
                <Avatar username={c.with!.username} size={40} online={c.with!.online} />
                <span className="flex min-w-[9rem] flex-1 flex-col gap-1">
                  <span className="text-[14.5px]">
                    <strong>{c.with!.username}</strong> wants to chat
                  </span>
                  <span className={`self-start rounded-full border px-2 py-px font-mono text-[10.5px] font-bold ${c.mode === "auto" ? "border-auto-line text-auto" : "border-keep-line text-keep"}`}>
                    {modeLabel(c)}
                  </span>
                </span>
                <span className="ml-auto rounded-[11px] bg-brand px-3.5 py-2.5 text-[13.5px] font-bold text-white">See</span>
              </button>
            ))}
          </section>
        ) : null}

        {requests ? (
          <section aria-labelledby="requests" className="flex flex-col gap-2.5">
            <h2 id="requests" className="eyebrow m-0 text-[11px] font-normal">
              requests · {requests}
            </h2>
            <ul className="m-0 flex list-none flex-col rounded-2xl border border-line-strong bg-raised p-0">
              {list!.incoming.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center gap-3 px-3.5 py-3 ${i ? "border-t border-line" : ""}`}
                >
                  <Avatar username={r.username} size={40} online={false} />
                  <span className="flex min-w-[9rem] flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14.5px] font-bold">
                      {r.username}
                    </span>
                    <span className="text-xs text-dim">
                      wants to connect · {ago(r.at)}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => answer(r.id, "decline")}
                      aria-label={`Decline ${r.username}`}
                      className="grid size-10 place-items-center rounded-[11px] border border-line-strong bg-transparent text-dim disabled:opacity-50"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => answer(r.id, "accept")}
                      className="min-h-10 rounded-[11px] bg-brand px-3.5 text-[13.5px] font-bold text-white disabled:opacity-50"
                    >
                      Accept
                    </button>
                  </span>
                </li>
              ))}
              {list!.outgoing.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center gap-3 px-3.5 py-3 ${i || list!.incoming.length ? "border-t border-line" : ""}`}
                >
                  <Avatar username={r.username} size={40} muted />
                  <span className="flex min-w-[9rem] flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14.5px] font-bold">
                      {r.username}
                    </span>
                    <span className="text-xs text-dim">
                      you asked · waiting
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => answer(r.id, "decline")}
                    className="ml-auto min-h-10 rounded-[11px] border border-line-strong bg-transparent px-3 text-[13px] font-semibold text-ink-soft disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="contacts"
          className="flex grow flex-col gap-1.5"
        >
          <div className="flex items-center justify-between">
            <h2 id="contacts" className="eyebrow m-0 text-[11px] font-normal">
              contacts · {list?.contacts.length ?? 0}
            </h2>
            {online ? (
              <span className="font-mono text-[11px] text-online">
                {online} online
              </span>
            ) : null}
          </div>
          {list === null && !error ? (
            <p className="text-sm text-dim">Loading…</p>
          ) : null}
          {list?.contacts.length === 0 ? (
            <div className="mt-2 flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-5 py-9 text-center">
              <p className="m-0 text-[15px] font-bold">No contacts yet</p>
              <p className="m-0 max-w-[34ch] text-[13.5px] leading-relaxed text-dim">
                Share your ID or a one-time invite code, or add someone with
                theirs.
              </p>
            </div>
          ) : null}
          <ul className="-mx-2 m-0 flex list-none flex-col p-0">
            {list?.contacts.map((c) => {
              const chat = chatWith.get(c.id);
              const waiting = chat?.status === "invited";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => (chat ? onOpenChat(chat.id) : onOpen(c))}
                    className="flex w-full items-center gap-3.5 rounded-[14px] bg-transparent px-2 py-[11px] text-left text-ink hover:bg-panel"
                  >
                    <Avatar username={c.username} online={c.online} />
                    <span className="flex min-w-0 grow flex-col gap-[3px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[15.5px] font-bold">{c.username}</span>
                        {chat?.unread ? (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 font-mono text-[11px] font-bold text-bg">{chat.unread}</span>
                        ) : null}
                      </span>
                      <span className={`truncate text-[13px] ${chat?.unread ? "font-semibold text-ink-soft" : c.online ? "text-online" : "text-faint"}`}>
                        {chat?.unread
                          ? `${chat.unread} new message${chat.unread > 1 ? "s" : ""}`
                          : waiting
                            ? chat.createdByMe
                              ? "invited · waiting"
                              : "invites you to chat"
                            : lastSeen(c)}
                      </span>
                    </span>
                    {chat ? (
                      <span className="flex shrink-0 flex-col items-end gap-[5px]">
                        <span
                          className={`rounded-full border px-2 py-px font-mono text-[10.5px] font-bold ${chat.mode === "auto" ? "border-auto-line text-auto" : "border-keep-line text-keep"} ${waiting ? "border-dashed" : ""}`}
                        >
                          {modeLabel(chat)}
                        </span>
                        {chat.lastMessageAt ? <span className="font-mono text-[11px] text-faint">{shortWhen(chat.lastMessageAt)}</span> : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="sticky bottom-0 bg-bg px-5 pb-6 pt-3">
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-2xl bg-brand text-[15px] font-bold text-white shadow-[0_10px_26px_rgba(126,34,52,0.35)] hover:bg-brand-hover"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add contact
        </button>
      </div>
    </main>
  );
}

/** "09:15", "yesterday", "Mon" */
function shortWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return "yesterday";
  return d.toLocaleDateString([], { weekday: "short" });
}
