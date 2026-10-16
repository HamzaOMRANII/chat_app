import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

const socketHandlers: Record<string, (arg: unknown) => void> = {};
vi.mock("socket.io-client", () => ({
  io: () => ({ on: (event: string, fn: (arg: unknown) => void) => (socketHandlers[event] = fn), close: () => {} }),
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
