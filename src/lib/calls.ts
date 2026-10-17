import { api } from "./api";
import { myIdentity } from "./chats";
import { safetyCode, signCall, verifyCall } from "./e2e";
import { registerPlugin } from "@capacitor/core";
import { live } from "./live";
import { isNativeApp } from "./platform";

type AudioRoute = { route: "headset" | "earpiece" | "speaker"; speaker: boolean };
/** Android: loudspeaker or earpiece for the call's sound (a web view's call audio goes to the earpiece otherwise). */
const CallAudio = isNativeApp
  ? registerPlugin<{ start(o: { speaker: boolean }): Promise<AudioRoute>; setSpeaker(o: { on: boolean }): Promise<AudioRoute>; stop(): Promise<void> }>("CallAudio")
  : null;

export type CallKind = "voice" | "video";
export type CallPeer = { id: string; username: string; identityPub: string | null };
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
  devices: Devices;
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
  devices: { mics: [], cams: [], speakers: [] },
};

const UNAVAILABLE: Record<string, (name: string) => string> = {
  not_taking_calls: (name) => `${name} isn't taking calls right now. They chose to turn off incoming calls, for their own reasons. That's their choice: you can still write to them.`,
  offline: (name) => `${name} isn't connected right now. Write to them, or try again later.`,
  busy: (name) => `${name} is already in a call. Try again in a moment.`,
  not_contact: () => "You can only call your contacts.",
};
const ENDED: Record<string, (name: string) => string> = {
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
  const out: Record<string, unknown> = { when, kind: state.kind, relayed: state.relayed, route: state.route, muted: state.muted, native: isNativeApp };
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
/** Android: call audio mode, on a headset or earbuds if connected, else the earpiece. */
function startAudio() {
  if (!CallAudio || audioOn) return;
  audioOn = true;
  void CallAudio.start({ speaker: false })
    .then((r) => set({ speaker: r.speaker, route: r.route }))
    .catch(() => {});
}

function cleanup() {
  stopRing();
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
      setTimeout(() => void report("5s"), 5000);
      setTimeout(() => void report("15s"), 15000);
    }
    if (pc.connectionState === "failed") void fail(new Error("The connection was lost."));
  };
  if (asCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sig = await signCall(await myIdentity(userId), callId, "offer", offer.sdp ?? "");
    live.send("call:signal", { callId, to: peerId, data: { sdp: { type: offer.type, sdp: offer.sdp }, sig } });
  }
}

async function onSignal({ callId, from, data }: { callId: string; from: string; data: { sdp?: RTCSessionDescriptionInit; sig?: string; candidate?: RTCIceCandidateInit } }) {
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
  live.on<{ callId: string; kind: CallKind; from: CallPeer }>("call:incoming", async ({ callId, kind, from }) => {
    if (state.phase !== "idle" && state.phase !== "ended") return live.send("call:leave", { callId });
    clearTimeout(dismissTimer);
    set({ ...IDLE, phase: "incoming", callId, kind, peer: from, outgoing: false, code: await codeFor(from).catch(() => null) });
    startRing(true);
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
  async accept(kind: CallKind) {
    if (state.phase !== "incoming") return;
    stopRing();
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
  /** Android: the loudspeaker, or back to the headset/earbuds (else the earpiece). */
  async toggleSpeaker() {
    const on = !state.speaker;
    set({ speaker: on });
    if (CallAudio) {
      const r = await CallAudio.setSpeaker({ on }).catch((): AudioRoute => ({ speaker: on, route: on ? "speaker" : "earpiece" }));
      set({ speaker: r.speaker, route: r.route });
    }
  },
};

