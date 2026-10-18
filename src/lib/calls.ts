import { api } from "./api";
import { myIdentity } from "./chats";
import { safetyCode, signCall, verifyCall } from "./e2e";
import { registerPlugin } from "@capacitor/core";
import { live } from "./live";
import { isNativeApp } from "./platform";

type AudioRoute = { route: "headset" | "earpiece" | "speaker"; speaker: boolean; id?: string; name?: string; kind?: string };
/** Android: a place the call's sound can go. */
export type Output = { id: string; kind: "earpiece" | "speaker" | "bluetooth" | "wired" | "usb" | "hearing_aid" | "other"; name: string };
/** Android: loudspeaker or earpiece for the call's sound (a web view's call audio goes to the earpiece otherwise). */
const CallAudio = isNativeApp
  ? registerPlugin<{
      start(o: { speaker: boolean; video?: boolean; who?: string }): Promise<AudioRoute>;
      setSpeaker(o: { on: boolean }): Promise<AudioRoute>;
      devices(): Promise<{ devices: Output[]; current: string | null }>;
      setDevice(o: { id: string }): Promise<AudioRoute>;
      stop(): Promise<void>;
    }>("CallAudio")
  : null;

export type CallKind = "voice" | "video";
export type CallPeer = { id: string; username: string; identityPub: string | null };
/** A person in a group call: their stream once connected. */
export type CallMember = { id: string; username: string; identityPub: string | null; stream: MediaStream | null; connected: boolean };
export type Devices = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };
export type CallState = {
  phase: "idle" | "calling" | "incoming" | "connecting" | "active" | "ended" | "unavailable";
  callId: string | null;
  peer: CallPeer | null;
  kind: CallKind;
  outgoing: boolean;
  muted: boolean;
  cameraOn: boolean;
  facing: "user" | "environment";
  local: MediaStream | null;
  remote: MediaStream | null;
  startedAt: number | null;
  /** The other side's offer/answer was signed by their identity key (nobody in between). */
  verified: boolean | null;
  relayed: boolean;
  /** First two groups of the safety code, to compare aloud. */
  code: string | null;
  note: string;
  micId: string | null;
  camId: string | null;
  speakerId: string | null;
  /** Android: where the sound plays. Headset or earbuds first, then the earpiece; the loudspeaker only when asked. */
  speaker: boolean;
  route: "headset" | "earpiece" | "speaker";
  /** Android: every output by name, and the one in use. */
  outputs: Output[];
  /** Bumped when the sound output changes: the player reconnects so the web view reopens its output there. */
  audioEpoch: number;
  outputId: string | null;
  devices: Devices;
  /** Group calls: the group, who is in the call with me, and whether I started it (only then: end for everyone). */
  group: { id: string; name: string } | null;
  members: CallMember[];
  starter: boolean;
};

const IDLE: CallState = {
  phase: "idle",
  callId: null,
  peer: null,
  kind: "voice",
  outgoing: false,
  muted: false,
  cameraOn: false,
  facing: "user",
  local: null,
  remote: null,
  startedAt: null,
  verified: null,
  relayed: false,
  code: null,
  note: "",
  micId: null,
  camId: null,
  speakerId: null,
  speaker: false,
  route: "earpiece",
  outputs: [],
  outputId: null,
  audioEpoch: 0,
  devices: { mics: [], cams: [], speakers: [] },
  group: null,
  members: [],
  starter: false,
};

const UNAVAILABLE: Record<string, (name: string) => string> = {
  not_taking_calls: (name) => `${name} isn't taking calls right now. They chose to turn off incoming calls, for their own reasons. That's their choice: you can still write to them.`,
  offline: (name) => `${name} isn't connected right now. Write to them, or try again later.`,
  busy: (name) => `${name} is already in a call. Try again in a moment.`,
  not_contact: () => "You can only call your contacts.",
};
const ENDED: Record<string, (name: string) => string> = {
  ended_by_starter: () => "The call was ended by the one who started it.",
  everyone_left: () => "Everyone left the call.",
  declined: (name) => `${name} declined the call.`,
  missed: (name) => `${name} didn't answer.`,
  cancelled: (name) => `${name} hung up.`,
  hung_up: () => "Call ended.",
};

let state: CallState = IDLE;
const listeners = new Set<(s: CallState) => void>();
let pc: RTCPeerConnection | null = null;
let userId = "";
let pending: RTCIceCandidateInit[] = [];
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;

function set(change: Partial<CallState>) {
  state = { ...state, ...change };
  for (const fn of listeners) fn(state);
}

