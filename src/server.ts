import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  ConnectionState,
  ConnectionStateChange,
  IAgentLspServer,
  ISettingsProvider,
} from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export function createServer(
  settings: ISettingsProvider,
  output: vscode.OutputChannel
): IAgentLspServer {
  let process: cp.ChildProcess | undefined;
  let state: ConnectionState = 'stopped';
  let startedAt: number | undefined;
  let nextId = 1;
  let restartDelay = 1000;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, PendingRequest>();
  let buffer = '';

  const stateEmitter = new vscode.EventEmitter<ConnectionStateChange>();

  function setState(newState: ConnectionState, version?: string) {
    state = newState;
    if (newState === 'connected') {
      startedAt = Date.now();
      restartDelay = 1000;
    }
    stateEmitter.fire({ state: newState, version, startedAt });
  }

  function discoverBinary(): string {
    const config = settings.getConfig();
    if (config.binaryPath) {
      return config.binaryPath;
    }

    // Check PATH
    const pathDirs = (globalThis.process?.env?.PATH ?? '').split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, 'agent-lsp');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Fallback
    const home = os.homedir();
    const fallback = path.join(home, '.agent-lsp', 'bin', 'agent-lsp');
    if (fs.existsSync(fallback)) {
      return fallback;
    }

    return 'agent-lsp'; // hope it's on PATH
  }

  function handleData(data: Buffer) {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const req = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) {
            req.reject(new Error(msg.error.message ?? 'RPC error'));
          } else {
            req.resolve(msg.result);
          }
        } else if (msg.method) {
          output.appendLine(`[notification] ${msg.method}`);
        }
      } catch {
        output.appendLine(`[parse error] ${line.slice(0, 100)}`);
      }
    }
  }

  function scheduleRestart() {
    if (restartTimer) return;
    output.appendLine(`[lifecycle] restarting in ${restartDelay}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      start();
    }, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 30000);
  }

  async function start(): Promise<void> {
    if (state === 'connected' || state === 'starting') return;
    setState('starting');

    const binary = discoverBinary();
    const config = settings.getConfig();
    const args = config.args ?? [];

    output.appendLine(`[lifecycle] starting: ${binary} ${args.join(' ')}`);

    try {
      const child = cp.spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', handleData);
      child.stderr?.on('data', (data: Buffer) => {
        output.appendLine(data.toString().trimEnd());
      });

      child.on('error', (err: Error) => {
        output.appendLine(`[error] ${err.message}`);
        setState('failed');
        scheduleRestart();
      });

      child.on('exit', (code: number | null, signal: string | null) => {
        output.appendLine(`[lifecycle] exited: code=${code} signal=${signal}`);
        process = undefined;
        rejectAllPending(new Error('Server disconnected'));
        if (state !== 'stopped') {
          setState('failed');
          scheduleRestart();
        }
      });

      process = child;
      setState('connected');
    } catch (err) {
      output.appendLine(`[error] spawn failed: ${err}`);
      setState('failed');
      scheduleRestart();
    }
  }

  async function stop(): Promise<void> {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
    if (!process) {
      setState('stopped');
      return;
    }

    setState('stopped');
    process.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        process?.kill('SIGKILL');
        resolve();
      }, 3000);
      process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    process = undefined;
    rejectAllPending(new Error('Server stopped'));
  }

  async function restart(): Promise<void> {
    await stop();
    await start();
  }

  function sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!process?.stdin?.writable) {
        reject(new Error('Server not connected'));
        return;
      }

      const id = nextId++;
      pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      process.stdin.write(msg + '\n');
    });
  }

  function sendNotification(method: string, params?: unknown): void {
    if (!process?.stdin?.writable) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    process.stdin.write(msg + '\n');
  }

  function rejectAllPending(err: Error) {
    for (const [, req] of pending) {
      req.reject(err);
    }
    pending.clear();
  }

  return {
    get state() { return state; },
    onStateChange: stateEmitter.event,
    outputChannel: output,
    start,
    stop,
    restart,
    sendRequest,
    sendNotification,
  };
}
