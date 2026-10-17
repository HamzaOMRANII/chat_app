import { useEffect } from "react";
import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./platform";

/**
 * View-only files. In the Android app the screen can't be captured at all while one is shown (FLAG_SECURE:
 * no screenshot, no screen recording, blank in the recent-apps preview). A browser can't stop the system's
 * screenshot tools; there it blocks right-click, dragging, selecting, saving and printing, and hides the
 * file when the page loses focus or the Print Screen key is pressed.
 */
const SecureScreen = isNativeApp ? registerPlugin<{ set(options: { on: boolean }): Promise<void> }>("SecureScreen") : null;

let active = 0;
function apply() {
  const on = active > 0;
  void SecureScreen?.set({ on }).catch(() => {});
  document.documentElement.toggleAttribute("data-protected", on);
}

/** Hides protected content in the browser: page in the background, window not focused, Print Screen. */
function shield(on: boolean) {
  document.documentElement.toggleAttribute("data-shielded", on);
}
const onBlur = () => shield(true);
const onFocus = () => shield(false);
const onVisibility = () => shield(document.visibilityState !== "visible");
function onKey(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (e.key === "PrintScreen") {
    shield(true);
    void navigator.clipboard?.writeText("").catch(() => {});
    setTimeout(() => shield(!document.hasFocus()), 1500);
  }
  // Save page, print
  if ((e.ctrlKey || e.metaKey) && (key === "s" || key === "p")) e.preventDefault();
  // macOS screenshot shortcuts (Cmd+Shift+3/4/5): hide before the capture where the browser sees the keys
  if (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(key)) shield(true);
}
const noMenu = (e: Event) => {
  if ((e.target as Element | null)?.closest?.("[data-view-only]")) e.preventDefault();
};

function listen(on: boolean) {
  if (isNativeApp) return;
  const method = on ? "addEventListener" : "removeEventListener";
  window[method]("blur", onBlur);
  window[method]("focus", onFocus);
  document[method]("visibilitychange", onVisibility);
  window[method]("keydown", onKey as EventListener, true);
  window[method]("keyup", onKey as EventListener, true);
  document[method]("contextmenu", noMenu, true);
  document[method]("dragstart", noMenu, true);
  if (!on) shield(false);
}

/** While `on`: this screen shows a view-only file. Counted, so several screens can ask at once. */
export function useViewOnlyProtection(on: boolean) {
  useEffect(() => {
    if (!on) return;
    active++;
    if (active === 1) listen(true);
    apply();
    return () => {
      active--;
      if (active === 0) listen(false);
      apply();
    };
  }, [on]);
}
