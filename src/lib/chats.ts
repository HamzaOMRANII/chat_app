import { api } from "./api";
import { deviceId } from "./device";
import { forgetChat, forgetChatsExcept, hasChatKey, identity, keepChatKey, newChatKey, verifyKey, type PublishedKey } from "./e2e";

export type ChatMode = "keep" | "auto";
export type Chat = {
  id: string;
  with: { id: string; username: string; online: boolean; lastSeenAt: string | null; identityPub: string | null } | null;
  mode: ChatMode;
  /** How long each message stays after it's sent. */
  retentionMinutes: number;
  status: "invited" | "active";
  createdByMe: boolean;
  invitedAt: string;
  inviteExpiresAt: string | null;
  acceptedAt: string | null;
  lastMessageAt: string | null;
  unread: number;
  keys: PublishedKey[];
};
export type ChatOptions = { keepMaxDays: number; auto: boolean; live: boolean };
export type WireMessage = {
  id: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  senderKeyVersion: number;
  recipientKeyVersion: number;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  expiresAt: string;
  /** A file sent with this message (its name and key are inside the ciphertext). */
  fileId?: string | null;
};

/** The durations offered for Keep-alive (the category's maximum cuts the list); Automatic is always 7 days. */
export const RETENTION_MINUTES = [30, 60, 180, 360, 720, 1440, 2880, 4320, 5760, 7200, 8640, 10080];
export const AUTO_MINUTES = 10080;

/** "30M", "6H", "2D" */
export const shortDuration = (minutes: number) => (minutes < 60 ? `${minutes}M` : minutes < 1440 ? `${minutes / 60}H` : `${minutes / 1440}D`);
/** "30 minutes", "1 hour", "2 days" */
export const longDuration = (minutes: number) =>
  minutes < 60 ? `${minutes} minutes` : minutes < 1440 ? `${minutes / 60} hour${minutes > 60 ? "s" : ""}` : `${minutes / 1440} day${minutes > 1440 ? "s" : ""}`;

export const modeLabel = (c: { mode: ChatMode; retentionMinutes: number }) => `${c.mode === "auto" ? "AUTO" : "KEEP"} · ${shortDuration(c.retentionMinutes)}`;

export const latestKey = (chat: Chat, userId: string) => chat.keys.filter((k) => k.userId === userId).sort((a, b) => b.version - a.version)[0] ?? null;

/** This device's identity, published for the account (the server keeps only the public half). */
export async function myIdentity(userId: string) {
  return identity(userId, deviceId());
}

export async function publishIdentity(userId: string) {
  const id = await myIdentity(userId);
  await api("/api/keys/identity", { method: "PUT", body: { deviceId: id.deviceId, signPub: id.signPub } });
  return id;
}

/** A signed chat key for me; its private half is kept once the server says which version it is. */
export async function makeChatKey(userId: string, peerId: string) {
  const id = await myIdentity(userId);
  return newChatKey(id, userId, peerId);
}

/**
 * Makes sure this device can write in a chat: if my latest key belongs to another device (or its private half
 * isn't here), publish a new one. Returns true when a new key was added.
 */
export async function ensureMyKey(chat: Chat, userId: string) {
  if (chat.status !== "active" || !chat.with) return false;
  const id = await myIdentity(userId);
  const mine = latestKey(chat, userId);
  if (mine && mine.identityPub === id.signPub && hasChatKey(userId, chat.id, mine.version)) return false;
  const key = await newChatKey(id, userId, chat.with.id);
  const { version } = await api<{ version: number }>(`/api/chats/${chat.id}/keys`, { body: { key: { pub: key.pub, sig: key.sig } } });
  keepChatKey(userId, chat.id, version, key.secret);
  return true;
}

/**
 * After sign-in: publish this device's identity, give every open chat a key for this device,
 * and forget keys of chats that ended meanwhile.
 */
export async function prepareDevice(userId: string) {
  await publishIdentity(userId);
  const { chats } = await api<{ chats: Chat[] }>("/api/chats");
  for (const chat of chats) await ensureMyKey(chat, userId).catch(() => {});
  forgetChatsExcept(
    userId,
    chats.map((c) => c.id),
  );
}

/** The other side's latest key, if its signature checks out. */
export async function theirVerifiedKey(chat: Chat, userId: string) {
  if (!chat.with) return null;
  const key = latestKey(chat, chat.with.id);
  return key && (await verifyKey(key, userId)) ? key : null;
}

export { forgetChat, keepChatKey };
