import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Chat } from "../lib/chats";
import { buildExport, PERIOD_TEXT, type ExportReq } from "../lib/exports";
import { bytes, openSavedFolder, saveBlob } from "../lib/files";
import { isNativeApp } from "../lib/platform";

const left = (iso: string, now: number) => {
  const ms = Math.max(0, Date.parse(iso) - now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `${h}:${String(m).padStart(2, "0")}`;
};

type Props = { exports: ExportReq[]; chat: Chat; userId: string; onChanged: () => void; onError: (err: unknown) => void };

/** Export requests in the chat: approve or refuse, waiting, ready to save (24 h), or refused. */
export function ExportCards({ exports, chat, userId, onChanged, onError }: Props) {
  const [now, setNow] = useState(Date.now());
  const [progress, setProgress] = useState<{ id: string; text: string; ratio: number } | null>(null);
  const [saved, setSaved] = useState("");
  const [viewSaved, setViewSaved] = useState<(() => void) | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const peer = chat.with?.username ?? "your contact";
  const open = (e: ExportReq) => Date.parse(e.until) > now;
  const recent = (e: ExportReq) => e.answeredAt && now - Date.parse(e.answeredAt) < 24 * 3600_000;
  const shown = exports.filter(
    (e) => ((e.status === "pending" || e.status === "approved") && open(e)) || (e.status === "refused" && e.requestedBy === userId && recent(e)),
  );
  if (!shown.length) return null;

  async function act(path: string, method: "POST" | "DELETE" = "POST") {
    try {
      await api(path, { method });
      onChanged();
    } catch (err) {
      onError(err);
    }
  }

  async function build(e: ExportReq) {
    try {
      setProgress({ id: e.id, text: "starting", ratio: 0 });
      const out = await buildExport({ chat, userId, req: e, onProgress: (text, ratio) => setProgress({ id: e.id, text, ratio }) });
      const where = await saveBlob(out.blob, out.name);
      await api(`/api/exports/${e.id}/downloaded`, { method: "POST" });
      setViewSaved(() => out.view);
      setSaved(
        `${where}${isNativeApp ? " (Documents/H_CHAT)" : " to your Downloads folder"}: ${out.name} · ${bytes(out.blob.size)}${out.left ? ` · ${out.left} view-only file${out.left > 1 ? "s" : ""} left out` : ""}`,
      );
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setProgress(null);
    }
  }

  const what = (e: ExportReq) =>
    `${[e.messages ? `${e.counts.messages} messages` : "", e.media ? `${e.counts.files} files · ${bytes(e.counts.bytes)}` : ""].filter(Boolean).join(" + ")} · ${PERIOD_TEXT[e.period]}`;

  return (
    <>
      {shown.map((e) => {
        const mine = e.requestedBy === userId;
        if (e.status === "refused") {
          return (
            <p key={e.id} className="m-0 self-center font-mono text-[11px] text-danger-ink">
              {"// "}
              {peer} refused your export
            </p>
          );
        }
        if (e.status === "pending" && !mine) {
          return (
            <section
              key={e.id}
              role="alert"
              aria-label="Export request"
              className="mt-2 flex flex-col gap-2.5 rounded-2xl border border-keep-line bg-keep/[0.07] p-3.5"
            >
              <h3 className="m-0 text-[15px] font-extrabold">{peer} wants to export this chat</h3>
              <p className="m-0 font-mono text-[11.5px] text-[#F3E3BF]">{what(e)}</p>
              <p className="m-0 text-[12.5px] leading-normal text-ink-soft">
                A copy leaves H_CHAT and stays on {peer}'s device. Your view-only files are never included.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void act(`/api/exports/${e.id}/refuse`)}
                  className="min-h-[46px] flex-1 rounded-xl border border-line-strong bg-transparent text-sm font-semibold text-ink"
                >
                  Refuse
                </button>
                <button
                  type="button"
                  onClick={() => void act(`/api/exports/${e.id}/approve`)}
                  className="min-h-[46px] flex-1 rounded-xl bg-brand text-sm font-bold text-white"
                >
                  Approve
                </button>
              </div>
              <p className="m-0 font-mono text-[10.5px] text-dim">the request expires in {left(e.until, now)} if you don't answer</p>
            </section>
          );
        }
        if (e.status === "pending") {
          return (
            <p key={e.id} className="m-0 flex flex-wrap items-center justify-center gap-2 self-center font-mono text-[11px] text-dim">
              {"// waiting for "}
              {peer} to approve your export
              <button type="button" onClick={() => void act(`/api/exports/${e.id}`, "DELETE")} className="bg-transparent p-0 font-mono text-[11px] text-link">
                cancel
              </button>
            </p>
          );
        }
        if (!mine) {
          return (
            <p key={e.id} className="m-0 self-center font-mono text-[11px] text-dim">
              {"// "}
              {peer} can save the export for {left(e.until, now)} more{e.downloadedAt ? " · saved" : ""}
            </p>
          );
        }
        const building = progress?.id === e.id;
        return (
          <section
            key={e.id}
            role="status"
            aria-label="Export ready"
            className="mt-2 flex flex-col gap-2.5 rounded-2xl border border-[#3A6B57] bg-online/[0.06] p-3.5"
          >
            <div className="flex items-center justify-between gap-2.5">
              <h3 className="m-0 text-[15px] font-extrabold">Export ready</h3>
              <span className="font-mono text-[11px] text-online">{left(e.until, now)} left</span>
            </div>
            <p className="m-0 font-mono text-[11.5px] text-dim">{what(e)}</p>
            {building ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-sunken p-3">
                <div className="flex justify-between font-mono text-[11px] text-ink-soft">
                  <span>building the zip on this device</span>
                  <span>{Math.round(progress.ratio * 100)}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                </div>
                <p className="m-0 truncate font-mono text-[10.5px] text-faint">{progress.text}</p>
              </div>
            ) : null}
            {saved && !building ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 font-mono text-[11px] text-ok">{saved}</p>
                {isNativeApp ? (
                  <button
                    type="button"
                    onClick={() => void openSavedFolder().catch(() => onError(new Error("Open the Files app, then Documents › H_CHAT.")))}
                    className="min-h-11 rounded-xl border border-line-strong bg-transparent text-sm font-semibold text-ink"
                  >
                    Open the folder
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => viewSaved?.()}
                      className="min-h-11 rounded-xl border border-line-strong bg-transparent text-sm font-semibold text-ink"
                    >
                      Open the export
                    </button>
                    <p className="m-0 text-[11.5px] leading-normal text-faint">
                      A website can't open your computer's folders: the zip is in your Downloads folder (Ctrl+J in Chrome, Edge and Firefox, ⌥⌘L in Safari,
                      shows it).
                    </p>
                  </>
                )}
              </div>
            ) : null}
            <button
              type="button"
              disabled={Boolean(progress)}
              onClick={() => void build(e)}
              className="min-h-12 rounded-xl bg-brand text-[14.5px] font-bold text-white disabled:opacity-60"
            >
              {e.downloadedAt ? "Save it again" : "Build and save the zip"}
            </button>
            <p className="m-0 text-[11.5px] leading-normal text-faint">
              chat.html (photos inline), chat.txt and media/. After 24 hours the approval expires: ask again to export later.
            </p>
          </section>
        );
      })}
    </>
  );
}
