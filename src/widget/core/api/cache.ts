// 캐시 레이어 — 인메모리 Map + 30s TTL + pub/sub + stale-while-revalidate

export interface CacheReadOptions {
  readonly staleWhileRevalidate?: boolean;
  readonly force?: boolean;
}

interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
}

type Listener<T> = (data: T) => void;

const cache = new Map<string, CacheEntry<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<Listener<unknown>>>();
const CACHE_TTL = 30_000;

// --- Key generators ---

export function getFeedbacksCacheKey(url: string): string {
  return `feedbacks:${url}`;
}

export function getAllFeedbacksCacheKey(): string {
  return "feedbacks:__all__";
}

export function getCommentsCacheKey(taskId: string): string {
  return `comments:${taskId}`;
}

export function getHistoryCacheKey(since?: string): string {
  return `history:${since ?? "all"}`;
}

// --- Internal primitives (exported for use by api/index.ts) ---

export function peekCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
  const subs = listeners.get(key);
  if (!subs) return;
  subs.forEach((listener) => (listener as Listener<T>)(data));
}

export function mutateCache<T>(key: string, updater: (current: T | null) => T): T {
  const next = updater(peekCache<T>(key));
  setCache(key, next);
  return next;
}

export function getMatchingKeys(pattern: string): readonly string[] {
  return Array.from(cache.keys()).filter((key) => key.includes(pattern));
}

export function mutateMatchingCaches<T>(pattern: string, updater: (current: T) => T): void {
  for (const key of getMatchingKeys(pattern)) {
    const current = peekCache<T>(key);
    if (current === null) continue;
    setCache(key, updater(current));
  }
}

export function snapshotCaches<T>(pattern: string): ReadonlyMap<string, T> {
  const snapshots = new Map<string, T>();
  for (const key of getMatchingKeys(pattern)) {
    const value = peekCache<T>(key);
    if (value !== null) snapshots.set(key, value);
  }
  return snapshots;
}

export function restoreSnapshots<T>(snapshots: ReadonlyMap<string, T>): void {
  snapshots.forEach((value, key) => setCache(key, value));
}

function isCacheFresh(key: string): boolean {
  const entry = cache.get(key);
  if (!entry) return false;
  return Date.now() - entry.timestamp <= CACHE_TTL;
}

export async function revalidateCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request: Promise<T> = (async (): Promise<T> => {
    try {
      const data = await fetcher();
      setCache(key, data);
      return data;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, request);
  return request;
}

export async function readWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheReadOptions = {},
): Promise<T> {
  const cached = peekCache<T>(key);
  if (cached !== null && !options.force) {
    if (options.staleWhileRevalidate || !isCacheFresh(key)) {
      void revalidateCache(key, fetcher);
    }
    return cached;
  }
  return revalidateCache(key, fetcher);
}

// --- Public consumer interface ---

export function subscribeCache<T>(key: string, listener: Listener<T>): () => void {
  const subs: Set<Listener<unknown>> = listeners.get(key) ?? new Set();
  subs.add(listener as Listener<unknown>);
  listeners.set(key, subs);
  return (): void => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener as Listener<unknown>);
    if (current.size === 0) listeners.delete(key);
  };
}

export function getCachedSnapshot<T>(key: string): T | null {
  return peekCache<T>(key);
}

export function invalidateCache(pattern?: string): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}
