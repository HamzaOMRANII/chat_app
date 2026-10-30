import { useEffect, useState } from "react";
import { Avatar, PageHeader } from "../components/PageHeader";
import { Notice } from "../components/Screen";
import { api } from "../lib/api";
import { longDuration } from "../lib/chats";
import { lastSeen } from "../lib/contacts";
import type { Group } from "../lib/groups";
import { GroupAvatar } from "./GroupPage";

type Props = { groupId: string; userId: string; onBack: () => void; onLeft: () => void; onAuthError: (err: unknown) => boolean };

/** A group's rules and members; leaving it. Everything else is managed by the administrator. */
export function GroupInfoPage({ groupId, userId, onBack, onLeft, onAuthError }: Props) {
  const [group, setGroup] = useState<Group | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ group: Group }>(`/api/groups/${groupId}`)
      .then((r) => setGroup(r.group))
      .catch((err) => !onAuthError(err) && onBack());
  }, [groupId, onAuthError, onBack]);

  async function leave() {
    try {
      await api(`/api/groups/${groupId}/leave`, { method: "POST" });
      onLeft();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof Error ? err.message : "Couldn't leave");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <PageHeader title="Group" onBack={onBack} />
      {group ? (
        <div className="flex grow flex-col gap-4 px-4 py-5">
          <div className="flex flex-col items-center gap-2">
            <GroupAvatar size={80} />
            <h2 className="m-0 text-[22px] font-extrabold">{group.name}</h2>
            <p className="m-0 font-mono text-[11.5px] text-dim">managed by the administrator · {group.members.length} members</p>
          </div>
          <dl className="m-0 flex flex-col gap-1.5 rounded-2xl border border-line bg-panel px-4 py-3.5 font-mono text-xs text-ink-soft">
            <div className="flex justify-between">
              <dt className="text-faint">messages stay</dt>
              <dd className="m-0">{longDuration(group.retentionMinutes)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">files</dt>
              <dd className="m-0">{group.files ? "allowed" : "not allowed"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">export</dt>
              <dd className="m-0">not available in groups</dd>
            </div>
          </dl>
          <h3 className="eyebrow m-0 text-[11px] font-normal">members · {group.members.length}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-t border-line px-1 py-2.5">
                <Avatar username={m.username} size={36} online={m.online} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14.5px] font-bold">{m.id === userId ? `${m.username} (you)` : m.username}</span>
                  {m.id === userId ? null : <span className={`text-xs ${m.online ? "text-online" : "text-dim"}`}>{lastSeen(m)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="grow" />
          {error ? <Notice tone="error">{error}</Notice> : null}
          {confirm ? (
            <Notice tone="warning">
              <span className="flex flex-col gap-3">
                <span>Leave {group.name}? You won't receive or read anything new. Only the administrator can add you back.</span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => void leave()} className="min-h-10 rounded-field bg-brand px-3.5 text-[13.5px] font-bold text-white">
                    Leave
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm(false)}
                    className="min-h-10 rounded-field border border-line-strong bg-transparent px-3.5 text-[13.5px] font-semibold text-ink"
                  >
                    Stay
                  </button>
                </span>
              </span>
            </Notice>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="min-h-12 rounded-[14px] border border-dashed border-danger bg-transparent font-mono text-[12.5px] font-bold uppercase text-danger-ink before:content-['[_'] after:content-['_]']"
            >
              Leave the group
            </button>
          )}
          <p className="m-0 text-center text-xs leading-normal text-faint">
            Members and settings are managed by the administrator. Whoever leaves or is removed can't read new messages.
          </p>
        </div>
      ) : (
        <p className="p-6 text-sm text-dim">Loading…</p>
      )}
    </main>
  );
}
