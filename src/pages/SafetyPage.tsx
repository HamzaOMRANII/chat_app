import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { myIdentity, type Chat } from "../lib/chats";
import { markSafetyChecked, safetyChecked, safetyCode } from "../lib/e2e";

/** Both phones show the same 12 groups when nobody is in between. */
export function SafetyPage({ chat, userId, onBack }: { chat: Chat; userId: string; onBack: () => void }) {
  const [code, setCode] = useState<string[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const peer = chat.with;

  useEffect(() => {
    if (!peer?.identityPub) return;
    void myIdentity(userId).then(async (id) => {
      const groups = await safetyCode(id.signPub, peer.identityPub!);
      setCode(groups);
      setCheckedAt(safetyChecked(userId, peer.id, groups));
    });
  }, [peer, userId]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="Safety code" onBack={onBack} />
      <div className="flex flex-col gap-4 px-[18px] py-[22px]">
        <p className="m-0 text-sm leading-relaxed text-ink-soft">
          Compare this code with <strong className="text-ink">{peer?.username}</strong>, in person or on a call. If it's the same on both phones, nobody is reading your
          messages in between.
        </p>
        {!peer?.identityPub ? <Notice tone="warning">{peer?.username ?? "Your contact"} hasn't set up encryption on their device yet.</Notice> : null}
        {code ? (
          <div
            aria-label="Safety code"
            className="grid grid-cols-3 gap-2.5 rounded-[20px] border border-line-strong bg-panel px-4 py-5 text-center font-mono text-[clamp(16px,5.4vw,21px)] font-bold tracking-[0.06em]"
          >
            {code.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        ) : null}
        <p className="m-0 rounded-field border border-dashed border-line-strong px-3.5 py-3 text-[12.5px] leading-normal text-dim">
          The code changes when either of you signs in on a new device. If you checked it before, you'll see that it's no longer marked as checked.
        </p>
        {checkedAt ? (
          <p role="status" className="m-0 flex items-center gap-2.5 rounded-field border border-online/40 bg-online/10 px-3.5 py-3 text-[13px] text-[#C9F2DF]">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-online" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Marked as checked on {new Date(checkedAt).toLocaleDateString()}
          </p>
        ) : code && peer ? (
          <button
            type="button"
            onClick={() => {
              markSafetyChecked(userId, peer.id, code);
              setCheckedAt(new Date().toISOString());
            }}
            className="min-h-[50px] rounded-[14px] bg-brand text-[15px] font-bold text-white hover:bg-brand-hover"
          >
            We compared it, it matches
          </button>
        ) : null}
      </div>
    </main>
  );
}
