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
    await screen.findByLabelText("Username");
    type("Username", "Hamza");
    type("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    const login = calls.find((c) => c.path === "/api/auth/login")!;
    expect(login.body.username).toBe("hamza");
    expect((login.body.device as { deviceId: string }).deviceId).toMatch(/[0-9a-f-]{36}/);

    "123456".split("").forEach((d, i) => type(`Digit ${i + 1}`, d));
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText("Hello, hamza")).toBeInTheDocument();
    expect(screen.getByText("Old laptop")).toBeInTheDocument();
  });

  it("shows the waiting screen for an account that isn't approved yet", async () => {
    routes["/api/auth/login"] = () => [403, { error: "Your account is waiting for approval.", code: "pending" }];
    render(<App />);
    await screen.findByLabelText("Username");
    type("Username", "leila.b");
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
    await screen.findByLabelText("Username");
    type("Username", "hamza");
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
    expect(await screen.findByText("Hello, hamza")).toBeInTheDocument();
    await waitFor(() => expect(socketHandlers["session:revoked"]).toBeDefined());
    socketHandlers["session:revoked"]!({ reason: "new_login", by: { name: "Galaxy S23", city: "Paris", country: "FR" } });
    expect(await screen.findByText("You were signed in on another device")).toBeInTheDocument();
    expect(screen.getByText("Galaxy S23")).toBeInTheDocument();
    expect(screen.getByText("Paris, FR")).toBeInTheDocument();
  });
});
