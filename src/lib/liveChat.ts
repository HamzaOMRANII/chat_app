import { api } from "./api";
import { myIdentity } from "./chats";
import { newChatKey, verifyKey, type PublishedKey } from "./e2e";

export type LiveSession = {
  id: string;
  with: { id: string; username: string; online: boolean; identityPub: string | null } | null;
  status: "invited" | "active";
  createdByMe: boolean;
  invitedAt: string;
  inviteExpiresAt: string | null;
  startedAt: string | null;
  /** Someone's connection dropped: who (me or them) and until when (ms) they can come back. */
  waitingFor: { mine: boolean; deadline: number } | null;
  keys: { userId: string; pub: string; sig: string; identityPub: string }[];
};

/**
 * The private half of each live session's key stays in memory only: closing the app or reloading the page
 * forgets it, so nothing typed in a live chat can ever be read again.
 */
const secrets = new Map<string, string>();
export const liveSecret = (sessionId: string) => secrets.get(sessionId) ?? null;
export const forgetLive = (sessionId: string) => void secrets.delete(sessionId);

export async function startLive(userId: string, peerId: string) {
  const key = await newChatKey(await myIdentity(userId), userId, peerId);
  const { live } = await api<{ live: LiveSession }>("/api/live", { body: { userId: peerId, key: { pub: key.pub, sig: key.sig } } });
  secrets.set(live.id, key.secret);
  return live;
}

export async function acceptLive(userId: string, session: LiveSession) {
  const key = await newChatKey(await myIdentity(userId), userId, session.with!.id);
  const { live } = await api<{ live: LiveSession }>(`/api/live/${session.id}/accept`, { body: { key: { pub: key.pub, sig: key.sig } } });
  secrets.set(live.id, key.secret);
  return live;
}

/** The two session keys, with the other side's signature checked. */
export async function liveKeys(session: LiveSession, userId: string): Promise<{ mine: PublishedKey; theirs: PublishedKey } | null> {
  const mine = session.keys.find((k) => k.userId === userId);
  const theirs = session.keys.find((k) => k.userId !== userId);
  if (!mine || !theirs) return null;
  const mineKey = { ...mine, version: 1 };
  const theirKey = { ...theirs, version: 1 };
  return (await verifyKey(theirKey, userId)) ? { mine: mineKey, theirs: theirKey } : null;
}

/** Time left to answer a live invitation: "4:12", "0:09" (never more than the 5 minutes, whatever the clocks say) */
export function countdown(ms: number) {
  const s = Math.max(0, Math.min(300, Math.ceil(ms / 1000)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** "03:12" */
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
