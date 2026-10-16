import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, ApiError, tokenStore } from "../lib/api";
import { isNativeApp, SERVER_ORIGIN } from "../lib/platform";
import { AdminResetPage } from "../pages/AdminResetPage";
import { ClosedPage } from "../pages/ClosedPage";
import { CodePage } from "../pages/CodePage";
import { AddContactPage } from "../pages/AddContactPage";
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
import { personalIdFromScan } from "../lib/contacts";
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

const SIGNED_IN_SCREENS = new Set<Screen["name"]>(["home", "myId", "add", "contact", "settings", "security"]);

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [lastLogin, setLastLogin] = useState<LastLogin>(null);
  // Bumped on "contacts:changed" so open contact screens reload
  const [contactsVersion, setContactsVersion] = useState(0);

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

  const enter = useCallback((u: User, last: LastLogin = null) => {
    setUser(u);
    setLastLogin(last);
    if (u.mustReset) return setScreen({ name: "reset" });
    const pendingAdd = takePendingAdd();
    setScreen(pendingAdd ? { name: "add", initialId: pendingAdd } : { name: "home" });
  }, []);

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
      auth: isNativeApp ? { token: tokenStore.get() } : {},
      transports: ["websocket"],
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
    // Missed events while offline: reload on every reconnect
    socket.on("connect", () => setContactsVersion((v) => v + 1));
    socket.on("connect_error", (err: Error & { data?: Partial<Closed> }) => {
      if (err.message === "unauthorized" && err.data?.reason) showClosed({ code: "session_revoked", ...err.data });
    });
    return () => {
      socket.close();
    };
  }, [signedIn, showClosed]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    tokenStore.clear();
    setUser(null);
    setScreen({ name: "login" });
  }

  const toLogin = (notice?: string) => setScreen({ name: "login", notice });
  const home = useCallback(() => setScreen({ name: "home" }), []);

  // Android back button: go up one screen; on a top screen, leave the app as usual.
  const screenRef = useRef(screen);
  screenRef.current = screen;
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
          onSettings={() => setScreen({ name: "settings" })}
          onAuthError={handleAuthError}
        />
      );
    case "myId":
      return <MyIdPage onBack={home} onAuthError={handleAuthError} />;
    case "add":
      return <AddContactPage initialId={screen.initialId} onBack={home} onAdded={(contact) => setScreen({ name: "contact", contact })} onAuthError={handleAuthError} />;
    case "contact":
      return <ContactPage contact={screen.contact} version={contactsVersion} onBack={home} onAuthError={handleAuthError} />;
    case "settings":
      return user ? <SettingsPage user={user} onBack={home} onSecurityLog={() => setScreen({ name: "security" })} onSignOut={signOut} /> : null;
    case "security":
      return <SecurityLogPage onBack={() => setScreen({ name: "settings" })} onAuthError={handleAuthError} />;
    case "closed":
      return <ClosedPage closed={screen.closed} onSignIn={() => toLogin()} />;
  }
}

/** Where the Android back button leads from each screen (null = leave the app). */
function parentScreen(screen: Screen): Screen | null {
  switch (screen.name) {
    case "myId":
    case "add":
    case "contact":
    case "settings":
      return { name: "home" };
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
