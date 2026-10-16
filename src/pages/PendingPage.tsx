import { Wordmark } from "../components/Logo";
import { Button } from "../components/Button";
import { AuthScreen } from "../components/Screen";

export function PendingPage({ username, onBack }: { username: string; onBack: () => void }) {
  return (
    <AuthScreen>
      <p className="m-0 text-center text-lg">
        <Wordmark />
      </p>
      <section className="flex flex-col items-center gap-4 rounded-card border border-line bg-panel px-5 py-8 text-center">
        <div className="grid size-[72px] place-items-center rounded-[22px] border border-keep-line bg-keep/12">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-keep" aria-hidden="true">
            <path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.16em] text-keep">pending approval</p>
        <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">Waiting for approval</h1>
        <p className="m-0 text-[14.5px] leading-relaxed text-ink-soft">
          An administrator will review the account <span className="font-mono text-ink">{username}</span>. H_CHAT sends no
          notifications, so come back and sign in later. You'll get in once it's approved.
        </p>
        <p className="m-0 w-full rounded-control border border-dashed border-line-strong bg-bg px-3.5 py-3 text-left text-[13px] text-ink-soft">
          Remember your recovery passcode. You'll need it if you ever lose your email.
        </p>
      </section>
      <Button variant="secondary" block onClick={onBack}>
        Back to sign in
      </Button>
    </AuthScreen>
  );
}
