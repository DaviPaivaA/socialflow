export type AuthSyncEvent =
  | { type: "session-invalidated" }
  | { type: "workspace-changed" };

export interface AuthSyncChannel {
  close(): void;
  publish(event: AuthSyncEvent): void;
  subscribe(listener: (event: AuthSyncEvent) => void): () => void;
}

const CHANNEL_NAME = "socialflow-auth";
const STORAGE_KEY = "socialflow-auth-event";

function isAuthSyncEvent(value: unknown): value is AuthSyncEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "session-invalidated" || type === "workspace-changed";
}

function noOpChannel(): AuthSyncChannel {
  return {
    close: () => undefined,
    publish: () => undefined,
    subscribe: () => () => undefined,
  };
}

export function createBrowserAuthSyncChannel(): AuthSyncChannel {
  if (typeof window === "undefined") return noOpChannel();

  if (typeof window.BroadcastChannel === "function") {
    const channel = new window.BroadcastChannel(CHANNEL_NAME);
    const listeners = new Set<(event: AuthSyncEvent) => void>();
    channel.addEventListener("message", (message) => {
      if (!isAuthSyncEvent(message.data)) return;
      listeners.forEach((listener) => listener(message.data));
    });
    return {
      close: () => channel.close(),
      publish: (event) => channel.postMessage(event),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  const listeners = new Set<(event: AuthSyncEvent) => void>();
  const onStorage = (storageEvent: StorageEvent) => {
    if (storageEvent.key !== STORAGE_KEY || !storageEvent.newValue) return;
    try {
      const parsed = JSON.parse(storageEvent.newValue) as {
        event?: unknown;
      };
      const event = parsed.event;
      if (!isAuthSyncEvent(event)) return;
      listeners.forEach((listener) => listener(event));
    } catch {
      // Eventos malformados de outras páginas não alteram a sessão local.
    }
  };
  window.addEventListener("storage", onStorage);

  return {
    close: () => window.removeEventListener("storage", onStorage),
    publish: (event) => {
      try {
        const nonce =
          typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : Array.from(
                window.crypto.getRandomValues(new Uint32Array(4)),
              ).join("-");
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ event, nonce }),
        );
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // A sincronização é best-effort quando storage está indisponível.
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
