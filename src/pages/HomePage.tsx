import { useState } from "react";
import { Logo, Wordmark } from "../components/Logo";
import { Notice } from "../components/Screen";
import { place, when, type LastLogin, type User } from "../app/types";

type Props = { user: User; lastLogin: LastLogin; onSecurityLog: () => void; onSignOut: () => void };

/** Signed-in home. Contacts and chats arrive in the next milestones. */
export function HomePage({ user, lastLogin, onSecurityLog, onSignOut }: Props) {
  const [showLastLogin, setShowLastLogin] = useState(Boolean(lastLogin));
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 pb-3.5 pt-5">
        <Logo size={30} />
        <span className="grow text-xl">
          <Wordmark />
        </span>
        <button
          type="button"
          onClick={onSecurityLog}
          aria-label="My security log"
          className="grid size-11 place-items-center rounded-field border border-line bg-panel text-ink"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-4 px-5 py-5">
        {showLastLogin && lastLogin ? (
          <Notice>
            <span className="flex items-start gap-3">
              <span className="grow">
                Last sign-in: <strong className="text-ink">{lastLogin.deviceName ?? "a device"}</strong>, {place(lastLogin.city, lastLogin.country)},{" "}
                {when(lastLogin.at)}. Not you? Change your password.
              </span>
              <button type="button" onClick={() => setShowLastLogin(false)} aria-label="Dismiss" className="min-h-6 bg-transparent px-1 text-dim">
                ×
              </button>
            </span>
          </Notice>
        ) : null}

        <section className="flex flex-col gap-1">
          <p className="eyebrow m-0">signed in</p>
          <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">Hello, {user.username}</h1>
        </section>

        <section className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-5 py-10 text-center">
          <p className="m-0 text-[15px] font-bold">Your contacts will appear here</p>
          <p className="m-0 max-w-[34ch] text-[13.5px] leading-relaxed text-dim">
            Adding contacts by ID and chatting arrive in the next update of H_CHAT.
          </p>
        </section>

        <button
          type="button"
          onClick={onSignOut}
          className="min-h-12 rounded-control border border-line-strong bg-panel text-[14.5px] font-semibold text-ink"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
