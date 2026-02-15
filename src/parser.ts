import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentFetchContext, SessionParseOptions, SessionUsageData } from '@tokentop/plugin-sdk';
import { CACHE_TTL_MS, evictSessionAggregateCache, sessionAggregateCache, sessionCache, sessionMetadataIndex } from './cache.ts';
import { CLAUDE_CODE_PROJECTS_PATH, getProjectDirs } from './paths.ts';
import type { ClaudeCodeAssistantEntry } from './types.ts';
import { extractProjectPath, readJsonlFile } from './utils.ts';
import {
  consumeForceFullReconciliation,
  sessionWatcher,
  startSessionWatcher,
  watchProjectDir,
} from './watcher.ts';

interface ParsedSessionFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

interface ClaudeEntryWithCwd {
  cwd?: string;
}

export function toTimestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isTokenBearingAssistant(entry: unknown): entry is ClaudeCodeAssistantEntry {
  if (!entry || typeof entry !== 'object') return false;

  const candidate = entry as Partial<ClaudeCodeAssistantEntry>;
  if (candidate.type !== 'assistant') return false;
  if (!candidate.message || typeof candidate.message !== 'object') return false;

  const model = candidate.message.model;
  const usage = candidate.message.usage;
  const messageId = candidate.message.id;

  if (typeof model !== 'string' || model.trim().length === 0) return false;
  if (!usage || typeof usage !== 'object') return false;
  if (typeof usage.input_tokens !== 'number' || usage.input_tokens <= 0) return false;
  if (typeof usage.output_tokens !== 'number') return false;
  if (typeof usage.cache_creation_input_tokens !== 'number') return false;
  if (typeof usage.cache_read_input_tokens !== 'number') return false;
  if (typeof messageId !== 'string' || messageId.length === 0) return false;

  return true;
}

export function extractSlug(entries: unknown[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as Partial<{ slug: string | null }>;
    if (typeof entry.slug === 'string' && entry.slug.length > 0) {
      return entry.slug;
    }
  }
  return undefined;
}

export function parseSessionFileRows(sessionId: string, mtimeMs: number, entries: unknown[]): SessionUsageData[] {
  const deduped = new Map<string, SessionUsageData>();
  const projectPath = extractProjectPath(entries as ClaudeEntryWithCwd[]);
  const sessionName = extractSlug(entries);

  for (const entry of entries) {
    if (!isTokenBearingAssistant(entry)) continue;

    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = entry.message.usage;

    const usage: SessionUsageData = {
      sessionId,
      providerId: 'anthropic',
      modelId: entry.message.model,
      tokens: {
        input: input_tokens,
        output: output_tokens,
      },
      timestamp: toTimestamp(entry.timestamp, mtimeMs),
      sessionUpdatedAt: mtimeMs,
    };

    if (sessionName) {
      usage.sessionName = sessionName;
    }
    if (cache_read_input_tokens > 0) {
      usage.tokens.cacheRead = cache_read_input_tokens;
    }
    if (cache_creation_input_tokens > 0) {
      usage.tokens.cacheWrite = cache_creation_input_tokens;
    }
    if (projectPath) {
      usage.projectPath = projectPath;
    }

    deduped.set(entry.message.id, usage);
  }

  return Array.from(deduped.values());
}

