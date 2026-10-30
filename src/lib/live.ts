/** The signed-in socket, shared with the screens: they listen to chat events and send "typing". */
type Handler = (payload: never) => void;
type Socket = {
  emit: (event: string, payload: unknown, ack?: (...args: never[]) => void) => void;
  connected: boolean;
  timeout?: (ms: number) => { emit: (event: string, payload: unknown, ack: (err: Error | null, reply: unknown) => void) => void };
};

const handlers = new Map<string, Set<Handler>>();
let socket: Socket | null = null;

export const live = {
  attach(s: Socket | null) {
    socket = s;
  },
  /** Called by App for every server event it forwards. */
  dispatch(event: string, payload: unknown) {
    for (const fn of handlers.get(event) ?? []) (fn as (p: unknown) => void)(payload);
  },
  on<T>(event: string, fn: (payload: T) => void) {
    const set = handlers.get(event) ?? new Set();
    set.add(fn as Handler);
    handlers.set(event, set);
    return () => void set.delete(fn as Handler);
  },
  /** False while the connection is down: screens then refresh on their own. */
  connected: () => Boolean(socket?.connected),
  send(event: string, payload: unknown) {
    if (socket?.connected) socket.emit(event, payload);
  },
  /** Sends and waits for the server's answer (calls). Rejects when offline or after `ms`. */
  request<T>(event: string, payload: unknown, ms = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!socket?.connected || !socket.timeout) return reject(new Error("No connection to H_CHAT."));
      socket.timeout(ms).emit(event, payload, (err, reply) => (err ? reject(new Error("H_CHAT didn't answer. Try again.")) : resolve(reply as T)));
    });
  },
};

export const CHAT_EVENTS = [
  "msg:new",
  "msg:status",
  "typing",
  "chat:ended",
  "chat:keys",
  "chats:changed",
  "live",
  "live:peer",
  "live:ended",
  "live:changed",
  "files:deleted",
  "media:request",
  "exports:changed",
  "call:incoming",
  "call:answered",
  "call:signal",
  "call:ended",
  "call:left",
  "call:joined",
  "group:msg",
  "group:read",
  "group:changed",
  "group:typing",
  "group:call",
] as const;
