export type Contact = { id: string; username: string; online: boolean; lastSeenAt: string | null; since: string; via: "id" | "invite" };
export type Request = { id: string; username: string; at: string };
export type ContactList = { contacts: Contact[]; incoming: Request[]; outgoing: Request[] };
export type MyId = { personalId: string; invite: { code: string; expiresAt: string } | null; searchesLeft: number };

export const initials = (username: string) =>
  username
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || username.slice(0, 2).toUpperCase();

/** "2h ago", "yesterday", "3d ago". */
export function ago(iso: string | null) {
  if (!iso) return "a while ago";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export const lastSeen = (c: Pick<Contact, "online" | "lastSeenAt">) => (c.online ? "online" : `last seen ${ago(c.lastSeenAt)}`);

/** "23h 41m left" until an ISO time. */
export function timeLeft(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m left`;
}

/**
 * What the My ID QR code holds: a link that opens "Add contact" with the ID filled in, so a phone's own camera
 * app works too. In-app scans read the ID from it.
 */
export const addContactLink = (personalId: string) => `https://chat.omranisystems.com/#add=${personalId}`;

/** The personal ID in a scanned text (the link above, or a plain ID), or null. */
export function personalIdFromScan(text: string) {
  const match = text.trim().match(/(?:^|#add=)(HC-?[2-9A-Z]{4}-?[2-9A-Z]{4})$/i);
  return match ? match[1]!.toUpperCase() : null;
}