// ---------- Ringing: a soft tone (and vibration on phones) while a call rings ----------
let ring: { ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null = null;
function startRing(incoming: boolean) {
  stopRing();
  try {
    const ctx = new AudioContext();
    const beep = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = incoming ? 660 : 440;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1);
      if (incoming) navigator.vibrate?.([400, 200, 400]);
    };
    beep();
    ring = { ctx, timer: setInterval(beep, incoming ? 2000 : 3000) };
  } catch {
    /* no audio: the screen still shows the call */
  }
}
function stopRing() {
  if (!ring) return;
  clearInterval(ring.timer);
  void ring.ctx.close().catch(() => {});
  ring = null;
}

async function iceServers(): Promise<RTCIceServer[]> {
  const turn = await api<{ urls: string[]; username: string; credential: string }>("/api/calls/turn");
  const host = turn.urls[0]?.replace(/^turns?:/, "").split(/[:?]/)[0];
  return [...(host ? [{ urls: `stun:${host}:3478` }] : []), { urls: turn.urls, username: turn.username, credential: turn.credential }];
}

async function media(kind: CallKind) {
  return navigator.mediaDevices.getUserMedia({
    audio: state.micId ? { deviceId: { exact: state.micId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true },
    video: kind === "video" ? (state.camId ? { deviceId: { exact: state.camId } } : { facingMode: state.facing }) : false,
  });
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    set({
      devices: {
        mics: all.filter((d) => d.kind === "audioinput"),
        cams: all.filter((d) => d.kind === "videoinput"),
        speakers: all.filter((d) => d.kind === "audiooutput"),
      },
    });
  } catch {
    /* listed again when permission is given */
  }
}

/** Sound received and sent, and whether this device plays it: to the server's log, never any content. */
async function report(when: string) {
  if (!pc || !state.callId) return;
  const stats = await pc.getStats().catch(() => null);
  const output = state.outputs.find((o) => o.id === state.outputId);
  const out: Record<string, unknown> = { epoch: state.audioEpoch, when, kind: state.kind, relayed: state.relayed, route: state.route, output: output ? `${output.kind}:${output.name}` : null, muted: state.muted, native: isNativeApp };
  stats?.forEach((r) => {
    if (r.type === "inbound-rtp" && r.kind === "audio") out.audioIn = { bytes: r.bytesReceived, packets: r.packetsReceived, lost: r.packetsLost, energy: r.totalAudioEnergy, level: r.audioLevel };
    if (r.type === "outbound-rtp" && r.kind === "audio") out.audioOut = { bytes: r.bytesSent, packets: r.packetsSent };
  });
  const track = state.remote?.getAudioTracks()[0];
  out.remoteTrack = track ? { enabled: track.enabled, muted: track.muted, state: track.readyState } : null;
  const el = document.querySelector<HTMLAudioElement>("audio[data-remote]");
  out.player = el ? { paused: el.paused, volume: el.volume, muted: el.muted, hasStream: Boolean(el.srcObject), readyState: el.readyState, playError: el.getAttribute("data-play-error") } : null;
  await api("/api/calls/diag", { body: { callId: state.callId, data: out } }).catch(() => {});
}

let audioOn = false;
let lostTimer: ReturnType<typeof setTimeout> | undefined;
/** Android: call audio mode, on a headset or earbuds if connected, else the earpiece. */
function startAudio() {
  if (!CallAudio || audioOn) return;
  audioOn = true;
  void CallAudio.start({ speaker: false, video: state.kind === "video", who: state.peer?.username ?? "" })
    .then((r) => set({ speaker: r.speaker, route: r.route, outputId: r.id ?? null }))
    .then(() => calls.loadOutputs())
    .catch(() => {});
}

// ---------- Group calls: one connection per person (the newcomer connects to those already in) ----------
const gpcs = new Map<string, { pc: RTCPeerConnection; pending: RTCIceCandidateInit[]; lost?: ReturnType<typeof setTimeout> }>();

function setMember(id: string, change: Partial<CallMember>) {
  set({ members: state.members.map((m) => (m.id === id ? { ...m, ...change } : m)) });
}

function dropPeer(id: string) {
  const g = gpcs.get(id);
  if (g) {
    clearTimeout(g.lost);
    g.pc.close();
  }
  gpcs.delete(id);
  set({ members: state.members.filter((m) => m.id !== id) });
}

