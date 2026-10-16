import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginPage } from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  it("shows the APK card when the server publishes a release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ version: "0.1.0", versionCode: 1, file: "h_chat-0.1.0.apk", size: 5 * 1024 * 1024, sha256: "ab", date: "2026-10-16" })),
      ),
    );
    render(<LoginPage />);
    expect(await screen.findByText(/h_chat\.apk · v0\.1\.0 · 5 MB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download/h_chat-0.1.0.apk");
  });

  it("hides the APK card when no release is published", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    render(<LoginPage />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Android app")).not.toBeInTheDocument();
  });

  it("explains that sign-in is not open yet", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "hamza" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in opens in the next release.");
  });
});
