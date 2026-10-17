import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { AudioCheck } from "./AudioCheck";

/** Settings › Calls: receive calls, or not. Callers are told you aren't taking calls, never why. */
export function CallSettings() {
  const [receive, setReceive] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ receive: boolean }>("/api/me/calls")
      .then((r) => setReceive(r.receive))
      .catch(() => {});
  }, []);
  async function change(value: boolean) {
    setReceive(value);
    try {
      setReceive((await api<{ receive: boolean }>("/api/me/calls", { method: "PUT", body: { receive: value } })).receive);
    } catch {
      setReceive(!value);
    }
  }
  if (receive === null) return null;
  return (
    <section aria-labelledby="calls-title" className="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-3.5">
      <h2 id="calls-title" className="m-0 text-sm font-bold">
        Calls
      </h2>
      <div className="flex items-center gap-3">
        <span className="flex grow flex-col gap-0.5">
          <span className="text-[14.5px] font-bold">Receive calls</span>
          <span className="text-[12.5px] leading-normal text-dim">
            {receive ? "Your contacts can call you." : "Off: nobody can call you. They're told you aren't taking calls, never why."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={receive}
          aria-label="Receive calls"
          onClick={() => void change(!receive)}
          className={`relative h-7 w-12 shrink-0 rounded-full border ${receive ? "border-[#1F8A5B] bg-[#1F8A5B]" : "border-line-strong bg-line"}`}
        >
          <span className={`absolute top-[3px] size-5 rounded-full transition-[left] ${receive ? "left-[23px] bg-white" : "left-[3px] bg-dim"}`} />
        </button>
      </div>
      <AudioCheck />
    </section>
  );
}
