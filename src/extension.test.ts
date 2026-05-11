import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { ConnectionStateChange } from './types';

// --- Shared mock state (vi.hoisted ensures availability before vi.mock) ---
const mocks = vi.hoisted(() => {
  const start = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const restart = vi.fn(async () => {});
  let autoStart = true;

  return {
    start,
    stop,
    restart,
    get autoStart() { return autoStart; },
    set autoStart(v: boolean) { autoStart = v; },
    server: {
      state: 'stopped' as const,
      onStateChange: vi.fn() as unknown as vscode.Event<ConnectionStateChange>,
      outputChannel: { appendLine: vi.fn(), show: vi.fn() } as unknown as vscode.OutputChannel,
      start,
      stop,
      restart,
      sendRequest: vi.fn(async () => ({})),
      sendNotification: vi.fn(),
    },
  };
});

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    createTerminal: vi.fn(() => ({
      show: vi.fn(),
      sendText: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn((_id: string, _handler: unknown) => ({
      dispose: vi.fn(),
    })),
  },
}));

vi.mock('./server', () => ({
  createServer: vi.fn(() => mocks.server),
}));

vi.mock('./settings', () => ({
  createSettingsProvider: vi.fn(() => ({
    getConfig: () => ({
      binaryPath: '',
      args: [],
      autoStart: mocks.autoStart,
      traceLevel: 'off',
    }),
    onConfigChange: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('./status-bar', () => ({
  createStatusBar: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('./skills', () => ({
  registerSkills: vi.fn(async () => []),
}));

vi.mock('./decorations', () => ({
  registerDecorations: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('./inspector-panel', () => ({
  registerInspectorPanel: vi.fn(() => ({ dispose: vi.fn() })),
}));

function createMockContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

// Must import after vi.mock declarations
import { activate, deactivate } from './extension';

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autoStart = true;
  });

  describe('activate', () => {
    it('starts server when autoStart is true', async () => {
      mocks.autoStart = true;
      const context = createMockContext();
      await activate(context);

      expect(mocks.start).toHaveBeenCalled();
    });

    it('skips start when autoStart is disabled', async () => {
      mocks.autoStart = false;
      const context = createMockContext();
      await activate(context);

      expect(mocks.start).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('stops server on deactivate', async () => {
      const context = createMockContext();
      await activate(context);
      deactivate();

      expect(mocks.stop).toHaveBeenCalled();
    });
  });

  describe('commands', () => {
    it('restart command calls server.restart', async () => {
      const context = createMockContext();
      await activate(context);

      // Find the restart command handler from registerCommand calls
      const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const restartCall = registerCalls.find(([id]) => id === 'agent-lsp.restart');
      expect(restartCall).toBeDefined();

      // Execute the handler
      const handler = restartCall![1] as () => unknown;
      handler();

      expect(mocks.restart).toHaveBeenCalled();
    });
  });
});
