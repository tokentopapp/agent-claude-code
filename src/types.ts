import type { SessionUsageData } from '@tokentop/plugin-sdk';

export interface ClaudeCodeUsageInfo {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  service_tier?: string;
}

export interface ClaudeCodeAssistantMessage {
  model: string;
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: ClaudeCodeUsageInfo;
}

export interface ClaudeCodeAssistantEntry {
  type: 'assistant';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  slug?: string | null;
  isSidechain: boolean;
  userType: string;
  version: string;
  gitBranch: string;
  requestId: string;
  message: ClaudeCodeAssistantMessage;
}

export interface ClaudeCodeUserEntry {
  type: 'user';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  isSidechain: boolean;
  userType: string;
  version: string;
  gitBranch: string;
  message: {
    role: 'user';
    content: string | Array<{ type: string; [key: string]: unknown }>;
  };
}

export interface SessionAggregateCacheEntry {
  updatedAt: number;
  usageRows: SessionUsageData[];
  lastAccessed: number;
}
