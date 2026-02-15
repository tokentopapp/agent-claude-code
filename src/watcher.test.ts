import { describe, test, expect } from 'bun:test';
import type { ActivityUpdate } from '@tokentop/plugin-sdk';
import {
  isTokenBearingAssistant as watcherIsTokenBearing,
  toTimestamp as watcherToTimestamp,
  consumeForceFullReconciliation,
  stopSessionWatcher,
  stopActivityWatch,
  sessionWatcher,
  RECONCILIATION_INTERVAL_MS,
} from './watcher.ts';
import {
  isTokenBearingAssistant as parserIsTokenBearing,
} from './parser.ts';
import type { ClaudeCodeAssistantEntry } from './types.ts';

function makeAssistantEntry(overrides?: {
  id?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  timestamp?: string;
}): ClaudeCodeAssistantEntry {
  return {
    type: 'assistant',
    uuid: 'uuid-1',
    parentUuid: null,
    sessionId: 'ses-1',
    timestamp: overrides?.timestamp ?? '2026-02-15T14:19:00.000Z',
    cwd: '/Users/test/project',
    slug: 'my-project',
    isSidechain: false,
    userType: 'external',
    version: '1.0.0',
    gitBranch: 'main',
    requestId: 'req-1',
    message: {
      model: overrides?.model ?? 'claude-opus-4-6',
      id: overrides?.id ?? 'msg_001',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: overrides?.input_tokens ?? 3,
        output_tokens: overrides?.output_tokens ?? 954,
        cache_creation_input_tokens: overrides?.cache_creation_input_tokens ?? 1297,
        cache_read_input_tokens: overrides?.cache_read_input_tokens ?? 17890,
      },
    },
  };
}

function breakType(entry: ClaudeCodeAssistantEntry, path: string, value: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
  const parts = path.split('.');
  let target = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]!] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]!] = value;
  return clone;
}

function mapTokensLikeWatcher(entry: ClaudeCodeAssistantEntry): ActivityUpdate['tokens'] {
  const tokens: ActivityUpdate['tokens'] = {
    input: entry.message.usage.input_tokens,
    output: entry.message.usage.output_tokens,
  };
  if (entry.message.usage.cache_read_input_tokens > 0) {
    tokens.cacheRead = entry.message.usage.cache_read_input_tokens;
  }
  if (entry.message.usage.cache_creation_input_tokens > 0) {
    tokens.cacheWrite = entry.message.usage.cache_creation_input_tokens;
  }
  return tokens;
}

