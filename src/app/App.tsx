import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, ApiError, tokenStore } from "../lib/api";
import { isNativeApp, SERVER_ORIGIN } from "../lib/platform";
import { AdminResetPage } from "../pages/AdminResetPage";
import { ClosedPage } from "../pages/ClosedPage";
import { CodePage } from "../pages/CodePage";
import { AddContactPage } from "../pages/AddContactPage";
import { ChatPage } from "../pages/ChatPage";
import { SafetyPage } from "../pages/SafetyPage";
import { prepareDevice } from "../lib/chats";
import { CHAT_EVENTS, live } from "../lib/live";
import { ContactPage } from "../pages/ContactPage";
import { ContactsPage } from "../pages/ContactsPage";
import { MyIdPage } from "../pages/MyIdPage";
import { LoginPage } from "../pages/LoginPage";
import { PasscodePage } from "../pages/PasscodePage";
import { PendingPage } from "../pages/PendingPage";
import { ResetPage } from "../pages/ResetPage";
import { SecurityLogPage } from "../pages/SecurityLogPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SignUpPage } from "../pages/SignUpPage";
import { personalIdFromScan, type Contact } from "../lib/contacts";
import { Banners, type Banner } from "../components/Banners";
import { onNotificationTap, openFromUrl, registerServiceWorker, showOnPhone, syncNotifications, type Note } from "../lib/notifications";
import type { Closed, LastLogin, Screen, User } from "./types";

const CLOSED_CODES = new Set(["session_revoked", "session_closed", "account_unavailable"]);
// A My ID QR code read by a phone's camera app opens chat.omranisystems.com/#add=HC-…: keep the ID through sign-in.
const PENDING_ADD = "hc.pendingAdd";
function takePendingAdd() {
  try {
    const fromLink = personalIdFromScan(decodeURIComponent(location.hash));
    if (fromLink) {
      sessionStorage.setItem(PENDING_ADD, fromLink);
      history.replaceState(null, "", location.pathname + location.search);
    }
    const id = sessionStorage.getItem(PENDING_ADD);
    sessionStorage.removeItem(PENDING_ADD);
    return id ?? undefined;
  } catch {
    return undefined;
  }
}
function keepPendingAdd() {
  try {
    const id = personalIdFromScan(decodeURIComponent(location.hash));
    if (id) sessionStorage.setItem(PENDING_ADD, id);
  } catch {
    /* storage unavailable */
  }
}
keepPendingAdd();

// A browser notification opened a new tab on /#chat=… or /#contact=…: go there once signed in.
let pendingOpen: Note["open"] = openFromUrl(location.hash);
if (pendingOpen.chatId || pendingOpen.userId) history.replaceState(null, "", location.pathname + location.search);
void registerServiceWorker();

/** Is the app on screen (not a hidden tab, not an app in the background)? */
const onScreenNow = () => (typeof document === "undefined" ? true : document.visibilityState === "visible");