async function groupPeer(peerId: string, asCaller: boolean) {
  const callId = state.callId!;
  let relayOnly = false;
  try {
    relayOnly = localStorage.getItem("hc.forceRelay") === "1";
  } catch {
    /* storage unavailable */
  }
  const gpc = new RTCPeerConnection({ iceServers: await iceServers(), iceTransportPolicy: relayOnly ? "relay" : "all" });
  const entry = { pc: gpc, pending: [] as RTCIceCandidateInit[] } as { pc: RTCPeerConnection; pending: RTCIceCandidateInit[]; lost?: ReturnType<typeof setTimeout> };
  gpcs.set(peerId, entry);
  const local = state.local!;
  for (const track of local.getTracks()) gpc.addTrack(track, local);
  gpc.ontrack = (e) => setMember(peerId, { stream: e.streams[0] ?? new MediaStream([e.track]) });
  gpc.onicecandidate = (e) => e.candidate && live.send("call:signal", { callId, to: peerId, data: { candidate: e.candidate.toJSON() } });
  gpc.onconnectionstatechange = () => {
    if (gpc.connectionState === "connected") {
      setMember(peerId, { connected: true });
      if (state.phase !== "active") {
        stopRing();
        set({ phase: "active", startedAt: Date.now() });
        setTimeout(() => set({ audioEpoch: state.audioEpoch + 1 }), 1500);
      }
    }
    clearTimeout(entry.lost);
    if (gpc.connectionState === "failed") dropPeer(peerId);
    if (gpc.connectionState === "disconnected") entry.lost = setTimeout(() => gpc.connectionState === "disconnected" && dropPeer(peerId), 15_000);
  };
  if (asCaller) {
    const offer = await gpc.createOffer();
    await gpc.setLocalDescription(offer);
    const sig = await signCall(await myIdentity(userId), callId, "offer", offer.sdp ?? "");
    live.send("call:signal", { callId, to: peerId, data: { sdp: { type: offer.type, sdp: offer.sdp }, sig } });
  }
  return entry;
}

async function onGroupSignal(from: string, data: { sdp?: RTCSessionDescriptionInit; sig?: string; candidate?: RTCIceCandidateInit }) {
  const member = state.members.find((m) => m.id === from);
  if (!member) return;
  try {
    if (data.sdp) {
      // Each person's offer/answer is signed by their identity: nobody in between
      if (member.identityPub && !(await verifyCall(member.identityPub, state.callId!, data.sdp.type ?? "", data.sdp.sdp ?? "", data.sig ?? ""))) return dropPeer(from);
      const entry = gpcs.get(from) ?? (data.sdp.type === "offer" ? await groupPeer(from, false) : null);
      if (!entry) return;
      await entry.pc.setRemoteDescription(data.sdp);
      for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === "offer") {
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        const sig = await signCall(await myIdentity(userId), state.callId!, "answer", answer.sdp ?? "");
        live.send("call:signal", { callId: state.callId, to: from, data: { sdp: { type: answer.type, sdp: answer.sdp }, sig } });
      }
    } else if (data.candidate) {
      const entry = gpcs.get(from);
      if (entry?.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
      else if (entry) entry.pending.push(data.candidate);
      else {
        // The offer hasn't arrived yet: keep the candidate for the connection about to be made
        const waiting = earlyCandidates.get(from) ?? [];
        waiting.push(data.candidate);
        earlyCandidates.set(from, waiting);
      }
    }
  } catch {
    dropPeer(from);
  }
}
const earlyCandidates = new Map<string, RTCIceCandidateInit[]>();

/** Join a running group call (from the ringing screen or the group's "Join" button). */
async function joinGroup(kind: CallKind) {
  set({ phase: "connecting", kind, cameraOn: kind === "video" });
  set({ local: await media(kind) });
  void listDevices();
  const r = await live.request<{ ok: boolean; full?: boolean; joined?: CallPeer[]; startedBy?: string }>("call:join", { callId: state.callId });
  if (!r.ok) return finish(r.full ? "The call is full (6 people)." : "The call has ended.");
  set({ members: (r.joined ?? []).map((p) => ({ ...p, stream: null, connected: false })), starter: r.startedBy === userId });
  startAudio();
  for (const p of r.joined ?? []) {
    const entry = await groupPeer(p.id, true);
    for (const c of earlyCandidates.get(p.id) ?? []) entry.pending.push(c);
    earlyCandidates.delete(p.id);
  }
}

