import { useEffect } from "react";
import { AndroidDownload } from "../components/AndroidDownload";
import { NotificationSettings } from "../components/NotificationSettings";
import { MyMedia } from "../components/MyMedia";
import { CallSettings } from "../components/CallSettings";
import { SecureCodeSettings } from "../components/SecureCodeSettings";
import { PageHeader } from "../components/PageHeader";
import { isNativeApp } from "../lib/platform";
import type { User } from "../app/types";

declare const __APP_VERSION__: string;

const row = "flex min-h-[54px] w-full items-center gap-3 bg-transparent px-4 text-left text-[15px] font-semibold text-ink hover:bg-raised";

type Props = { user: User; focusApp?: boolean; onBack: () => void; onSecurityLog: () => void; onMedia: () => void; onSignOut: () => void };

export function SettingsPage({ user, focusApp, onBack, onSecurityLog, onMedia, onSignOut }: Props) {
  // From the header's "Get the Android app" button: bring the download card into view once it has loaded
  useEffect(() => {
    if (!focusApp) return;
    const t = setTimeout(() => document.getElementById("android-app")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(t);
  }, [focusApp]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="Settings" onBack={onBack} />
      <div className="flex flex-col gap-4 px-4 py-5">
        <section className="flex flex-col gap-1">
          <p className="eyebrow m-0">signed in as</p>
          <p className="m-0 text-xl font-extrabold">{user.username}</p>
          <p className="m-0 font-mono text-xs text-dim">{user.email}</p>
        </section>
        <NotificationSettings />
        <CallSettings />
        <MyMedia onOpen={onMedia} />
        <SecureCodeSettings />
        <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <button type="button" onClick={onSecurityLog} className={row}>
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
              <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            My security log
          </button>
        </div>
        {isNativeApp ? null : (
          <div id="android-app">
            <AndroidDownload />
          </div>
        )}
        <button type="button" onClick={onSignOut} className="min-h-12 rounded-control border border-line-strong bg-panel text-[14.5px] font-semibold text-ink">
          Sign out
        </button>
        <p className="m-0 text-center font-mono text-[11px] text-faint">H_CHAT {__APP_VERSION__} · end-to-end encrypted</p>
      </div>
    </main>
  );
}
