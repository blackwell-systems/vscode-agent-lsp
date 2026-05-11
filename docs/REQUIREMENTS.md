# VS Code Extension for agent-lsp: Requirements

## Project Metadata

| Dimension | Decision |
|-----------|----------|
| Language | TypeScript |
| Project type | VS Code Extension (vscode-extension API) |
| Deployment | VS Code Marketplace (free) |
| Build system | esbuild for bundling, vsce for packaging |
| Test framework | vitest + @vscode/test-electron |
| Package manager | npm |
| Min VS Code version | 1.85.0 |

## Core Features

### 1. Auto-start

Spawn the `agent-lsp` binary as a child process on workspace open. Communicate via stdio (JSON-RPC / MCP protocol). Restart automatically on crash with exponential backoff (1s, 2s, 4s, max 30s). Stop when the workspace closes.

### 2. Status bar

Status bar item showing connection state:
- "$(zap) agent-lsp" (green) when connected
- "$(sync~spin) agent-lsp" (yellow) when starting/reconnecting
- "$(error) agent-lsp" (red) when failed

Click action: restart the server. Tooltip shows version and uptime.

### 3. Command palette (skills)

Register all 24 agent-lsp skills as VS Code commands:
- `agent-lsp.skill.lsp-inspect`
- `agent-lsp.skill.lsp-concurrency-audit`
- `agent-lsp.skill.lsp-refactor`
- etc.

Invoke via MCP `prompts/get` to retrieve skill instructions; display in an output panel or pass to an active AI assistant context.

### 4. Output channel

Dedicated "agent-lsp" output channel showing:
- Server stderr (debug/info/warning/error logs)
- MCP notifications received
- Connection lifecycle events

### 5. Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `agent-lsp.binaryPath` | string | `""` (use PATH) | Path to agent-lsp binary |
| `agent-lsp.args` | string[] | `[]` | Additional arguments (e.g., `["go:gopls", "typescript:typescript-language-server"]`) |
| `agent-lsp.autoStart` | boolean | `true` | Start server on workspace open |
| `agent-lsp.trace.server` | string | `"off"` | Trace level: off, messages, verbose |

### 6. Inline decorations (blast radius)

For each function/method definition in the active editor, show an inline decoration with the caller count from `blast_radius`. Format: `// 12 callers (3 test)`. Update when the file is saved. Use `CodeLens` or `InlayHint` provider.

Cache results per file; invalidate on save. Only compute for the active editor (not all open files) to limit resource usage.

### 7. Inspector results panel

TreeView in the sidebar ("Agent LSP: Inspection") showing findings from the last `/lsp-inspect` run. Reads `.agent-lsp/last-inspection.json` (or the `inspect://last` MCP resource). Each finding is a tree item with:
- Icon by severity (error/warning/info)
- Label: check type + file:line
- Description: finding text
- Click action: open file at the finding location

Refresh button re-reads the resource. Auto-refresh on file change to `.agent-lsp/last-inspection.json`.

### 8. Quick pick for skill args

When a skill command is invoked from the command palette, show a VS Code QuickPick or InputBox for required arguments:
- `/lsp-inspect`: prompt for file/directory path (default: active file)
- `/lsp-concurrency-audit`: prompt for file path and optional type name
- `/lsp-rename`: prompt for new name

Use the skill's `argument-hint` frontmatter to determine what to prompt for.

## Binary Discovery

Order of resolution:
1. `agent-lsp.binaryPath` setting (if set)
2. `agent-lsp` on PATH
3. `~/.agent-lsp/bin/agent-lsp`
4. Show error notification with install instructions if not found

## Key Constraints

- Must not conflict with Cursor/Windsurf/Cline MCP configurations (separate config systems)
- No bundled binary (platform-specific, too large for marketplace). Extension provides a "Install agent-lsp" command that runs `npm install -g @blackwell-systems/agent-lsp`
- Extension activates on: workspace open (if autoStart), or first command invocation
- All MCP communication is stdio (no HTTP server needed from the extension side)

## File Structure

```
vscode-agent-lsp/
  src/
    extension.ts          # activate/deactivate, register commands
    server.ts             # spawn/manage agent-lsp process, MCP communication
    status-bar.ts         # status bar item management
    skills.ts             # command registration from prompts/list
    decorations.ts        # blast radius inline decorations
    inspector-panel.ts    # TreeView for inspection results
    settings.ts           # configuration access
  package.json            # extension manifest, contributes, activation events
  tsconfig.json
  esbuild.config.ts
  .vscodeignore
  README.md
  CHANGELOG.md
  LICENSE
```

## Marketplace Metadata

- Publisher: blackwell-systems
- Display name: "agent-lsp"
- Description: "Language intelligence for AI agents: 65 tools, 24 skills, 30 languages. Blast radius analysis, speculative execution, concurrency auditing."
- Categories: ["Programming Languages", "Linters", "Other"]
- Keywords: ["mcp", "lsp", "ai", "agent", "code-intelligence", "refactoring"]
- Icon: reuse agent-lsp logo (512x512 PNG)