function cleanup() {
  stopRing();
  for (const id of [...gpcs.keys()]) {
    const g = gpcs.get(id)!;
    clearTimeout(g.lost);
    g.pc.close();
  }
  gpcs.clear();
  earlyCandidates.clear();
  clearTimeout(lostTimer);
  if (CallAudio && audioOn) void CallAudio.stop().catch(() => {});
  audioOn = false;
  clearInterval(tick);
  pc?.close();
  pc = null;
  pending = [];
  state.local?.getTracks().forEach((t) => t.stop());
}

function finish(note: string) {
  cleanup();
  set({ phase: "ended", note, local: null, remote: null });
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => state.phase === "ended" && set({ ...IDLE }), 2500);
}

async function fail(err: unknown) {
  const text = err instanceof DOMException && err.name === "NotAllowedError" ? "H_CHAT needs the microphone (and the camera for video). Allow it and try again." : err instanceof Error ? err.message : "The call failed.";
  if (state.callId) live.send("call:leave", { callId: state.callId });
  finish(text);
}

async function connect(asCaller: boolean) {
  const callId = state.callId!;
  const peerId = state.peer!.id;
  // "hc.forceRelay" (testing only): every packet through the TURN relay, as on a network that blocks direct connections
  let relayOnly = false;
  try {
    relayOnly = localStorage.getItem("hc.forceRelay") === "1";
  } catch {
    /* storage unavailable */
  }
  pc = new RTCPeerConnection({ iceServers: await iceServers(), iceTransportPolicy: relayOnly ? "relay" : "all" });
  const local = state.local!;
  for (const track of local.getTracks()) pc.addTrack(track, local);
  startAudio();
  pc.ontrack = (e) => set({ remote: e.streams[0] ?? new MediaStream([e.track]) });
  pc.onicecandidate = (e) => e.candidate && live.send("call:signal", { callId, to: peerId, data: { candidate: e.candidate.toJSON() } });
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected" && state.phase !== "active") {
      set({ phase: "active", startedAt: Date.now() });
      // Direct or through the relay: read from the pair the connection really uses, now and once it settled
      const check = () =>
        void pc?.getStats().then((stats) => {
          stats.forEach((r) => {
            if (r.type !== "transport" || !r.selectedCandidatePairId) return;
            const pair = stats.get(r.selectedCandidatePairId);
            const local = pair && stats.get(pair.localCandidateId);
            const remote = pair && stats.get(pair.remoteCandidateId);
            set({ relayed: local?.candidateType === "relay" || remote?.candidateType === "relay" });
          });
        });
      check();
      setTimeout(check, 2000);
      // What the call really carries (sent to the server to find audio problems): at 5 s and 15 s
      // Android switched to call mode as the call started: reopen the player on the final output
      setTimeout(() => set({ audioEpoch: state.audioEpoch + 1 }), 1500);
      setTimeout(() => void report("5s"), 5000);
      setTimeout(() => void report("15s"), 15000);
      setTimeout(() => void report("30s"), 30000);
    }
    if (pc.connectionState === "failed") void fail(new Error("The connection was lost."));
    // Lost for 15 s (the other phone went silent, its network dropped): end it properly on both sides
    clearTimeout(lostTimer);
    if (pc.connectionState === "disconnected") lostTimer = setTimeout(() => pc?.connectionState === "disconnected" && void fail(new Error("The connection was lost.")), 15_000);
  };
  if (asCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sig = await signCall(await myIdentity(userId), callId, "offer", offer.sdp ?? "");
    live.send("call:signal", { callId, to: peerId, data: { sdp: { type: offer.type, sdp: offer.sdp }, sig } });
  }
}

async function onSignal({ callId, from, data }: { callId: string; from: string; data: { sdp?: RTCSessionDescriptionInit; sig?: string; candidate?: RTCIceCandidateInit } }) {
  if (callId === state.callId && state.group) return onGroupSignal(from, data);
  if (callId !== state.callId || from !== state.peer?.id) return;
  try {
    if (data.sdp) {
      const pub = state.peer.identityPub;
      const ok = pub ? await verifyCall(pub, callId, data.sdp.type ?? "", data.sdp.sdp ?? "", data.sig ?? "") : false;
      if (pub && !ok) return void fail(new Error("This call couldn't be verified: it was stopped to protect you."));
      set({ verified: ok });
      if (!pc) await connect(false);
      await pc!.setRemoteDescription(data.sdp);
      for (const c of pending.splice(0)) await pc!.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === "offer") {
        const answer = await pc!.createAnswer();
        await pc!.setLocalDescription(answer);
        const sig = await signCall(await myIdentity(userId), callId, "answer", answer.sdp ?? "");
        live.send("call:signal", { callId, to: from, data: { sdp: { type: answer.type, sdp: answer.sdp }, sig } });
      }
    } else if (data.candidate) {
      if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else pending.push(data.candidate);
    }
  } catch (err) {
    void fail(err);
  }
}

