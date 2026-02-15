import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { ActivityCallback, ActivityUpdate } from '@tokentop/plugin-sdk';
import { CLAUDE_CODE_PROJECTS_PATH, getProjectDirs } from './paths.ts';
import type { ClaudeCodeAssistantEntry } from './types.ts';

export interface SessionWatcherState {
  projectWatchers: Map<string, fsSync.FSWatcher>;
  rootWatcher: fsSync.FSWatcher | null;
  dirtyPaths: Set<string>;
  reconciliationTimer: ReturnType<typeof setInterval> | null;
  started: boolean;
}

interface ActivityWatcherState {
  projectWatchers: Map<string, fsSync.FSWatcher>;
  rootWatcher: fsSync.FSWatcher | null;
  callback: ActivityCallback | null;
  fileOffsets: Map<string, number>;
  started: boolean;
}

export const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000;

export const sessionWatcher: SessionWatcherState = {
  projectWatchers: new Map(),
  rootWatcher: null,
  dirtyPaths: new Set(),
  reconciliationTimer: null,
  started: false,
};

const activityWatcher: ActivityWatcherState = {
  projectWatchers: new Map(),
  rootWatcher: null,
  callback: null,
  fileOffsets: new Map(),
  started: false,
};

export let forceFullReconciliation = false;

function isTokenBearingAssistant(entry: unknown): entry is ClaudeCodeAssistantEntry {
  if (!entry || typeof entry !== 'object') return false;

  const candidate = entry as Partial<ClaudeCodeAssistantEntry>;
  if (candidate.type !== 'assistant') return false;
  if (!candidate.message || typeof candidate.message !== 'object') return false;

  const model = candidate.message.model;
  const usage = candidate.message.usage;
  if (typeof model !== 'string' || model.trim().length === 0) return false;
  if (!usage || typeof usage !== 'object') return false;
  if (typeof usage.input_tokens !== 'number' || usage.input_tokens <= 0) return false;
  if (typeof usage.output_tokens !== 'number') return false;
  if (typeof usage.cache_creation_input_tokens !== 'number') return false;
  if (typeof usage.cache_read_input_tokens !== 'number') return false;
  if (typeof candidate.message.id !== 'string' || candidate.message.id.length === 0) return false;

  return true;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function watchProjectDirForActivity(projectDirPath: string): void {
  if (activityWatcher.projectWatchers.has(projectDirPath)) return;

  try {
    const watcher = fsSync.watch(projectDirPath, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      const filePath = path.join(projectDirPath, filename);
      void processJsonlDelta(filePath);
    });

    activityWatcher.projectWatchers.set(projectDirPath, watcher);
  } catch {
  }
}

async function primeProjectOffsets(projectDirPath: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(projectDirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

    const filePath = path.join(projectDirPath, entry.name);
    try {
      const stat = await fs.stat(filePath);
      activityWatcher.fileOffsets.set(filePath, stat.size);
    } catch {
    }
  }
}

async function processJsonlDelta(filePath: string): Promise<void> {
  const callback = activityWatcher.callback;
  if (!callback) return;

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    activityWatcher.fileOffsets.delete(filePath);
    return;
  }

  const knownOffset = activityWatcher.fileOffsets.get(filePath) ?? 0;
  const startOffset = stat.size < knownOffset ? 0 : knownOffset;

  if (stat.size === startOffset) return;

  let chunk: string;
  try {
    const handle = await fs.open(filePath, 'r');
    const length = stat.size - startOffset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, startOffset);
    await handle.close();
    chunk = buffer.toString('utf-8');
  } catch {
    return;
  }

  activityWatcher.fileOffsets.set(filePath, stat.size);

  const sessionId = path.basename(filePath, '.jsonl');
  const lines = chunk.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }

    if (!isTokenBearingAssistant(entry)) continue;

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

    callback({
      sessionId,
      messageId: entry.message.id,
      tokens,
      timestamp: toTimestamp(entry.timestamp),
    });
  }
}

export function watchProjectDir(projectDirPath: string): void {
  if (sessionWatcher.projectWatchers.has(projectDirPath)) return;

  try {
    const watcher = fsSync.watch(projectDirPath, (_eventType, filename) => {
      if (filename?.endsWith('.jsonl')) {
        const filePath = path.join(projectDirPath, filename);
        sessionWatcher.dirtyPaths.add(filePath);
      }
    });
    sessionWatcher.projectWatchers.set(projectDirPath, watcher);
  } catch {
  }
}

export function startSessionWatcher(): void {
  if (sessionWatcher.started) return;
  sessionWatcher.started = true;

  try {
    sessionWatcher.rootWatcher = fsSync.watch(CLAUDE_CODE_PROJECTS_PATH, (eventType, filename) => {
      if (eventType !== 'rename' || !filename) return;
      watchProjectDir(path.join(CLAUDE_CODE_PROJECTS_PATH, filename));
    });
  } catch {
  }

  void getProjectDirs().then((dirs) => {
    for (const dirPath of dirs) {
      watchProjectDir(dirPath);
    }
  });

  sessionWatcher.reconciliationTimer = setInterval(() => {
    forceFullReconciliation = true;
  }, RECONCILIATION_INTERVAL_MS);
}

export function stopSessionWatcher(): void {
  if (sessionWatcher.reconciliationTimer) {
    clearInterval(sessionWatcher.reconciliationTimer);
    sessionWatcher.reconciliationTimer = null;
  }

  for (const watcher of sessionWatcher.projectWatchers.values()) {
    watcher.close();
  }
  sessionWatcher.projectWatchers.clear();

  if (sessionWatcher.rootWatcher) {
    sessionWatcher.rootWatcher.close();
    sessionWatcher.rootWatcher = null;
  }

  sessionWatcher.dirtyPaths.clear();
  sessionWatcher.started = false;
}

export function consumeForceFullReconciliation(): boolean {
  const value = forceFullReconciliation;
  if (forceFullReconciliation) {
    forceFullReconciliation = false;
  }
  return value;
}

export function startActivityWatch(callback: ActivityCallback): void {
  activityWatcher.callback = callback;

  if (activityWatcher.started) return;
  activityWatcher.started = true;

  try {
    activityWatcher.rootWatcher = fsSync.watch(CLAUDE_CODE_PROJECTS_PATH, (eventType, filename) => {
      if (eventType !== 'rename' || !filename) return;

      const projectDirPath = path.join(CLAUDE_CODE_PROJECTS_PATH, filename);
      watchProjectDirForActivity(projectDirPath);
      void primeProjectOffsets(projectDirPath);
    });
  } catch {
  }

  void getProjectDirs().then((dirs) => {
    for (const dirPath of dirs) {
      watchProjectDirForActivity(dirPath);
      void primeProjectOffsets(dirPath);
    }
  });
}

export function stopActivityWatch(): void {
  for (const watcher of activityWatcher.projectWatchers.values()) {
    watcher.close();
  }
  activityWatcher.projectWatchers.clear();

  if (activityWatcher.rootWatcher) {
    activityWatcher.rootWatcher.close();
    activityWatcher.rootWatcher = null;
  }

  activityWatcher.fileOffsets.clear();
  activityWatcher.callback = null;
  activityWatcher.started = false;

  stopSessionWatcher();
}
