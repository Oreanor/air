import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChatRequest, ChatMessage } from '../types';
import { HistoryService } from './history';
import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { ALL_MODELS, ModelProvider, getModelDescriptor, resolveAutoModel } from './modelRouter';

type ApiMsg = { role: 'user' | 'assistant'; content: string };

const FILE_SIZE_LIMIT   = 8_000;  // chars per file before truncation
const TOTAL_FILES_LIMIT = 40_000; // chars across all requested files

export class ChatOrchestrator {
  private gemini?: GeminiProvider;
  private groq?: GroqProvider;
  private availableProviders = new Set<ModelProvider>();

  constructor(private readonly history?: HistoryService) {}

  setGeminiKey(apiKey: string) {
    this.gemini = new GeminiProvider(apiKey);
    this.availableProviders.add('gemini');
  }

  setGroqKey(apiKey: string) {
    this.groq = new GroqProvider(apiKey);
    this.availableProviders.add('groq');
  }

  getAvailableModels() {
    return ALL_MODELS.filter(m => this.availableProviders.has(m.provider));
  }

  getHistory(conversationId: string): ChatMessage[] {
    return this.history?.getHistory(conversationId) ?? [];
  }

  async clearHistory(conversationId: string) {
    await this.history?.clearHistory(conversationId);
  }