describe('watcher isTokenBearingAssistant (duplicate drift detection)', () => {
  test('accepts a valid assistant entry', () => {
    expect(watcherIsTokenBearing(makeAssistantEntry())).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(watcherIsTokenBearing(null)).toBe(false);
    expect(watcherIsTokenBearing(undefined)).toBe(false);
  });

  test('rejects non-object types', () => {
    expect(watcherIsTokenBearing(42)).toBe(false);
    expect(watcherIsTokenBearing('assistant')).toBe(false);
  });

  test('rejects entries with wrong type field', () => {
    expect(watcherIsTokenBearing({ type: 'user', message: {} })).toBe(false);
  });

  test('rejects entries with input_tokens <= 0', () => {
    expect(watcherIsTokenBearing(makeAssistantEntry({ input_tokens: 0 }))).toBe(false);
    expect(watcherIsTokenBearing(makeAssistantEntry({ input_tokens: -1 }))).toBe(false);
  });

  test('rejects entries with empty message.id', () => {
    expect(watcherIsTokenBearing(makeAssistantEntry({ id: '' }))).toBe(false);
  });

  test('rejects entries with missing usage', () => {
    expect(watcherIsTokenBearing(breakType(makeAssistantEntry(), 'message.usage', undefined))).toBe(false);
  });

  test('matches parser isTokenBearingAssistant on all edge cases', () => {
    const cases: unknown[] = [
      makeAssistantEntry(),
      makeAssistantEntry({ input_tokens: 0 }),
      makeAssistantEntry({ id: '' }),
      makeAssistantEntry({ output_tokens: 0 }),
      makeAssistantEntry({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      null,
      undefined,
      42,
      'assistant',
      { type: 'user' },
      { type: 'assistant' },
      { type: 'assistant', message: 'string' },
      breakType(makeAssistantEntry(), 'message.model', ''),
      breakType(makeAssistantEntry(), 'message.usage', null),
      breakType(makeAssistantEntry(), 'message.usage.output_tokens', 'bad'),
      breakType(makeAssistantEntry(), 'message.usage.cache_read_input_tokens', undefined),
      breakType(makeAssistantEntry(), 'message.id', undefined),
    ];

    for (const input of cases) {
      expect(watcherIsTokenBearing(input)).toBe(parserIsTokenBearing(input));
    }
  });
});

describe('watcher toTimestamp (Date.now fallback)', () => {
  test('parses valid ISO 8601 string', () => {
    expect(watcherToTimestamp('2026-02-15T14:19:00.000Z')).toBe(Date.parse('2026-02-15T14:19:00.000Z'));
  });

  test('returns a finite number close to now for undefined', () => {
    const before = Date.now();
    const result = watcherToTimestamp(undefined);
    const after = Date.now();
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  test('returns a finite number close to now for invalid date', () => {
    const before = Date.now();
    const result = watcherToTimestamp('not-a-date');
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  test('handles date-only strings', () => {
    const ts = watcherToTimestamp('2026-02-15');
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThan(0);
  });
});

describe('watcher token mapping (processJsonlDelta parity)', () => {
  test('maps input to input_tokens only (not summed with cache)', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({
      input_tokens: 3,
      output_tokens: 954,
      cache_read_input_tokens: 17890,
      cache_creation_input_tokens: 1297,
    }));
    expect(tokens.input).toBe(3);
    expect(tokens.output).toBe(954);
  });

  test('sets cacheRead when cache_read_input_tokens > 0', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({ cache_read_input_tokens: 17890 }));
    expect(tokens.cacheRead).toBe(17890);
  });

  test('sets cacheWrite when cache_creation_input_tokens > 0', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({ cache_creation_input_tokens: 1297 }));
    expect(tokens.cacheWrite).toBe(1297);
  });

  test('omits cacheRead when cache_read_input_tokens is 0', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({ cache_read_input_tokens: 0 }));
    expect(tokens.cacheRead).toBeUndefined();
  });

  test('omits cacheWrite when cache_creation_input_tokens is 0', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({ cache_creation_input_tokens: 0 }));
    expect(tokens.cacheWrite).toBeUndefined();
  });

  test('real-world token breakdown matches parser expectations', () => {
    const tokens = mapTokensLikeWatcher(makeAssistantEntry({
      input_tokens: 3,
      output_tokens: 11,
      cache_read_input_tokens: 17890,
      cache_creation_input_tokens: 1297,
    }));
    expect(tokens.input).toBe(3);
    expect(tokens.output).toBe(11);
    expect(tokens.cacheRead).toBe(17890);
    expect(tokens.cacheWrite).toBe(1297);
  });
});

describe('consumeForceFullReconciliation', () => {
  test('returns false when not forced', () => {
    consumeForceFullReconciliation();
    expect(consumeForceFullReconciliation()).toBe(false);
  });

  test('returns false on consecutive calls', () => {
    consumeForceFullReconciliation();
    expect(consumeForceFullReconciliation()).toBe(false);
    expect(consumeForceFullReconciliation()).toBe(false);
  });
});

describe('watcher constants', () => {
  test('RECONCILIATION_INTERVAL_MS is 10 minutes', () => {
    expect(RECONCILIATION_INTERVAL_MS).toBe(10 * 60 * 1000);
  });
});

describe('watcher lifecycle', () => {
  test('stopSessionWatcher is idempotent', () => {
    stopSessionWatcher();
    stopSessionWatcher();
    expect(sessionWatcher.started).toBe(false);
    expect(sessionWatcher.projectWatchers.size).toBe(0);
    expect(sessionWatcher.rootWatcher).toBeNull();
    expect(sessionWatcher.dirtyPaths.size).toBe(0);
    expect(sessionWatcher.reconciliationTimer).toBeNull();
  });

  test('stopActivityWatch is idempotent', () => {
    stopActivityWatch();
    stopActivityWatch();
  });
});
