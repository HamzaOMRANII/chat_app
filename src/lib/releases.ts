import { serverUrl } from "./platform";

/** Written by scripts/build-apk.mjs next to each APK in /projects/mobile_builds. */
export type LatestRelease = {
  version: string;
  versionCode: number;
  file: string;
  size: number;
  sha256: string;
  date: string;
  notes?: string;
};

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  try {
    const res = await fetch(serverUrl("/download/latest.json"), { signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LatestRelease;
  } catch {
    return null;
  }
}

export function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}
