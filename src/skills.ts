import * as vscode from 'vscode';
import { IAgentLspServer, SkillDescriptor, SkillArgument } from './types';

/**
 * Registers VS Code commands for all agent-lsp skills.
 * Fetches the skill list from the server via prompts/list and creates
 * a command for each skill plus a master QuickPick command.
 */
export async function registerSkills(
  server: IAgentLspServer,
  context: vscode.ExtensionContext
): Promise<vscode.Disposable[]> {
  const disposables: vscode.Disposable[] = [];

  // Fetch available skills from the server
  const skills = await fetchSkills(server);

  // Register individual skill commands
  for (const skill of skills) {
    const commandId = `agent-lsp.skill.${skill.name}`;
    const disposable = vscode.commands.registerCommand(commandId, async () => {
      await invokeSkill(server, skill);
    });
    disposables.push(disposable);
  }

  // Register master QuickPick command
  const masterDisposable = vscode.commands.registerCommand(
    'agent-lsp.skills',
    async () => {
      await showSkillPicker(server, skills);
    }
  );
  disposables.push(masterDisposable);

  // Add all disposables to extension context
  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  return disposables;
}

/**
 * Fetches the list of available skills from the server.
 */
async function fetchSkills(server: IAgentLspServer): Promise<SkillDescriptor[]> {
  try {
    const response = await server.sendRequest('prompts/list', {});
    const result = response as { prompts?: SkillDescriptor[] };
    return result.prompts ?? [];
  } catch (error) {
    server.outputChannel.appendLine(
      `[skills] Failed to fetch skill list: ${error}`
    );
    return [];
  }
}

/**
 * Invokes a skill, prompting the user for any required arguments.
 */
async function invokeSkill(
  server: IAgentLspServer,
  skill: SkillDescriptor
): Promise<void> {
  const args: Record<string, string> = {};

  if (skill.arguments && skill.arguments.length > 0) {
    for (const arg of skill.arguments) {
      const value = await promptForArgument(arg);
      if (value === undefined) {
        // User cancelled
        return;
      }
      args[arg.name] = value;
    }
  }

  try {
    const result = await server.sendRequest('prompts/get', {
      name: skill.name,
      arguments: args,
    });
    displayResult(server, skill.name, result);
  } catch (error) {
    server.outputChannel.appendLine(
      `[skills] Error invoking ${skill.name}: ${error}`
    );
    server.outputChannel.show(true);
  }
}

/**
 * Prompts the user for a single skill argument value.
 * Defaults file-path arguments to the active editor's file path.
 */
async function promptForArgument(arg: SkillArgument): Promise<string | undefined> {
  const defaultValue = getDefaultValue(arg);

  return vscode.window.showInputBox({
    prompt: arg.description,
    placeHolder: arg.name,
    value: defaultValue,
    ignoreFocusOut: true,
  });
}

/**
 * Determines the default value for an argument.
 * File-path arguments default to the active editor's file path.
 */
function getDefaultValue(arg: SkillArgument): string | undefined {
  // If the argument has an explicit default, use it
  if (arg.default) {
    return arg.default;
  }

  // For file-path arguments, default to the active editor's file
  const isFilePath =
    arg.name.includes('file') ||
    arg.name.includes('path') ||
    arg.description.toLowerCase().includes('file path');

  if (isFilePath) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      return activeEditor.document.uri.fsPath;
    }
  }

  return undefined;
}

/**
 * Shows a QuickPick of all available skills, then invokes the selected one.
 */
async function showSkillPicker(
  server: IAgentLspServer,
  skills: SkillDescriptor[]
): Promise<void> {
  if (skills.length === 0) {
    vscode.window.showInformationMessage('No agent-lsp skills available.');
    return;
  }

  const items: vscode.QuickPickItem[] = skills.map((skill) => ({
    label: skill.name,
    description: skill.description,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an agent-lsp skill to run',
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  const skill = skills.find((s) => s.name === selected.label);
  if (skill) {
    await invokeSkill(server, skill);
  }
}

/**
 * Displays the result of a skill invocation in the output channel.
 */
function displayResult(
  server: IAgentLspServer,
  skillName: string,
  result: unknown
): void {
  server.outputChannel.appendLine(`\n--- ${skillName} ---`);

  const response = result as { messages?: Array<{ content: { text?: string } }> };
  if (response.messages && Array.isArray(response.messages)) {
    for (const msg of response.messages) {
      if (msg.content?.text) {
        server.outputChannel.appendLine(msg.content.text);
      }
    }
  } else {
    server.outputChannel.appendLine(JSON.stringify(result, null, 2));
  }

  server.outputChannel.appendLine(`--- end ${skillName} ---\n`);
  server.outputChannel.show(true);
}
