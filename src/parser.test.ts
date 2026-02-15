import { describe, test, expect } from 'bun:test';
import {
  isTokenBearingAssistant,
  toTimestamp,
  extractSlug,
  parseSessionFileRows,
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
  cwd?: string;
  slug?: string | null;
}): ClaudeCodeAssistantEntry {
  return {
    type: 'assistant',
    uuid: 'uuid-1',
    parentUuid: null,
    sessionId: 'ses-1',
    timestamp: overrides?.timestamp ?? '2026-02-15T14:19:00.000Z',
    cwd: overrides?.cwd ?? '/Users/test/project',
    slug: overrides?.slug ?? 'my-project',
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

describe('isTokenBearingAssistant', () => {
  test('accepts a valid assistant entry', () => {
    expect(isTokenBearingAssistant(makeAssistantEntry())).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(isTokenBearingAssistant(null)).toBe(false);
    expect(isTokenBearingAssistant(undefined)).toBe(false);
  });

  test('rejects non-object types', () => {
    expect(isTokenBearingAssistant(42)).toBe(false);
    expect(isTokenBearingAssistant('assistant')).toBe(false);
    expect(isTokenBearingAssistant(true)).toBe(false);
  });

  test('rejects entries with wrong type field', () => {
    expect(isTokenBearingAssistant({ type: 'user', message: {} })).toBe(false);
    expect(isTokenBearingAssistant({ type: 'system', message: {} })).toBe(false);
  });

  test('rejects entries without message object', () => {
    expect(isTokenBearingAssistant({ type: 'assistant' })).toBe(false);
    expect(isTokenBearingAssistant({ type: 'assistant', message: 'not an object' })).toBe(false);
  });

  test('rejects entries with empty or missing model', () => {
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.model', ''))).toBe(false);
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.model', undefined))).toBe(false);
  });

  test('rejects entries with missing or invalid usage', () => {
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.usage', undefined))).toBe(false);
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.usage', 'string'))).toBe(false);
  });

  test('rejects entries with input_tokens <= 0', () => {
    expect(isTokenBearingAssistant(makeAssistantEntry({ input_tokens: 0 }))).toBe(false);
    expect(isTokenBearingAssistant(makeAssistantEntry({ input_tokens: -1 }))).toBe(false);
  });

  test('rejects entries with non-number output_tokens', () => {
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.usage.output_tokens', 'bad'))).toBe(false);
  });

  test('rejects entries with non-number cache fields', () => {
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.usage.cache_creation_input_tokens', undefined))).toBe(false);
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.usage.cache_read_input_tokens', undefined))).toBe(false);
  });

  test('rejects entries with empty or missing message.id', () => {
    expect(isTokenBearingAssistant(makeAssistantEntry({ id: '' }))).toBe(false);
    expect(isTokenBearingAssistant(breakType(makeAssistantEntry(), 'message.id', undefined))).toBe(false);
  });

  test('accepts entries with output_tokens = 0', () => {
    expect(isTokenBearingAssistant(makeAssistantEntry({ output_tokens: 0 }))).toBe(true);
  });

  test('accepts entries with cache fields = 0', () => {
    expect(isTokenBearingAssistant(makeAssistantEntry({
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }))).toBe(true);
  });
});

describe('toTimestamp', () => {
  test('parses valid ISO 8601 string', () => {
    expect(toTimestamp('2026-02-15T14:19:00.000Z', 0)).toBe(Date.parse('2026-02-15T14:19:00.000Z'));
  });

  test('returns fallback for undefined', () => {
    expect(toTimestamp(undefined, 999)).toBe(999);
  });

  test('returns fallback for empty string', () => {
    expect(toTimestamp('', 999)).toBe(999);
  });

  test('returns fallback for invalid date string', () => {
    expect(toTimestamp('not-a-date', 42)).toBe(42);
  });

  test('handles date-only strings', () => {
    const ts = toTimestamp('2026-02-15', 0);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThan(0);
  });
});

describe('extractSlug', () => {
  test('extracts slug from last entry with slug', () => {
    expect(extractSlug([{ slug: 'first-slug' }, { slug: 'last-slug' }])).toBe('last-slug');
  });

  test('returns undefined for empty array', () => {
    expect(extractSlug([])).toBeUndefined();
  });

  test('returns undefined when no entries have slug', () => {
    expect(extractSlug([{}, { type: 'user' }])).toBeUndefined();
  });

  test('skips null slugs', () => {
    expect(extractSlug([{ slug: 'valid-slug' }, { slug: null }])).toBe('valid-slug');
  });

  test('skips empty string slugs', () => {
    expect(extractSlug([{ slug: 'valid-slug' }, { slug: '' }])).toBe('valid-slug');
  });
});

describe('parseSessionFileRows', () => {
  const SESSION_ID = 'test-session-001';
  const MTIME = Date.now();

  test('maps input to input_tokens only (not including cache tokens)', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      makeAssistantEntry({ input_tokens: 3, output_tokens: 954, cache_read_input_tokens: 17890, cache_creation_input_tokens: 1297 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokens.input).toBe(3);
    expect(rows[0]!.tokens.output).toBe(954);
  });

  test('sets cacheRead when cache_read_input_tokens > 0', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ cache_read_input_tokens: 17890 })]);
    expect(rows[0]!.tokens.cacheRead).toBe(17890);
  });

  test('sets cacheWrite when cache_creation_input_tokens > 0', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ cache_creation_input_tokens: 1297 })]);
    expect(rows[0]!.tokens.cacheWrite).toBe(1297);
  });

  test('omits cacheRead when cache_read_input_tokens is 0', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ cache_read_input_tokens: 0 })]);
    expect(rows[0]!.tokens.cacheRead).toBeUndefined();
  });

  test('omits cacheWrite when cache_creation_input_tokens is 0', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ cache_creation_input_tokens: 0 })]);
    expect(rows[0]!.tokens.cacheWrite).toBeUndefined();
  });

  test('deduplicates by message.id keeping last entry', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      makeAssistantEntry({ id: 'msg_001', output_tokens: 11 }),
      makeAssistantEntry({ id: 'msg_001', output_tokens: 11 }),
      makeAssistantEntry({ id: 'msg_001', output_tokens: 954 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokens.output).toBe(954);
  });

  test('handles streaming entries with multiple message ids', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      makeAssistantEntry({ id: 'msg_001', output_tokens: 9 }),
      makeAssistantEntry({ id: 'msg_001', output_tokens: 954 }),
      makeAssistantEntry({ id: 'msg_002', output_tokens: 11 }),
      makeAssistantEntry({ id: 'msg_002', output_tokens: 500 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.tokens.output === 954)).toBeDefined();
    expect(rows.find(r => r.tokens.output === 500)).toBeDefined();
  });

  test('skips non-assistant entries', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      { type: 'user', message: { content: 'hello' } },
      makeAssistantEntry(),
      { type: 'system' },
    ]);
    expect(rows).toHaveLength(1);
  });

  test('skips entries failing type guard', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      makeAssistantEntry({ input_tokens: 0 }),
      makeAssistantEntry({ id: '' }),
      makeAssistantEntry(),
    ]);
    expect(rows).toHaveLength(1);
  });

  test('sets providerId to anthropic', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry()]);
    expect(rows[0]!.providerId).toBe('anthropic');
  });

  test('sets modelId from entry', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ model: 'claude-sonnet-4-20250514' })]);
    expect(rows[0]!.modelId).toBe('claude-sonnet-4-20250514');
  });

  test('sets sessionName from slug', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ slug: 'my-feature-branch' })]);
    expect(rows[0]!.sessionName).toBe('my-feature-branch');
  });

  test('omits sessionName when no slug present', () => {
    const entry = makeAssistantEntry();
    entry.slug = undefined;
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [entry]);
    expect(rows[0]!.sessionName).toBeUndefined();
  });

  test('sets projectPath from cwd', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ cwd: '/Users/test/my-project' })]);
    expect(rows[0]!.projectPath).toBe('/Users/test/my-project');
  });

  test('sets sessionId and sessionUpdatedAt', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry()]);
    expect(rows[0]!.sessionId).toBe(SESSION_ID);
    expect(rows[0]!.sessionUpdatedAt).toBe(MTIME);
  });

  test('parses timestamp from entry', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [makeAssistantEntry({ timestamp: '2026-02-15T14:19:00.000Z' })]);
    expect(rows[0]!.timestamp).toBe(Date.parse('2026-02-15T14:19:00.000Z'));
  });

  test('falls back to mtime when timestamp is missing', () => {
    const rows = parseSessionFileRows(SESSION_ID, MTIME, [
      breakType(makeAssistantEntry(), 'timestamp', undefined) as ClaudeCodeAssistantEntry,
    ]);
    expect(rows[0]!.timestamp).toBe(MTIME);
  });

  test('returns empty array for empty entries', () => {
    expect(parseSessionFileRows(SESSION_ID, MTIME, [])).toEqual([]);
  });

  test('returns empty array when no valid entries exist', () => {
    expect(parseSessionFileRows(SESSION_ID, MTIME, [
      { type: 'user', message: { content: 'hi' } },
      { type: 'result', result: 'ok' },
    ])).toEqual([]);
  });

  test('real-world two-turn session with caching matches expected token breakdown', () => {
    const rows = parseSessionFileRows('8099bb08', MTIME, [
      makeAssistantEntry({ id: 'msg_turn1', input_tokens: 3, output_tokens: 11, cache_read_input_tokens: 17890, cache_creation_input_tokens: 1297 }),
      makeAssistantEntry({ id: 'msg_turn1', input_tokens: 3, output_tokens: 11, cache_read_input_tokens: 17890, cache_creation_input_tokens: 1297 }),
      makeAssistantEntry({ id: 'msg_turn1', input_tokens: 3, output_tokens: 11, cache_read_input_tokens: 17890, cache_creation_input_tokens: 1297 }),
      makeAssistantEntry({ id: 'msg_turn2', input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 19464, cache_creation_input_tokens: 1124 }),
      makeAssistantEntry({ id: 'msg_turn2', input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 19464, cache_creation_input_tokens: 1124 }),
      makeAssistantEntry({ id: 'msg_turn2', input_tokens: 3, output_tokens: 954, cache_read_input_tokens: 19464, cache_creation_input_tokens: 1124 }),
    ]);

    expect(rows).toHaveLength(2);

    const turn1 = rows.find(r => r.tokens.output === 11)!;
    expect(turn1.tokens.input).toBe(3);
    expect(turn1.tokens.cacheRead).toBe(17890);
    expect(turn1.tokens.cacheWrite).toBe(1297);
    expect(turn1.providerId).toBe('anthropic');

    const turn2 = rows.find(r => r.tokens.output === 954)!;
    expect(turn2.tokens.input).toBe(3);
    expect(turn2.tokens.cacheRead).toBe(19464);
    expect(turn2.tokens.cacheWrite).toBe(1124);

    const totalInput = rows.reduce((sum, r) => sum + r.tokens.input, 0);
    expect(totalInput).toBe(6);

    const totalCacheRead = rows.reduce((sum, r) => sum + (r.tokens.cacheRead ?? 0), 0);
    const totalCacheWrite = rows.reduce((sum, r) => sum + (r.tokens.cacheWrite ?? 0), 0);
    expect(totalCacheRead).toBe(37354);
    expect(totalCacheWrite).toBe(2421);
  });
});
