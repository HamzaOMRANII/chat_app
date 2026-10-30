import { api } from "./api";
import { myIdentity } from "./chats";
import { forgetGroupsExcept, groupSecret, keepGroupKey, newChatKey, verifyKey, type PublishedKey } from "./e2e";

export type GroupMember = { id: string; username: string; online: boolean; lastSeenAt: string | null; identityPub: string | null };
export type Group = {
  id: string;
  name: string;
  mode: "keep" | "auto";
  retentionMinutes: number;
  files: boolean;
  members: GroupMember[];
  keys: PublishedKey[];
  lastMessageAt: string | null;
  /** A call running in the group right now (anyone can join, up to 6). */
  call: { callId: string; kind: "voice" | "video"; startedBy: string; joined: string[] } | null;
  unread: number;
};
export type GroupRequest = { id: string; name: string; status: "pending" | "refused"; members: string[]; at: string };
export type GroupWire = {
  id: string;
  senderId: string | null;
  system: { kind: "added" | "removed" | "left" | "created" | "settings"; userId: string | null; name: string | null } | null;
  ciphertext: string | null;
  nonce: string | null;
  senderKeyVersion: number | null;
  wrap: { keyVersion: number; key: string } | null;
  fileId: string | null;
  readBy: number;
  recipients: number;
  sentAt: string;
  expiresAt: string;
};

export const latestGroupKey = (g: Group, userId: string) => g.keys.filter((k) => k.userId === userId).sort((a, b) => b.version - a.version)[0] ?? null;

/** This device must have its own key in the group (a new one after moving to a new device). Returns true if published. */
export async function ensureGroupKey(g: Group, userId: string) {
  const id = await myIdentity(userId);
  const mine = latestGroupKey(g, userId);
  if (mine && mine.identityPub === id.signPub && groupSecret(userId, g.id, mine.version)) return false;
  const key = await newChatKey(id, userId, g.id);
  const { version } = await api<{ version: number }>(`/api/groups/${g.id}/keys`, { body: { key: { pub: key.pub, sig: key.sig } } });
  keepGroupKey(userId, g.id, version, key.secret);
  return true;
}

/** Every current member's latest key whose signature checks out: the message is locked for each of them. */
export async function recipientKeys(g: Group) {
  const out: PublishedKey[] = [];
  for (const m of g.members) {
    const k = latestGroupKey(g, m.id);
    if (k && (await verifyKey(k, g.id))) out.push(k);
  }
  return out;
}

/** After sign-in: a key in every group, and forget the keys of groups I left. */
export async function prepareGroups(userId: string) {
  const { groups } = await api<{ groups: Group[] }>("/api/groups");
  for (const g of groups) await ensureGroupKey(g, userId).catch(() => {});
  forgetGroupsExcept(
    userId,
    groups.map((g) => g.id),
  );
}

/** A stable colour per member name (sender names in the group). */
const COLORS = ["#7FDCE8", "#E3A3AE", "#9AAEFF", "#F2C46B", "#7FE3B6", "#D7A6F2", "#F29A6B", "#A6D8F2"];
export function memberColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}
