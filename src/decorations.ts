import * as vscode from 'vscode';
import { BlastRadiusEntry, IAgentLspServer } from './types';

/**
 * CodeLens provider that shows inline blast radius decorations
 * (caller counts) for functions/methods in the active editor.
 */
class BlastRadiusCodeLensProvider implements vscode.CodeLensProvider {
  private cache = new Map<string, vscode.CodeLens[]>();
  private onDidChangeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeEmitter.event;

  constructor(private readonly server: IAgentLspServer) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const uri = document.uri.toString();

    // Return cached result if available
    const cached = this.cache.get(uri);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.server.sendRequest('tools/call', {
        name: 'get_change_impact',
        arguments: { changed_files: [document.uri.fsPath] },
      });

      const entries = this.parseResponse(response);
      const lenses = entries.map((entry) => {
        const range = new vscode.Range(
          new vscode.Position(entry.line - 1, 0),
          new vscode.Position(entry.line - 1, 0)
        );
        const title = `${entry.callerCount} callers (${entry.testCallerCount} test)`;
        const lens = new vscode.CodeLens(range, {
          title,
          command: '',
        });
        return lens;
      });

      this.cache.set(uri, lenses);
      return lenses;
    } catch {
      // Do not block the editor on failure
      return [];
    }
  }

  invalidate(uri: string): void {
    this.cache.delete(uri);
    this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    this.cache.clear();
  }

  private parseResponse(response: unknown): BlastRadiusEntry[] {
    if (!response || typeof response !== 'object') {
      return [];
    }
    const obj = response as Record<string, unknown>;
    const content = obj['content'];
    if (!Array.isArray(content)) {
      return [];
    }
    // Look for text content block with JSON
    for (const block of content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'text'
      ) {
        try {
          const parsed = JSON.parse((block as Record<string, unknown>)['text'] as string);
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (e): e is BlastRadiusEntry =>
                typeof e === 'object' &&
                e !== null &&
                typeof e.symbolName === 'string' &&
                typeof e.line === 'number' &&
                typeof e.callerCount === 'number' &&
                typeof e.testCallerCount === 'number'
            );
          }
          // If parsed is an object with a symbols array
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.symbols)) {
            return parsed.symbols.filter(
              (e: unknown): e is BlastRadiusEntry =>
                typeof e === 'object' &&
                e !== null &&
                typeof (e as BlastRadiusEntry).symbolName === 'string' &&
                typeof (e as BlastRadiusEntry).line === 'number' &&
                typeof (e as BlastRadiusEntry).callerCount === 'number' &&
                typeof (e as BlastRadiusEntry).testCallerCount === 'number'
            );
          }
        } catch {
          // JSON parse failed, skip
        }
      }
    }
    return [];
  }
}

/**
 * Register the blast radius CodeLens provider and wire up
 * cache invalidation on document save.
 */
export function registerDecorations(
  server: IAgentLspServer,
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = new BlastRadiusCodeLensProvider(server);

  const registration = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    provider
  );

  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    provider.invalidate(doc.uri.toString());
  });

  context.subscriptions.push(registration, saveListener, provider);

  return new vscode.Disposable(() => {
    registration.dispose();
    saveListener.dispose();
    provider.dispose();
  });
}
