import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatOrchestrator } from './services';
import { ChatRequest } from './types';
import { GitService } from './services/GitService';
import { NpmService } from './services/NpmService';

const CMD_RE = /<vscode-cmd>([\s\S]*?)<\/vscode-cmd>/g;

function extractCmds(text: string): Array<Record<string, any>> {
  const cmds: Array<Record<string, any>> = [];
  let m: RegExpExecArray | null;
  CMD_RE.lastIndex = 0;
  while ((m = CMD_RE.exec(text)) !== null) {
    try { cmds.push(JSON.parse(m[1])); } catch {}
  }
  return cmds;
}

function stripCmds(text: string): string {
  return text.replace(/<vscode-cmd>[\s\S]*?<\/vscode-cmd>/g, '').trim();
}

const SCAN_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '__pycache__', '.vscode', '.idea',
]);

function scanFolders(
  root: string,
  rel: string,
  depth: number,
  maxDepth: number,
): Array<{ name: string; path: string; depth: number }> {
  if (depth > maxDepth) { return []; }
  const result: Array<{ name: string; path: string; depth: number }> = [];
  try {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || SCAN_EXCLUDE.has(e.name) || e.name.startsWith('.')) { continue; }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      result.push({ name: e.name, path: relPath, depth });
      result.push(...scanFolders(root, relPath, depth + 1, maxDepth));
    }
  } catch {}
  return result;
}

interface ScheduledTask {
  id: string
  text: string
  scheduledAt: number
  completedAt?: number
}

const SCHEDULE_KEY = 'kludge.scheduledPrompts';

