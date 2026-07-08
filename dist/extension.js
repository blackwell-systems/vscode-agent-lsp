"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = __toESM(require("vscode"));

// src/server.ts
var vscode = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var fs = __toESM(require("fs"));
function createServer(settings, output) {
  let process;
  let state = "stopped";
  let startedAt;
  let nextId = 1;
  let restartDelay = 1e3;
  let restartTimer;
  const pending = /* @__PURE__ */ new Map();
  let buffer = "";
  const stateEmitter = new vscode.EventEmitter();
  function setState(newState, version) {
    state = newState;
    if (newState === "connected") {
      startedAt = Date.now();
      restartDelay = 1e3;
    }
    stateEmitter.fire({ state: newState, version, startedAt });
  }
  function discoverBinary() {
    const config = settings.getConfig();
    if (config.binaryPath) {
      return config.binaryPath;
    }
    const pathDirs = (globalThis.process?.env?.PATH ?? "").split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, "agent-lsp");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const home = os.homedir();
    const fallback = path.join(home, ".agent-lsp", "bin", "agent-lsp");
    if (fs.existsSync(fallback)) {
      return fallback;
    }
    return "agent-lsp";
  }
  function handleData(data) {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim())
        continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== void 0 && pending.has(msg.id)) {
          const req = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            req.reject(new Error(msg.error.message ?? "RPC error"));
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
    if (restartTimer)
      return;
    output.appendLine(`[lifecycle] restarting in ${restartDelay}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = void 0;
      start();
    }, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 3e4);
  }
  async function start() {
    if (state === "connected" || state === "starting")
      return;
    setState("starting");
    const binary = discoverBinary();
    const config = settings.getConfig();
    const args = config.args ?? [];
    output.appendLine(`[lifecycle] starting: ${binary} ${args.join(" ")}`);
    try {
      const child = cp.spawn(binary, args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      child.stdout?.on("data", handleData);
      child.stderr?.on("data", (data) => {
        output.appendLine(data.toString().trimEnd());
      });
      child.on("error", (err) => {
        output.appendLine(`[error] ${err.message}`);
        setState("failed");
        scheduleRestart();
      });
      child.on("exit", (code, signal) => {
        output.appendLine(`[lifecycle] exited: code=${code} signal=${signal}`);
        process = void 0;
        rejectAllPending(new Error("Server disconnected"));
        if (state !== "stopped") {
          setState("failed");
          scheduleRestart();
        }
      });
      process = child;
      setState("connected");
    } catch (err) {
      output.appendLine(`[error] spawn failed: ${err}`);
      setState("failed");
      scheduleRestart();
    }
  }
  async function stop() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = void 0;
    }
    if (!process) {
      setState("stopped");
      return;
    }
    setState("stopped");
    process.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        process?.kill("SIGKILL");
        resolve();
      }, 3e3);
      process?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    process = void 0;
    rejectAllPending(new Error("Server stopped"));
  }
  async function restart() {
    await stop();
    await start();
  }
  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!process?.stdin?.writable) {
        reject(new Error("Server not connected"));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      process.stdin.write(msg + "\n");
    });
  }
  function sendNotification(method, params) {
    if (!process?.stdin?.writable)
      return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    process.stdin.write(msg + "\n");
  }
  function rejectAllPending(err) {
    for (const [, req] of pending) {
      req.reject(err);
    }
    pending.clear();
  }
  return {
    get state() {
      return state;
    },
    onStateChange: stateEmitter.event,
    outputChannel: output,
    start,
    stop,
    restart,
    sendRequest,
    sendNotification
  };
}

// src/settings.ts
var vscode2 = __toESM(require("vscode"));
var SECTION = "agent-lsp";
function readConfig() {
  const cfg = vscode2.workspace.getConfiguration(SECTION);
  return {
    binaryPath: cfg.get("binaryPath", ""),
    args: cfg.get("args", []),
    autoStart: cfg.get("autoStart", true),
    traceLevel: cfg.get("trace.server", "off")
  };
}
function createSettingsProvider() {
  const emitter = new vscode2.EventEmitter();
  const subscription = vscode2.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      emitter.fire(readConfig());
    }
  });
  emitter.event(() => {
  });
  const disposable = { dispose: () => {
    subscription.dispose();
    emitter.dispose();
  } };
  const provider = {
    getConfig: readConfig,
    onConfigChange: emitter.event,
    dispose: () => disposable.dispose()
  };
  return provider;
}

// src/status-bar.ts
var vscode3 = __toESM(require("vscode"));
function createStatusBar(server2) {
  const item = vscode3.window.createStatusBarItem(
    vscode3.StatusBarAlignment.Left,
    100
  );
  item.command = "agent-lsp.restart";
  item.show();
  function update(change) {
    const uptime = change.startedAt ? formatUptime(Date.now() - change.startedAt) : void 0;
    const version = change.version ?? "unknown";
    switch (change.state) {
      case "connected":
        item.text = "$(zap) agent-lsp";
        item.color = new vscode3.ThemeColor("statusBarItem.foreground");
        item.backgroundColor = void 0;
        item.tooltip = uptime ? `agent-lsp v${version} - up ${uptime}` : `agent-lsp v${version}`;
        break;
      case "starting":
        item.text = "$(sync~spin) agent-lsp";
        item.color = new vscode3.ThemeColor("statusBarItem.warningForeground");
        item.backgroundColor = new vscode3.ThemeColor("statusBarItem.warningBackground");
        item.tooltip = "agent-lsp starting...";
        break;
      case "failed":
        item.text = "$(error) agent-lsp";
        item.color = void 0;
        item.backgroundColor = new vscode3.ThemeColor("statusBarItem.errorBackground");
        item.tooltip = "agent-lsp failed to connect";
        break;
      case "stopped":
        item.text = "$(circle-slash) agent-lsp";
        item.color = void 0;
        item.backgroundColor = void 0;
        item.tooltip = "agent-lsp stopped";
        break;
    }
  }
  const subscription = server2.onStateChange(update);
  update({ state: server2.state });
  return {
    dispose: () => {
      subscription.dispose();
      item.dispose();
    }
  };
}
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1e3);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// src/skills.ts
var vscode4 = __toESM(require("vscode"));
async function registerSkills(server2, context) {
  const disposables = [];
  const skills = await fetchSkills(server2);
  for (const skill of skills) {
    const commandId = `agent-lsp.skill.${skill.name}`;
    const disposable = vscode4.commands.registerCommand(commandId, async () => {
      await invokeSkill(server2, skill);
    });
    disposables.push(disposable);
  }
  const masterDisposable = vscode4.commands.registerCommand(
    "agent-lsp.skills",
    async () => {
      await showSkillPicker(server2, skills);
    }
  );
  disposables.push(masterDisposable);
  for (const d of disposables) {
    context.subscriptions.push(d);
  }
  return disposables;
}
async function fetchSkills(server2) {
  try {
    const response = await server2.sendRequest("prompts/list", {});
    const result = response;
    return result.prompts ?? [];
  } catch (error) {
    server2.outputChannel.appendLine(
      `[skills] Failed to fetch skill list: ${error}`
    );
    return [];
  }
}
async function invokeSkill(server2, skill) {
  const args = {};
  if (skill.arguments && skill.arguments.length > 0) {
    for (const arg of skill.arguments) {
      const value = await promptForArgument(arg);
      if (value === void 0) {
        return;
      }
      args[arg.name] = value;
    }
  }
  try {
    const result = await server2.sendRequest("prompts/get", {
      name: skill.name,
      arguments: args
    });
    displayResult(server2, skill.name, result);
  } catch (error) {
    server2.outputChannel.appendLine(
      `[skills] Error invoking ${skill.name}: ${error}`
    );
    server2.outputChannel.show(true);
  }
}
async function promptForArgument(arg) {
  const defaultValue = getDefaultValue(arg);
  return vscode4.window.showInputBox({
    prompt: arg.description,
    placeHolder: arg.name,
    value: defaultValue,
    ignoreFocusOut: true
  });
}
function getDefaultValue(arg) {
  if (arg.default) {
    return arg.default;
  }
  const isFilePath = arg.name.includes("file") || arg.name.includes("path") || arg.description.toLowerCase().includes("file path");
  if (isFilePath) {
    const activeEditor = vscode4.window.activeTextEditor;
    if (activeEditor) {
      return activeEditor.document.uri.fsPath;
    }
  }
  return void 0;
}
async function showSkillPicker(server2, skills) {
  if (skills.length === 0) {
    vscode4.window.showInformationMessage("No agent-lsp skills available.");
    return;
  }
  const items = skills.map((skill2) => ({
    label: skill2.name,
    description: skill2.description
  }));
  const selected = await vscode4.window.showQuickPick(items, {
    placeHolder: "Select an agent-lsp skill to run",
    matchOnDescription: true
  });
  if (!selected) {
    return;
  }
  const skill = skills.find((s) => s.name === selected.label);
  if (skill) {
    await invokeSkill(server2, skill);
  }
}
function displayResult(server2, skillName, result) {
  server2.outputChannel.appendLine(`
--- ${skillName} ---`);
  const response = result;
  if (response.messages && Array.isArray(response.messages)) {
    for (const msg of response.messages) {
      if (msg.content?.text) {
        server2.outputChannel.appendLine(msg.content.text);
      }
    }
  } else {
    server2.outputChannel.appendLine(JSON.stringify(result, null, 2));
  }
  server2.outputChannel.appendLine(`--- end ${skillName} ---
`);
  server2.outputChannel.show(true);
}

// src/decorations.ts
var vscode5 = __toESM(require("vscode"));
var BlastRadiusCodeLensProvider = class {
  constructor(server2) {
    this.server = server2;
  }
  cache = /* @__PURE__ */ new Map();
  onDidChangeEmitter = new vscode5.EventEmitter();
  onDidChangeCodeLenses = this.onDidChangeEmitter.event;
  async provideCodeLenses(document, _token) {
    const uri = document.uri.toString();
    const cached = this.cache.get(uri);
    if (cached) {
      return cached;
    }
    try {
      const response = await this.server.sendRequest("tools/call", {
        name: "get_change_impact",
        arguments: { changed_files: [document.uri.fsPath] }
      });
      const entries = this.parseResponse(response);
      const lenses = entries.map((entry) => {
        const range = new vscode5.Range(
          new vscode5.Position(entry.line - 1, 0),
          new vscode5.Position(entry.line - 1, 0)
        );
        const title = `${entry.callerCount} callers (${entry.testCallerCount} test)`;
        const lens = new vscode5.CodeLens(range, {
          title,
          command: ""
        });
        return lens;
      });
      this.cache.set(uri, lenses);
      return lenses;
    } catch {
      return [];
    }
  }
  invalidate(uri) {
    this.cache.delete(uri);
    this.onDidChangeEmitter.fire();
  }
  dispose() {
    this.onDidChangeEmitter.dispose();
    this.cache.clear();
  }
  parseResponse(response) {
    if (!response || typeof response !== "object") {
      return [];
    }
    const obj = response;
    const content = obj["content"];
    if (!Array.isArray(content)) {
      return [];
    }
    for (const block of content) {
      if (typeof block === "object" && block !== null && block["type"] === "text") {
        try {
          const parsed = JSON.parse(block["text"]);
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (e) => typeof e === "object" && e !== null && typeof e.symbolName === "string" && typeof e.line === "number" && typeof e.callerCount === "number" && typeof e.testCallerCount === "number"
            );
          }
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.symbols)) {
            return parsed.symbols.filter(
              (e) => typeof e === "object" && e !== null && typeof e.symbolName === "string" && typeof e.line === "number" && typeof e.callerCount === "number" && typeof e.testCallerCount === "number"
            );
          }
        } catch {
        }
      }
    }
    return [];
  }
};
function registerDecorations(server2, context) {
  const provider = new BlastRadiusCodeLensProvider(server2);
  const registration = vscode5.languages.registerCodeLensProvider(
    { scheme: "file" },
    provider
  );
  const saveListener = vscode5.workspace.onDidSaveTextDocument((doc) => {
    provider.invalidate(doc.uri.toString());
  });
  context.subscriptions.push(registration, saveListener, provider);
  return new vscode5.Disposable(() => {
    registration.dispose();
    saveListener.dispose();
    provider.dispose();
  });
}

// src/inspector-panel.ts
var vscode6 = __toESM(require("vscode"));
var InspectorTreeDataProvider = class {
  constructor(server2) {
    this.server = server2;
  }
  findings = [];
  _onDidChangeTreeData = new vscode6.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  getTreeItem(finding) {
    const iconName = finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "info";
    const label = `${finding.checkType}: ${finding.file}:${finding.line}`;
    const truncatedMessage = finding.message.length > 80 ? finding.message.slice(0, 80) : finding.message;
    const item = new vscode6.TreeItem(label, vscode6.TreeItemCollapsibleState.None);
    item.iconPath = new vscode6.ThemeIcon(iconName);
    item.description = truncatedMessage;
    item.command = {
      title: "Open Finding",
      command: "vscode.open",
      arguments: [
        vscode6.Uri.file(finding.file),
        {
          selection: new vscode6.Range(
            new vscode6.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1)),
            new vscode6.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1))
          )
        }
      ]
    };
    return item;
  }
  getChildren() {
    return this.findings;
  }
  /**
   * Re-fetch findings from the MCP resource and fire a tree data change event.
   */
  async refresh() {
    try {
      const response = await this.server.sendRequest("resources/read", {
        uri: "inspect://last"
      });
      this.findings = parseFindings(response);
    } catch {
      this.findings = [];
    }
    this._onDidChangeTreeData.fire();
  }
  dispose() {
    this._onDidChangeTreeData.dispose();
  }
};
function parseFindings(response) {
  if (!response || typeof response !== "object") {
    return [];
  }
  const res = response;
  const contents = res["contents"];
  if (!Array.isArray(contents) || contents.length === 0) {
    return [];
  }
  const firstContent = contents[0];
  const text = firstContent?.["text"];
  if (typeof text !== "string") {
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
function isInspectionFinding(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value;
  return (obj["severity"] === "error" || obj["severity"] === "warning" || obj["severity"] === "info") && typeof obj["checkType"] === "string" && typeof obj["file"] === "string" && typeof obj["line"] === "number" && typeof obj["column"] === "number" && typeof obj["message"] === "string";
}
function registerInspectorPanel(server2, context) {
  const provider = new InspectorTreeDataProvider(server2);
  const treeView = vscode6.window.createTreeView("agentLsp.inspector", {
    treeDataProvider: provider
  });
  const watcher = vscode6.workspace.createFileSystemWatcher(
    "**/.agent-lsp/last-inspection.json"
  );
  const onFileChange = watcher.onDidChange(() => {
    void provider.refresh();
  });
  const onFileCreate = watcher.onDidCreate(() => {
    void provider.refresh();
  });
  void provider.refresh();
  const disposable = vscode6.Disposable.from(
    treeView,
    provider,
    watcher,
    onFileChange,
    onFileCreate
  );
  context.subscriptions.push(disposable);
  return disposable;
}

// src/extension.ts
var server;
async function activate(context) {
  const outputChannel = vscode7.window.createOutputChannel("agent-lsp");
  context.subscriptions.push(outputChannel);
  const settings = createSettingsProvider();
  context.subscriptions.push(settings);
  const srv = createServer(settings, outputChannel);
  server = srv;
  const statusBar = createStatusBar(srv);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode7.commands.registerCommand("agent-lsp.restart", () => srv.restart()),
    vscode7.commands.registerCommand("agent-lsp.stop", () => srv.stop()),
    vscode7.commands.registerCommand("agent-lsp.install", () => {
      const terminal = vscode7.window.createTerminal("agent-lsp install");
      terminal.show();
      terminal.sendText("npm install -g @blackwell-systems/agent-lsp");
    })
  );
  registerSkills(srv, context).catch((err) => {
    outputChannel.appendLine(`[warn] Failed to register skills: ${err}`);
  });
  const decorations = registerDecorations(srv, context);
  context.subscriptions.push(decorations);
  const inspector = registerInspectorPanel(srv, context);
  context.subscriptions.push(inspector);
  const config = settings.getConfig();
  if (config.autoStart) {
    srv.start().catch((err) => {
      outputChannel.appendLine(`[error] Server failed to start: ${err}`);
    });
  }
}
function deactivate() {
  if (server) {
    server.stop();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
