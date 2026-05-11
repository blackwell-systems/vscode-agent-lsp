import * as vscode from 'vscode';
import { ConnectionStateChange, IAgentLspServer } from './types';

/**
 * Creates a status bar item that reflects the agent-lsp server connection state.
 * Returns a Disposable that cleans up the item and event subscription.
 */
export function createStatusBar(server: IAgentLspServer): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  item.command = 'agent-lsp.restart';
  item.show();

  function update(change: ConnectionStateChange): void {
    const uptime = change.startedAt
      ? formatUptime(Date.now() - change.startedAt)
      : undefined;
    const version = change.version ?? 'unknown';

    switch (change.state) {
      case 'connected':
        item.text = '$(zap) agent-lsp';
        item.color = new vscode.ThemeColor('statusBarItem.foreground');
        item.backgroundColor = undefined;
        item.tooltip = uptime
          ? `agent-lsp v${version} - up ${uptime}`
          : `agent-lsp v${version}`;
        break;
      case 'starting':
        item.text = '$(sync~spin) agent-lsp';
        item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        item.tooltip = 'agent-lsp starting...';
        break;
      case 'failed':
        item.text = '$(error) agent-lsp';
        item.color = undefined;
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        item.tooltip = 'agent-lsp failed to connect';
        break;
      case 'stopped':
        item.text = '$(circle-slash) agent-lsp';
        item.color = undefined;
        item.backgroundColor = undefined;
        item.tooltip = 'agent-lsp stopped';
        break;
    }
  }

  const subscription = server.onStateChange(update);

  // Set initial state
  update({ state: server.state });

  return {
    dispose: () => {
      subscription.dispose();
      item.dispose();
    },
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) { return `${seconds}s`; }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) { return `${minutes}m`; }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
