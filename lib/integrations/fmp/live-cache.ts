import "server-only";

// MMS-FMP-INTEGRATION-01: very short in-process cache so several FMP
// instances/tabs polling every 15–30s share one set of DB queries. Entries
// live for at most ttlMs (10s in production — never minutes), concurrent
// misses for the same key share one in-flight load, and failures are never
// cached. Per-process only, which matches MMS's single-instance deployment
// (same assumption as the proxy.ts rate limiter).

type Entry<T> = { value: T; expiresAt: number };

export type ShortTtlCache<T> = {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
};

export function createShortTtlCache<T>(
  ttlMs: number,
  maxEntries = 50,
  clock: () => number = Date.now
): ShortTtlCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    async get(key, load) {
      const now = clock();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = load()
        .then((value) => {
          if (ttlMs > 0) {
            if (entries.size >= maxEntries) {
              const oldest = entries.keys().next().value;
              if (oldest !== undefined) entries.delete(oldest);
            }
            entries.set(key, { value, expiresAt: clock() + ttlMs });
          }
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}
