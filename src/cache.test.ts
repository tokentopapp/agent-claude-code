import { describe, test, expect, beforeEach } from 'bun:test';
import { evictSessionAggregateCache, sessionAggregateCache, SESSION_AGGREGATE_CACHE_MAX } from './cache.ts';

beforeEach(() => {
  sessionAggregateCache.clear();
});

describe('evictSessionAggregateCache', () => {
  test('does nothing when under limit', () => {
    sessionAggregateCache.set('s1', { updatedAt: 1, usageRows: [], lastAccessed: 100 });
    sessionAggregateCache.set('s2', { updatedAt: 2, usageRows: [], lastAccessed: 200 });

    evictSessionAggregateCache();
    expect(sessionAggregateCache.size).toBe(2);
  });

  test('does nothing when at exactly the limit', () => {
    for (let i = 0; i < SESSION_AGGREGATE_CACHE_MAX; i++) {
      sessionAggregateCache.set(`s${i}`, { updatedAt: i, usageRows: [], lastAccessed: i });
    }

    evictSessionAggregateCache();
    expect(sessionAggregateCache.size).toBe(SESSION_AGGREGATE_CACHE_MAX);
  });

  test('evicts least recently accessed entries when over limit', () => {
    const overCount = 5;
    const total = SESSION_AGGREGATE_CACHE_MAX + overCount;

    for (let i = 0; i < total; i++) {
      sessionAggregateCache.set(`s${i}`, { updatedAt: i, usageRows: [], lastAccessed: i });
    }

    evictSessionAggregateCache();
    expect(sessionAggregateCache.size).toBe(SESSION_AGGREGATE_CACHE_MAX);

    for (let i = 0; i < overCount; i++) {
      expect(sessionAggregateCache.has(`s${i}`)).toBe(false);
    }

    expect(sessionAggregateCache.has(`s${overCount}`)).toBe(true);
    expect(sessionAggregateCache.has(`s${total - 1}`)).toBe(true);
  });

  test('evicts by lastAccessed not insertion order', () => {
    for (let i = 0; i < SESSION_AGGREGATE_CACHE_MAX + 2; i++) {
      sessionAggregateCache.set(`s${i}`, { updatedAt: i, usageRows: [], lastAccessed: 1000 });
    }

    sessionAggregateCache.get('s0')!.lastAccessed = 9999;
    sessionAggregateCache.get('s1')!.lastAccessed = 9998;

    evictSessionAggregateCache();

    expect(sessionAggregateCache.has('s0')).toBe(true);
    expect(sessionAggregateCache.has('s1')).toBe(true);
    expect(sessionAggregateCache.size).toBe(SESSION_AGGREGATE_CACHE_MAX);
  });
});
