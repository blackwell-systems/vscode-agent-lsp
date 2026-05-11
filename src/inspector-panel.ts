import * as vscode from 'vscode';
import { InspectionFinding, IAgentLspServer } from './types';

/**
 * TreeDataProvider that displays findings from the last /lsp-inspect run.
 * Reads data via the MCP resources/read endpoint with URI inspect://last.
 */
class InspectorTreeDataProvider implements vscode.TreeDataProvider<InspectionFinding> {
  private findings: InspectionFinding[] = [];
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<InspectionFinding | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<InspectionFinding | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly server: IAgentLspServer) {}

  getTreeItem(finding: InspectionFinding): vscode.TreeItem {
    const iconName = finding.severity === 'error'
      ? 'error'
      : finding.severity === 'warning'
        ? 'warning'
        : 'info';

    const label = `${finding.checkType}: ${finding.file}:${finding.line}`;
    const truncatedMessage = finding.message.length > 80
      ? finding.message.slice(0, 80)
      : finding.message;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(iconName);
    item.description = truncatedMessage;
    item.command = {
      title: 'Open Finding',
      command: 'vscode.open',
      arguments: [
        vscode.Uri.file(finding.file),
        {
          selection: new vscode.Range(
            new vscode.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1)),
            new vscode.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1))
          ),
        } as vscode.TextDocumentShowOptions,
      ],
    };

    return item;
  }

  getChildren(): InspectionFinding[] {
    return this.findings;
  }

  /**
   * Re-fetch findings from the MCP resource and fire a tree data change event.
   */
  async refresh(): Promise<void> {
    try {
      const response = await this.server.sendRequest('resources/read', {
        uri: 'inspect://last',
      });
      this.findings = parseFindings(response);
    } catch {
      this.findings = [];
    }
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Parse the MCP resources/read response into an array of InspectionFinding.
 * Handles null, undefined, and malformed responses gracefully.
 */
function parseFindings(response: unknown): InspectionFinding[] {
  if (!response || typeof response !== 'object') {
    return [];
  }

  // MCP resources/read returns { contents: [{ text: "..." }] }
  const res = response as Record<string, unknown>;
  const contents = res['contents'];
  if (!Array.isArray(contents) || contents.length === 0) {
    return [];
  }

  const firstContent = contents[0] as Record<string, unknown>;
  const text = firstContent?.['text'];
  if (typeof text !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isInspectionFinding);
  } catch {
    return [];
  }
}

function isInspectionFinding(value: unknown): value is InspectionFinding {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    (obj['severity'] === 'error' || obj['severity'] === 'warning' || obj['severity'] === 'info') &&
    typeof obj['checkType'] === 'string' &&
    typeof obj['file'] === 'string' &&
    typeof obj['line'] === 'number' &&
    typeof obj['column'] === 'number' &&
    typeof obj['message'] === 'string'
  );
}

/**
 * Register the Inspector TreeView panel and its file watcher.
 * Returns a Disposable that cleans up all resources.
 */
export function registerInspectorPanel(
  server: IAgentLspServer,
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = new InspectorTreeDataProvider(server);

  const treeView = vscode.window.createTreeView('agentLsp.inspector', {
    treeDataProvider: provider,
  });

  // Watch for changes to the inspection results file
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/.agent-lsp/last-inspection.json'
  );

  const onFileChange = watcher.onDidChange(() => {
    void provider.refresh();
  });
  const onFileCreate = watcher.onDidCreate(() => {
    void provider.refresh();
  });

  // Initial load
  void provider.refresh();

  const disposable = vscode.Disposable.from(
    treeView,
    provider,
    watcher,
    onFileChange,
    onFileCreate
  );

  context.subscriptions.push(disposable);
  return disposable;
}

// Export for testing
export { InspectorTreeDataProvider, parseFindings };
