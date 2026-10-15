/**
 * Cloudflare Workers expose `caches.default`; DOM lib `CacheStorage` does not.
 * Cast once here so route handlers stay type-safe under `lib: ["dom", ...]`.
 */
type WorkersCacheStorage = CacheStorage & { default: Cache };

export function workersDefaultCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  return (caches as unknown as WorkersCacheStorage).default;
}
