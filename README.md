# agent-lsp for VS Code

Code intelligence for AI agents, directly in your editor. 65 tools, 24 skills, 30 languages.

## Features

- **Server lifecycle management:** Start, stop, and restart the agent-lsp binary from VS Code with status bar integration.
- **Blast radius decorations:** Inline CodeLens showing caller counts for exported symbols, partitioned by test vs production code.
- **Skills palette:** Browse and invoke all 24 agent-lsp workflow skills through a QuickPick command palette.
- **Inspector panel:** Activity bar view with a TreeView displaying code quality findings from /lsp-inspect.
- **Auto-start:** Server launches automatically on workspace open (configurable).
- **Binary installer:** One-click terminal command to install the agent-lsp binary globally via npm.

## Installation

1. Install from the VS Code Marketplace: search "agent-lsp" by Blackwell Systems.
2. Install the binary (required for server features):

```bash
npm install -g @blackwell-systems/agent-lsp
```

Or use the command palette: `agent-lsp: Install Binary`.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `agent-lsp.binaryPath` | string | `""` | Path to agent-lsp binary (leave empty to use PATH) |
| `agent-lsp.args` | string[] | `[]` | Additional arguments for agent-lsp |
| `agent-lsp.autoStart` | boolean | `true` | Start server automatically on workspace open |
| `agent-lsp.trace.server` | string | `"off"` | Trace level for server communication (off, messages, verbose) |

## Links

- [agent-lsp on GitHub](https://github.com/blackwell-systems/agent-lsp)
- [Documentation](https://github.com/blackwell-systems/agent-lsp/tree/main/docs)
