import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => {
  const EventEmitter = vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  }));

  return {
    EventEmitter,
    Range: vi.fn().mockImplementation((startLine: number, startChar: number, endLine: number, endChar: number) => ({
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    })),
    Position: vi.fn().mockImplementation((line: number, character: number) => ({
      line,
      character,
    })),
    CodeLens: vi.fn().mockImplementation((range: unknown, command: unknown) => ({
      range,
      command,
    })),
    Disposable: vi.fn().mockImplementation((callOnDispose: () => void) => ({
      dispose: callOnDispose,
    })),
    languages: {
      registerCodeLensProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      onDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
  };
});

import { registerDecorations } from './decorations';
import type { IAgentLspServer } from './types';

function createMockServer(sendRequestImpl?: (method: string, params?: unknown) => Promise<unknown>): IAgentLspServer {
  return {
    state: 'connected',
    onStateChange: vi.fn() as unknown as import('vscode').Event<import('./types').ConnectionStateChange>,
    outputChannel: {} as import('vscode').OutputChannel,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn().mockImplementation(sendRequestImpl ?? (() => Promise.resolve(null))),
    sendNotification: vi.fn(),
  };
}

function createMockContext(): import('vscode').ExtensionContext {
  return {
    subscriptions: [],
  } as unknown as import('vscode').ExtensionContext;
}

function createMockDocument(uri = 'file:///test.ts', fsPath = '/test.ts'): import('vscode').TextDocument {
  return {
    uri: { toString: () => uri, fsPath },
  } as unknown as import('vscode').TextDocument;
}

const mockResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify([
        { symbolName: 'doSomething', line: 10, callerCount: 5, testCallerCount: 2 },
        { symbolName: 'helperFn', line: 25, callerCount: 3, testCallerCount: 1 },
      ]),
    },
  ],
};

describe('BlastRadiusCodeLensProvider', () => {
  let vscode: typeof import('vscode');

  beforeEach(async () => {
    vi.clearAllMocks();
    vscode = await import('vscode');
  });

  it('TestCodeLens_ShowsCallerCount - shows correct lens title from response', async () => {
    const server = createMockServer(() => Promise.resolve(mockResponse));
    const context = createMockContext();
    registerDecorations(server, context);

    // Get the provider that was registered
    const registerCall = vi.mocked(vscode.languages.registerCodeLensProvider).mock.calls[0];
    const provider = registerCall[1] as import('vscode').CodeLensProvider;

    const doc = createMockDocument();
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken;

    const lenses = await provider.provideCodeLenses!(doc, token);

    expect(lenses).toHaveLength(2);
    expect(lenses![0].command!.title).toBe('5 callers (2 test)');
    expect(lenses![1].command!.title).toBe('3 callers (1 test)');
  });

  it('TestCodeLens_CachesResults - second call returns cached without server request', async () => {
    const server = createMockServer(() => Promise.resolve(mockResponse));
    const context = createMockContext();
    registerDecorations(server, context);

    const registerCall = vi.mocked(vscode.languages.registerCodeLensProvider).mock.calls[0];
    const provider = registerCall[1] as import('vscode').CodeLensProvider;

    const doc = createMockDocument();
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken;

    await provider.provideCodeLenses!(doc, token);
    await provider.provideCodeLenses!(doc, token);

    expect(server.sendRequest).toHaveBeenCalledTimes(1);
  });

  it('TestCodeLens_InvalidatesOnSave - save clears cache, next call hits server', async () => {
    const server = createMockServer(() => Promise.resolve(mockResponse));
    const context = createMockContext();
    registerDecorations(server, context);

    const registerCall = vi.mocked(vscode.languages.registerCodeLensProvider).mock.calls[0];
    const provider = registerCall[1] as import('vscode').CodeLensProvider;

    const doc = createMockDocument();
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken;

    // First call populates cache
    await provider.provideCodeLenses!(doc, token);

    // Simulate save by calling the onDidSaveTextDocument callback
    const saveCallback = vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0] as (doc: import('vscode').TextDocument) => void;
    saveCallback(doc);

    // Next call should hit the server again
    await provider.provideCodeLenses!(doc, token);

    expect(server.sendRequest).toHaveBeenCalledTimes(2);
  });

  it('TestCodeLens_HandlesEmptyResponse - empty response produces empty array', async () => {
    const server = createMockServer(() => Promise.resolve({ content: [{ type: 'text', text: '[]' }] }));
    const context = createMockContext();
    registerDecorations(server, context);

    const registerCall = vi.mocked(vscode.languages.registerCodeLensProvider).mock.calls[0];
    const provider = registerCall[1] as import('vscode').CodeLensProvider;

    const doc = createMockDocument();
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken;

    const lenses = await provider.provideCodeLenses!(doc, token);

    expect(lenses).toHaveLength(0);
  });
});
