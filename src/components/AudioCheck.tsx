import { useEffect, useRef, useState } from "react";
import { playTestTone } from "../lib/audioCheck";

type Step = "idle" | "listening" | "recording" | "playing" | "done" | "error";

/**
 * Settings › Calls: checks this device's microphone and speaker before a call. A test sound plays; then 3 seconds
 * are recorded and played back. Nothing leaves the device.
 */
export function AudioCheck() {
  const [step, setStep] = useState<Step>("idle");
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [note, setNote] = useState("");
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  async function run() {
    setNote("");
    setPeak(0);
    try {
      setStep("playing");
      await playTestTone();
      setStep("listening");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let max = 0;
      const t = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let p = 0;
        for (const v of data) p = Math.max(p, Math.abs(v - 128));
        const l = Math.min(1, p / 64);
        max = Math.max(max, l);
        setLevel(l);
        setPeak(max);
      }, 100);
      stop.current = () => {
        clearInterval(t);
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx.close();
      };
      setStep("recording");
      const recorder = new MediaRecorder(stream);
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      const done = new Promise((r) => (recorder.onstop = r));
      recorder.start();
      await new Promise((r) => setTimeout(r, 3000));
      recorder.stop();
      await done;
      stop.current();
      setLevel(0);
      setStep("playing");
      const url = URL.createObjectURL(new Blob(parts, { type: recorder.mimeType }));
      const el = new Audio(url);
      await el.play();
      await new Promise((r) => (el.onended = r));
      URL.revokeObjectURL(url);
      setStep("done");
      setNote(
        max < 0.05
          ? "The microphone picked up almost nothing: check it isn't muted or blocked (phone settings › Apps › H_CHAT › Permissions › Microphone)."
          : "Your microphone works. Did you hear the two beeps and then your own voice? If not, the speaker or headphones are the problem.",
      );
    } catch (err) {
      stop.current();
      setStep("error");
      setNote(err instanceof DOMException && err.name === "NotAllowedError" ? "H_CHAT isn't allowed to use the microphone. Allow it in the settings and try again." : "The check couldn't run on this device.");
    }
  }

  const busy = step === "listening" || step === "recording" || step === "playing";
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-3">
        <span className="flex grow flex-col gap-0.5">
          <span className="text-[14.5px] font-bold">Test microphone and speaker</span>
          <span className="text-[12.5px] leading-normal text-dim">
            {step === "playing" ? "Listen…" : step === "recording" || step === "listening" ? "Say something for 3 seconds…" : "Two beeps, then 3 seconds of your voice played back. Nothing leaves this device."}
          </span>
        </span>
        <button type="button" disabled={busy} onClick={() => void run()} className="min-h-10 shrink-0 rounded-[11px] border border-line-strong bg-transparent px-3.5 text-[13px] font-bold text-ink disabled:opacity-50">
          {step === "done" || step === "error" ? "Again" : "Start"}
        </button>
      </div>
      {step === "recording" || step === "listening" || step === "done" ? (
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10.5px] text-faint">mic</span>
          <span className="h-1.5 grow overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-online transition-[width]" style={{ width: `${Math.round((step === "done" ? peak : level) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      {note ? <p className={`m-0 text-[12.5px] leading-normal ${step === "error" ? "text-danger-ink" : "text-ink-soft"}`}>{note}</p> : null}
    </div>
  );
}
