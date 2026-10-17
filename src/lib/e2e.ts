type Sodium = typeof import("libsodium-wrappers");
// Loaded on first use (it's large): every exported function awaits lib() before the sync helpers run.
let sodium: Sodium;
async function lib() {
  if (!sodium) {
    const mod = await import("libsodium-wrappers");
    const loaded = ((mod as unknown as { default?: Sodium }).default ?? mod) as Sodium;
    await loaded.ready;
    sodium = loaded;
  }
  return sodium;
}

/**
 * End-to-end encryption for stored chats (libsodium).
 *
 * - Identity: an Ed25519 signing key per device and account. Only the public half goes to the server.
 * - Chat keys: each participant makes an X25519 key pair for each chat, signs the public half with their
 *   identity, and publishes it. Moving to a new device adds a new version. Private halves stay here.
 * - Messages: XChaCha20-Poly1305 with a key derived from X25519(my chat key, their chat key); the chat id,
 *   sender and key versions are bound in as associated data.
 * - Ending a chat deletes the private chat keys here, so leftover ciphertext can never be opened again.
 *
 * Private keys live in this device's storage (localStorage), per account. They never leave the device.
 */

const B64 = () => sodium.base64_variants.ORIGINAL;
export const ready = () => lib();
const enc = (bytes: Uint8Array) => sodium.to_base64(bytes, B64());
const dec = (text: string) => sodium.from_base64(text, B64());

type Identity = { deviceId: string; signPub: string; signSec: string };

const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: keys can't be kept, messages won't be readable after a restart */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(prefix: string) {
    try {
      const found: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) found.push(k);
      }
      return found;
    } catch {
      return [];
    }
  },
};

const identityKey = (userId: string) => `hc.e2e.identity.${userId}`;
const chatKeyKey = (userId: string, chatId: string, version: number) => `hc.e2e.chat.${userId}.${chatId}.${version}`;

/** This device's identity for the account, created on first use. */
export async function identity(userId: string, deviceId: string): Promise<Identity> {
  await lib();
  const existing = store.get<Identity>(identityKey(userId));
  if (existing && existing.deviceId === deviceId) return existing;
  const pair = sodium.crypto_sign_keypair();
  const created = { deviceId, signPub: enc(pair.publicKey), signSec: enc(pair.privateKey) };
  store.set(identityKey(userId), created);
  return created;
}

const keyStatement = (ownerId: string, peerId: string, pub: string) => sodium.from_string(`hchat-chat-key|${ownerId}|${peerId}|${pub}`);

/** A new chat key for me in a chat with peerId: the private half is kept here, the public half and signature go to the server. */
export async function newChatKey(id: Identity, userId: string, peerId: string) {
  await lib();
  const pair = sodium.crypto_box_keypair();
  const pub = enc(pair.publicKey);
  const sig = enc(sodium.crypto_sign_detached(keyStatement(userId, peerId, pub), dec(id.signSec)));
  return { pub, sig, secret: enc(pair.privateKey) };
}

export function keepChatKey(userId: string, chatId: string, version: number, secret: string) {
  store.set(chatKeyKey(userId, chatId, version), secret);
}
export const hasChatKey = (userId: string, chatId: string, version: number) => store.get<string>(chatKeyKey(userId, chatId, version)) !== null;

/** Forgets every private key of a chat (chat ended): its messages can never be decrypted again. */
export function forgetChat(userId: string, chatId: string) {
  for (const k of store.keys(`hc.e2e.chat.${userId}.${chatId}.`)) store.remove(k);
}

/** Forgets the keys of chats that are no longer open (ended while this device was away). */
export function forgetChatsExcept(userId: string, openChatIds: string[]) {
  const open = new Set(openChatIds);
  for (const k of store.keys(`hc.e2e.chat.${userId}.`)) {
    const chatId = k.split(".")[4];
    if (chatId && !open.has(chatId)) store.remove(k);
  }
}

export type PublishedKey = { userId: string; version: number; pub: string; sig: string; identityPub: string };

/** Checks that a published chat key was signed by the identity it claims. */
export async function verifyKey(key: PublishedKey, peerOfOwner: string) {
  await lib();
  try {
    return sodium.crypto_sign_verify_detached(dec(key.sig), keyStatement(key.userId, peerOfOwner, key.pub), dec(key.identityPub));
  } catch {
    return false;
  }
}

function sharedKey(mySecret: string, myKey: PublishedKey, theirKey: PublishedKey, chatId: string) {
  const dh = sodium.crypto_scalarmult(dec(mySecret), dec(theirKey.pub));
  // Same input on both sides: order the two public keys by owner id
  const [first, second] = [myKey, theirKey].sort((a, b) => (a.userId < b.userId ? -1 : 1));
  return sodium.crypto_generichash(32, new Uint8Array([...dh, ...dec(first!.pub), ...dec(second!.pub), ...sodium.from_string(chatId)]));
}

const associated = (chatId: string, senderId: string, senderVersion: number, recipientVersion: number) =>
  sodium.from_string(`hchat-msg|${chatId}|${senderId}|${senderVersion}|${recipientVersion}`);

/** A file sent with a message: what's needed to fetch, open and show it. Only inside the encrypted message. */
export type FileRef = { id: string; name: string; mime: string; size: number; key: string; chunks: number };
export type Plain = { t: string; f?: FileRef };

