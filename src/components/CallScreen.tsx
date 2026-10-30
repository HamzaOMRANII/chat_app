import { useEffect, useRef, useState } from "react";
import { calls, listDevices, type CallState, type Output } from "../lib/calls";
import { playTestTone } from "../lib/audioCheck";
import { isNativeApp } from "../lib/platform";
import { Avatar } from "./PageHeader";

const icons = {
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  video: <path d="M3 6h12v12H3zM15 10l6-3v10l-6-3" />,
  mic: <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3" />,
  micOff: <path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3" />,
  camOff: <path d="M3 3l18 18M15 10l6-3v10l-3-1.5M15 15v3H3V6h3" />,
  flip: <path d="M4 8h3l2-3h6l2 3h3v11H4zM9 13a3 3 0 0 1 5-2.2M15 13a3 3 0 0 1-5 2.2" />,
  gear: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />,
  hang: <path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V16l-3 1.5z" />,
  lock: <path d="M4 11h16v10H4zM8 11V7a4 4 0 0 1 8 0v4" />,
  speaker: <path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />,
  headset: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z" />,
  earpiece: <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 6h4" />,
};
const Icon = ({ d, size = 22 }: { d: keyof typeof icons; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icons[d]}
  </svg>
);

function Control({ icon, label, onClick, tone = "plain", disabled = false }: { icon: keyof typeof icons; label: string; onClick: () => void; tone?: "plain" | "on" | "danger" | "go"; disabled?: boolean }) {
  const styles = {
    plain: "border border-white/15 bg-white/10 text-ink",
    on: "border-0 bg-ink text-bg",
    danger: "border-0 bg-[#C0392B] text-white",
    go: "border-0 bg-[#1F8A5B] text-white",
  }[tone];
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`grid size-[58px] place-items-center rounded-full disabled:opacity-40 ${styles}`}>
        <Icon d={icon} size={24} />
      </button>
      <span className="text-[11.5px] text-ink-soft">{label}</span>
    </span>
  );
}

