import * as vscode from 'vscode';

/** Union type representing server connection states. */
export type ConnectionState = 'connected' | 'starting' | 'failed' | 'stopped';

/** Event payload for server state transitions. */
export interface ConnectionStateChange {
  state: ConnectionState;
  version?: string;
  startedAt?: number;
}

/** Extension configuration for the agent-lsp binary. */
export interface AgentLspConfig {
  binaryPath: string;
  args: string[];
  autoStart: boolean;
  traceLevel: 'off' | 'messages' | 'verbose';
}

/** Skill metadata from prompts/list MCP response. */
export interface SkillDescriptor {
  name: string;
  description: string;
  arguments?: SkillArgument[];
}

/** A single argument definition for a skill. */
export interface SkillArgument {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

/** Data structure for inline decoration caller counts. */
export interface BlastRadiusEntry {
  symbolName: string;
  line: number;
  callerCount: number;
  testCallerCount: number;
}

/** Single finding from /lsp-inspect, displayed in TreeView. */
export interface InspectionFinding {
  severity: 'error' | 'warning' | 'info';
  checkType: string;
  file: string;
  line: number;
  column: number;
  message: string;
}

/** Server lifecycle interface. Manages the agent-lsp child process. */
export interface IAgentLspServer {
  readonly state: ConnectionState;
  readonly onStateChange: vscode.Event<ConnectionStateChange>;
  readonly outputChannel: vscode.OutputChannel;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  sendRequest(method: string, params?: unknown): Promise<unknown>;
  sendNotification(method: string, params?: unknown): void;
}

/** Configuration accessor. Reads from VS Code workspace settings. */
export interface ISettingsProvider {
  getConfig(): AgentLspConfig;
  onConfigChange: vscode.Event<AgentLspConfig>;
}
