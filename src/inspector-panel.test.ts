import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { InspectorTreeDataProvider, parseFindings } from './inspector-panel';
import { InspectionFinding, IAgentLspServer } from './types';

// Mock vscode module
vi.mock('vscode', () => {
  const EventEmitter = vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  }));

  return {
    TreeItem: vi.fn().mockImplementation((label: string, collapsibleState: number) => ({
      label,
      collapsibleState,
    })),
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),
    Uri: { file: vi.fn((path: string) => ({ scheme: 'file', path })) },
    Range: vi.fn().mockImplementation((start: unknown, end: unknown) => ({ start, end })),
    Position: vi.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
    EventEmitter,
    Disposable: { from: vi.fn() },
    window: { createTreeView: vi.fn() },
    workspace: {
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        dispose: vi.fn(),
      })),
    },
  };
});

function createMockServer(response: unknown = null): IAgentLspServer {
  return {
    state: 'connected',
    onStateChange: vi.fn() as unknown as vscode.Event<never>,
    outputChannel: {} as vscode.OutputChannel,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    sendRequest: vi.fn().mockResolvedValue(response),
    sendNotification: vi.fn(),
  };
}

function makeFinding(overrides: Partial<InspectionFinding> = {}): InspectionFinding {
  return {
    severity: 'error',
    checkType: 'dead-code',
    file: '/src/foo.ts',
    line: 10,
    column: 5,
    message: 'Unused export: fooHelper',
    ...overrides,
  };
}

describe('InspectorTreeDataProvider', () => {
  describe('TestTreeItem_ErrorSeverity', () => {
    it('error finding gets ThemeIcon("error")', () => {
      const server = createMockServer();
      const provider = new InspectorTreeDataProvider(server);
      const finding = makeFinding({ severity: 'error' });

      const item = provider.getTreeItem(finding);

      expect(vscode.ThemeIcon).toHaveBeenCalledWith('error');
      expect(item.iconPath).toEqual({ id: 'error' });
    });

    it('warning finding gets ThemeIcon("warning")', () => {
      const server = createMockServer();
      const provider = new InspectorTreeDataProvider(server);
      const finding = makeFinding({ severity: 'warning' });

      const item = provider.getTreeItem(finding);

      expect(vscode.ThemeIcon).toHaveBeenCalledWith('warning');
      expect(item.iconPath).toEqual({ id: 'warning' });
    });

    it('info finding gets ThemeIcon("info")', () => {
      const server = createMockServer();
      const provider = new InspectorTreeDataProvider(server);
      const finding = makeFinding({ severity: 'info' });

      const item = provider.getTreeItem(finding);

      expect(vscode.ThemeIcon).toHaveBeenCalledWith('info');
      expect(item.iconPath).toEqual({ id: 'info' });
    });
  });

  describe('TestTreeItem_ClickOpensFile', () => {
    it('command has correct file URI and position', () => {
      const server = createMockServer();
      const provider = new InspectorTreeDataProvider(server);
      const finding = makeFinding({ file: '/src/bar.ts', line: 42, column: 8 });

      const item = provider.getTreeItem(finding);

      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('vscode.open');
      expect(vscode.Uri.file).toHaveBeenCalledWith('/src/bar.ts');
      // Position is 0-indexed, so line 42 -> 41, column 8 -> 7
      expect(vscode.Position).toHaveBeenCalledWith(41, 7);
    });
  });

  describe('TestGetChildren_ParsesFindings', () => {
    it('mock response becomes finding array', async () => {
      const findings = [makeFinding(), makeFinding({ severity: 'warning', checkType: 'error-handling' })];
      const mcpResponse = {
        contents: [{ text: JSON.stringify(findings) }],
      };
      const server = createMockServer(mcpResponse);
      const provider = new InspectorTreeDataProvider(server);

      await provider.refresh();
      const children = provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0].severity).toBe('error');
      expect(children[1].checkType).toBe('error-handling');
    });

    it('returns empty array for null response', async () => {
      const server = createMockServer(null);
      const provider = new InspectorTreeDataProvider(server);

      await provider.refresh();
      const children = provider.getChildren();

      expect(children).toHaveLength(0);
    });

    it('returns empty array for malformed response', async () => {
      const server = createMockServer({ contents: [{ text: 'not json' }] });
      const provider = new InspectorTreeDataProvider(server);

      await provider.refresh();
      const children = provider.getChildren();

      expect(children).toHaveLength(0);
    });
  });

  describe('TestRefresh_ReloadsData', () => {
    it('refresh fires onDidChangeTreeData', async () => {
      const findings = [makeFinding()];
      const mcpResponse = { contents: [{ text: JSON.stringify(findings) }] };
      const server = createMockServer(mcpResponse);
      const provider = new InspectorTreeDataProvider(server);

      await provider.refresh();

      // Verify sendRequest was called with correct args
      expect(server.sendRequest).toHaveBeenCalledWith('resources/read', {
        uri: 'inspect://last',
      });
    });
  });
});

describe('parseFindings', () => {
  it('filters out invalid findings', () => {
    const result = parseFindings({
      contents: [{
        text: JSON.stringify([
          makeFinding(),
          { severity: 'invalid', checkType: 'x' }, // missing fields
          makeFinding({ severity: 'warning' }),
        ]),
      }],
    });

    expect(result).toHaveLength(2);
  });
});
