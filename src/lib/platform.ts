import { Capacitor } from "@capacitor/core";

/** True inside the Android APK, false in the browser. */
export const isNativeApp = Capacitor.isNativePlatform();

/**
 * The web app is served by chat.omranisystems.com, so it calls the API on the same origin.
 * The APK has no origin of its own and must call the server by its full address.
 */
export const SERVER_ORIGIN = isNativeApp ? "https://chat.omranisystems.com" : "";

export function serverUrl(path: string) {
  return `${SERVER_ORIGIN}${path}`;
}
