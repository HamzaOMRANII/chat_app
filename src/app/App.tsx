import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { api, ApiError, tokenStore } from "../lib/api";
import { isNativeApp, SERVER_ORIGIN } from "../lib/platform";
import { AdminResetPage } from "../pages/AdminResetPage";
import { ClosedPage } from "../pages/ClosedPage";
import { CodePage } from "../pages/CodePage";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { PasscodePage } from "../pages/PasscodePage";
import { PendingPage } from "../pages/PendingPage";
import { ResetPage } from "../pages/ResetPage";
import { SecurityLogPage } from "../pages/SecurityLogPage";
import { SignUpPage } from "../pages/SignUpPage";
import type { Closed, LastLogin, Screen, User } from "./types";

const CLOSED_CODES = new Set(["session_revoked", "session_closed", "account_unavailable"]);

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [lastLogin, setLastLogin] = useState<LastLogin>(null);

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
    setScreen(u.mustReset ? { name: "reset" } : { name: "home" });
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

  // While signed in, listen for "signed in on another device" (and other session ends)
  const signedIn = screen.name === "home" || screen.name === "security";
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
      return user ? <HomePage user={user} lastLogin={lastLogin} onSecurityLog={() => setScreen({ name: "security" })} onSignOut={signOut} /> : null;
    case "security":
      return <SecurityLogPage onBack={() => setScreen({ name: "home" })} onAuthError={handleAuthError} />;
    case "closed":
      return <ClosedPage closed={screen.closed} onSignIn={() => toLogin()} />;
  }
}
