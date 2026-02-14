import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createAgentPlugin,
  type AgentFetchContext,
  type PluginContext,
  type SessionParseOptions,
  type SessionUsageData,
} from '@tokentop/plugin-sdk';

// TODO: Implement session parsing for Claude Code
// See @tokentop/agent-opencode for a complete reference implementation.

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
    configPath: path.join(os.homedir(), '.claude'),
    sessionPath: path.join(os.homedir(), '.claude', 'projects'),
  },

  capabilities: {
    sessionParsing: false,
    authReading: false,
    realTimeTracking: false,
    multiProvider: false,
  },

  async isInstalled(_ctx: PluginContext): Promise<boolean> {
    return fs.existsSync(path.join(os.homedir(), '.claude'));
  },

  async parseSessions(_options: SessionParseOptions, _ctx: AgentFetchContext): Promise<SessionUsageData[]> {
    return [];
  },
});

export default claudeCodeAgentPlugin;
