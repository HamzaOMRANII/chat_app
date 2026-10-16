import type { Contact } from "../lib/contacts";

export type User = { id: string; username: string; email: string; mustReset: boolean };

export type LastLogin = { at: string; deviceName?: string; city?: string; country?: string } | null;

/** Why this device's session ended, and (for a new sign-in) where it came from. */
export type Closed = {
  code: "session_revoked" | "session_closed" | "account_unavailable" | "session_expired";
  at?: string;
  reason?: string;
  by?: { name?: string; city?: string; country?: string };
};

export type Challenge = { challengeId: string; emailHint: string; username: string };

export type Screen =
  | { name: "loading" }
  | { name: "login"; notice?: string }
  | { name: "signup" }
  | { name: "pending"; username: string }
  | { name: "code"; challenge: Challenge }
  | { name: "passcode"; challenge: Challenge }
  | { name: "adminReset" }
  | { name: "reset" }
  | { name: "home" }
  | { name: "myId" }
  | { name: "add"; initialId?: string }
  | { name: "contact"; contact: Contact }
  | { name: "settings" }
  | { name: "security" }
  | { name: "closed"; closed: Closed };

export function place(city?: string, country?: string) {
  return [city, country].filter(Boolean).join(", ") || "unknown location";
}

export function when(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `today ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
