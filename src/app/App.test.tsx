import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

const socketHandlers: Record<string, (arg: unknown) => void> = {};
vi.mock("socket.io-client", () => ({
  io: () => ({ on: (event: string, fn: (arg: unknown) => void) => (socketHandlers[event] = fn), emit: () => {}, close: () => {} }),
}));

// libsodium can't run in jsdom (separate realm); the real crypto is covered by lib/e2e.test.ts.
// Here: a transparent stand-in so the screens can be exercised end to end.
vi.mock("../lib/e2e", () => ({
  identity: async (_u: string, deviceId: string) => ({ deviceId, signPub: "I".repeat(43) + "=", signSec: "s" }),
  newChatKey: async () => ({ pub: "P".repeat(43) + "=", sig: "S".repeat(86) + "==", secret: "x" }),
  keepChatKey: () => {},
  hasChatKey: () => true,
  forgetChat: () => {},
  forgetChatsExcept: () => {},
  verifyKey: async () => true,
  encryptMessage: async ({ plain, myKey, theirKey }: { plain: { t: string }; myKey: { version: number }; theirKey: { version: number } }) => ({
    ciphertext: btoa(JSON.stringify(plain)),
    nonce: "N".repeat(32),
    senderKeyVersion: myKey.version,
    recipientKeyVersion: theirKey.version,
  }),
  decryptMessage: async ({ ciphertext }: { ciphertext: string }) => (ciphertext === "LOCKED" ? null : JSON.parse(atob(ciphertext))),
  safetyCode: async () => Array.from({ length: 12 }, (_, i) => String(10000 + i)),
  safetyChecked: () => null,
  markSafetyChecked: () => {},
}));

type Route = (body: Record<string, unknown>) => [number, Record<string, unknown>];
let routes: Record<string, Route>;
const calls: { path: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  routes = {
    "/api/auth/me": () => [401, { error: "Sign in to continue", code: "unauthorized" }],
    "/download/latest.json": () => [404, {}],
    "/api/contacts": () => [200, { contacts: [], incoming: [], outgoing: [] }],
    "/api/chats": () => [200, { chats: [] }],
    "/api/keys/identity": () => [200, { changed: false }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      const [status, data] = routes[path]?.(body) ?? [404, { error: "Not found" }];
      return new Response(JSON.stringify(data), { status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("H_CHAT sign-in flow", () => {
  it("signs in with password and email code, then shows the last sign-in", async () => {
    routes["/api/auth/login"] = () => [200, { challengeId: "c".repeat(24), emailHint: "h•••a@example.com" }];
    routes["/api/auth/verify-code"] = (body) =>
      body.code === "123456"
        ? [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: false }, lastLogin: { at: new Date().toISOString(), deviceName: "Old laptop", country: "FR" } }]
        : [400, { error: "Wrong code. 4 attempts left.", code: "wrong_code", details: { attemptsLeft: 4 } }];

    render(<App />);
    await screen.findByLabelText("Username or email");
    type("Username or email", "Hamza");
    type("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    const login = calls.find((c) => c.path === "/api/auth/login")!;
    expect(login.body.username).toBe("hamza");
    expect((login.body.device as { deviceId: string }).deviceId).toMatch(/[0-9a-f-]{36}/);

    "123456".split("").forEach((d, i) => type(`Digit ${i + 1}`, d));
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    expect(screen.getByText("Old laptop")).toBeInTheDocument();
  });

  it("shows the waiting screen for an account that isn't approved yet", async () => {
    routes["/api/auth/login"] = () => [403, { error: "Your account is waiting for approval.", code: "pending" }];
    render(<App />);
    await screen.findByLabelText("Username or email");
    type("Username or email", "leila.b");
    type("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
  });

  it("sends a complete sign-up and refuses mismatched passcodes", async () => {
    routes["/api/auth/signup"] = (body) => [201, { status: "pending", username: body.username }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Request access" }));
    type("Username", "leila.b");
    type(/Email/, "leila@example.com");
    type("Password", "correct horse battery");
    type(/Recovery passcode/, "12345678");
    type("Repeat the passcode", "12345679");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Request access" }).closest("form")!);
    expect(await screen.findByText("The two passcodes don't match.")).toBeInTheDocument();

    type("Repeat the passcode", "12345678");
    fireEvent.submit(screen.getByRole("button", { name: "Request access" }).closest("form")!);
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/auth/signup")!.body).toMatchObject({ username: "leila.b", passcode: "12345678", privacyAccepted: true });
  });

  it("forces new credentials after a recovery passcode sign-in", async () => {
    routes["/api/auth/login"] = () => [200, { challengeId: "c".repeat(24), emailHint: "h•••a@example.com" }];
    routes["/api/auth/verify-passcode"] = () => [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: true } }];
    render(<App />);
    await screen.findByLabelText("Username or email");
    type("Username or email", "hamza");
    type("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use recovery passcode" }));
    type("Passcode", "12345678");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Secure your account")).toBeInTheDocument();
  });

  it("shows where the account signed in when this device gets replaced", async () => {
    routes["/api/auth/me"] = () => [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: false }, lastLogin: null }];
    render(<App />);
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    await waitFor(() => expect(socketHandlers["session:revoked"]).toBeDefined());
    socketHandlers["session:revoked"]!({ reason: "new_login", by: { name: "Galaxy S23", city: "Paris", country: "FR" } });
    expect(await screen.findByText("You were signed in on another device")).toBeInTheDocument();
    expect(screen.getByText("Galaxy S23")).toBeInTheDocument();
    expect(screen.getByText("Paris, FR")).toBeInTheDocument();
  });
});

