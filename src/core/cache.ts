import NodeCache from 'node-cache';
import { getEnvBool } from '../config/env.js';

interface CacheConfig {
  stdTTL?: number;
  checkperiod?: number;
}

// Fixed for the process lifetime: disables reads/writes on every cache-backed controller
// from this one chokepoint, rather than each controller needing its own check. `npm run dev`
// sets this so responses always reflect the latest generator code; production leaves it off.
const NO_CACHE = getEnvBool('NO_CACHE', false);

let cache: NodeCache | null = null;

export function initCache(config: CacheConfig = {}): NodeCache {
  cache = new NodeCache({
    stdTTL: config.stdTTL || 3600,
    checkperiod: config.checkperiod || 600,
  });
  return cache;
}

export function getCache(): NodeCache {
  if (!cache) {
    cache = initCache();
  }
  return cache;
}

export function cacheKey(namespace: string, ...parts: (string | number)[]): string {
  return [namespace, ...parts].join(':');
}

export function getCached<T>(key: string): T | undefined {
  if (NO_CACHE) return undefined;
  return getCache().get<T>(key);
}

export function setCached<T>(key: string, value: T, ttl: number = 3600): void {
  if (NO_CACHE) return;
  getCache().set(key, value, ttl);
}

export function clearCache(): void {
  getCache().flushAll();
}
