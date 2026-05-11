import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const EventEmitter = class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (listener: (e: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire = (data: unknown) => { this.listeners.forEach(l => l(data)); };
    dispose = () => { this.listeners = []; };
  };

  return {
    workspace: {
      getConfiguration: vi.fn(() => ({ get: vi.fn() })),
      onDidChangeConfiguration: vi.fn(),
    },
    EventEmitter,
    window: {
      createStatusBarItem: vi.fn(() => ({
        text: '',
        color: undefined,
        backgroundColor: undefined,
        tooltip: '',
        command: '',
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: class { constructor(public id: string) {} },
  };
});

import { createSettingsProvider } from './settings';
import { createStatusBar } from './status-bar';
import type { ConnectionStateChange, IAgentLspServer } from './types';
import * as vscode from 'vscode';

describe('settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TestGetConfig_ReadsAllSettings', () => {
    const mockGet = vi.fn((key: string) => {
      switch (key) {
        case 'binaryPath': return '/usr/local/bin/agent-lsp';
        case 'args': return ['--stdio'];
        case 'autoStart': return false;
        case 'trace.server': return 'verbose';
        default: return undefined;
      }
    });
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: mockGet } as unknown as vscode.WorkspaceConfiguration);

    const provider = createSettingsProvider();
    const config = provider.getConfig();

    expect(config.binaryPath).toBe('/usr/local/bin/agent-lsp');
    expect(config.args).toEqual(['--stdio']);
    expect(config.autoStart).toBe(false);
    expect(config.traceLevel).toBe('verbose');
  });

  it('TestOnConfigChange_FiresOnChange', () => {
    let configChangeCallback: ((e: { affectsConfiguration: (s: string) => boolean }) => void) | undefined;
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((cb: unknown) => {
      configChangeCallback = cb as typeof configChangeCallback;
      return { dispose: vi.fn() } as unknown as vscode.Disposable;
    });

    const mockGet = vi.fn((key: string) => {
      switch (key) {
        case 'binaryPath': return '/new/path';
        case 'args': return [];
        case 'autoStart': return true;
        case 'trace.server': return 'messages';
        default: return undefined;
      }
    });
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: mockGet } as unknown as vscode.WorkspaceConfiguration);

    const provider = createSettingsProvider();
    const handler = vi.fn();
    provider.onConfigChange(handler);

    expect(configChangeCallback).toBeDefined();
    configChangeCallback!({ affectsConfiguration: (s: string) => s === 'agent-lsp' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      binaryPath: '/new/path',
      traceLevel: 'messages',
    }));
  });
});

describe('status-bar', () => {
  function createMockServer(initialState: string = 'stopped'): IAgentLspServer & { fireStateChange: (c: ConnectionStateChange) => void } {
    let listener: ((c: ConnectionStateChange) => void) | undefined;
    return {
      state: initialState as IAgentLspServer['state'],
      onStateChange: ((cb: (c: ConnectionStateChange) => void) => {
        listener = cb;
        return { dispose: vi.fn() };
      }) as unknown as vscode.Event<ConnectionStateChange>,
      outputChannel: {} as vscode.OutputChannel,
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      sendRequest: vi.fn(),
      sendNotification: vi.fn(),
      fireStateChange: (c: ConnectionStateChange) => { listener?.(c); },
    };
  }

  it('TestStatusBar_ConnectedState', () => {
    const statusBarItem = {
      text: '',
      color: undefined as unknown,
      backgroundColor: undefined as unknown,
      tooltip: '',
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(statusBarItem as unknown as vscode.StatusBarItem);

    const server = createMockServer('connected');
    createStatusBar(server);

    expect(statusBarItem.text).toBe('$(zap) agent-lsp');
  });

  it('TestStatusBar_FailedState', () => {
    const statusBarItem = {
      text: '',
      color: undefined as unknown,
      backgroundColor: undefined as unknown,
      tooltip: '',
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(statusBarItem as unknown as vscode.StatusBarItem);

    const server = createMockServer('stopped');
    createStatusBar(server);
    server.fireStateChange({ state: 'failed' });

    expect(statusBarItem.text).toBe('$(error) agent-lsp');
  });
});