describe("contacts", () => {
  const signedIn = () => {
    routes["/api/auth/me"] = () => [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: false } }];
  };

  it("lists contacts and requests, accepts a request, and reloads when the server says so", async () => {
    signedIn();
    let accepted = false;
    routes["/api/contacts"] = () => [
      200,
      {
        contacts: [
          { id: "u1", username: "youssef.k", online: true, lastSeenAt: null, since: "2026-10-12T10:00:00Z", via: "id" },
          ...(accepted ? [{ id: "u2", username: "sara.m", online: false, lastSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString(), since: "2026-10-16T10:00:00Z", via: "id" }] : []),
        ],
        incoming: accepted ? [] : [{ id: "r1", username: "sara.m", at: new Date().toISOString() }],
        outgoing: [{ id: "r2", username: "nadia.s", at: new Date().toISOString() }],
      },
    ];
    routes["/api/contacts/requests/r1/accept"] = () => {
      accepted = true;
      return [200, { ok: true }];
    };
    render(<App />);
    expect(await screen.findByText("requests · 2")).toBeInTheDocument();
    expect(screen.getByText("youssef.k")).toBeInTheDocument();
    expect(screen.getByText("1 online")).toBeInTheDocument();
    expect(screen.getByText("you asked · waiting")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("last seen 2h ago")).toBeInTheDocument();
    expect(screen.getByText("requests · 1")).toBeInTheDocument();

    const before = calls.filter((c) => c.path === "/api/contacts").length;
    socketHandlers["contacts:changed"]?.(undefined);
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/contacts").length).toBe(before + 1));
  });

  it("adds by ID and shows the same answer for any failure", async () => {
    signedIn();
    routes["/api/contacts/me"] = () => [200, { personalId: "HC-4KX7-92QM", invite: null, searchesLeft: 10 }];
    routes["/api/contacts/add"] = (body) =>
      body.personalId === "HC-7RT2-K4PW"
        ? [200, { status: "requested", username: "leila.b", searchesLeft: 9 }]
        : [404, { error: "No one found with this ID. Check it with the person.", code: "not_found", details: { searchesLeft: 8 } }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add contact" }));
    expect(await screen.findByText(/10 of 10 searches left/)).toBeInTheDocument();

    type("Their ID", "HC-7RT2-K4PW");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("leila.b")).toBeInTheDocument();
    expect(screen.getByText(/9 of 10 searches left/)).toBeInTheDocument();

    type("Their ID", "HC-2222-2222");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("No one found with this ID. Check it with the person.")).toBeInTheDocument();
    expect(screen.getByText(/8 of 10 searches left/)).toBeInTheDocument();
  });

  it("shows my ID with a QR code and creates an invite code", async () => {
    signedIn();
    routes["/api/contacts/me"] = () => [200, { personalId: "HC-4KX7-92QM", invite: null, searchesLeft: 10 }];
    routes["/api/contacts/invite"] = () => [200, { code: "K7Q2-M9XA", expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "My ID and invite codes" }));
    expect(await screen.findByText("HC-4KX7-92QM")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code of your ID" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create invite code" }));
    expect(await screen.findByText("K7Q2-M9XA")).toBeInTheDocument();
    expect(screen.getByText(/^2[34]h \d\dm left$/)).toBeInTheDocument();
  });
});

