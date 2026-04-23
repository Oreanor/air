import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { ChatProvider } from './chatProvider';
import { ChatOrchestrator, HistoryService, TelegramService, PreviewPanel } from './services';
import { ChatRequest } from './types';

const _TG_CMD_RE = /<vscode-cmd>([\s\S]*?)<\/vscode-cmd>/g;
function extractTgCmds(text: string): Array<Record<string, any>> {
  const cmds: Array<Record<string, any>> = [];
  let m: RegExpExecArray | null;
  _TG_CMD_RE.lastIndex = 0;
  while ((m = _TG_CMD_RE.exec(text)) !== null) {
    try { cmds.push(JSON.parse(m[1])); } catch {}
  }
  return cmds;
}
function stripTgCmds(text: string): string {
  return text.replace(/<vscode-cmd>[\s\S]*?<\/vscode-cmd>/g, '').trim();
}

async function listWorkspaceFiles(): Promise<string[]> {
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

function buildRequestContext(
  taskKind: 'chat' | 'edit' | 'preview' | 'icons' | 'image' | 'search' | 'agent',
  extra: Record<string, any> = {}
) {
  const activeEditor = vscode.window.activeTextEditor;
  return {
    taskKind,
    workspaceFiles: extra.workspaceFiles ?? [],
    activeFile: extra.activeFile ?? activeEditor?.document.fileName,
    activeFileContent: extra.activeFileContent ?? activeEditor?.document.getText() ?? '',
    ...extra,
  };
}

export async function activate(context: vscode.ExtensionContext) {
  const historyService = new HistoryService(context.globalState);
  const orchestrator = new ChatOrchestrator(historyService);
  const provider = new ChatProvider(context.extensionUri, context.globalState, orchestrator);
  void provider.restoreScheduledTasks();
  const preview = new PreviewPanel();

  // ── инициализируем провайдеры из .env ────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey   = process.env.GROQ_API_KEY;

  if (geminiKey) {
    orchestrator.setGeminiKey(geminiKey);
    console.log('[Kludge] Gemini provider initialized');
  }
  if (groqKey) {
    orchestrator.setGroqKey(groqKey);
    console.log('[Kludge] Groq provider initialized');
  }
  if (!geminiKey && !groqKey) {
    console.warn('[Kludge] No API keys found — running in echo mode');
    vscode.window.showWarningMessage('Kludge Code: не найдены ключи GEMINI_API_KEY / GROQ_API_KEY в .env');
  }

  // ── подписка на ошибки из preview → авто-фикс через AI ───────────────
  preview.subscribeToErrors(async (errorMsg, stack) => {
    const workspaceFiles = await listWorkspaceFiles();
    const request: ChatRequest = {
      conversationId: 'preview-autofix',
      messages: [{
        id: `err-${Date.now()}`,
        role: 'user',
        content: `Runtime ошибка в приложении:\n${errorMsg}\n\nStack: ${stack}\n\nПредложи фикс.`,
        createdAt: Date.now()
      }],
      context: buildRequestContext('agent', { workspaceFiles }),
      modelId: 'default'
    };

    let fix = '';
    await orchestrator.streamChatResponse(request, delta => {
      fix += delta;
      provider.postMessage({ type: 'delta', delta, conversationId: 'preview-autofix' });
    });
    provider.postMessage({ type: 'done', conversationId: 'preview-autofix' });
  });

  // ── element picker из preview → чип в инпуте webview ────────────────
  preview.subscribeToElementPicks(async (info) => {
    await provider.postMessageWhenReady({ type: 'picked-element', data: info });
    provider.postMessage({ type: 'picker-done' });
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('kludge.openPreview', () => preview.open()),
    vscode.commands.registerCommand('kludge.openPreviewAt', (url: string) => preview.open(url)),
    vscode.commands.registerCommand('kludge.reloadPreview', () => preview.reload()),
    vscode.commands.registerCommand('kludge.pickElement', () => preview.startElementPicker()),
    vscode.commands.registerCommand('kludge.stopPicker', () => preview.stopElementPicker()),
    vscode.workspace.onDidSaveTextDocument(() => preview.reload())
  );

  // ── Telegram ──────────────────────────────────────────────────────────
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  if (tgToken && tgChatId) {
    const telegram = new TelegramService(tgToken, tgChatId);

    telegram.startPolling(async (text, from) => {
      const workspaceFiles = await listWorkspaceFiles();

      const request: ChatRequest = {
        conversationId: `tg-${tgChatId}`,
        messages: [
          { id: `tg-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }
        ],
        context: buildRequestContext('chat', { workspaceFiles }),
        modelId: 'default',
        systemExtra: provider.getScheduledContext(),
      };

      provider.postMessage({
        type: 'user-message',
        text,
        from,
        conversationId: request.conversationId
      });

      let fullResponse = '';
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

      provider.postMessage({ type: 'stream-start', conversationId: request.conversationId });

      await orchestrator.streamChatResponse(request, (delta) => {
        fullResponse += delta;
        provider.postMessage({ type: 'delta', delta, conversationId: request.conversationId });
      });

      const cmds = extractTgCmds(fullResponse);
      const clean = stripTgCmds(fullResponse);

      provider.postMessage({ type: 'done', conversationId: request.conversationId });
      if (cmds.length > 0) {
        provider.postMessage({ type: 'patch-last-message', text: clean });
      }

      if (clean) {
        await telegram.send(clean).catch(e => console.error('[Kludge] Telegram send error:', e));
      }

      if (cmds.length > 0) {
        void provider.executeVscodeCmds(cmds, folder);
      }
    });

    context.subscriptions.push({ dispose: () => telegram.stopPolling() });
    console.log('[Kludge] Telegram polling started');
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatProvider.viewId,
      provider
    )
  );

  // ── dev-команды ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('kludge.helloWorld', () => {
      vscode.window.showInformationMessage('Kludge Code is running!');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kludge.testStream', async () => {
      vscode.window.showInformationMessage('Kludge Code: test stream started');
      const workspaceFiles = await listWorkspaceFiles();
      const request: ChatRequest = {
        conversationId: 'test',
        messages: [{ id: '1', role: 'user', content: 'Hello from test stream', createdAt: Date.now() }],
        context: buildRequestContext('chat', { workspaceFiles }),
        modelId: 'default'
      };
      await orchestrator.streamChatResponse(request, (delta) => {
        provider.postMessage({ type: 'delta', delta });
      });
      provider.postMessage({ type: 'done' });
      vscode.window.showInformationMessage('Kludge Code: test stream finished');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kludge.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.explorer');
      vscode.window.showInformationMessage('Kludge Code: Opened Explorer — please expand "Kludge Code Chat" view.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kludge.sendMessage', async () => {
      const convId = await vscode.window.showInputBox({ prompt: 'Conversation ID', value: 'default' });
      if (convId === undefined) { return; }
      const text = await vscode.window.showInputBox({ prompt: 'Message text' });
      if (!text) { return; }

      const workspaceFiles = await listWorkspaceFiles();
      const request: ChatRequest = {
        conversationId: convId,
        messages: [{ id: `user-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }],
        context: buildRequestContext('chat', { workspaceFiles }),
        modelId: 'default'
      };

      provider.postMessage({ type: 'stream-start', conversationId: convId });
      await orchestrator.streamChatResponse(request, (delta) => {
        provider.postMessage({ type: 'delta', delta });
      });
      provider.postMessage({ type: 'done', conversationId: convId });
    })
  );
}

export function deactivate() {}