function useWide() {
  const query = "(min-width: 900px)";
  const [wide, setWide] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function MediaView({ stream, muted, mirror, className, sinkId }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; className: string; sinkId?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === stream) return;
    el.srcObject = stream;
    // Started explicitly: some web views don't autoplay a stream that arrives later
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (sinkId && el?.setSinkId) void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${className} ${mirror ? "-scale-x-100" : ""}`} />;
}

/** Plays the other person's audio: an <audio> element kept in the page (not display:none), started explicitly. */
function RemoteAudio({ stream, sinkId }: { stream: MediaStream | null; sinkId?: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    // Android pauses the app's players when the phone switches to call mode (earpiece): play again at once,
    // and check every second; the last refusal is kept for the call report
    const resume = () => {
      if (!el.paused) return;
      void el.play().then(
        () => el.removeAttribute("data-play-error"),
        (err: unknown) => el.setAttribute("data-play-error", err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
      );
    };
    resume();
    el.addEventListener("pause", resume);
    el.addEventListener("loadedmetadata", resume);
    const t = setInterval(resume, 1000);
    // A tap is a gesture: always allowed to start sound
    document.addEventListener("pointerdown", resume, true);
    return () => {
      clearInterval(t);
      // Let go of the stream so the web view closes this output before the next player opens its own
      el.pause();
      el.srcObject = null;
      el.removeEventListener("pause", resume);
      el.removeEventListener("loadedmetadata", resume);
      document.removeEventListener("pointerdown", resume, true);
    };
  }, [stream]);
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (sinkId && el?.setSinkId) void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay playsInline data-remote="" className="pointer-events-none absolute size-px opacity-0" />;
}

/** The microphone's level, so you can see it works (and that mute does). */
function Level({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const t = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
    }, 120);
    return () => {
      clearInterval(t);
      void ctx.close();
    };
  }, [stream]);
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[86px] shrink-0 font-mono text-[10.5px] text-faint">your mic</span>
      <span className="h-1.5 grow overflow-hidden rounded-full bg-line">
        <span className="block h-full bg-online transition-[width]" style={{ width: `${muted ? 0 : Math.round(level * 100)}%` }} />
      </span>
      {muted ? <span className="font-mono text-[10.5px] text-keep">muted</span> : null}
    </div>
  );
}

const OUTPUT_NAME: Record<Output["kind"], string> = {
  earpiece: "Phone earpiece",
  speaker: "Loudspeaker",
  bluetooth: "Bluetooth headset",
  wired: "Wired headphones",
  usb: "USB headset",
  hearing_aid: "Hearing aid",
  other: "Audio device",
};
const outputLabel = (o: Output) => (o.kind === "earpiece" || o.kind === "speaker" ? OUTPUT_NAME[o.kind] : o.name ? `${o.name} (${OUTPUT_NAME[o.kind].toLowerCase()})` : OUTPUT_NAME[o.kind]);

/** The other person's sound as it arrives: shows whether their voice reaches this device at all. */
function IncomingLevel({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void calls.levelIn().then(setLevel), 400);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[86px] shrink-0 font-mono text-[10.5px] text-faint">their voice</span>
      <span className="h-1.5 grow overflow-hidden rounded-full bg-line">
        <span className="block h-full bg-live transition-[width]" style={{ width: `${Math.min(100, Math.round(Math.sqrt(level) * 140))}%` }} />
      </span>
    </div>
  );
}

function DevicePanel({ s, onClose, side }: { s: CallState; onClose: () => void; side: boolean }) {
  const [tone, setTone] = useState("");
  useEffect(() => {
    void listDevices();
    void calls.loadOutputs();
  }, []);
  const current = (kind: "audio" | "video") => s.local?.getTracks().find((t) => t.kind === kind)?.getSettings().deviceId ?? "";
  const pick = (label: string, list: MediaDeviceInfo[], value: string, onChange: (id: string) => void, empty: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[42px] rounded-xl border border-line-strong bg-sunken px-3 text-[13.5px] text-ink outline-none focus:border-accent">
        {list.length ? null : <option value="">{empty}</option>}
        {list.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${empty} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  const canSink = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
  async function test() {
    setTone("playing a test sound…");
    try {
      await playTestTone(s.speakerId);
      setTone("Did you hear two beeps? If not, choose another output above.");
    } catch {
      setTone("The test sound couldn't play on this device.");
    }
  }
  const body = (
    <>
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-extrabold">Sound and microphone</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg bg-transparent text-dim">
          ✕
        </button>
      </div>

      <section aria-labelledby="out-title" className="flex flex-col gap-2">
        <h3 id="out-title" className="m-0 font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
          hear on (output)
        </h3>
        {isNativeApp ? (
          <div role="radiogroup" aria-label="Hear on" className="flex flex-col gap-1.5">
            {s.outputs.length === 0 ? <p className="m-0 text-[12.5px] text-faint">Looking for outputs…</p> : null}
            {s.outputs.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={s.outputId === o.id}
                onClick={() => void calls.selectOutput(o.id)}
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-left text-[14px] ${s.outputId === o.id ? "border-accent bg-accent/10 font-bold text-ink" : "border-line text-ink-soft"}`}
              >
                <span className={`grid size-[18px] place-items-center rounded-full border-2 ${s.outputId === o.id ? "border-accent" : "border-faint"}`}>
                  {s.outputId === o.id ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
                {outputLabel(o)}
              </button>
            ))}
          </div>
        ) : canSink && s.devices.speakers.length ? (
          pick("speaker", s.devices.speakers, s.speakerId ?? "default", (id) => void calls.selectOutput(id), "Speaker")
        ) : (
          <p className="m-0 text-[12.5px] text-faint">This browser plays calls on the computer's default output.</p>
        )}
        <IncomingLevel active />
        <button type="button" onClick={() => void test()} className="min-h-10 self-start rounded-xl border border-line-strong bg-transparent px-3.5 text-[13px] font-semibold text-ink">
          Play a test sound
        </button>
        {tone ? <p className="m-0 text-[12px] text-dim">{tone}</p> : null}
      </section>

      <section aria-labelledby="in-title" className="flex flex-col gap-2">
        <h3 id="in-title" className="m-0 font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
          speak with (input)
        </h3>
        {pick("microphone", s.devices.mics, s.micId ?? current("audio"), (id) => void calls.selectMic(id), "Microphone")}
        <Level stream={s.local} muted={s.muted} />
        {isNativeApp ? <p className="m-0 text-[11.5px] leading-normal text-faint">A Bluetooth headset chosen above also uses its own microphone.</p> : null}
      </section>

      {s.kind === "video" ? pick("camera", s.devices.cams, s.camId ?? current("video"), (id) => void calls.selectCamera(id), "Camera") : null}
      <p className="m-0 text-xs leading-normal text-faint">
        "Their voice" moves when sound arrives from {s.peer?.username ?? "them"}; the green bar when your microphone picks you up. Changes apply at once, without hanging up.
      </p>
    </>
  );
  if (side) return <aside aria-label="Sound and microphone" className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto rounded-[20px] border border-line-strong bg-panel p-5">{body}</aside>;
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <section role="dialog" aria-label="Sound and microphone" onClick={(e) => e.stopPropagation()} className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto rounded-t-[26px] border-t border-line-strong bg-panel px-[18px] pb-7 pt-4">
        {body}
        <button type="button" onClick={onClose} className="min-h-[50px] shrink-0 rounded-[14px] bg-brand text-[15px] font-bold text-white">
          Done
        </button>
      </section>
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** The call, over everything: ringing, connecting, in call, ended, or "not taking calls". */
export function CallScreen() {
  const [s, setS] = useState(calls.get());
  const [devices, setDevices] = useState(false);
  const [now, setNow] = useState(Date.now());
  const wide = useWide();
  useEffect(() => calls.subscribe(setS), []);
  useEffect(() => {
    if (s.phase !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.phase]);
  if (s.phase === "idle" || !s.peer) return null;
  const name = s.peer.username;
  const video = s.kind === "video";
  const remoteHasVideo = Boolean(s.remote?.getVideoTracks().some((t) => t.readyState === "live"));
  const chip = s.code ? (
    <span title="Compare these numbers aloud: the same on both devices means nobody is in between" className="inline-flex items-center gap-1.5 rounded-full border border-online/45 px-2.5 py-1 font-mono text-[10.5px] text-ok">
      <Icon d="lock" size={12} />
      {s.verified === false ? "not verified" : "encrypted"} · {s.code}
    </span>
  ) : null;

  if (s.phase === "unavailable") {
    return (
      <div role="dialog" aria-label="Call" className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-5">
        <section className="flex w-full max-w-[400px] flex-col items-center gap-3.5 rounded-[22px] border border-line-strong bg-panel px-6 py-7 text-center">
          <Avatar username={name} size={80} />
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-keep">{/isn't taking calls/.test(s.note) ? "not taking calls" : "can't call now"}</p>
          <h2 className="m-0 text-xl font-extrabold">{/isn't taking calls/.test(s.note) ? `${name} isn't taking calls right now` : `You can't reach ${name} now`}</h2>
          <p className="m-0 max-w-[34ch] text-sm leading-relaxed text-dim">{s.note.replace(/^[^.]*taking calls right now\. /, "")}</p>
          <button type="button" onClick={() => calls.dismiss()} className="min-h-12 rounded-[14px] bg-brand px-6 text-[14.5px] font-bold text-white">
            Write a message
          </button>
        </section>
      </div>
    );
  }

  if (s.phase === "incoming") {
    const card = (
      <>
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{"// incoming "}{s.group ? "group " : ""}{s.kind} call</p>
        {s.group ? <GroupIcon size={wide ? 88 : 112} /> : <Avatar username={name} size={wide ? 88 : 112} />}
        <h1 className="m-0 text-[26px] font-extrabold">{s.group ? s.group.name : name}</h1>
        {s.group ? <p className="m-0 text-sm text-ink-soft">started by {name}</p> : null}
        {chip}
        <p className="m-0 text-[13px] text-dim">End-to-end encrypted, straight between your devices</p>
      </>
    );
    const buttons = (
      <div className={`flex w-full ${wide ? "gap-2.5" : "justify-around"}`}>
        <Control icon="hang" label="Decline" tone="danger" onClick={() => calls.decline()} />
        <Control icon="phone" label="Voice only" onClick={() => void calls.accept("voice")} />
        {video ? <Control icon="video" label="Video" tone="go" onClick={() => void calls.accept("video")} /> : <Control icon="phone" label="Answer" tone="go" onClick={() => void calls.accept("voice")} />}
      </div>
    );
    return wide ? (
      <div role="dialog" aria-label={`Incoming call from ${name}`} className="fixed inset-0 z-50 grid place-items-center bg-black/55">
        <section className="flex w-[420px] flex-col items-center gap-3.5 rounded-3xl border border-line-strong bg-panel p-7 text-center shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          {card}
          {buttons}
          <span className="text-xs text-faint">The browser asks once for your microphone and camera.</span>
        </section>
      </div>
    ) : (
      <div role="dialog" aria-label={`Incoming call from ${name}`} className="fixed inset-0 z-50 flex flex-col bg-[#07080C]">
        <div className="flex grow flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_50%_35%,rgba(126,34,52,0.35),transparent_60%)] px-6 text-center">{card}</div>
        <div className="px-6 pb-11 pt-5">{buttons}</div>
      </div>
    );
  }

  if (s.group) return <GroupCall s={s} wide={wide} now={now} devices={devices} setDevices={setDevices} />;

  const status =
    s.phase === "calling" ? "ringing…" : s.phase === "connecting" ? "connecting…" : s.phase === "ended" ? s.note : `${clock(now - (s.startedAt ?? now))}${s.relayed ? " · through the relay" : " · direct"}`;
  const controls = (
    <div className={`flex ${wide ? "gap-3 rounded-full border border-white/10 bg-[rgba(10,11,16,0.75)] px-4 py-3" : "justify-between"}`}>
      <Control icon={s.muted ? "micOff" : "mic"} label={s.muted ? "Unmute" : "Mute"} tone={s.muted ? "on" : "plain"} onClick={() => calls.toggleMute()} disabled={s.phase === "ended"} />
      {video ? <Control icon={s.cameraOn ? "video" : "camOff"} label={s.cameraOn ? "Camera" : "Camera off"} tone={s.cameraOn ? "plain" : "on"} onClick={() => calls.toggleCamera()} disabled={s.phase === "ended"} /> : null}
      {video && !wide ? <Control icon="flip" label="Flip" onClick={() => void calls.flip()} disabled={s.phase === "ended"} /> : null}
      {isNativeApp ? (
        <Control
          icon={s.speaker ? "speaker" : s.route === "headset" ? "headset" : "earpiece"}
          label={s.speaker ? "Speaker on" : s.route === "headset" ? (s.outputs.find((o) => o.id === s.outputId)?.name || "Headset").slice(0, 14) : "Earpiece"}
          tone={s.speaker ? "on" : "plain"}
          onClick={() => void calls.toggleSpeaker()}
          disabled={s.phase === "ended"}
        />
      ) : null}
      <Control icon="gear" label="Sound" onClick={() => setDevices((d) => !d)} disabled={s.phase === "ended"} />
      <Control icon="hang" label="Hang up" tone="danger" onClick={() => (s.phase === "ended" ? calls.dismiss() : calls.hangUp())} />
    </div>
  );
  return (
    <div role="dialog" aria-label={`Call with ${name}`} className="fixed inset-0 z-50 flex bg-[#07080C] text-ink">
      <div className={`relative flex grow flex-col overflow-hidden ${wide ? "m-4 rounded-3xl" : ""} bg-gradient-to-br from-[#22303F] via-[#3B2A44] to-[#2A1A20]`}>
        {video && remoteHasVideo ? <MediaView stream={s.remote} muted className="absolute inset-0 size-full object-cover" /> : null}
        {!video || !remoteHasVideo ? (
          <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 opacity-80">
            <Avatar username={name} size={wide ? 180 : 140} />
          </div>
        ) : null}
        {/* The other person's voice, always through its own element (video elements stay muted) */}
        {/* A new element (key) each time the output changes: the web view opens its sound output again there */}
        <RemoteAudio key={s.audioEpoch} stream={s.remote} sinkId={s.speakerId} />
        <div className="relative flex items-start gap-2.5 bg-gradient-to-b from-black/60 to-transparent px-4 pb-6 pt-[18px]">
          <div className="flex grow flex-col gap-1">
            <span className="text-[17px] font-extrabold">{name}</span>
            <span className="font-mono text-[11px] text-ink-soft">{status}</span>
          </div>
          {chip}
        </div>
        {video && s.local ? (
          <div className={`absolute overflow-hidden rounded-2xl border-2 border-white/25 bg-[#1F3A35] ${wide ? "bottom-[110px] right-5 h-[150px] w-[240px]" : "right-4 top-[86px] h-[150px] w-[104px]"}`}>
            {s.cameraOn ? <MediaView stream={s.local} muted mirror={s.facing === "user"} className="size-full object-cover" /> : null}
            <span className="absolute bottom-1.5 left-2 font-mono text-[10px]">you{s.muted ? " · muted" : ""}</span>
          </div>
        ) : null}
        <div className="grow" />
        <div className={`relative flex flex-col gap-3 ${wide ? "items-center pb-6" : "bg-gradient-to-b from-transparent to-black/60 px-3.5 pb-[34px] pt-[18px]"}`}>
          {controls}
          {s.muted && s.phase !== "ended" ? <p className="m-0 self-center font-mono text-[10.5px] text-ink-soft">you're muted · {name} can't hear you</p> : null}
        </div>
        {devices && !wide ? <DevicePanel s={s} side={false} onClose={() => setDevices(false)} /> : null}
      </div>
      {devices && wide ? (
        <div className="my-4 mr-4 flex">
          <DevicePanel s={s} side onClose={() => setDevices(false)} />
        </div>
      ) : null}
    </div>
  );
}

function GroupIcon({ size }: { size: number }) {
  return (
    <span aria-hidden="true" className="grid place-items-center bg-[#1F2A44] text-auto" style={{ width: size, height: size, borderRadius: size * 0.32 }}>
      <svg viewBox="0 0 24 24" width={size * 0.48} height={size * 0.48} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <circle cx="17" cy="9" r="2.6" />
        <path d="M15.5 14.2A5 5 0 0 1 21 19" />
      </svg>
    </span>
  );
}

/** A group call: a tile per person (their video or initials), everyone can leave, only the starter ends it for all. */
function GroupCall({ s, wide, now, devices, setDevices }: { s: CallState; wide: boolean; now: number; devices: boolean; setDevices: (fn: (d: boolean) => boolean) => void }) {
  const video = s.kind === "video";
  const inCall = s.members.length + 1;
  const status = s.phase === "calling" ? "ringing the members…" : s.phase === "connecting" ? "joining…" : s.phase === "ended" ? s.note : `${clock(now - (s.startedAt ?? now))} · ${inCall} in the call`;
  const tile = "relative grid min-h-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#2A3A55] to-[#0D0E14]";
  return (
    <div role="dialog" aria-label={`Group call in ${s.group!.name}`} className="fixed inset-0 z-50 flex bg-[#07080C] text-ink">
      <div className="flex min-w-0 grow flex-col">
        <div className="flex items-start gap-2.5 px-4 pb-3 pt-[18px]">
          <div className="flex grow flex-col gap-1">
            <span className="text-[17px] font-extrabold">{s.group!.name}</span>
            <span className="font-mono text-[11px] text-ink-soft">{status}</span>
          </div>
          <span className="rounded-full border border-online/45 px-2.5 py-1 font-mono text-[10.5px] text-ok">encrypted · up to 6</span>
        </div>
        <div className={`grid min-h-0 grow auto-rows-fr gap-2 px-3 ${inCall > 4 ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className={tile}>
            {video && s.cameraOn && s.local ? <MediaView stream={s.local} muted mirror={s.facing === "user"} className="absolute inset-0 size-full object-cover" /> : <Avatar username="you" size={64} />}
            <span className="absolute bottom-2 left-2.5 font-mono text-[10.5px] [text-shadow:0_1px_2px_#000]">you{s.muted ? " · muted" : ""}</span>
          </div>
          {s.members.map((m) => {
            const hasVideo = Boolean(m.stream?.getVideoTracks().some((t) => t.readyState === "live"));
            return (
              <div key={m.id} className={`${tile} ${m.connected ? "" : "opacity-60"}`}>
                {video && hasVideo ? <MediaView stream={m.stream} muted className="absolute inset-0 size-full object-cover" /> : <Avatar username={m.username} size={64} />}
                <RemoteAudio key={`${s.audioEpoch}:${m.id}`} stream={m.stream} sinkId={s.speakerId} />
                <span className="absolute bottom-2 left-2.5 font-mono text-[10.5px] [text-shadow:0_1px_2px_#000]">
                  {m.username}
                  {m.connected ? "" : " · connecting…"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 px-3.5 pb-[30px] pt-4">
          <div className="flex justify-between">
            <Control icon={s.muted ? "micOff" : "mic"} label={s.muted ? "Unmute" : "Mute"} tone={s.muted ? "on" : "plain"} onClick={() => calls.toggleMute()} disabled={s.phase === "ended"} />
            {video ? <Control icon={s.cameraOn ? "video" : "camOff"} label={s.cameraOn ? "Camera" : "Camera off"} tone={s.cameraOn ? "plain" : "on"} onClick={() => calls.toggleCamera()} disabled={s.phase === "ended"} /> : null}
            {video && !wide ? <Control icon="flip" label="Flip" onClick={() => void calls.flip()} disabled={s.phase === "ended"} /> : null}
            <Control icon="gear" label="Sound" onClick={() => setDevices((d) => !d)} disabled={s.phase === "ended"} />
            <Control icon="hang" label={s.phase === "ended" ? "Close" : "Leave"} tone="danger" onClick={() => (s.phase === "ended" ? calls.dismiss() : calls.hangUp(false))} />
          </div>
          {s.starter && s.phase !== "ended" ? (
            <button
              type="button"
              onClick={() => calls.hangUp(true)}
              className="min-h-[46px] rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-xs font-bold text-danger-ink before:content-['[_'] after:content-['_]']"
            >
              END FOR EVERYONE
            </button>
          ) : null}
          {s.phase !== "ended" ? (
            <p className="m-0 self-center font-mono text-[10.5px] text-dim">{s.starter ? "you started this call: you can end it for everyone" : "only the one who started the call can end it for everyone"}</p>
          ) : null}
        </div>
        {devices && !wide ? <DevicePanel s={s} side={false} onClose={() => setDevices(() => false)} /> : null}
      </div>
      {devices && wide ? (
        <div className="my-4 mr-4 flex">
          <DevicePanel s={s} side onClose={() => setDevices(() => false)} />
        </div>
      ) : null}
    </div>
  );
}
