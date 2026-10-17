import { api } from "./api";
import { isNativeApp } from "./platform";

/** What the server sends on the socket ("notify") for every event. Never any message content. */
export type Note = {
  kind: "contact_request" | "contact_added" | "chat_invite" | "chat_accepted" | "chat_declined" | "chat_ended" | "message";
  title: string;
  body: string;
  tag: string;
  open: { chatId?: string; userId?: string; liveId?: string; media?: boolean };
  /** False when the person turned this kind off in Settings: in-app banner only. */
  system: boolean;
};
export type NotifyPrefs = { messages: boolean; chats: boolean; contacts: boolean };
export type Permission = "granted" | "denied" | "default" | "unsupported";

/**
 * System notifications:
 * - Browser: Web Push through the service worker, so they arrive even when the tab is closed (the browser must be running).
 * - Android app: a phone notification while the app is in the background.
 */
const webSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const notificationsSupported = () => isNativeApp || webSupported();

async function local() {
  return (await import("@capacitor/local-notifications")).LocalNotifications;
}

export async function permission(): Promise<Permission> {
  if (isNativeApp) {
    const { display } = await (await local()).checkPermissions();
    return display === "granted" ? "granted" : display === "denied" ? "denied" : "default";
  }
  if (!webSupported()) return "unsupported";
  return Notification.permission;
}

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
/** The web app registers its service worker once (no caching: it only handles notifications). */
export function registerServiceWorker() {
  if (isNativeApp || !webSupported()) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register("/sw.js").catch(() => null);
  return registration;
}

/** Subscribes this browser and hands the subscription to the server, tied to this sign-in. */
async function subscribeWeb() {
  const reg = await registerServiceWorker();
  if (!reg) return false;
  const { pushKey } = await api<{ pushKey: string | null }>("/api/notifications");
  if (!pushKey) return false;
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    const wanted = keyBytes(pushKey);
    if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) });
  const json = sub.toJSON();
  await api("/api/notifications/push", { body: { endpoint: json.endpoint, keys: json.keys } });
  return true;
}

/** Asks for permission (from a tap) and turns notifications on for this device. */
export async function enableNotifications(): Promise<Permission> {
  if (isNativeApp) {
    const { display } = await (await local()).requestPermissions();
    return display === "granted" ? "granted" : display === "denied" ? "denied" : "default";
  }
  if (!webSupported()) return "unsupported";
  const result = await Notification.requestPermission();
  if (result === "granted") await subscribeWeb();
  return result;
}

/** After each sign-in: the subscription belongs to the session, so the new session registers it again. */
export async function syncNotifications() {
  if (isNativeApp || !webSupported() || Notification.permission !== "granted") return;
  await subscribeWeb().catch(() => {});
}

let nextId = 1;
/** Android app in the background: a phone notification for this event. */
export async function showOnPhone(note: Note) {
  if (!isNativeApp) return;
  const notifications = await local();
  await notifications.schedule({
    notifications: [{ id: nextId++, title: note.title, body: note.body, group: note.tag, extra: { open: note.open } }],
  });
}

/** Taps on a notification (browser or phone): where to go. */
export function onNotificationTap(go: (open: Note["open"]) => void) {
  const cleanups: (() => void)[] = [];
  if (isNativeApp) {
    void local().then((n) =>
      n
        .addListener("localNotificationActionPerformed", ({ notification }) => go((notification.extra as { open?: Note["open"] } | undefined)?.open ?? {}))
        .then((handle) => cleanups.push(() => void handle.remove())),
    );
  } else if (webSupported()) {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type === "hc:open" && data.url) go(openFromUrl(data.url));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    cleanups.push(() => navigator.serviceWorker.removeEventListener("message", onMessage));
  }
  return () => cleanups.forEach((c) => c());
}

/** "/#chat=…" or "/#contact=…" (a browser notification opening a new tab). */
export function openFromUrl(url: string): Note["open"] {
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const [kind, id] = hash.split("=");
  if (kind === "media") return { media: true };
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return {};
  return kind === "chat" ? { chatId: id } : kind === "live" ? { liveId: id } : kind === "contact" ? { userId: id } : {};
}
