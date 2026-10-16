import { isNativeApp, serverUrl } from "./platform";

/** An error answered by the API: { error, code, details }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// The APK has no cookie for chat.omranisystems.com: it keeps the session token itself.
const TOKEN_KEY = "hc.session";
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export async function api<T = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (isNativeApp) {
    headers["X-Client"] = "android";
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(serverUrl(path), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      credentials: isNativeApp ? "omit" : "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "network", "No connection to H_CHAT. Check your internet and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (isNativeApp && typeof data.token === "string") tokenStore.set(data.token);
  if (!res.ok) {
    throw new ApiError(res.status, String(data.code ?? "error"), String(data.error ?? "Something went wrong"), data.details as Record<string, unknown> | undefined);
  }
  return data as T;
}