describe("QR link", () => {
  it("opens Add contact with the ID from a scanned My ID link, after sign-in", async () => {
    routes["/api/auth/me"] = () => [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: false } }];
    routes["/api/contacts/me"] = () => [200, { personalId: "HC-4KX7-92QM", invite: null, searchesLeft: 10 }];
    history.replaceState(null, "", "/#add=HC-7RT2-K4PW");
    vi.resetModules();
    const { App: FreshApp } = await import("./App");
    render(<FreshApp />);
    expect(await screen.findByDisplayValue("HC-7RT2-K4PW")).toBeInTheDocument();
    expect(location.hash).toBe("");
    expect(screen.getByText(/Check the ID from the QR code/)).toBeInTheDocument();
  });
});

describe("scanned text", () => {
  it("reads the ID from the link or a plain ID, and nothing else", async () => {
    const { personalIdFromScan, addContactLink } = await import("../lib/contacts");
    expect(personalIdFromScan(addContactLink("HC-4KX7-92QM"))).toBe("HC-4KX7-92QM");
    expect(personalIdFromScan("hc-4kx7-92qm")).toBe("HC-4KX7-92QM");
    expect(personalIdFromScan("https://evil.example/#add=HC-4KX7-92QM-extra")).toBeNull();
    expect(personalIdFromScan("hello")).toBeNull();
  });
});

