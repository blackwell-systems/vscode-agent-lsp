import * as vscode from 'vscode';
import { AgentLspConfig, ISettingsProvider } from './types';

const SECTION = 'agent-lsp';

function readConfig(): AgentLspConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    binaryPath: cfg.get<string>('binaryPath', ''),
    args: cfg.get<string[]>('args', []),
    autoStart: cfg.get<boolean>('autoStart', true),
    traceLevel: cfg.get<'off' | 'messages' | 'verbose'>('trace.server', 'off'),
  };
}

/**
 * Creates an ISettingsProvider that reads from VS Code workspace configuration
 * and emits change events when the 'agent-lsp' section is modified.
 */
export function createSettingsProvider(): ISettingsProvider {
  const emitter = new vscode.EventEmitter<AgentLspConfig>();

  const subscription = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      emitter.fire(readConfig());
    }
  });

  // Attach disposal so the caller can clean up via disposable patterns
  emitter.event(() => {}); // no-op; keeps emitter alive
  const disposable = { dispose: () => { subscription.dispose(); emitter.dispose(); } };

  const provider: ISettingsProvider & vscode.Disposable = {
    getConfig: readConfig,
    onConfigChange: emitter.event,
    dispose: () => disposable.dispose(),
  };

  return provider;
}
