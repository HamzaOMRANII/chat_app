import QRCode from "qrcode";
import { useMemo } from "react";

/** QR code drawn as one SVG path (dark modules in brand burgundy on a light tile, like the design). */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    let d = "";
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
    }
    return { n: modules.size, path: d };
  }, [text]);
  return (
    <span className="rounded-[14px] bg-ink p-3">
      <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="block">
        <path d={path} fill="#0A0B10" />
      </svg>
    </span>
  );
}
