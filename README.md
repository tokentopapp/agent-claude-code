# @tokentop/agent-claude-code

[![npm](https://img.shields.io/npm/v/@tokentop/agent-claude-code?style=flat-square&color=CB3837&logo=npm)](https://www.npmjs.com/package/@tokentop/agent-claude-code)
[![CI](https://img.shields.io/github/actions/workflow/status/tokentopapp/agent-claude-code/ci.yml?style=flat-square&label=CI)](https://github.com/tokentopapp/agent-claude-code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[tokentop](https://github.com/tokentopapp/tokentop) agent plugin for **Claude Code** (Anthropic's CLI coding agent). Parses session data, tracks token usage, and provides real-time activity monitoring.

## Capabilities

| Capability | Status |
|-----------|--------|
| Session parsing | Yes |
| Credential reading | No |
| Real-time tracking | Yes |
| Multi-provider | No |

## How It Works

This plugin reads Claude Code's local session files from `~/.claude/projects/` to extract:

- Session metadata (start time, duration, project)
- Token usage per message (input, output, cache read/write)
- Model information per conversation turn
- Real-time file watching for live session updates

## Install

This plugin is **bundled with tokentop** — no separate install needed. If you need it standalone:

```bash
bun add @tokentop/agent-claude-code
```

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed (`~/.claude` directory must exist)
- [Bun](https://bun.sh/) >= 1.0.0
- `@tokentop/plugin-sdk` ^1.0.0 (peer dependency)

## Permissions

| Type | Access | Paths |
|------|--------|-------|
| Filesystem | Read | `~/.claude` |

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```

## Contributing

See the [Contributing Guide](https://github.com/tokentopapp/.github/blob/main/CONTRIBUTING.md). Issues for this plugin should be [filed on the main tokentop repo](https://github.com/tokentopapp/tokentop/issues/new?template=bug_report.yml&labels=bug,agent-claude-code).

## License

MIT