const SIGNED_IN_SCREENS = new Set<Screen["name"]>(["home", "myId", "add", "contact", "settings", "security", "chat", "safety"]);

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [user, setUser] = useState<User | null>(null);
  const [lastLogin, setLastLogin] = useState<LastLogin>(null);
  // Bumped on "contacts:changed" so open contact screens reload
  const [contactsVersion, setContactsVersion] = useState(0);
  const [banners, setBanners] = useState<Banner[]>([]);
  const bannerId = useRef(0);
  const visible = useRef(onScreenNow());

  /** One banner per tag: a new one replaces the previous (e.g. several messages in the same chat). */
  const showBanner = useCallback((banner: Omit<Banner, "id">) => {
    const id = ++bannerId.current;
    setBanners((list) => [...list.filter((b) => b.tag !== banner.tag), { ...banner, id }].slice(-3));
  }, []);
  const dismissBanner = useCallback((id: number) => setBanners((list) => list.filter((b) => b.id !== id)), []);
  // Chats just closed on screen: their own banner says why, the server's "chat ended" notification adds nothing
  const closedHere = useRef(new Map<string, number>());

  /** Where a notification leads: the chat, the contact, or the contacts list. */
  const openTarget = useCallback((open: Note["open"]) => {
    if (open.chatId) return setScreen({ name: "chat", chatId: open.chatId });
    if (open.userId) {
      return void api<{ contact: Contact }>(`/api/contacts/${open.userId}`)
        .then(({ contact }) => setScreen({ name: "contact", contact }))
        .catch(() => setScreen({ name: "home" }));
    }
    setScreen({ name: "home" });
  }, []);

  const showClosed = useCallback((closed: Closed) => {
    tokenStore.clear();
    setUser(null);
    setScreen({ name: "closed", closed });
  }, []);

  /** Turns "your session ended" API errors into the right screen; returns true when handled. */
  const handleAuthError = useCallback(
    (err: unknown) => {
      if (!(err instanceof ApiError) || err.status !== 401) return false;
      if (CLOSED_CODES.has(err.code)) showClosed({ code: err.code as Closed["code"], ...(err.details as Partial<Closed>) });
      else showClosed({ code: "session_expired" });
      return true;
    },
    [showClosed],
  );

  const enter = useCallback(
    (u: User, last: LastLogin = null) => {
      setUser(u);
      setLastLogin(last);
      if (u.mustReset) return setScreen({ name: "reset" });
      const pendingAdd = takePendingAdd();
      if (pendingAdd) return setScreen({ name: "add", initialId: pendingAdd });
      const open = pendingOpen;
      pendingOpen = {};
      if (open.chatId || open.userId) return openTarget(open);
      setScreen({ name: "home" });
    },
    [openTarget],
  );

  // Restore an existing session on start
  useEffect(() => {
    api<{ user: User; lastLogin: LastLogin }>("/api/auth/me")
      .then((res) => enter(res.user))
      .catch((err) => {
        if (err instanceof ApiError && err.code === "session_revoked") handleAuthError(err);
        else setScreen({ name: "login" });
      });
  }, [enter, handleAuthError]);

  // While signed in: "signed in on another device" (and other session ends), contact changes, presence
  const signedIn = SIGNED_IN_SCREENS.has(screen.name);
  useEffect(() => {
    if (!signedIn) return;
    const socket = io(SERVER_ORIGIN || undefined, {
      path: "/socket.io",
      withCredentials: !isNativeApp,
      // Asked again on every reconnect. The APK sends its token; the web app a fresh 60-second ticket (asked with
      // its cookie), so the live connection never depends on which cookies the browser sends to /socket.io.
      // "visible": the server sends a Web Push only when the app isn't on screen.
      auth: (cb: (data: Record<string, unknown>) => void) => {
        if (isNativeApp) return cb({ token: tokenStore.get(), visible: visible.current });
        api<{ ticket: string }>("/api/auth/socket-ticket")
          .then(({ ticket }) => cb({ ticket, visible: visible.current }))
          .catch(() => cb({ visible: visible.current }));
      },
      transports: ["websocket"],
      reconnectionDelayMax: 2000,
    });
    // Back on screen: the connection may have died silently while the phone slept. Check it now
    // (reconnect if it doesn't answer within 3 s) and fetch whatever was missed.
    const catchUp = () => {
      setContactsVersion((v) => v + 1);
      live.dispatch("resync", null);
    };
    const setVisible = (on: boolean) => {
      const wasVisible = visible.current;
      visible.current = on;
      socket.emit("visibility", { visible: on });
      if (!on || wasVisible) return;
      if (!socket.connected) socket.connect();
      else
        socket.timeout(3000).emit("alive", null, (err: Error | null) => {
          if (err) socket.disconnect().connect();
        });
      catchUp();
    };
    const onVisibility = () => setVisible(onScreenNow());
    document.addEventListener("visibilitychange", onVisibility);
    let removeAppState = () => {};
    if (isNativeApp) {
      void import("@capacitor/app").then(({ App: NativeApp }) =>
        NativeApp.addListener("appStateChange", ({ isActive }) => setVisible(isActive)).then((handle) => (removeAppState = () => void handle.remove())),
      );
    }

    // Every event: a banner when the app is on screen, a phone notification when the Android app is in the background
    // (browsers in the background get the server's Web Push instead).
    socket.on("notify", (note: Note) => {
      if (!visible.current) {
        if (note.system) void showOnPhone(note).catch(() => {});
        return;
      }
      const current = screenRef.current;
      const here = current.name === "chat" && note.tag === `chat:${current.chatId}`;
      // The open chat shows its own messages; an accepted chat opens by itself
      if ((note.kind === "message" && here) || note.kind === "chat_accepted") return;
      if ((note.kind === "chat_ended" || note.kind === "chat_declined") && Date.now() - (closedHere.current.get(note.tag) ?? 0) < 15_000) return;
      showBanner({ tag: note.tag, title: note.title, body: note.body, who: note.title, onOpen: () => openTarget(note.open) });
    });
    // They accepted my invitation: open the chat, unless I'm writing in another one
    socket.on("chat:accepted", ({ chatId }: { chatId: string }) => {
      const current = screenRef.current;
      if (current.name === "chat" && current.chatId !== chatId) {
        showBanner({ tag: `chat:${chatId}`, title: "Chat accepted", body: "Tap to open it.", onOpen: () => openTarget({ chatId }) });
      } else if (current.name !== "safety") {
        setScreen({ name: "chat", chatId });
      }
    });
    socket.on("session:revoked", (event: { reason: string; by?: Closed["by"] }) => {
      showClosed({
        code: event.reason === "new_login" ? "session_revoked" : event.reason === "suspended" ? "account_unavailable" : "session_closed",
        reason: event.reason,
        by: event.by,
        at: new Date().toISOString(),
      });
    });
    socket.on("contacts:changed", () => setContactsVersion((v) => v + 1));
    // Chat events go to the open screens; anything that changes the list reloads it
    for (const event of CHAT_EVENTS) {
      socket.on(event, (payload: unknown) => {
        live.dispatch(event, payload);
        if (event !== "typing" && event !== "msg:status") setContactsVersion((v) => v + 1);
      });
    }
    live.attach(socket);
    // Missed events while offline: the list and the open chat reload on every reconnect
    socket.on("connect", catchUp);
    // Refused by the server: a closed session shows why; anything else tries again (Socket.IO doesn't on its own)
    let retry: ReturnType<typeof setTimeout> | undefined;
    socket.on("connect_error", (err: Error & { data?: Partial<Closed> }) => {
      if (err.message === "unauthorized" && err.data?.reason) return showClosed({ code: "session_revoked", ...err.data });
      if (err.message === "unauthorized" && !socket.active) {
        clearTimeout(retry);
        retry = setTimeout(() => socket.connect(), 3000);
      }
    });
    return () => {
      clearTimeout(retry);
      live.attach(null);
      document.removeEventListener("visibilitychange", onVisibility);
      removeAppState();
      socket.close();
    };
  }, [signedIn, showClosed, showBanner, openTarget]);

  // Taps on browser or phone notifications
  useEffect(() => onNotificationTap(openTarget), [openTarget]);

  // Once per sign-in: this device's encryption identity, and its keys for every open chat
  const userId = user?.id;
  useEffect(() => {
    if (!signedIn || !userId) return;
    void prepareDevice(userId).catch(() => {});
    void syncNotifications();
  }, [signedIn, userId]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    tokenStore.clear();
    setUser(null);
    setScreen({ name: "login" });
  }

  const toLogin = (notice?: string) => setScreen({ name: "login", notice });
  const home = useCallback(() => setScreen({ name: "home" }), []);

  // Android back button: go up one screen; on a top screen, leave the app as usual.
  useEffect(() => {
    if (!isNativeApp) return;
    let remove = () => {};
    void import("@capacitor/app").then(({ App: NativeApp }) =>
      NativeApp.addListener("backButton", () => {
        const parent = parentScreen(screenRef.current);
        if (parent) setScreen(parent);
        else void NativeApp.exitApp();
      }).then((handle) => (remove = () => void handle.remove())),
    );
    return () => remove();
  }, []);

  return (
    <>
      {page()}
      <Banners banners={banners} onDismiss={dismissBanner} />
    </>
  );

  function page() {
    switch (screen.name) {
      case "loading":
        return <main className="bg-grid min-h-dvh" aria-busy="true" />;
      case "login":
        return (
          <LoginPage
            notice={screen.notice}
            onChallenge={(challenge) => setScreen({ name: "code", challenge })}
            onPending={(username) => setScreen({ name: "pending", username })}
            onSignUp={() => setScreen({ name: "signup" })}
            onAdminReset={() => setScreen({ name: "adminReset" })}
          />
        );
      case "signup":
        return <SignUpPage onDone={(username) => setScreen({ name: "pending", username })} onBack={() => toLogin()} />;
      case "pending":
        return <PendingPage username={screen.username} onBack={() => toLogin()} />;
      case "code":
        return (
          <CodePage
            challenge={screen.challenge}
            onSignedIn={enter}
            onUsePasscode={() => setScreen({ name: "passcode", challenge: screen.challenge })}
            onRestart={toLogin}
          />
        );
      case "passcode":
        return (
          <PasscodePage
            challenge={screen.challenge}
            onSignedIn={(u) => enter(u)}
            onBack={() => setScreen({ name: "code", challenge: screen.challenge })}
            onRestart={toLogin}
          />
        );
      case "adminReset":
        return <AdminResetPage onSignedIn={(u) => enter(u)} onBack={() => toLogin()} />;
      case "reset":
        return user ? <ResetPage user={user} onDone={(u) => enter(u)} onSignOut={signOut} /> : null;
      case "home":
        return (
          <ContactsPage
            lastLogin={lastLogin}
            version={contactsVersion}
            onMyId={() => setScreen({ name: "myId" })}
            onAdd={() => setScreen({ name: "add" })}
            onOpen={(contact) => setScreen({ name: "contact", contact })}
            onOpenChat={(chatId) => setScreen({ name: "chat", chatId })}
            onSettings={() => setScreen({ name: "settings" })}
            onGetApp={() => setScreen({ name: "settings", focus: "app" })}
            onAuthError={handleAuthError}
          />
        );
      case "myId":
        return <MyIdPage onBack={home} onAuthError={handleAuthError} />;
      case "add":
        return (
          <AddContactPage
            initialId={screen.initialId}
            onBack={home}
            onAdded={(contact) => setScreen({ name: "contact", contact })}
            onAuthError={handleAuthError}
          />
        );
      case "contact":
        return user ? (
          <ContactPage
            contact={screen.contact}
            userId={user.id}
            version={contactsVersion}
            onBack={home}
            onChat={(chatId) => setScreen({ name: "chat", chatId })}
            onAuthError={handleAuthError}
          />
        ) : null;
      case "chat":
        return user ? (
          <ChatPage
            key={screen.chatId}
            chatId={screen.chatId}
            userId={user.id}
            onBack={home}
            onClosed={(text) => {
              closedHere.current.set(`chat:${screen.chatId}`, Date.now());
              home();
              showBanner({ tag: `chat:${screen.chatId}`, title: "Chat closed", body: text });
            }}
            onSafety={(chat) => setScreen({ name: "safety", chat })}
            onAuthError={handleAuthError}
          />
        ) : null;
      case "safety":
        return user ? <SafetyPage chat={screen.chat} userId={user.id} onBack={() => setScreen({ name: "chat", chatId: screen.chat.id })} /> : null;
      case "settings":
        return user ? (
          <SettingsPage user={user} focusApp={screen.focus === "app"} onBack={home} onSecurityLog={() => setScreen({ name: "security" })} onSignOut={signOut} />
        ) : null;
      case "security":
        return <SecurityLogPage onBack={() => setScreen({ name: "settings" })} onAuthError={handleAuthError} />;
      case "closed":
        return <ClosedPage closed={screen.closed} onSignIn={() => toLogin()} />;
    }
  }
}

/** Where the Android back button leads from each screen (null = leave the app). */
function parentScreen(screen: Screen): Screen | null {
  switch (screen.name) {
    case "myId":
    case "add":
    case "contact":
    case "settings":
    case "chat":
      return { name: "home" };
    case "safety":
      return { name: "chat", chatId: screen.chat.id };
    case "security":
      return { name: "settings" };
    case "signup":
    case "pending":
    case "adminReset":
    case "code":
      return { name: "login" };
    case "passcode":
      return { name: "code", challenge: screen.challenge };
    default:
      return null;
  }
}
