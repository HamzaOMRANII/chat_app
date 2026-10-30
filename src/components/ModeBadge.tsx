export type ChatMode = "live" | "keep" | "auto";

const styles: Record<ChatMode, string> = {
  live: "border-live-line text-live",
  keep: "border-keep-line text-keep",
  auto: "border-auto-line text-auto",
};

export function ModeBadge({ mode, days }: { mode: ChatMode; days?: number }) {
  const label = mode === "live" ? "LIVE" : `${mode === "keep" ? "KEEP" : "AUTO"} · ${days ?? 7}D`;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold ${styles[mode]}`}>
      {mode === "live" && <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />}
      {label}
    </span>
  );
}
