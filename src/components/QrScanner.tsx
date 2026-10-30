import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/** Browser camera QR reader (the web app; the APK uses Google's scanner). Calls onResult once with the text read. */
export function QrScanner({ onResult, onClose, onUpload }: { onResult: (text: string) => void; onClose: () => void; onUpload: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          done = true;
          onResult(code.data);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (s) => {
        stream = s;
        if (done || !video.current) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setError("No camera access. Allow the camera for this site in your browser, or type the ID."));

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a QR code" className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <p className="m-0 grow text-[15px] font-bold text-white">Point at their H_CHAT QR code</p>
        <button type="button" onClick={onClose} className="min-h-11 rounded-field border border-line-strong bg-panel px-4 text-sm font-semibold text-ink">
          Close
        </button>
      </div>
      <div className="relative grid grow place-items-center overflow-hidden">
        {error ? (
          <p role="alert" className="m-6 rounded-field border border-dashed border-danger px-4 py-3 text-sm text-[#FFC9C9]">
            {error}
          </p>
        ) : (
          <>
            <video ref={video} muted playsInline className="h-full w-full object-cover" />
            <span aria-hidden="true" className="absolute size-[min(70vw,300px)] rounded-3xl border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </>
        )}
      </div>
      <div className="px-4 pb-6 pt-3">
        <button
          type="button"
          onClick={onUpload}
          className="min-h-12 w-full rounded-control border border-line-strong bg-panel text-[14.5px] font-semibold text-ink"
        >
          Can't scan? Upload a QR image
        </button>
      </div>
    </div>
  );
}
