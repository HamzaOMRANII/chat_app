import { Button } from "../components/Button";
import { AuthScreen, Notice } from "../components/Screen";
import { place, when, type Closed } from "../app/types";

const MESSAGES: Record<Closed["code"], [string, string]> = {
  session_revoked: ["You were signed in on another device", "H_CHAT works on one device at a time, so this session was closed."],
  session_closed: ["You were signed out", "This session was closed by you or by the administrator."],
  account_unavailable: ["This account can't be used", "It was suspended or removed. Contact the administrator."],
  session_expired: ["Your session ended", "Sign in again to continue."],
};

export function ClosedPage({ closed, onSignIn }: { closed: Closed; onSignIn: () => void }) {
  const [title, text] = MESSAGES[closed.code];
  const replaced = closed.code === "session_revoked";
  return (
    <AuthScreen>
      <div className="flex flex-col items-center gap-4 pt-4 text-center">
        <div className="grid size-[72px] place-items-center rounded-[22px] border border-line-strong bg-panel">
          <svg
            viewBox="0 0 24 24"
            width="34"
            height="34"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-soft"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="14" height="10" rx="1.5" />
            <path d="M6 18h6" />
            <rect x="17" y="8" width="5" height="12" rx="1.2" />
          </svg>
        </div>
        <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="m-0 text-[14.5px] leading-relaxed text-ink-soft">{text}</p>
      </div>
      {replaced && closed.by ? (
        <section className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-panel px-[18px] py-4">
          <p className="eyebrow m-0">new sign-in</p>
          <p className="m-0 text-base font-bold">{closed.by.name ?? "Another device"}</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs text-ink-soft">
            <span>
              <span className="text-faint">when </span>
              {closed.at ? when(closed.at) : "just now"}
            </span>
            <span>
              <span className="text-faint">where </span>
              {place(closed.by.city, closed.by.country)}
            </span>
          </div>
        </section>
      ) : null}
      {closed.code !== "account_unavailable" ? (
        <Button block onClick={onSignIn}>
          Sign in on this device
        </Button>
      ) : null}
      {replaced ? <Notice tone="error">Not you? Sign in here and change your password right away. Signing in closes the other session.</Notice> : null}
    </AuthScreen>
  );
}