export async function parseSessionsFromProjects(
  options: SessionParseOptions,
  ctx: AgentFetchContext,
): Promise<SessionUsageData[]> {
  const limit = options.limit ?? 100;
  const since = options.since;

  try {
    await fs.access(CLAUDE_CODE_PROJECTS_PATH);
  } catch {
    ctx.logger.debug('No Claude Code projects directory found');
    return [];
  }

  startSessionWatcher();

  const now = Date.now();
  if (
    !options.sessionId &&
    limit === sessionCache.lastLimit &&
    now - sessionCache.lastCheck < CACHE_TTL_MS &&
    sessionCache.lastResult.length > 0 &&
    sessionCache.lastSince === since
  ) {
    ctx.logger.debug('Claude Code: using cached sessions (within TTL)', { count: sessionCache.lastResult.length });
    return sessionCache.lastResult;
  }

  const dirtyPaths = new Set(sessionWatcher.dirtyPaths);
  sessionWatcher.dirtyPaths.clear();

  const needsFullStat = consumeForceFullReconciliation();
  if (needsFullStat) {
    ctx.logger.debug('Claude Code: full reconciliation sweep triggered');
  }

  const sessionFiles: ParsedSessionFile[] = [];
  const seenFilePaths = new Set<string>();

  let statCount = 0;
  let statSkipCount = 0;
  let dirtyHitCount = 0;

  const projectDirs = await getProjectDirs();

  for (const projectDirPath of projectDirs) {
    watchProjectDir(projectDirPath);

    let entries;
    try {
      entries = await fs.readdir(projectDirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

      const sessionId = path.basename(entry.name, '.jsonl');
      if (options.sessionId && sessionId !== options.sessionId) continue;

      const filePath = path.join(projectDirPath, entry.name);
      seenFilePaths.add(filePath);

      const isDirty = dirtyPaths.has(filePath);
      if (isDirty) dirtyHitCount++;

      const metadata = sessionMetadataIndex.get(filePath);
      if (!isDirty && !needsFullStat && metadata) {
        statSkipCount++;

        if (!since || metadata.mtimeMs >= since) {
          sessionFiles.push({
            sessionId: metadata.sessionId,
            filePath,
            mtimeMs: metadata.mtimeMs,
          });
        }
        continue;
      }

      statCount++;
      let mtimeMs: number;
      try {
        const stat = await fs.stat(filePath);
        mtimeMs = stat.mtimeMs;
      } catch {
        sessionMetadataIndex.delete(filePath);
        continue;
      }

      if (metadata && metadata.mtimeMs === mtimeMs) {
        if (!since || metadata.mtimeMs >= since) {
          sessionFiles.push({
            sessionId: metadata.sessionId,
            filePath,
            mtimeMs: metadata.mtimeMs,
          });
        }
        continue;
      }

      sessionMetadataIndex.set(filePath, { mtimeMs, sessionId });
      if (!since || mtimeMs >= since) {
        sessionFiles.push({ sessionId, filePath, mtimeMs });
      }
    }
  }

  for (const cachedPath of sessionMetadataIndex.keys()) {
    if (!seenFilePaths.has(cachedPath)) {
      sessionMetadataIndex.delete(cachedPath);
    }
  }

  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const sessions: SessionUsageData[] = [];
  let aggregateCacheHits = 0;
  let aggregateCacheMisses = 0;

  for (const file of sessionFiles) {
    const cached = sessionAggregateCache.get(file.sessionId);
    if (cached && cached.updatedAt === file.mtimeMs) {
      cached.lastAccessed = now;
      aggregateCacheHits++;
      sessions.push(...cached.usageRows);
      continue;
    }

    aggregateCacheMisses++;

    const rows = await readJsonlFile<unknown>(file.filePath);
    const usageRows = parseSessionFileRows(file.sessionId, file.mtimeMs, rows);

    sessionAggregateCache.set(file.sessionId, {
      updatedAt: file.mtimeMs,
      usageRows,
      lastAccessed: now,
    });

    sessions.push(...usageRows);
  }

  evictSessionAggregateCache();

  if (!options.sessionId) {
    sessionCache.lastCheck = Date.now();
    sessionCache.lastResult = sessions;
    sessionCache.lastLimit = limit;
    sessionCache.lastSince = since;
  }

  ctx.logger.debug('Claude Code: parsed sessions', {
    count: sessions.length,
    sessionFiles: sessionFiles.length,
    statChecks: statCount,
    statSkips: statSkipCount,
    dirtyHits: dirtyHitCount,
    aggregateCacheHits,
    aggregateCacheMisses,
    metadataIndexSize: sessionMetadataIndex.size,
    aggregateCacheSize: sessionAggregateCache.size,
  });

  return sessions;
}