async function codeFor(peer: CallPeer) {
  if (!peer.identityPub) return null;
  const mine = await myIdentity(userId);
  return (await safetyCode(mine.signPub, peer.identityPub)).slice(0, 2).join(" ");
}

let attached = false;
/** Once signed in: who I am, and the call events from the server. */
export function attachCalls(id: string) {
  userId = id;
  if (attached) return;
  attached = true;
  live.on<{ callId: string; kind: CallKind; from: CallPeer; group?: { id: string; name: string } }>("call:incoming", async ({ callId, kind, from, group }) => {
    if (state.phase !== "idle" && state.phase !== "ended") return group ? undefined : live.send("call:leave", { callId });
    clearTimeout(dismissTimer);
    set({ ...IDLE, phase: "incoming", callId, kind, peer: from, outgoing: false, group: group ?? null, code: group ? null : await codeFor(from).catch(() => null) });
    startRing(true);
    // A group call keeps going without me: stop ringing after 45 s (it can still be joined from the group)
    if (group) setTimeout(() => state.phase === "incoming" && state.callId === callId && finish(`Missed call in ${group.name}.`), 45_000);
  });
  // Group calls: someone joined (they will connect to me), someone left
  live.on<{ callId: string; user: CallPeer }>("call:joined", ({ callId, user }) => {
    if (callId !== state.callId || !state.group || state.members.some((m) => m.id === user.id)) return;
    set({ members: [...state.members, { ...user, stream: null, connected: false }] });
  });
  live.on<{ callId: string; userId: string }>("call:left", ({ callId, userId: who }) => {
    if (callId === state.callId && state.group) dropPeer(who);
  });
  live.on<{ callId: string }>("call:answered", async ({ callId }) => {
    if (callId !== state.callId) return;
    stopRing();
    set({ phase: "connecting" });
    await connect(true).catch(fail);
  });
  live.on("call:signal", (p: Parameters<typeof onSignal>[0]) => void onSignal(p));
  live.on<{ callId: string; reason: string }>("call:ended", ({ callId, reason }) => {
    if (callId !== state.callId) return;
    finish((ENDED[reason] ?? (() => "Call ended."))(state.peer?.username ?? "Your contact"));
  });
}

