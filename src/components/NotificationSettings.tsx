import { useEffect, useState } from "react";
import { Notice } from "./Screen";
import { api } from "../lib/api";
import { enableNotifications, permission, type NotifyPrefs, type Permission } from "../lib/notifications";
import { isNativeApp } from "../lib/platform";

const KINDS: { key: keyof NotifyPrefs; label: string; hint: string }[] = [
  { key: "messages", label: "Messages", hint: "Who wrote. Never what they wrote." },
  { key: "chats", label: "Chat invitations and answers", hint: "Invited, accepted, declined, ended" },
  { key: "contacts", label: "Contact requests", hint: "New requests and new contacts" },
];

/** Settings: turn notifications on for this device, and choose which events show one. */
export function NotificationSettings() {
  const [perm, setPerm] = useState<Permission | null>(null);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void permission().then(setPerm, () => setPerm("unsupported"));
    api<{ prefs: NotifyPrefs }>("/api/notifications")
      .then(({ prefs: p }) => setPrefs(p))
      .catch(() => setError("Couldn't load your notification settings"));
  }, []);

  async function turnOn() {
    setError("");
    try {
      setPerm(await enableNotifications());
    } catch {
      setError("Couldn't turn notifications on. Try again.");
    }
  }

  async function toggle(key: keyof NotifyPrefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      await api("/api/notifications", { method: "PUT", body: { [key]: next[key] } });
    } catch {
      setPrefs(prefs);
      setError("Couldn't save. Try again.");
    }
  }

  const where = isNativeApp ? "this phone" : "this browser";
  return (
    <section aria-labelledby="notifications-title" className="flex flex-col gap-2.5">
      <h2 id="notifications-title" className="eyebrow m-0 text-[11px] font-normal">
        notifications
      </h2>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">On {where}</span>
            <span className="text-[12.5px] leading-snug text-dim">
              {perm === "granted"
                ? isNativeApp
                  ? "On. They arrive while H_CHAT is open or in the background."
                  : "On. They arrive even when the H_CHAT tab is closed, while the browser runs."
                : perm === "denied"
                  ? `Blocked in ${isNativeApp ? "the phone's settings (Apps › H_CHAT › Notifications)" : "the browser's site settings"}. Allow them there.`
                  : perm === "unsupported"
                    ? "This browser can't show notifications."
                    : "Off. You only see banners while H_CHAT is on screen."}
            </span>
          </span>
          {perm === "default" ? (
            <button type="button" onClick={turnOn} className="min-h-11 shrink-0 rounded-[11px] bg-brand px-4 text-[13.5px] font-bold text-white hover:bg-brand-hover">
              Turn on
            </button>
          ) : perm === "granted" ? (
            <span className="shrink-0 font-mono text-[11px] font-bold text-online">ON</span>
          ) : null}
        </div>
        {prefs
          ? KINDS.map((k) => (
              <label key={k.key} className="flex min-h-[58px] cursor-pointer items-center gap-3 border-t border-line px-4 py-2.5">
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="text-[14.5px] font-semibold">{k.label}</span>
                  <span className="text-[12px] text-dim">{k.hint}</span>
                </span>
                <input type="checkbox" role="switch" checked={prefs[k.key]} onChange={() => toggle(k.key)} className="peer sr-only" />
                <span
                  aria-hidden="true"
                  className="relative h-7 w-12 shrink-0 rounded-full border border-line-strong bg-sunken transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-dim after:transition-transform peer-checked:border-brand peer-checked:bg-brand peer-checked:after:translate-x-5 peer-checked:after:bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
                />
              </label>
            ))
          : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}

/** Contacts screen: a one-time invitation to turn notifications on, until it's answered or dismissed. */
const ASKED = "hc.notify.asked";
export function NotificationPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let asked = false;
    try {
      asked = localStorage.getItem(ASKED) === "1";
    } catch {
      /* storage unavailable */
    }
    if (!asked) void permission().then((p) => setShow(p === "default"), () => {});
  }, []);
  const done = () => {
    setShow(false);
    try {
      localStorage.setItem(ASKED, "1");
    } catch {
      /* storage unavailable */
    }
  };
  if (!show) return null;
  return (
    <Notice>
      <span className="flex flex-wrap items-center gap-3">
        <span className="min-w-[12rem] flex-1">
          <strong className="text-ink">Turn on notifications</strong> to know about new messages, chat invitations and contact requests when H_CHAT isn't on screen.
        </span>
        <span className="ml-auto flex shrink-0 gap-2">
          <button type="button" onClick={done} className="min-h-10 rounded-[11px] border border-line-strong bg-transparent px-3 text-[13px] font-semibold text-ink-soft">
            Not now
          </button>
          <button
            type="button"
            onClick={() => {
              done();
              void enableNotifications().catch(() => {});
            }}
            className="min-h-10 rounded-[11px] bg-brand px-3.5 text-[13.5px] font-bold text-white"
          >
            Turn on
          </button>
        </span>
      </span>
    </Notice>
  );
}