describe("Android app download", () => {
  it("is one tap away in the signed-in web app", async () => {
    routes["/api/auth/me"] = () => [200, { user: { id: "1", username: "hamza", email: "hamza@example.com", mustReset: false } }];
    routes["/download/latest.json"] = () => [200, { version: "0.3.2", versionCode: 302, file: "h_chat-0.3.2.apk", size: 5_800_000, sha256: "ab".repeat(32), date: "2026-10-16" }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Get the Android app" }));
    expect(await screen.findByText(/v0\.3\.2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download/h_chat-0.3.2.apk");
  });
});

describe("stored chats", () => {
  const me = { id: "1".repeat(24), username: "hamza", email: "hamza@example.com", mustReset: false };
  const leila = { id: "2".repeat(24), username: "leila.b", online: true, lastSeenAt: null, identityPub: "I".repeat(43) + "=" };
  const key = (userId: string) => ({ userId, version: 1, pub: "P".repeat(43) + "=", sig: "S".repeat(86) + "==", identityPub: "I".repeat(43) + "=" });
  const enc = (t: string) => btoa(JSON.stringify({ t }));
  const wire = (id: string, senderId: string, text: string, extra: Record<string, unknown> = {}) => ({
    id,
    senderId,
    ciphertext: text === "LOCKED" ? "LOCKED" : enc(text),
    nonce: "N".repeat(32),
    senderKeyVersion: 1,
    recipientKeyVersion: 1,
    sentAt: new Date(Date.now() - 60_000).toISOString(),
    deliveredAt: null,
    readAt: null,
    expiresAt: new Date(Date.now() + 2 * 864e5 + 4 * 36e5).toISOString(),
    ...extra,
  });
  const chat = (over: Record<string, unknown> = {}) => ({
    id: "c".repeat(24),
    with: leila,
    mode: "keep",
    retentionMinutes: 4320,
    status: "active",
    createdByMe: false,
    invitedAt: new Date().toISOString(),
    inviteExpiresAt: null,
    acceptedAt: new Date().toISOString(),
    lastMessageAt: null,
    unread: 0,
    keys: [key(me.id), key(leila.id)],
    ...over,
  });

  beforeEach(() => {
    routes["/api/auth/me"] = () => [200, { user: me }];
    routes["/api/contacts"] = () => [200, { contacts: [{ id: leila.id, username: "leila.b", online: true, lastSeenAt: null, since: new Date().toISOString(), via: "invite" }], incoming: [], outgoing: [] }];
  });

  it("accepts an invitation, reads, sends, and follows the chat live", async () => {
    let status = "invited";
    const posted: Record<string, unknown>[] = [];
    routes["/api/chats"] = () => [200, { chats: [chat({ status, keys: status === "invited" ? [key(leila.id)] : [key(me.id), key(leila.id)] })] }];
    routes[`/api/chats/${"c".repeat(24)}`] = () => [200, { chat: chat({ status, keys: status === "invited" ? [key(leila.id)] : [key(me.id), key(leila.id)] }) }];
    routes[`/api/chats/${"c".repeat(24)}/accept`] = () => {
      status = "active";
      return [200, { chat: chat() }];
    };
    routes[`/api/chats/${"c".repeat(24)}/receipts`] = () => [200, { delivered: 1, read: 1 }];
    routes[`/api/chats/${"c".repeat(24)}/messages`] = (body) => {
      if (body.ciphertext) {
        posted.push(body);
        return [201, { message: wire("m9", me.id, "ignored", { ...body }) }];
      }
      return [200, { messages: [wire("m0", leila.id, "LOCKED"), wire("m1", leila.id, "Sent the contract, check it before Friday")] }];
    };

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b wants to chat/ }));
    expect(await screen.findByText(/a Keep-alive chat: each message is deleted 3 days after it's sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByText("Sent the contract, check it before Friday")).toBeInTheDocument();
    expect(screen.getByText(/1 earlier message was sent to your other device/)).toBeInTheDocument();
    expect(screen.getByText(/deleted in 2d 0[34]h/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/receipts"))).toBe(true));

    type("Message", "Read it. Two changes on page 4.");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Read it. Two changes on page 4.")).toBeInTheDocument();
    expect(posted[0]).toMatchObject({ senderKeyVersion: 1, recipientKeyVersion: 1 });
    expect(posted[0]).not.toHaveProperty("text");

    socketHandlers["typing"]?.({ chatId: "c".repeat(24) });
    expect(await screen.findByText("leila.b is typing…")).toBeInTheDocument();
    socketHandlers["msg:new"]?.({ chatId: "c".repeat(24), message: wire("m2", leila.id, "Can you send the signed copy?") });
    expect(await screen.findByText("Can you send the signed copy?")).toBeInTheDocument();
    socketHandlers["msg:status"]?.({ chatId: "c".repeat(24), delivered: [], read: ["m9"], at: new Date().toISOString() });
    expect(await screen.findByText(/✓✓ read/)).toBeInTheDocument();

    // Ended: back to the list at once, with a banner saying why
    routes["/api/chats"] = () => [200, { chats: [] }];
    socketHandlers["chat:ended"]?.({ chatId: "c".repeat(24), reason: "ended_by_user", by: leila.id });
    expect(await screen.findByText("Chat ended by leila.b. All messages were deleted.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Add contact" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End chat" })).toBeNull();
  });

  it("after a reconnect, the open chat shows the messages it missed", async () => {
    let wireList = [wire("m1", leila.id, "First")];
    routes["/api/chats"] = () => [200, { chats: [chat()] }];
    routes[`/api/chats/${"c".repeat(24)}`] = () => [200, { chat: chat() }];
    routes[`/api/chats/${"c".repeat(24)}/receipts`] = () => [200, { delivered: 0, read: 0 }];
    routes[`/api/chats/${"c".repeat(24)}/messages`] = () => [200, { messages: wireList }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    expect(await screen.findByText("First")).toBeInTheDocument();

    // Sent while this phone's connection was down: no live event ever came
    wireList = [...wireList, wire("m2", leila.id, "Sent while you were offline")];
    socketHandlers["connect"]!(undefined);
    expect(await screen.findByText("Sent while you were offline")).toBeInTheDocument();
  });

  it("shows a banner for each event and opens what it's about; an accepted chat opens by itself", async () => {
    routes["/api/chats"] = () => [200, { chats: [chat({ status: "invited", createdByMe: true, keys: [key(me.id)] })] }];
    routes[`/api/chats/${"c".repeat(24)}`] = () => [200, { chat: chat() }];
    routes[`/api/chats/${"c".repeat(24)}/messages`] = () => [200, { messages: [] }];
    render(<App />);
    expect(await screen.findByRole("button", { name: "Add contact" })).toBeInTheDocument();
    await waitFor(() => expect(socketHandlers["notify"]).toBeDefined());

    socketHandlers["notify"]!({ kind: "contact_request", title: "rami.t", body: "wants to connect with you", tag: "contact:r", open: {}, system: true });
    expect(await screen.findByText("wants to connect with you")).toBeInTheDocument();

    // leila accepts my invitation: the chat opens without a tap
    socketHandlers["chat:accepted"]!({ chatId: "c".repeat(24), by: leila.id });
    expect(await screen.findByText("No messages yet. Say hello.")).toBeInTheDocument();

    // A message in another chat: banner; in this one: nothing extra
    socketHandlers["notify"]!({ kind: "message", title: "leila.b", body: "New message", tag: `chat:${"c".repeat(24)}`, open: { chatId: "c".repeat(24) }, system: true });
    socketHandlers["notify"]!({ kind: "message", title: "rami.t", body: "New message", tag: `chat:${"d".repeat(24)}`, open: { chatId: "d".repeat(24) }, system: true });
    expect(await screen.findAllByText("New message")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /rami\.t\s*New message/ })).toBeInTheDocument();
  });

  it("starts a chat with only the allowed modes, then waits for acceptance", async () => {
    let invited = false;
    routes["/api/chats"] = (body) => {
      if (body.mode) {
        invited = true;
        return [201, { chat: chat({ status: "invited", createdByMe: true, mode: body.mode, retentionMinutes: body.retentionMinutes, keys: [key(me.id)] }) }];
      }
      return [200, { chats: invited ? [chat({ status: "invited", createdByMe: true, retentionMinutes: 30, keys: [key(me.id)] })] : [] }];
    };
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 3, auto: false, live: false } }];
    routes[`/api/chats/${"c".repeat(24)}`] = () => [200, { chat: chat({ status: "invited", createdByMe: true, retentionMinutes: 30, keys: [key(me.id)] }) }];
    routes[`/api/contacts/${leila.id}`] = () => [200, { contact: { id: leila.id, username: "leila.b", online: true, lastSeenAt: null, since: new Date().toISOString(), via: "invite" } }];

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start chat" }));
    expect(await screen.findByText("Keep-alive")).toBeInTheDocument();
    expect(screen.queryByText("Automatic")).toBeNull(); // not allowed by this pair's rules
    // From 30 minutes up to this pair's 3 days
    expect(screen.getByText("30 minutes")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("How long messages stay"), { target: { value: "0" } });
    expect(screen.getByText("KEEP · 30M")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send chat invitation" }));

    expect(await screen.findByText("Waiting for leila.b")).toBeInTheDocument();
    expect(screen.getByText(/each message is deleted 30 minutes after it's sent/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/chats" && c.body.mode)!.body).toMatchObject({ userId: leila.id, mode: "keep", retentionMinutes: 30 });
  });
});
