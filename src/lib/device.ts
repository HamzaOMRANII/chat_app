import { Device } from "@capacitor/device";
import { isNativeApp } from "./platform";

declare const __APP_VERSION__: string;

const DEVICE_ID_KEY = "hc.deviceId";

/** A random ID that identifies this browser or phone in the security log. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

type NetworkInformation = { type?: string; effectiveType?: string };

/**
 * What the sign-up and sign-in screens report for the security log (the user is told at sign-up).
 * Browsers can't give the MAC address or the real device name; the APK adds model and phone name.
 */
export async function deviceInfo() {
  const base = {
    deviceId: deviceId(),
    platform: isNativeApp ? ("android" as const) : ("web" as const),
    appVersion: __APP_VERSION__,
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language?.slice(0, 20),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 60),
  };
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  const network = connection?.type ?? connection?.effectiveType;
  if (!isNativeApp) return { ...base, ...(network && { network: network.slice(0, 20) }) };
  try {
    const info = await Device.getInfo();
    return {
      ...base,
      name: info.name?.slice(0, 80),
      model: info.model?.slice(0, 80),
      manufacturer: info.manufacturer?.slice(0, 80),
      osVersion: info.osVersion?.slice(0, 40),
      ...(network && { network: network.slice(0, 20) }),
    };
  } catch {
    return base;
  }
}