export class ChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'kludge.chatView';
  private _view?: vscode.WebviewView;
  private _abortController?: AbortController;
  private _messageQueue: any[] = [];
  private _readyResolve?: () => void;
  private _readyPromise: Promise<void> = new Promise(r => { this._readyResolve = r; });
  private _isReady = false;
  private _git?: GitService;
  private _npm?: NpmService;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _globalState: vscode.Memento,
    private readonly orchestrator?: ChatOrchestrator
  ) {}

  get isVisible(): boolean {
    return this._view?.visible ?? false;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    this._isReady = false;
    this._readyPromise = new Promise(r => { this._readyResolve = r; });

    const postMsg = (msg: unknown) => this._view?.webview.postMessage(msg);
    this._git = new GitService(postMsg, this.orchestrator);
    this._npm = new NpmService(postMsg);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    const sendAll = () => {
      if (!webviewView.visible) { return; }
      this._sendLocale();
      this._sendHistory();
      this._sendModels();
      this._sendNpmScripts();
      this._sendWorkspaceTree();
      this._sendActiveFile();
      this._sendCustomPrompts();
      this._sendScheduledTasks();
      void this._git?.sendInfo(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
    };

    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(() => this._sendActiveFile());
    webviewView.onDidDispose(() => activeEditorDisposable.dispose());
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) { sendAll(); this._flushQueue(); }
    });

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'ready') {
        this._isReady = true;
        this._readyResolve?.();
        sendAll();
        this._flushQueue();
        return;
      }
      void this._handleMessage(msg);
    });
  }

  public async postMessageWhenReady(msg: any, timeoutMs = 2000): Promise<void> {
    if (!this._isReady || !this._view?.visible) {
      vscode.commands.executeCommand(`${ChatProvider.viewId}.focus`).then(() => {}, () => {});
      await Promise.race([
        this._readyPromise,
        new Promise<void>(r => setTimeout(r, timeoutMs)),
      ]);
    }
    if (this._view?.visible) {
      this._view.webview.postMessage(msg);
    } else {
      this._messageQueue.push(msg);
    }
  }

  public postMessage(msg: any) {
    if (this._view?.visible) {
      this._view.webview.postMessage(msg);
    } else {
      this._messageQueue.push(msg);
      if (msg.type === 'user-message' || msg.type === 'stream-start') {
        vscode.commands.executeCommand(`${ChatProvider.viewId}.focus`).then(() => {}, () => {});
      }
    }
  }

  private _flushQueue() {
    if (!this._view?.visible || this._messageQueue.length === 0) { return; }
    const queue = [...this._messageQueue];
    this._messageQueue = [];
    for (const msg of queue) { this._view.webview.postMessage(msg); }
  }

  private _sendLocale() {
    if (!this._view?.visible) { return; }
    this._view.webview.postMessage({ type: 'locale', locale: vscode.env.language });
  }

  private _sendHistory() {
    if (!this._view?.visible || !this.orchestrator) { return; }
    try {
      const hist = this.orchestrator.getHistory('default');
      if (Array.isArray(hist) && hist.length > 0) {
        this._view.webview.postMessage({ type: 'history', conversationId: 'default', messages: hist });
      }
    } catch (e) {
      console.error('[Kludge] ChatProvider: failed to send history', e);
    }
  }

  private _sendModels() {
    if (!this._view?.visible) { return; }
    const models = this.orchestrator?.getAvailableModels() ?? [];
    this._view.webview.postMessage({ type: 'models', models });
  }

  private _sendWorkspaceTree() {
    if (!this._view?.visible) { return; }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      this._view.webview.postMessage({ type: 'workspace-tree', root: null, folders: [] });
      return;
    }
    const folders = scanFolders(folder, '', 0, 2);
    this._view.webview.postMessage({ type: 'workspace-tree', root: folder, folders });
  }

  private _sendActiveFile() {
    if (!this._view?.visible) { return; }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
    let relativePath: string | null = null;
    if (filePath && folder) {
      const norm = filePath.replace(/\\/g, '/');
      const normFolder = folder.replace(/\\/g, '/');
      if (norm.startsWith(normFolder)) {
        relativePath = norm.slice(normFolder.length).replace(/^\//, '');
      }
    }
    this._view.webview.postMessage({ type: 'active-file', relativePath });
  }

  private async _sendScheduledPrompt(text: string) {
    this._abortController?.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    await this.postMessageWhenReady({ type: 'user-message', text, from: 'Scheduled' });

    const request: import('./types').ChatRequest = {
      conversationId: 'default',
      messages: [{ id: `user-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }],
      context: { taskKind: 'chat' },
      modelId: 'default',
      systemExtra: this.getScheduledContext(),
    };

    this._view?.webview.postMessage({ type: 'stream-start', conversationId: 'default' });

    if (this.orchestrator) {
      try {
        let assembled = '';
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        await this.orchestrator.streamChatResponse(request, delta => {
          assembled += delta;
          if (!signal.aborted) { this._view?.webview.postMessage({ type: 'delta', delta }); }
        }, signal);
        if (!signal.aborted) {
          await this._processAssembled(assembled, folder);
          this._view?.webview.postMessage({ type: 'done', conversationId: 'default' });
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && !signal.aborted) {
          this._view?.webview.postMessage({ type: 'error', error: String(e) });
        }
      }
    }
  }

  public async restoreScheduledTasks(): Promise<void> {
    let tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []);
    if (tasks.length === 0) { return; }

    // Удаляем выполненные задачи старше 7 дней
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const cleaned = tasks.filter(t => !t.completedAt || t.completedAt > sevenDaysAgo);
    if (cleaned.length !== tasks.length) {
      await this._globalState.update(SCHEDULE_KEY, cleaned);
      tasks = cleaned;
    }

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const pending = tasks.filter(t => !t.completedAt);
    const todayOrPastPending = pending.filter(t => t.scheduledAt <= endOfToday.getTime());
    const futurePending      = pending.filter(t => t.scheduledAt >  endOfToday.getTime());

    for (const task of futurePending) { this._armTask(task); }

    if (todayOrPastPending.length === 0) { return; }

    const fmt = (task: ScheduledTask) => {
      const preview = task.text.length > 40 ? task.text.slice(0, 40) + '…' : task.text;
      const time = new Date(task.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `«${preview}» в ${time}`;
    };
    const list = todayOrPastPending.map(fmt).join(', ');
    const msg = `На сегодня нашёл задачи — ${list}`;
    const choice = await vscode.window.showInformationMessage(msg, 'Оставить', 'Отменить');

    if (choice === 'Отменить') {
      for (const task of todayOrPastPending) { await this._removeTask(task.id); }
    } else {
      for (const task of todayOrPastPending) { this._armTask(task); }
    }
  }

  private _armTask(task: ScheduledTask): void {
    const delay = task.scheduledAt - Date.now();
    const fire = async () => {
      await this._markTaskDone(task.id);
      await this._sendScheduledPrompt(task.text);
    };
    if (delay <= 0) {
      void fire();
    } else {
      setTimeout(() => void fire(), Math.min(delay, 2_147_483_647));
    }
  }

  private async _markTaskDone(id: string): Promise<void> {
    const tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []);
    const updated = tasks.map(t => t.id === id ? { ...t, completedAt: Date.now() } : t);
    await this._globalState.update(SCHEDULE_KEY, updated);
    this._sendScheduledTasks();
  }

  private async _saveTask(task: ScheduledTask): Promise<void> {
    const tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []).filter(t => t.id !== task.id);
    await this._globalState.update(SCHEDULE_KEY, [...tasks, task]);
    this._sendScheduledTasks();
  }

  private async _removeTask(id: string): Promise<void> {
    const tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []).filter(t => t.id !== id);
    await this._globalState.update(SCHEDULE_KEY, tasks);
    this._sendScheduledTasks();
  }

  private async _executeVscodeCmd(cmd: Record<string, any>, folder: string): Promise<void> {
    switch (cmd.type) {
      case 'git-add':    await this._git?.handleAdd(folder); break;
      case 'git-commit': await this._git?.handleCommitOrPush(false, folder); break;
      case 'git-push':   await this._git?.handleCommitOrPush(true, folder); break;
      case 'npm-run':    this._npm?.run(String(cmd.script ?? ''), folder); break;
    }
  }

  private async _processAssembled(assembled: string, folder: string): Promise<void> {
    const cmds = extractCmds(assembled);
    if (cmds.length === 0) { return; }
    this._view?.webview.postMessage({ type: 'patch-last-message', text: stripCmds(assembled) });
    for (const cmd of cmds) { await this._executeVscodeCmd(cmd, folder); }
  }

  public async executeVscodeCmds(cmds: Array<Record<string, any>>, folder: string): Promise<void> {
    for (const cmd of cmds) { await this._executeVscodeCmd(cmd, folder); }
  }

  public getScheduledContext(): string | undefined {
    const tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []);
    if (tasks.length === 0) { return undefined; }

    const pending   = tasks.filter(t => !t.completedAt).sort((a, b) => a.scheduledAt - b.scheduledAt);
    const completed = tasks.filter(t =>  t.completedAt).sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));

    const preview = (t: ScheduledTask) => t.text.length > 80 ? t.text.slice(0, 80) + '…' : t.text;
    const hm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const lines: string[] = [];
    if (pending.length > 0) {
      lines.push('Предстоящие задачи:');
      for (const t of pending) {
        lines.push(`- «${preview(t)}» — ${new Date(t.scheduledAt).toLocaleString()}`);
      }
    }
    if (completed.length > 0) {
      lines.push('Выполненные задачи (сегодня):');
      for (const t of completed) {
        lines.push(`- ✓ «${preview(t)}» — запланировано на ${hm(t.scheduledAt)}, выполнено в ${hm(t.completedAt!)}`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  private _sendScheduledTasks(): void {
    if (!this._view?.visible) { return; }
    const tasks = this._globalState.get<ScheduledTask[]>(SCHEDULE_KEY, []);
    this._view.webview.postMessage({ type: 'scheduled-tasks', tasks });
  }

  private async _listWorkspaceFiles(): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return []; }
    const files: string[] = [];
    for (const folder of folders) {
      const entries = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/*'),
        '**/{node_modules,.git,dist,out,build,.next}/**',
        200
      );
      for (const uri of entries) {
        files.push(vscode.workspace.asRelativePath(uri, false));
      }
    }
    return files;
  }

  private _sendCustomPrompts() {
    if (!this._view?.visible) { return; }
    const cfg = vscode.workspace.getConfiguration('kludge');
    const saved = cfg.get<Array<{ label: string; text: string }>>('customPrompts', []);
    const prompts = saved.map((p, i) => ({ key: `custom-${i}`, label: p.label, text: p.text }));
    this._view.webview.postMessage({ type: 'custom-prompts', prompts });
  }

  private _sendNpmScripts() {
    if (!this._view?.visible) { return; }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) { return; }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
      const scripts: string[] = Object.keys(pkg.scripts ?? {});
      this._view.webview.postMessage({ type: 'npm-scripts', scripts });
    } catch {
      this._view.webview.postMessage({ type: 'npm-scripts', scripts: [] });
    }
  }

  private async _handleMessage(msg: any) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
      switch (msg?.type) {

        case 'send': {
          this._abortController?.abort();
          this._abortController = new AbortController();
          const signal = this._abortController.signal;
          const payload = msg.payload ?? { text: msg.text };
          const workspaceFiles = await this._listWorkspaceFiles();
          const request: ChatRequest = payload.text
            ? {
                conversationId: payload.conversationId ?? 'default',
                messages: [{ id: `user-${Date.now()}`, role: 'user', content: payload.text, createdAt: Date.now() }],
                context: { ...(payload.context ?? { taskKind: 'chat' }), workspaceFiles },
                modelId: payload.modelId ?? 'default',
                systemExtra: this.getScheduledContext(),
              } as ChatRequest
            : { ...(payload as ChatRequest), context: { ...(payload as ChatRequest).context, workspaceFiles }, systemExtra: this.getScheduledContext() };

          this._view?.webview.postMessage({ type: 'stream-start', conversationId: request.conversationId });

          if (this.orchestrator) {
            try {
              let assembled = '';
              await this.orchestrator.streamChatResponse(request, delta => {
                assembled += delta;
                if (!signal.aborted) { this._view?.webview.postMessage({ type: 'delta', delta }); }
              }, signal);
              if (!signal.aborted) {
                await this._processAssembled(assembled, folder ?? '');
                this._view?.webview.postMessage({ type: 'done', conversationId: request.conversationId });
              }
            } catch (e: any) {
              if (e?.name === 'AbortError' || signal.aborted) {
                this._view?.webview.postMessage({ type: 'stopped', conversationId: request.conversationId });
              } else {
                throw e;
              }
            }
          } else {
            this._view?.webview.postMessage({ type: 'response', text: `Echo: ${msg.text ?? JSON.stringify(msg.payload)}` });
          }
          break;
        }

        case 'stop':
          this._abortController?.abort();
          this._view?.webview.postMessage({ type: 'stopped' });
          break;

        case 'command':
          vscode.commands.executeCommand(msg.command);
          break;

        case 'git-info':
          if (folder) { await this._git?.sendInfo(folder); }
          break;

        case 'git-checkout':
          if (folder) { await this._git?.handleCheckout(msg.branch, msg.isNew, folder); }
          break;

        case 'git-add':
          if (folder) { await this._git?.handleAdd(folder); }
          break;

        case 'git-commit':
        case 'git-push':
          if (folder) { await this._git?.handleCommitOrPush(msg.type === 'git-push', folder); }
          break;

        case 'npm-scripts':
          this._sendNpmScripts();
          break;

        case 'npm-run':
          if (folder) { this._npm?.run(msg.script ?? '', folder); }
          break;

        case 'clear-history':
          await this.orchestrator?.clearHistory(msg.conversationId ?? 'default');
          break;

        case 'schedule-prompt': {
          const task: ScheduledTask = {
            id: `task-${Date.now()}`,
            text: String(msg.text ?? ''),
            scheduledAt: Number(msg.scheduledAt),
          };
          await this._saveTask(task);
          this._armTask(task);
          break;
        }

        case 'cancel-scheduled-task': {
          await this._removeTask(String(msg.id ?? ''));
          this._sendScheduledTasks();
          break;
        }

        case 'save-custom-prompt': {
          const cfg = vscode.workspace.getConfiguration('kludge');
          const existing = cfg.get<Array<{ label: string; text: string }>>('customPrompts', []);
          await cfg.update('customPrompts', [...existing, { label: String(msg.label ?? ''), text: String(msg.text ?? '') }], vscode.ConfigurationTarget.Global);
          this._sendCustomPrompts();
          break;
        }
      }
    } catch (err) {
      this._view?.webview.postMessage({ type: 'error', error: String(err) });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const distPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'webview');
    const htmlPath = path.join(distPath.fsPath, 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
      return `<html><body>Error: Could not load index.html from ${htmlPath}. Please run 'npm run build'. Error: ${error}</body></html>`;
    }

    html = html.replace(/(src|href)="([^"]+)"/g, (_, attr, val) => {
      if (val.startsWith('http')) { return `${attr}="${val}"`; }
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', val));
      return `${attr}="${uri}"`;
    });

    const nonce = getNonce();
    html = html.replace('<head>', `<head>
      <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        script-src 'nonce-${nonce}' 'unsafe-eval';
        style-src ${webview.cspSource} 'unsafe-inline';
        img-src ${webview.cspSource} data:;
        connect-src *;
      ">`);
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    return html;
  }
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