  async loadFileIfNeeded(conversationId: string, filePath: string): Promise<string | undefined> {
    if (!this.history) { return undefined; }
    const cached = this.history.getCachedFile(conversationId, filePath);
    if (cached !== undefined) { return cached; }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const content = Buffer.from(bytes).toString('utf8');
      await this.history.cacheFile(conversationId, filePath, content);
      return content;
    } catch { return undefined; }
  }

  async streamChatResponse(
    request: ChatRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const convId = request.conversationId ?? 'default';
    const userMsg = request.messages?.at(-1);

    if (userMsg && this.history) {
      await this.history.addUserMessage(convId, userMsg);
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const fileList = request.context?.workspaceFiles ?? [];

    // ── system prompt ────────────────────────────────────────────────────────
    const needsCmds = request.context?.taskKind === 'agent'
      || /git|commit|push|npm|build|запуш|скоммит|сбилд|задеплой/i.test(userMsg?.content ?? '');

    const systemParts: string[] = [
      'Ты AI-ассистент встроенный в VS Code расширение Kludge Code.',
      `Рабочая директория: ${workspaceRoot}`,
      'Отвечай на языке пользователя.',
    ];

    if (needsCmds) {
      systemParts.push(
        '',
        'Когда пользователь просит выполнить действие в VS Code, добавь в самый конец ответа один или несколько тегов:',
        '<vscode-cmd>{"type":"git-add"}</vscode-cmd> — индексировать все изменения (git add -A)',
        '<vscode-cmd>{"type":"git-commit"}</vscode-cmd> — закоммитить (add + commit с AI-сообщением)',
        '<vscode-cmd>{"type":"git-push"}</vscode-cmd> — закоммитить и запушить',
        '<vscode-cmd>{"type":"npm-run","script":"build"}</vscode-cmd> — запустить npm-скрипт (build/dev/test/install и др.)',
        'Теги автоматически скрываются из чата и исполняются. Не объясняй их пользователю.',
      );
    }

    if (fileList.length > 0) {
      systemParts.push('', `Файлы проекта:\n${fileList.join('\n')}`);
    }

    if (request.systemExtra) { systemParts.push('', request.systemExtra); }

    const systemPrompt = systemParts.join('\n');

    // ── API messages ─────────────────────────────────────────────────────────
    const apiMessages: ApiMsg[] = [];

    if (this.history) {
      const state = this.history.getState(convId);
      if (state.summary) {
        apiMessages.push({ role: 'user',      content: `[Контекст предыдущего разговора]\n${state.summary}` });
        apiMessages.push({ role: 'assistant', content: 'Понял контекст, продолжаю.' });
      }
    }

    if (userMsg) {
      apiMessages.push({ role: 'user', content: userMsg.content });
    }

    if (apiMessages.length === 0) { return; }

    // ── resolve model ────────────────────────────────────────────────────────
    let modelId = request.modelId;
    if (!modelId || modelId === 'default' || modelId === 'auto') {
      modelId = resolveAutoModel(this.availableProviders);
    }
    const descriptor = getModelDescriptor(modelId);
    const provider   = descriptor?.provider;

    console.log(`[Kludge] Using model: ${modelId} (${provider ?? 'unknown'})`);

    // ── echo fallback ────────────────────────────────────────────────────────
    if (!provider || (!this.gemini && !this.groq)) {
      const assembled = `[Echo — нет доступных провайдеров] ${userMsg?.content ?? ''}`;
      for (const chunk of assembled.split(/(\s+)/)) {
        if (signal?.aborted) { return; }
        if (chunk) { onDelta(chunk); }
        await new Promise(r => setTimeout(r, 30));
      }
      if (this.history) { await this.history.addAssistantSummary(convId, assembled); }
      return;
    }

    // ── stream (with optional two-pass file resolution) ──────────────────────
    let assembled = '';

    try {
      if (fileList.length > 0) {
        assembled = await this._streamWithFileResolution(
          apiMessages, modelId, provider, systemPrompt,
          workspaceRoot, userMsg!.content, onDelta, signal,
        );
      } else {
        assembled = await this._stream(apiMessages, modelId, provider, systemPrompt, onDelta, signal);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) { return; }
      const errMsg = `\n\n⚠️ Ошибка: ${err?.message ?? String(err)}`;
      onDelta(errMsg);
      assembled += errMsg;
    }

    if (this.history && assembled) {
      await this.history.addAssistantSummary(convId, assembled);
    }
  }

  // ── two-pass: detect <read-files> tag early, read files, do pass 2 ────────

  private async _streamWithFileResolution(
    apiMessages: ApiMsg[],
    modelId: string,
    provider: string,
    systemPrompt: string,
    workspaceRoot: string,
    originalUserContent: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const pass1System = systemPrompt
      + '\n\nЕсли для выполнения задачи нужно содержимое конкретных файлов — ответь ТОЛЬКО тегом (без другого текста):\n'
      + '<read-files>path/to/file1.ts,path/to/file2.ts</read-files>\n'
      + 'Иначе — отвечай сразу.';

    const gen = this._getGen(apiMessages, modelId, provider, pass1System);
    if (!gen) { return ''; }

    // Buffer early chunks to detect the tag before showing anything to the user.
    // As soon as content clearly isn't a tag, flush and stream normally.
    let buf        = '';
    let flushed    = false;
    let assembled  = '';
    let fileRequest: string | null = null;

    for await (const chunk of gen) {
      if (signal?.aborted) { return assembled; }
      assembled += chunk;

      if (flushed) {
        onDelta(chunk);
        continue;
      }

      buf += chunk;

      const match = buf.match(/<read-files>([\s\S]*?)<\/read-files>/);
      if (match) {
        fileRequest = match[1];
        break;
      }

      // Once it's clear the response isn't a tag — flush buffer and stream rest
      const looksLikeTag = buf.startsWith('<') || buf.startsWith('\n<') || buf.startsWith(' <');
      if (!looksLikeTag || buf.length > 120) {
        flushed = true;
        onDelta(buf);
        buf = '';
      }
    }

    // Flush leftover buffer (short direct answer that fit entirely in the buffer)
    if (!flushed && buf && !fileRequest) {
      onDelta(buf);
    }

    if (!fileRequest || signal?.aborted) {
      return assembled;
    }

    // ── pass 2: inject file contents ─────────────────────────────────────────
    const paths    = fileRequest.split(',').map(p => p.trim()).filter(Boolean);
    const contents = this._readProjectFiles(paths, workspaceRoot);

    onDelta(`*Читаю ${paths.length} файл${paths.length === 1 ? '' : paths.length < 5 ? 'а' : 'ов'}...*\n\n`);

    const augMessages: ApiMsg[] = [
      ...apiMessages.slice(0, -1),
      { role: 'user', content: `Содержимое файлов:\n\n${contents}\n\n---\n${originalUserContent}` },
    ];

    assembled = await this._stream(augMessages, modelId, provider, systemPrompt, onDelta, signal);
    return assembled;
  }

  // ── plain streaming ───────────────────────────────────────────────────────

  private async _stream(
    messages: ApiMsg[],
    modelId: string,
    provider: string,
    systemPrompt: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const gen = this._getGen(messages, modelId, provider, systemPrompt);
    if (!gen) { return ''; }
    let assembled = '';
    for await (const chunk of gen) {
      if (signal?.aborted) { return assembled; }
      onDelta(chunk);
      assembled += chunk;
    }
    return assembled;
  }

  // ── provider dispatch ─────────────────────────────────────────────────────

  private _getGen(
    messages: ApiMsg[],
    modelId: string,
    provider: string,
    systemPrompt: string,
  ): AsyncIterable<string> | null {
    if (provider === 'gemini' && this.gemini) {
      return this.gemini.stream(messages, modelId, systemPrompt);
    }
    if (provider === 'groq' && this.groq) {
      return this.groq.stream(messages, modelId, systemPrompt);
    }
    return null;
  }

  // ── file reading ──────────────────────────────────────────────────────────

  private _readProjectFiles(relativePaths: string[], workspaceRoot: string): string {
    if (!workspaceRoot) { return '[рабочая директория не определена]'; }
    const parts: string[] = [];
    let total = 0;

    for (const rel of relativePaths) {
      if (total >= TOTAL_FILES_LIMIT) {
        parts.push(`[лимит объёма достигнут, остальные файлы пропущены]`);
        break;
      }
      try {
        const abs = path.join(workspaceRoot, rel);
        let content = fs.readFileSync(abs, 'utf8');
        if (content.length > FILE_SIZE_LIMIT) {
          content = content.slice(0, FILE_SIZE_LIMIT)
            + `\n…[файл обрезан: показано ${FILE_SIZE_LIMIT} из ${content.length} символов]`;
        }
        parts.push(`=== ${rel} ===\n${content}`);
        total += content.length;
      } catch {
        parts.push(`=== ${rel} ===\n[не удалось прочитать файл]`);
      }
    }

    return parts.join('\n\n');
  }
}
