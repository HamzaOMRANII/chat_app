// @vitest-environment node
// libsodium checks byte arrays with instanceof, which jsdom's separate realm breaks: run in plain Node.
import { beforeEach, describe, expect, it } from "vitest";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;
import { decryptMessage, encryptMessage, forgetChat, newFileKey, openLive, openPiece, sealLive, sealPiece, identity, keepChatKey, newChatKey, safetyCode, verifyKey, type PublishedKey } from "./e2e";

beforeEach(() => localStorage.clear());

async function setup() {
  const idA = await identity("A", "device-a");
  const idB = await identity("B", "device-b");
  const a = await newChatKey(idA, "A", "B");
  const b = await newChatKey(idB, "B", "A");
  keepChatKey("A", "chat1", 1, a.secret);
  keepChatKey("B", "chat1", 1, b.secret);
  const keyA: PublishedKey = { userId: "A", version: 1, pub: a.pub, sig: a.sig, identityPub: idA.signPub };
  const keyB: PublishedKey = { userId: "B", version: 1, pub: b.pub, sig: b.sig, identityPub: idB.signPub };
  return { idA, idB, keyA, keyB };
}

describe("end-to-end encryption", () => {
  it("keeps the identity per device and signs chat keys with it", async () => {
    const first = await identity("A", "device-a");
    expect(await identity("A", "device-a")).toEqual(first);
    expect((await identity("A", "device-new")).signPub).not.toBe(first.signPub);

    const { keyA, keyB } = await setup();
    expect(await verifyKey(keyA, "B")).toBe(true);
    expect(await verifyKey({ ...keyA, pub: keyB.pub }, "B")).toBe(false); // a swapped key is caught
    expect(await verifyKey(keyA, "C")).toBe(false); // bound to the pair
  });

  it("encrypts on one side and decrypts on the other; anything altered fails", async () => {
    const { keyA, keyB } = await setup();
    const sent = await encryptMessage({ userId: "A", chatId: "chat1", myKey: keyA, theirKey: keyB, plain: { t: "Salam 👋" } });
    expect(sent.ciphertext).not.toContain("Salam");

    const open = (over: Partial<Parameters<typeof decryptMessage>[0]> = {}) =>
      decryptMessage({ userId: "B", chatId: "chat1", senderId: "A", myKey: keyB, theirKey: keyA, ...sent, ...over });
    expect(await open()).toEqual({ t: "Salam 👋" });
    // the sender reads their own message too
    expect(await decryptMessage({ userId: "A", chatId: "chat1", senderId: "A", myKey: keyA, theirKey: keyB, ...sent })).toEqual({ t: "Salam 👋" });

    expect(await open({ senderId: "B" })).toBeNull(); // claimed sender changed
    expect(await open({ chatId: "chat2" })).toBeNull(); // moved to another chat
    expect(await open({ ciphertext: sent.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A")) })).toBeNull();
  });

  it("can't open anything once the chat's keys are forgotten (chat ended)", async () => {
    const { keyA, keyB } = await setup();
    const sent = await encryptMessage({ userId: "A", chatId: "chat1", myKey: keyA, theirKey: keyB, plain: { t: "bye" } });
    forgetChat("B", "chat1");
    expect(await decryptMessage({ userId: "B", chatId: "chat1", senderId: "A", myKey: keyB, theirKey: keyA, ...sent })).toBeNull();
  });

  it("gives both sides the same 12-group safety code, and a new one for a new device", async () => {
    const { idA, idB } = await setup();
    const code = await safetyCode(idA.signPub, idB.signPub);
    expect(code).toHaveLength(12);
    expect(code.every((g) => /^\d{5}$/.test(g))).toBe(true);
    expect(await safetyCode(idB.signPub, idA.signPub)).toEqual(code);
    const moved = await identity("B", "device-b2");
    expect(await safetyCode(idA.signPub, moved.signPub)).not.toEqual(code);
  });
});

describe("live chat", () => {
  it("only the other side opens what is typed, and nothing goes to storage", async () => {
    const idA = await identity("A", "device-a");
    const idB = await identity("B", "device-b");
    const a = await newChatKey(idA, "A", "B");
    const b = await newChatKey(idB, "B", "A");
    const keyA: PublishedKey = { userId: "A", version: 1, pub: a.pub, sig: a.sig, identityPub: idA.signPub };
    const keyB: PublishedKey = { userId: "B", version: 1, pub: b.pub, sig: b.sig, identityPub: idB.signPub };
    const stored = memory.size;
    const sealed = await sealLive({ secret: a.secret, sessionId: "live1", userId: "A", myKey: keyA, theirKey: keyB, plain: { t: "draft", text: "hi" } as { t: string } });
    expect(memory.size).toBe(stored);
    expect(await openLive({ secret: b.secret, sessionId: "live1", senderId: "A", myKey: keyB, theirKey: keyA, ...sealed })).toMatchObject({ t: "draft", text: "hi" });
    // Another session, or a forged sender, doesn't open
    expect(await openLive({ secret: b.secret, sessionId: "live2", senderId: "A", myKey: keyB, theirKey: keyA, ...sealed })).toBeNull();
    expect(await openLive({ secret: b.secret, sessionId: "live1", senderId: "B", myKey: keyB, theirKey: keyA, ...sealed })).toBeNull();
  });
});

describe("files", () => {
  it("each piece opens only with its key, at its place, in its file", async () => {
    const key = await newFileKey();
    const data = new TextEncoder().encode("piece of a contract");
    const sealed = await sealPiece(key, "file1", 0, 2, data);
    expect(sealed.length).toBe(data.length + 40);
    expect(new TextDecoder().decode(await openPiece(key, "file1", 0, 2, sealed))).toBe("piece of a contract");
    await expect(openPiece(key, "file1", 1, 2, sealed)).rejects.toThrow(); // moved
    await expect(openPiece(key, "file2", 0, 2, sealed)).rejects.toThrow(); // other file
    await expect(openPiece(key, "file1", 0, 1, sealed)).rejects.toThrow(); // file cut short
    await expect(openPiece(await newFileKey(), "file1", 0, 2, sealed)).rejects.toThrow();
  });
});
