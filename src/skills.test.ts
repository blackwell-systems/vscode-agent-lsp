import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { registerSkills } from './skills';
import { IAgentLspServer, SkillDescriptor } from './types';

// Mock vscode module
vi.mock('vscode', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  return {
    commands: {
      registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
        commands.set(id, handler);
        return { dispose: vi.fn() };
      }),
      executeCommand: vi.fn(async (id: string, ...args: unknown[]) => {
        const handler = commands.get(id);
        if (handler) {
          return handler(...args);
        }
      }),
    },
    window: {
      showInputBox: vi.fn(),
      showQuickPick: vi.fn(),
      showInformationMessage: vi.fn(),
      activeTextEditor: undefined as unknown,
    },
    EventEmitter: vi.fn(() => ({
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

function createMockServer(skills: SkillDescriptor[] = []): IAgentLspServer {
  return {
    state: 'connected',
    onStateChange: vi.fn() as unknown as vscode.Event<unknown>,
    outputChannel: {
      appendLine: vi.fn(),
      show: vi.fn(),
    } as unknown as vscode.OutputChannel,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    sendRequest: vi.fn(async (method: string) => {
      if (method === 'prompts/list') {
        return { prompts: skills };
      }
      if (method === 'prompts/get') {
        return { messages: [{ content: { text: 'result text' } }] };
      }
      return {};
    }),
    sendNotification: vi.fn(),
  } as unknown as IAgentLspServer;
}

function createMockContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

describe('registerSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates commands for each skill from prompts/list', async () => {
    const skills: SkillDescriptor[] = [
      { name: 'lsp-verify', description: 'Verify changes' },
      { name: 'lsp-inspect', description: 'Inspect code', arguments: [] },
    ];
    const server = createMockServer(skills);
    const context = createMockContext();

    const disposables = await registerSkills(server, context);

    // Should register individual commands + master command
    expect(disposables.length).toBe(3);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'agent-lsp.skill.lsp-verify',
      expect.any(Function)
    );
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'agent-lsp.skill.lsp-inspect',
      expect.any(Function)
    );
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'agent-lsp.skills',
      expect.any(Function)
    );
  });

  it('handles empty skill list gracefully', async () => {
    const server = createMockServer([]);
    const context = createMockContext();

    const disposables = await registerSkills(server, context);

    // Only the master command should be registered
    expect(disposables.length).toBe(1);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'agent-lsp.skills',
      expect.any(Function)
    );
  });

  it('prompts for arguments when skill has required args', async () => {
    const skills: SkillDescriptor[] = [
      {
        name: 'lsp-impact',
        description: 'Blast radius',
        arguments: [
          { name: 'symbol', description: 'Symbol name', required: true },
          { name: 'scope', description: 'Analysis scope', required: false },
        ],
      },
    ];
    const server = createMockServer(skills);
    const context = createMockContext();

    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('MyFunction')
      .mockResolvedValueOnce('all');

    await registerSkills(server, context);

    // Execute the skill command
    await vscode.commands.executeCommand('agent-lsp.skill.lsp-impact');

    // Should have prompted for both arguments
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Symbol name',
        placeHolder: 'symbol',
      })
    );

    // Should have called prompts/get with collected args
    expect(server.sendRequest).toHaveBeenCalledWith('prompts/get', {
      name: 'lsp-impact',
      arguments: { symbol: 'MyFunction', scope: 'all' },
    });
  });

  it('defaults file-path arguments to active editor path', async () => {
    const skills: SkillDescriptor[] = [
      {
        name: 'lsp-inspect',
        description: 'Inspect',
        arguments: [
          { name: 'file_path', description: 'File to inspect', required: true },
        ],
      },
    ];
    const server = createMockServer(skills);
    const context = createMockContext();

    // Mock active editor
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
      document: {
        uri: { fsPath: '/workspace/src/main.ts' },
      },
    };

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('/workspace/src/main.ts');

    await registerSkills(server, context);
    await vscode.commands.executeCommand('agent-lsp.skill.lsp-inspect');

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '/workspace/src/main.ts',
      })
    );
  });

  it('master command shows QuickPick of all skills', async () => {
    const skills: SkillDescriptor[] = [
      { name: 'lsp-verify', description: 'Verify changes' },
      { name: 'lsp-inspect', description: 'Inspect code' },
    ];
    const server = createMockServer(skills);
    const context = createMockContext();

    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: 'lsp-verify',
      description: 'Verify changes',
    });

    await registerSkills(server, context);
    await vscode.commands.executeCommand('agent-lsp.skills');

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'lsp-verify', description: 'Verify changes' },
        { label: 'lsp-inspect', description: 'Inspect code' },
      ],
      expect.objectContaining({
        placeHolder: 'Select an agent-lsp skill to run',
      })
    );

    // Should invoke the selected skill
    expect(server.sendRequest).toHaveBeenCalledWith('prompts/get', {
      name: 'lsp-verify',
      arguments: {},
    });
  });
});
