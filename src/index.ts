import * as fs from 'fs';
import {
  createAgentPlugin,
  type AgentFetchContext,
  type PluginContext,
  type SessionParseOptions,
  type SessionUsageData,
} from '@tokentop/plugin-sdk';
import { CACHE_TTL_MS, SESSION_AGGREGATE_CACHE_MAX, sessionAggregateCache, sessionCache, sessionMetadataIndex } from './cache.ts';
import { parseSessionsFromProjects } from './parser.ts';
import { CLAUDE_CODE_HOME, CLAUDE_CODE_PROJECTS_PATH } from './paths.ts';
import { RECONCILIATION_INTERVAL_MS, startActivityWatch, stopActivityWatch } from './watcher.ts';

const claudeCodeAgentPlugin = createAgentPlugin({
  id: 'claude-code',
  type: 'agent',
  name: 'Claude Code',
  version: '0.1.0',

  meta: {
    description: 'Claude Code (Anthropic CLI) session tracking',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
  },

  permissions: {
    filesystem: {
      read: true,
      paths: ['~/.claude'],
    },
  },

  agent: {
    name: 'Claude Code',
    command: 'claude',
    configPath: CLAUDE_CODE_HOME,
    sessionPath: CLAUDE_CODE_PROJECTS_PATH,
  },

  capabilities: {
    sessionParsing: true,
    authReading: false,
    realTimeTracking: true,
    multiProvider: false,
  },

  startActivityWatch(_ctx: PluginContext, callback): void {
    startActivityWatch(callback);
  },

  stopActivityWatch(_ctx: PluginContext): void {
    stopActivityWatch();
  },

  async isInstalled(_ctx: PluginContext): Promise<boolean> {
    return fs.existsSync(CLAUDE_CODE_PROJECTS_PATH) || fs.existsSync(CLAUDE_CODE_HOME);
  },

  async parseSessions(options: SessionParseOptions, ctx: AgentFetchContext): Promise<SessionUsageData[]> {
    return parseSessionsFromProjects(options, ctx);
  },
});

export {
  CACHE_TTL_MS,
  CLAUDE_CODE_HOME,
  CLAUDE_CODE_PROJECTS_PATH,
  RECONCILIATION_INTERVAL_MS,
  SESSION_AGGREGATE_CACHE_MAX,
  sessionAggregateCache,
  sessionCache,
  sessionMetadataIndex,
};

export default claudeCodeAgentPlugin;
