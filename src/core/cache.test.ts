import { initCache, cacheKey, getCached, setCached, clearCache } from './cache.js';

describe('cache', () => {
  beforeEach(() => {
    initCache();
  });

  describe('cacheKey', () => {
    it('joins namespace and parts with a colon', () => {
      expect(cacheKey('flights', 'JFK', 'LAX', 1)).toBe('flights:JFK:LAX:1');
    });

    it('supports a namespace with no parts', () => {
      expect(cacheKey('airports')).toBe('airports');
    });
  });

  describe('getCached / setCached', () => {
    it('returns undefined for a key that was never set', () => {
      expect(getCached('missing')).toBeUndefined();
    });

    it('returns the value that was set', () => {
      setCached('key', { foo: 'bar' });

      expect(getCached('key')).toEqual({ foo: 'bar' });
    });
  });

  describe('clearCache', () => {
    it('removes all cached values', () => {
      setCached('key', 'value');

      clearCache();

      expect(getCached('key')).toBeUndefined();
    });
  });
});