export async function encryptMessage(opts: { userId: string; chatId: string; myKey: PublishedKey; theirKey: PublishedKey; plain: Plain }) {
  await lib();
  const secret = store.get<string>(chatKeyKey(opts.userId, opts.chatId, opts.myKey.version));
  if (!secret) throw new Error("This device has no key for this chat.");
  const key = sharedKey(secret, opts.myKey, opts.theirKey, opts.chatId);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ad = associated(opts.chatId, opts.userId, opts.myKey.version, opts.theirKey.version);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(sodium.from_string(JSON.stringify(opts.plain)), ad, null, nonce, key);
  return { ciphertext: enc(cipher), nonce: enc(nonce), senderKeyVersion: opts.myKey.version, recipientKeyVersion: opts.theirKey.version };
}

/**
 * Opens a message. null = this device can't (sent before it had its keys, or tampered with).
 * `myVersion` is my side's key version for this message, `theirKey` the other side's published key.
 */
export async function decryptMessage(opts: {
  userId: string;
  chatId: string;
  senderId: string;
  myKey: PublishedKey;
  theirKey: PublishedKey;
  ciphertext: string;
  nonce: string;
  senderKeyVersion: number;
  recipientKeyVersion: number;
}): Promise<Plain | null> {
  await lib();
  const secret = store.get<string>(chatKeyKey(opts.userId, opts.chatId, opts.myKey.version));
  if (!secret) return null;
  try {
    const key = sharedKey(secret, opts.myKey, opts.theirKey, opts.chatId);
    const ad = associated(opts.chatId, opts.senderId, opts.senderKeyVersion, opts.recipientKeyVersion);
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, dec(opts.ciphertext), ad, dec(opts.nonce), key);
    const parsed = JSON.parse(sodium.to_string(plain)) as Plain;
    return typeof parsed.t === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** 12 groups of 5 digits from both identity keys: identical on both phones when nobody is in between. */
export async function safetyCode(identityA: string, identityB: string) {
  await lib();
  const [first, second] = [identityA, identityB].sort();
  const hash = sodium.crypto_generichash(60, new Uint8Array([...dec(first!), ...dec(second!)]));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const chunk = hash.slice(i * 5, i * 5 + 5);
    const n = chunk.reduce((acc, byte) => (acc * 256 + byte) % 100000, 0);
    groups.push(String(n).padStart(5, "0"));
  }
  return groups;
}

const safetyKey = (userId: string, peerId: string) => `hc.e2e.safety.${userId}.${peerId}`;
/** "We compared it, it matches": remembered with the code, so a new device on either side clears it. */
export const markSafetyChecked = (userId: string, peerId: string, code: string[]) =>
  store.set(safetyKey(userId, peerId), { code: code.join(""), at: new Date().toISOString() });
export function safetyChecked(userId: string, peerId: string, code: string[]) {
  const saved = store.get<{ code: string; at: string }>(safetyKey(userId, peerId));
  return saved && saved.code === code.join("") ? saved.at : null;
}

// ---------- Live chat: session keys live in memory only, nothing is written to storage ----------

const liveAssociated = (sessionId: string, senderId: string) => sodium.from_string(`hchat-live|${sessionId}|${senderId}`);

/** What one side types in a live chat, sealed for the other side (the server only relays it). */
export async function sealLive(opts: { secret: string; sessionId: string; userId: string; myKey: PublishedKey; theirKey: PublishedKey; plain: Plain }) {
  await lib();
  const key = sharedKey(opts.secret, opts.myKey, opts.theirKey, opts.sessionId);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(sodium.from_string(JSON.stringify(opts.plain)), liveAssociated(opts.sessionId, opts.userId), null, nonce, key);
  return { nonce: enc(nonce), ct: enc(cipher) };
}

/** Opens what the other side sent; null if it doesn't check out. */
export async function openLive(opts: { secret: string; sessionId: string; senderId: string; myKey: PublishedKey; theirKey: PublishedKey; nonce: string; ct: string }): Promise<Plain | null> {
  await lib();
  try {
    const key = sharedKey(opts.secret, opts.myKey, opts.theirKey, opts.sessionId);
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, dec(opts.ct), liveAssociated(opts.sessionId, opts.senderId), dec(opts.nonce), key);
    const parsed = JSON.parse(sodium.to_string(plain)) as Plain;
    return typeof parsed.t === "string" ? parsed : null;
  } catch {
    return null;
  }
}

// ---------- Files: a random key per file, each piece sealed on its own ----------

/** A new key for one file (it travels inside the end-to-end encrypted message). */
export async function newFileKey() {
  await lib();
  return enc(sodium.crypto_aead_xchacha20poly1305_ietf_keygen());
}

const pieceAssociated = (fileId: string, n: number, count: number) => sodium.from_string(`hchat-file|${fileId}|${n}|${count}`);

/** Piece n of count: nonce (24 bytes) followed by the ciphertext. */
export async function sealPiece(key: string, fileId: string, n: number, count: number, data: Uint8Array) {
  await lib();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(data, pieceAssociated(fileId, n, count), null, nonce, dec(key));
  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce);
  out.set(cipher, nonce.length);
  return out;
}

/** Opens piece n; throws if it was tampered with, swapped or cut. */
export async function openPiece(key: string, fileId: string, n: number, count: number, sealed: Uint8Array) {
  await lib();
  const size = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed.subarray(size), pieceAssociated(fileId, n, count), sealed.subarray(0, size), dec(key));
}
