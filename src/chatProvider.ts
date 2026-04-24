import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatOrchestrator } from './services';
import { ChatRequest } from './types';
import { GitService } from './services/GitService';
import { NpmService } from './services/NpmService';
import { extractCmds, stripCmds, listWorkspaceFiles } from './utils/vscodeCmd';

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
const DISABLED_PROVIDERS_KEY = 'kludge.disabledProviders';
const SESSIONS_KEY = 'kludge.sessions';
const ACTIVE_SESSION_KEY = 'kludge.activeSession';

interface StoredSession { id: string; name: string; createdAt: number }

const FILE_PATH_RE = /`([^`\s]+\.[a-zA-Z]{1,6})`/g;

const PROVIDER_DEFS = [
  { id: 'gemini'     as const, name: 'Google Gemini', secretKey: 'kludge.provider.gemini'      },
  { id: 'groq'       as const, name: 'Groq',          secretKey: 'kludge.provider.groq'        },
  { id: 'openrouter' as const, name: 'OpenRouter',    secretKey: 'kludge.provider.openrouter'  },
  { id: 'anthropic'  as const, name: 'Anthropic',     secretKey: 'kludge.provider.anthropic'   },
  { id: 'deepseek'   as const, name: 'DeepSeek',      secretKey: 'kludge.provider.deepseek'    },
  { id: 'mistral'    as const, name: 'Mistral',       secretKey: 'kludge.provider.mistral'     },
  { id: 'openai'     as const, name: 'OpenAI',        secretKey: 'kludge.provider.openai'      },
  { id: 'ollama'     as const, name: 'Ollama (local)', secretKey: 'kludge.provider.ollama', placeholder: 'http://localhost:11434' },
];

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
  private _softRemoved = new Set<string>(); // visually removed but key still in SecretStorage
  private _activeWork: { sessionId: string; sessionName: string; files: Set<string> } | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _globalState: vscode.Memento,
    private readonly _secrets: vscode.SecretStorage,
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
      this._sendSessions();
      this._sendHistory();
      this._sendModels();
      this._sendNpmScripts();
      this._sendWorkspaceTree();
      this._sendActiveFile();
      this._sendCustomPrompts();
      this._sendScheduledTasks();
      void this._sendProviders();
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

  private _sendHistory(conversationId?: string) {
    if (!this._view?.visible || !this.orchestrator) { return; }
    const id = conversationId ?? this._globalState.get<string>(ACTIVE_SESSION_KEY, 'default');
    try {
      const hist = this.orchestrator.getHistory(id);
      this._view.webview.postMessage({ type: 'history', conversationId: id, messages: hist ?? [] });
    } catch (e) {
      console.error('[Kludge] ChatProvider: failed to send history', e);
    }
  }

  private _getSessions(): StoredSession[] {
    const stored = this._globalState.get<StoredSession[]>(SESSIONS_KEY, []);
    if (stored.length === 0) {
      return [{ id: 'default', name: 'Chat 1', createdAt: Date.now() }];
    }
    return stored;
  }

  private async _saveSessions(sessions: StoredSession[]): Promise<void> {
    await this._globalState.update(SESSIONS_KEY, sessions);
  }

  private _sendSessions() {
    if (!this._view?.visible) { return; }
    const sessions = this._getSessions();
    const activeSessionId = this._globalState.get<string>(ACTIVE_SESSION_KEY, 'default');
    const busySessionId = this._activeWork?.sessionId ?? null;
    this._view.webview.postMessage({ type: 'sessions', sessions, activeSessionId, busySessionId });
  }

  private _sendModels() {
    if (!this._view?.visible) { return; }
    const models = this.orchestrator?.getAvailableModels() ?? [];
    const disabledProviders = this._globalState.get<string[]>(DISABLED_PROVIDERS_KEY, []);
    this._view.webview.postMessage({ type: 'models', models, disabledProviders });
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

  public async loadProviderKeys(): Promise<void> {
    const ENV_MAP: Record<string, string | undefined> = {
      gemini:     process.env.GEMINI_API_KEY,
      groq:       process.env.GROQ_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      anthropic:  process.env.ANTHROPIC_API_KEY,
      deepseek:   process.env.DEEPSEEK_API_KEY,
      mistral:    process.env.MISTRAL_API_KEY,
      openai:     process.env.OPENAI_API_KEY,
    };
    for (const def of PROVIDER_DEFS) {
      const stored = await this._secrets.get(def.secretKey);
      const envKey = ENV_MAP[def.id];

      // migrate from .env on first run
      if (envKey && !stored) {
        await this._secrets.store(def.secretKey, envKey);
      }

      const key = stored ?? envKey;
      if (key && this.orchestrator) { await this._applyKey(def.id, key); }
    }
  }

  private async _applyKey(id: string, key: string): Promise<void> {
    if (!this.orchestrator) { return; }
    if (id === 'gemini')     { this.orchestrator.setGeminiKey(key); }
    if (id === 'groq')       { this.orchestrator.setGroqKey(key); }
    if (id === 'openrouter') { this.orchestrator.setOpenRouterKey(key); }
    if (id === 'anthropic')  { this.orchestrator.setAnthropicKey(key); }
    if (id === 'deepseek')   { this.orchestrator.setDeepSeekKey(key); }
    if (id === 'mistral')    { this.orchestrator.setMistralKey(key); }
    if (id === 'openai')     { this.orchestrator.setOpenAIKey(key); }
    if (id === 'ollama')     { await this.orchestrator.setOllamaUrl(key); }
  }

  private async _sendProviders(): Promise<void> {
    if (!this._view?.visible) { return; }
    const providers = await Promise.all(PROVIDER_DEFS.map(async def => {
      const key = await this._secrets.get(def.secretKey);
      const soft = this._softRemoved.has(def.id);
      const isUrl = def.id === 'ollama';
      const mask = (k: string) => isUrl ? k : '••••' + k.slice(-4);
      return {
        id:             def.id,
        name:           def.name,
        configured:     !!key && !soft,
        maskedKey:      key && !soft ? mask(key) : undefined,
        pendingRemoval: soft && !!key,
        pendingMasked:  soft && key ? mask(key) : undefined,
        placeholder:    (def as any).placeholder as string | undefined,
      };
    }));
    const disabledProviders = this._globalState.get<string[]>(DISABLED_PROVIDERS_KEY, []);
    this._view.webview.postMessage({ type: 'providers', providers, disabledProviders });
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
          const sessionId = payload.conversationId ?? 'default';
          const workspaceFiles = await listWorkspaceFiles();

          // ── work-conflict detection ──────────────────────────────────
          if (this._activeWork && this._activeWork.sessionId !== sessionId) {
            const overlap = payload.context?.activeFile
              ? this._activeWork.files.has(payload.context.activeFile)
              : false;
            this._view?.webview.postMessage({
              type: 'session-busy',
              workingSession: { id: this._activeWork.sessionId, name: this._activeWork.sessionName },
              hasFileConflict: overlap,
            });
          }

          // ── start work tracking ──────────────────────────────────────
          const sessions = this._getSessions();
          const session = sessions.find(s => s.id === sessionId);
          const touchedFiles = new Set<string>(
            [payload.context?.activeFile].filter(Boolean) as string[]
          );
          this._activeWork = { sessionId, sessionName: session?.name ?? sessionId, files: touchedFiles };
          this._sendSessions();

          const request: ChatRequest = payload.text
            ? {
                conversationId: sessionId,
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
                if (!signal.aborted) {
                  // accumulate file paths mentioned in response
                  let m: RegExpExecArray | null;
                  FILE_PATH_RE.lastIndex = 0;
                  while ((m = FILE_PATH_RE.exec(delta)) !== null) {
                    this._activeWork?.files.add(m[1]);
                  }
                  this._view?.webview.postMessage({ type: 'delta', delta });
                }
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
            } finally {
              if (this._activeWork?.sessionId === sessionId) {
                this._activeWork = null;
                this._sendSessions();
              }
            }
          } else {
            this._activeWork = null;
            this._view?.webview.postMessage({ type: 'response', text: `Echo: ${msg.text ?? JSON.stringify(msg.payload)}` });
          }
          break;
        }

        case 'stop':
          this._abortController?.abort();
          this._view?.webview.postMessage({ type: 'stopped' });
          break;

        case 'new-session': {
          const sessions = this._getSessions();
          const num = sessions.length + 1;
          const newSession: StoredSession = { id: `s-${Date.now()}`, name: `Chat ${num}`, createdAt: Date.now() };
          const updated = [...sessions, newSession];
          await this._saveSessions(updated);
          await this._globalState.update(ACTIVE_SESSION_KEY, newSession.id);
          this._sendSessions();
          this._sendHistory(newSession.id);
          break;
        }

        case 'switch-session': {
          const sid = String(msg.sessionId ?? 'default');
          await this._globalState.update(ACTIVE_SESSION_KEY, sid);
          this._sendSessions();
          this._sendHistory(sid);
          break;
        }

        case 'close-session': {
          const sid = String(msg.sessionId ?? '');
          if (!sid || sid === 'default') { break; }
          const sessions = this._getSessions().filter(s => s.id !== sid);
          if (sessions.length === 0) { break; }
          await this._saveSessions(sessions);
          const currentActive = this._globalState.get<string>(ACTIVE_SESSION_KEY, 'default');
          const nextActive = currentActive === sid ? sessions[sessions.length - 1].id : currentActive;
          await this._globalState.update(ACTIVE_SESSION_KEY, nextActive);
          // clean up history for closed session
          await this.orchestrator?.clearHistory(sid);
          this._sendSessions();
          if (currentActive === sid) { this._sendHistory(nextActive); }
          break;
        }

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

        case 'git-init':
          if (folder) { await this._git?.handleInit(folder); }
          break;

        case 'git-reset-prev':
          if (folder) { await this._git?.handleResetPrev(folder); }
          break;

        case 'git-reset-remote':
          if (folder) { await this._git?.handleResetRemote(folder); }
          break;

        case 'npm-scripts':
          this._sendNpmScripts();
          break;

        case 'npm-run':
          if (folder) { this._npm?.run(msg.script ?? '', folder); }
          break;

        case 'clear-history': {
          const cid = msg.conversationId ?? this._globalState.get<string>(ACTIVE_SESSION_KEY, 'default');
          await this.orchestrator?.clearHistory(cid);
          break;
        }

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

        case 'save-provider-key': {
          const def = PROVIDER_DEFS.find(d => d.id === String(msg.providerId ?? ''));
          if (!def || !msg.key) { break; }
          const key = String(msg.key);
          await this._secrets.store(def.secretKey, key);
          this._softRemoved.delete(def.id);
          await this._applyKey(def.id, key);
          await this._sendProviders();
          this._sendModels();
          break;
        }

        case 'remove-provider-key': {
          const def = PROVIDER_DEFS.find(d => d.id === String(msg.providerId ?? ''));
          if (!def) { break; }
          this._softRemoved.add(def.id);
          if (this.orchestrator) { this.orchestrator.removeProvider(def.id); }
          await this._sendProviders();
          this._sendModels();
          break;
        }

        case 'restore-provider-key': {
          const def = PROVIDER_DEFS.find(d => d.id === String(msg.providerId ?? ''));
          if (!def) { break; }
          this._softRemoved.delete(def.id);
          const key = await this._secrets.get(def.secretKey);
          if (key) { await this._applyKey(def.id, key); }
          await this._sendProviders();
          this._sendModels();
          break;
        }

        case 'toggle-provider': {
          const pid = String(msg.providerId ?? '');
          if (!pid) { break; }
          const disabled = new Set(this._globalState.get<string[]>(DISABLED_PROVIDERS_KEY, []));
          if (disabled.has(pid)) { disabled.delete(pid); } else { disabled.add(pid); }
          await this._globalState.update(DISABLED_PROVIDERS_KEY, [...disabled]);
          this._sendModels();
          await this._sendProviders();
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
