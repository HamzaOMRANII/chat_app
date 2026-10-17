import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";

const socketHandlers: Record<string, (arg: unknown) => void> = {};
const emitted: { event: string; payload: unknown }[] = [];
vi.mock("socket.io-client", () => ({
  io: () => ({
    connected: true,
    on: (event: string, fn: (arg: unknown) => void) => (socketHandlers[event] = fn),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    close: () => {},
  }),
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
  sealLive: async ({ plain }: { plain: unknown }) => ({ nonce: "N".repeat(32), ct: btoa(JSON.stringify(plain)) }),
  openLive: async ({ ct }: { ct: string }) => JSON.parse(atob(ct)),
  newFileKey: async () => "K".repeat(43) + "=",
  sealPiece: async (_k: string, _id: string, _n: number, _c: number, data: Uint8Array) => new Uint8Array(data.length + 40),
  openPiece: async (_k: string, _id: string, _n: number, _c: number, sealed: Uint8Array) => sealed.subarray(40),
}));

type Route = (body: Record<string, unknown>) => [number, Record<string, unknown>];
let routes: Record<string, Route>;
const calls: { path: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  emitted.length = 0;
  routes = {
    "/api/auth/me": () => [401, { error: "Sign in to continue", code: "unauthorized" }],
    "/download/latest.json": () => [404, {}],
    "/api/contacts": () => [200, { contacts: [], incoming: [], outgoing: [] }],
    "/api/chats": () => [200, { chats: [] }],
    "/api/live": () => [200, { live: [] }],
    "/api/media": () => [200, { used: 0, files: 0, limit: 2 * 1024 ** 3, maxFile: 100 * 1024 ** 2, request: null, chats: [] }],
    "/api/keys/identity": () => [200, { changed: false }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ? { bytes: (init.body as Uint8Array).length } : {};
      calls.push({ path, body });
      const fallback = (): [number, Record<string, unknown>] =>
        /^\/api\/chats\/[a-f0-9]{24}\/files$/.test(path)
          ? [200, { files: [] }]
          : /^\/api\/chats\/[a-f0-9]{24}\/exports$/.test(path)
            ? [200, { exports: [] }]
            : [404, { error: "Not found" }];
      const [status, data] = routes[path]?.(body) ?? fallback();
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

  it("shows ✓✓ read even when the read receipt arrives before the server's answer to the send", async () => {
    routes["/api/chats"] = () => [200, { chats: [chat()] }];
    routes[`/api/chats/${"c".repeat(24)}`] = () => [200, { chat: chat() }];
    routes[`/api/chats/${"c".repeat(24)}/receipts`] = () => [200, { delivered: 0, read: 0 }];
    routes[`/api/chats/${"c".repeat(24)}/messages`] = (body) => {
      if (!body.ciphertext) return [200, { messages: [] }];
      // leila has the chat open too: her read receipt beats the answer to my send
      socketHandlers["msg:status"]!({ chatId: "c".repeat(24), delivered: [], read: ["m9"], at: new Date().toISOString() });
      return [201, { message: wire("m9", me.id, "ignored", { ...body }) }];
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    expect(await screen.findByText("No messages yet. Say hello.")).toBeInTheDocument();
    type("Message", "Are you there?");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Are you there?")).toBeInTheDocument();
    expect(await screen.findByText(/✓✓ read/)).toBeInTheDocument();
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

describe("live chats", () => {
  const me = { id: "1".repeat(24), username: "hamza", email: "hamza@example.com", mustReset: false };
  const leila = { id: "2".repeat(24), username: "leila.b", online: true, identityPub: "I".repeat(43) + "=" };
  const key = (userId: string) => ({ userId, pub: "P".repeat(43) + "=", sig: "S".repeat(86) + "==", identityPub: "I".repeat(43) + "=" });
  const id = "d".repeat(24);
  const session = (over: Record<string, unknown> = {}) => ({
    id,
    with: leila,
    status: "invited",
    createdByMe: false,
    invitedAt: new Date().toISOString(),
    inviteExpiresAt: new Date(Date.now() + 4 * 60_000 + 12_000).toISOString(),
    startedAt: null,
    waitingFor: null,
    keys: [key(leila.id)],
    ...over,
  });
  const sealed = (plain: object) => ({ sessionId: id, nonce: "N".repeat(32), ct: btoa(JSON.stringify(plain)) });

  beforeEach(() => {
    routes["/api/auth/me"] = () => [200, { user: me }];
    routes["/api/contacts"] = () => [200, { contacts: [{ id: leila.id, username: "leila.b", online: true, lastSeenAt: null, since: new Date().toISOString(), via: "invite" }], incoming: [], outgoing: [] }];
  });

  it("shows the invitation with its 5-minute countdown, goes live, and shows each other's typing", async () => {
    let status = "invited";
    routes["/api/live"] = () => [200, { live: [status === "invited" ? session() : session({ status: "active", startedAt: new Date().toISOString(), inviteExpiresAt: null, keys: [key(me.id), key(leila.id)] })] }];
    routes[`/api/live/${id}/accept`] = () => {
      status = "active";
      return [200, { live: session({ status: "active", startedAt: new Date().toISOString(), inviteExpiresAt: null, keys: [key(me.id), key(leila.id)] }) }];
    };
    routes[`/api/live/${id}`] = () => [200, { ok: true }];

    render(<App />);
    expect(await screen.findByText("wants to chat live")).toBeInTheDocument();
    expect(screen.getByText(/^4:1\d left$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /wants to chat live/ }));
    expect(await screen.findByText("leila.b wants to chat live")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(await screen.findByText(/nothing is stored · wiped when either of you leaves/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === `/api/live/${id}/accept`)!.body.key).toBeTruthy();

    // Their draft appears letter by letter, corrections included; a finished line stays
    await waitFor(() => expect(screen.getByLabelText("Live message")).not.toBeDisabled());
    socketHandlers["live"]!(sealed({ t: "draft", text: "Total is 4", n: 1 }));
    expect(await screen.findByText("leila.b is typing live")).toBeInTheDocument();
    socketHandlers["live"]!(sealed({ t: "draft", text: "Total is", n: 2 }));
    await screen.findByText("Total is");
    socketHandlers["live"]!(sealed({ t: "draft", text: "stale", n: 1 })); // out of order: ignored
    socketHandlers["live"]!(sealed({ t: "line", text: "Total is 42", n: 3 }));
    expect(await screen.findByText("Total is 42")).toBeInTheDocument();
    expect(screen.queryByText("leila.b is typing live")).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();

    // Mine goes out on every keystroke, encrypted
    type("Live message", "Perfect");
    await waitFor(() => expect(emitted.some((e) => e.event === "live")).toBe(true));
    const out = emitted.filter((e) => e.event === "live").at(-1)!.payload as { sessionId: string; ct: string };
    expect(out.sessionId).toBe(id);
    expect(JSON.parse(atob(out.ct))).toMatchObject({ t: "draft", text: "Perfect" });
    expect(screen.getByText(/your draft · leila.b sees it now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send the line" }));
    expect(await screen.findByText("Perfect")).toBeInTheDocument();

    // Their connection drops: writing pauses with the 30 s countdown; then it is wiped
    socketHandlers["live:peer"]!({ sessionId: id, online: false, deadline: Date.now() + 30_000 });
    expect(await screen.findByText(/connection dropped/)).toBeInTheDocument();
    expect(screen.getByLabelText("Live message")).toBeDisabled();
    socketHandlers["live:ended"]!({ sessionId: id, reason: "connection_lost", by: null });
    expect(await screen.findByText("Live chat with leila.b ended")).toBeInTheDocument();
    expect(screen.queryByText("Total is 42")).toBeNull();
  });

  it("starts a live chat from the contact, then waits for an answer", async () => {
    let invited = false;
    routes["/api/live"] = (body) => {
      if (body.userId) {
        invited = true;
        return [201, { live: session({ createdByMe: true, keys: [key(me.id)], inviteExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }) }];
      }
      return [200, { live: invited ? [session({ createdByMe: true, keys: [key(me.id)], inviteExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })] : [] }];
    };
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 7, auto: true, live: true } }];
    routes[`/api/contacts/${leila.id}`] = () => [200, { contact: { id: leila.id, username: "leila.b", online: true, lastSeenAt: null, since: new Date().toISOString(), via: "invite" } }];
    routes[`/api/live/${id}`] = () => [200, { ok: true }];

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start chat" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Live/ }));
    expect(screen.getByText("leila.b has 5 minutes to answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite to a live chat" }));
    expect(await screen.findByText("Waiting for leila.b")).toBeInTheDocument();
    expect(screen.getByText(/^(5:0\d|4:5\d)$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" }));
    expect(await screen.findByText("Live chat with leila.b ended")).toBeInTheDocument();
    expect(calls.some((c) => c.path === `/api/live/${id}`)).toBe(true);
  });

  it("starts a live chat from an open stored chat, next to it", async () => {
    const chatId = "c".repeat(24);
    const ck = (userId: string) => ({ ...key(userId), version: 1 });
    const stored = { id: chatId, with: { ...leila, lastSeenAt: null }, mode: "keep", retentionMinutes: 1440, status: "active", createdByMe: true, invitedAt: new Date().toISOString(), inviteExpiresAt: null, acceptedAt: new Date().toISOString(), lastMessageAt: null, unread: 0, keys: [ck(me.id), ck(leila.id)] };
    let invited = false;
    const waiting = () => session({ createdByMe: true, keys: [key(me.id)], inviteExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    routes["/api/chats"] = () => [200, { chats: [stored] }];
    routes[`/api/chats/${chatId}`] = () => [200, { chat: stored }];
    routes[`/api/chats/${chatId}/messages`] = () => [200, { messages: [], me: me.id }];
    routes[`/api/chats/${chatId}/receipts`] = () => [200, { delivered: 0, read: 0 }];
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 7, auto: true, live: true } }];
    routes["/api/live"] = (body) => {
      if (body.userId) {
        invited = true;
        return [201, { live: waiting() }];
      }
      return [200, { live: invited ? [waiting()] : [] }];
    };

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start a live chat" }));
    expect(await screen.findByRole("radio", { name: /Live/ })).toBeChecked();
    expect(screen.queryByText("Keep-alive")).toBeNull(); // the stored chat is already there
    fireEvent.click(screen.getByRole("button", { name: "Invite to a live chat" }));
    expect(await screen.findByText("Waiting for leila.b")).toBeInTheDocument();
  });

  it("sends a file encrypted in pieces, shows files and removed ones, and the admin's download request", async () => {
    const chatId = "c".repeat(24);
    const fileId = "f".repeat(24);
    const ck = (userId: string) => ({ ...key(userId), version: 1 });
    const stored = { id: chatId, with: { ...leila, lastSeenAt: null }, mode: "keep", retentionMinutes: 4320, status: "active", createdByMe: true, invitedAt: new Date().toISOString(), inviteExpiresAt: null, acceptedAt: new Date().toISOString(), lastMessageAt: null, unread: 0, keys: [ck(me.id), ck(leila.id)] };
    const wire = (id: string, plain: object) => ({ id, senderId: leila.id, ciphertext: btoa(JSON.stringify(plain)), nonce: "N".repeat(32), senderKeyVersion: 1, recipientKeyVersion: 1, sentAt: new Date().toISOString(), deliveredAt: null, readAt: null, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const doc = { id: "e".repeat(24), name: "contract.pdf", mime: "application/pdf", size: 18_600_000, key: "K", chunks: 5 };
    const secret = { id: "b".repeat(24), name: "notes.txt", mime: "text/plain", size: 900, key: "K", chunks: 1, view: true };
    const gone = { id: "a".repeat(24), name: "site-visit.mp4", mime: "video/mp4", size: 91_000_000, key: "K", chunks: 23 };
    routes["/api/media"] = () => [200, { used: 1_620_000_000, files: 23, limit: 2 * 1024 ** 3, maxFile: 100 * 1024 ** 2, request: { deadline: new Date(Date.now() + 3 * 864e5).toISOString() }, chats: [] }];
    routes["/api/chats"] = () => [200, { chats: [stored] }];
    routes[`/api/chats/${chatId}`] = () => [200, { chat: stored }];
    routes[`/api/chats/${chatId}/messages`] = (body) => (body.ciphertext ? [201, { message: { ...wire("m9", {}), senderId: me.id, id: "m9", fileId } }] : [200, { messages: [wire("m1", { t: "", f: doc }), wire("m2", { t: "", f: gone }), wire("m3", { t: "", f: secret })], me: me.id }]);
    routes[`/api/chats/${chatId}/receipts`] = () => [200, { delivered: 0, read: 0 }];
    routes[`/api/chats/${chatId}/files`] = (body) =>
      body.size
        ? [201, { file: { id: fileId, chunks: 1, chunkSize: 4 * 1024 * 1024 } }]
        : [200, { files: [{ id: doc.id, status: "ready" }, { id: gone.id, status: "deleted", deletedReason: "removed_by_admin" }, { id: secret.id, status: "ready" }] }];
    routes[`/api/files/${fileId}/chunks/0`] = () => [200, { received: 1, chunks: 1 }];
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 7, auto: true, live: true, files: "all", export: true } }];

    render(<App />);
    // The administrator's request, on the contacts list
    expect(await screen.findByText("Download your media")).toBeInTheDocument();
    expect(screen.getByText(/23 files/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    expect(await screen.findByText("contract.pdf")).toBeInTheDocument();
    expect(screen.getByText(/site-visit.mp4 · removed by an administrator/)).toBeInTheDocument();
    // A view-only file from leila: the page is protected and right-click is blocked on it
    const shared = screen.getByRole("button", { name: /Open notes.txt/ });
    expect(shared).toHaveAttribute("data-view-only");
    expect(document.documentElement).toHaveAttribute("data-protected");
    expect(fireEvent.contextMenu(shared)).toBe(false);
    expect(screen.getByText(/messages and files are deleted 3 days after they're sent/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "Attach a file" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Attach a file" }));
    expect(await screen.findByText("Send a file to leila.b")).toBeInTheDocument();
    // The sender decides: view only
    fireEvent.click(screen.getByRole("radio", { name: "View only" }));
    const picked = new File(["%PDF-1.4 signed"], "signed.pdf", { type: "application/pdf" });

    fireEvent.change(screen.getByLabelText("Choose documents"), { target: { files: [picked] } });
    await waitFor(() => expect(calls.some((c) => c.path === `/api/chats/${chatId}/messages` && c.body.fileId === fileId)).toBe(true));
    expect(calls.find((c) => c.path === `/api/chats/${chatId}/files` && c.body.size)!.body).toEqual({ kind: "document", size: picked.size });
    expect(calls.find((c) => c.path === `/api/files/${fileId}/chunks/0`)!.body).toEqual({ bytes: picked.size + 40 });
    const sentPlain = JSON.parse(atob(calls.find((c) => c.body.fileId === fileId)!.body.ciphertext as string));
    expect(sentPlain.f).toMatchObject({ id: fileId, name: "signed.pdf", mime: "application/pdf", chunks: 1, view: true });
    expect(await screen.findByText("signed.pdf")).toBeInTheDocument();
  });

  it("refuses files where the contact's rules don't allow them", async () => {
    const chatId = "c".repeat(24);
    const ck = (userId: string) => ({ ...key(userId), version: 1 });
    const stored = { id: chatId, with: { ...leila, lastSeenAt: null }, mode: "keep", retentionMinutes: 1440, status: "active", createdByMe: true, invitedAt: new Date().toISOString(), inviteExpiresAt: null, acceptedAt: new Date().toISOString(), lastMessageAt: null, unread: 0, keys: [ck(me.id), ck(leila.id)] };
    routes["/api/chats"] = () => [200, { chats: [stored] }];
    routes[`/api/chats/${chatId}`] = () => [200, { chat: stored }];
    routes[`/api/chats/${chatId}/messages`] = () => [200, { messages: [], me: me.id }];
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 3, auto: false, live: false, files: "none", export: false } }];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    expect(await screen.findByRole("button", { name: "Files aren't allowed with this contact" })).toBeDisabled();
  });

  it("asks to export, and the other side approves from the chat", async () => {
    const chatId = "c".repeat(24);
    const ck = (userId: string) => ({ ...key(userId), version: 1 });
    const stored = { id: chatId, with: { ...leila, lastSeenAt: null }, mode: "keep", retentionMinutes: 1440, status: "active", createdByMe: true, invitedAt: new Date().toISOString(), inviteExpiresAt: null, acceptedAt: new Date().toISOString(), lastMessageAt: null, unread: 0, keys: [ck(me.id), ck(leila.id)] };
    const request = (over: object) => ({ id: "e".repeat(24), chatId, requestedBy: leila.id, approverId: me.id, messages: true, media: true, period: "all", counts: { messages: 214, files: 23, bytes: 186e6 }, status: "pending", requestedAt: new Date().toISOString(), answeredAt: null, until: new Date(Date.now() + 23 * 3600_000).toISOString(), downloadedAt: null, ...over });
    let list = [request({})];
    routes["/api/chats"] = () => [200, { chats: [stored] }];
    routes[`/api/chats/${chatId}`] = () => [200, { chat: stored }];
    routes[`/api/chats/${chatId}/messages`] = () => [200, { messages: [], me: me.id }];
    routes[`/api/chats/${chatId}/exports`] = (body) => (body.period ? [201, { export: request({ requestedBy: me.id, approverId: leila.id, period: body.period, messages: body.messages, media: body.media }) }] : [200, { exports: list }]);
    routes[`/api/exports/${"e".repeat(24)}/approve`] = () => {
      list = [request({ status: "approved", answeredAt: new Date().toISOString() })];
      return [200, { export: list[0] }];
    };
    routes[`/api/chats/options/${leila.id}`] = () => [200, { options: { keepMaxDays: 7, auto: true, live: true, files: "all", export: true } }];

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /leila.b/ }));
    const card = await screen.findByRole("alert", { name: "Export request" });
    expect(card).toHaveTextContent("214 messages + 23 files · 177 MB · everything");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(true));
    expect(await screen.findByText(/leila.b can save the export for/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export this chat" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Last 7 days" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Export this chat" })).getByRole("checkbox", { name: /^Media/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask leila.b to approve" }));
    await waitFor(() => expect(calls.find((c) => c.path === `/api/chats/${chatId}/exports` && c.body.period)!.body).toEqual({ messages: true, media: false, period: "7d" }));
  });
});