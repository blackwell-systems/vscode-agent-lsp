import * as vscode from 'vscode';
import { IAgentLspServer } from './types';
import { createServer } from './server';
import { createSettingsProvider } from './settings';
import { createStatusBar } from './status-bar';
import { registerSkills } from './skills';
import { registerDecorations } from './decorations';
import { registerInspectorPanel } from './inspector-panel';

let server: IAgentLspServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('agent-lsp');
  context.subscriptions.push(outputChannel);

  const settings = createSettingsProvider();
  context.subscriptions.push(settings as unknown as vscode.Disposable);

  const srv = createServer(settings, outputChannel);
  server = srv;

  // Status bar
  const statusBar = createStatusBar(srv);
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agent-lsp.restart', () => srv.restart()),
    vscode.commands.registerCommand('agent-lsp.stop', () => srv.stop()),
    vscode.commands.registerCommand('agent-lsp.install', () => {
      const terminal = vscode.window.createTerminal('agent-lsp install');
      terminal.show();
      terminal.sendText('npm install -g @blackwell-systems/agent-lsp');
    }),
  );

  // Skills (fire-and-forget)
  registerSkills(srv, context).catch((err: unknown) => {
    outputChannel.appendLine(`[warn] Failed to register skills: ${err}`);
  });

  // Decorations
  const decorations = registerDecorations(srv, context);
  context.subscriptions.push(decorations);

  // Inspector panel
  const inspector = registerInspectorPanel(srv, context);
  context.subscriptions.push(inspector);

  // Auto-start
  const config = settings.getConfig();
  if (config.autoStart) {
    srv.start().catch((err: unknown) => {
      outputChannel.appendLine(`[error] Server failed to start: ${err}`);
    });
  }
}

export function deactivate(): void {
  if (server) {
    server.stop();
  }
}
