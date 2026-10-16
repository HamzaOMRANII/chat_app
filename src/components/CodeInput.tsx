import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/** Six one-digit boxes; typing moves forward, Backspace moves back, pasting fills all. */
export function CodeInput({ value, onChange, length = 6, autoFocus = true }: { value: string; onChange: (code: string) => void; length?: number; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="grid grid-cols-6 gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          aria-label={`Digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          value={digit}
          onPaste={onPaste}
          onKeyDown={(e) => onKeyDown(i, e)}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(-1);
            setDigit(i, d);
            if (d && i < length - 1) refs.current[i + 1]?.focus();
          }}
          className="min-h-14 w-full rounded-field border border-line-strong bg-bg text-center font-mono text-2xl font-bold text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(199,112,126,0.18)]"
        />
      ))}
    </div>
  );
}