export const calls = {
  get: () => state,
  subscribe(fn: (s: CallState) => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  async start(peer: CallPeer, kind: CallKind) {
    if (state.phase !== "idle" && state.phase !== "ended") return;
    clearTimeout(dismissTimer);
    set({ ...IDLE, phase: "calling", peer, kind, outgoing: true, cameraOn: kind === "video" });
    try {
      const reply = await live.request<{ callId?: string; error?: string }>("call:start", { to: peer.id, kind });
      if (!reply.callId) return set({ phase: "unavailable", note: (UNAVAILABLE[reply.error ?? ""] ?? (() => "The call couldn't start."))(peer.username) });
      set({ callId: reply.callId, code: await codeFor(peer).catch(() => null) });
      startRing(false);
      set({ local: await media(kind) });
      void listDevices();
    } catch (err) {
      void fail(err);
    }
  },
  /** Starts a call in a group: every member is rung; whoever joins connects to everyone already in. */
  async startGroup(group: { id: string; name: string }, kind: CallKind) {
    if (state.phase !== "idle" && state.phase !== "ended") return;
    clearTimeout(dismissTimer);
    set({ ...IDLE, phase: "calling", group, kind, outgoing: true, starter: true, cameraOn: kind === "video", peer: { id: group.id, username: group.name, identityPub: null } });
    try {
      const reply = await live.request<{ callId?: string; error?: string }>("call:start", { groupId: group.id, kind });
      if (!reply.callId) {
        return set({ phase: "unavailable", note: reply.error === "already_running" ? `A call is already running in ${group.name}: join it from the group.` : "The call couldn't start." });
      }
      set({ callId: reply.callId });
      startRing(false);
      set({ local: await media(kind) });
      void listDevices();
      startAudio();
    } catch (err) {
      void fail(err);
    }
  },
  /** Joins a group call already running (the group's "Join" button). */
  async joinRunning(group: { id: string; name: string }, callId: string, kind: CallKind) {
    if (state.phase !== "idle" && state.phase !== "ended") return;
    clearTimeout(dismissTimer);
    set({ ...IDLE, phase: "connecting", callId, group, kind, peer: { id: group.id, username: group.name, identityPub: null } });
    await joinGroup(kind).catch(fail);
  },
  async accept(kind: CallKind) {
    if (state.phase !== "incoming") return;
    stopRing();
    if (state.group) return void joinGroup(kind).catch(fail);
    set({ phase: "connecting", kind, cameraOn: kind === "video" });
    try {
      set({ local: await media(kind) });
      void listDevices();
      const { ok } = await live.request<{ ok: boolean }>("call:answer", { callId: state.callId });
      if (!ok) return finish("The call ended before you answered.");
      await connect(false);
    } catch (err) {
      void fail(err);
    }
  },
  decline() {
    if (state.callId) live.send("call:leave", { callId: state.callId });
    finish(state.phase === "incoming" ? "Call declined." : "Call ended.");
  },
  hangUp(everyone = false) {
    if (state.callId) live.send("call:leave", { callId: state.callId, everyone });
    finish("Call ended.");
  },
  dismiss() {
    cleanup();
    set({ ...IDLE });
  },
  toggleMute() {
    const muted = !state.muted;
    state.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    set({ muted });
  },
  toggleCamera() {
    const cameraOn = !state.cameraOn;
    state.local?.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
    set({ cameraOn });
  },
  /** Replaces the microphone or camera without hanging up. */
  async swap(kind: "audio" | "video", constraints: MediaTrackConstraints) {
    const fresh = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: constraints } : { video: constraints });
    const track = kind === "audio" ? fresh.getAudioTracks()[0]! : fresh.getVideoTracks()[0]!;
    if (kind === "audio") track.enabled = !state.muted;
    else track.enabled = state.cameraOn;
    const sender = pc?.getSenders().find((s) => s.track?.kind === kind);
    await sender?.replaceTrack(track);
    for (const g of gpcs.values()) await g.pc.getSenders().find((s) => s.track?.kind === kind)?.replaceTrack(track);
    const local = new MediaStream([...(state.local?.getTracks().filter((t) => t.kind !== kind) ?? []), track]);
    state.local?.getTracks().filter((t) => t.kind === kind).forEach((t) => t.stop());
    set({ local });
  },
  async flip() {
    const facing = state.facing === "user" ? "environment" : "user";
    set({ facing, camId: null });
    await this.swap("video", { facingMode: facing }).catch(() => {});
  },
  async useMic(id: string) {
    set({ micId: id });
    await this.swap("audio", { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true }).catch(() => {});
  },
  async useCamera(id: string) {
    set({ camId: id });
    await this.swap("video", { deviceId: { exact: id } }).catch(() => {});
  },
  useSpeaker(id: string) {
    set({ speakerId: id });
  },
  /** Android: the list of outputs (earpiece, loudspeaker, each headset by name). */
  async loadOutputs() {
    if (!CallAudio) return;
    const r = await CallAudio.devices().catch(() => null);
    if (r) set({ outputs: r.devices, outputId: r.current });
  },
  /** Hear the call on this output: Android by id, a browser through setSinkId. */
  async useOutput(id: string) {
    if (!CallAudio) return this.useSpeaker(id);
    const r = await CallAudio.setDevice({ id }).catch(() => null);
    if (r) set({ speaker: r.speaker, route: r.route, outputId: r.id ?? id });
    await this.loadOutputs();
    setTimeout(() => set({ audioEpoch: state.audioEpoch + 1 }), 300);
  },
  /** The other person's sound level as it arrives (0..1), from the connection itself. */
  async levelIn() {
    const stats = await (pc ?? [...gpcs.values()][0]?.pc)?.getStats().catch(() => null);
    let level = 0;
    stats?.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "audio" && typeof r.audioLevel === "number") level = r.audioLevel;
    });
    return level;
  },
  /** Android: the loudspeaker, or back to the headset/earbuds (else the earpiece). */
  async toggleSpeaker() {
    const on = !state.speaker;
    set({ speaker: on });
    if (CallAudio) {
      const r = await CallAudio.setSpeaker({ on }).catch((): AudioRoute => ({ speaker: on, route: on ? "speaker" : "earpiece" }));
      set({ speaker: r.speaker, route: r.route, outputId: r.id ?? state.outputId });
      setTimeout(() => set({ audioEpoch: state.audioEpoch + 1 }), 300);
    }
  },
};

