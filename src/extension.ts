import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Загружаем переменные окружения из .env файла
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { ChatProvider } from './chatProvider';
import { ChatOrchestrator, HistoryService, TelegramService } from './services';
import { ChatRequest } from './types';
import { PreviewPanel } from './services';

export function activate(context: vscode.ExtensionContext) {
  const historyService = new HistoryService(context.globalState);
  const orchestrator = new ChatOrchestrator(historyService);

  const provider = new ChatProvider(context.extensionUri, orchestrator);

  const preview = new PreviewPanel();

  // подписываем агента на ошибки из preview
  preview.subscribeToErrors(async (errorMsg, stack) => {
    const request: ChatRequest = {
      conversationId: 'preview-autofix',
      messages: [{
        id: `err-${Date.now()}`,
        role: 'user',
        content: `Runtime ошибка в приложении:\n${errorMsg}\n\nStack: ${stack}\n\nПредложи фикс.`,
        createdAt: Date.now()
      }],
      context: { taskKind: 'agent' },
      modelId: 'default'
    };

    let fix = '';
    await orchestrator.streamChatResponse(request, delta => {
      fix += delta;
      provider.postMessage({ type: 'delta', delta, conversationId: 'preview-autofix' });
    });
    provider.postMessage({ type: 'done', conversationId: 'preview-autofix' });
  });

  preview.subscribeToElementPicks(async (info) => {
    const summary = `Picked element: \`${info.selector}\`\n` +
      `Size: ${info.rect.width}×${info.rect.height}\n` +
      `Font: ${info.styles.fontSize} ${info.styles.fontWeight}\n` +
      `Color: ${info.styles.color}\n` +
      `Background: ${info.styles.background}`

    provider.postMessage({
      type: 'user-message',
      text: summary,
      from: 'Preview Picker',
      conversationId: 'preview',
    })

    // и сразу спрашиваем агента что с этим сделать
    const request: ChatRequest = {
      conversationId: 'preview',
      messages: [{
        id: `pick-${Date.now()}`,
        role: 'user',
        content: `Пользователь выбрал элемент в preview:\n${summary}\n\nЧто можно улучшить?`,
        createdAt: Date.now(),
      }],
      context: { taskKind: 'agent' },
      modelId: 'default',
    }

    provider.postMessage({ type: 'stream-start', conversationId: 'preview' })
    await orchestrator.streamChatResponse(request, delta => {
      provider.postMessage({ type: 'delta', delta, conversationId: 'preview' })
    })
    provider.postMessage({ type: 'done', conversationId: 'preview' })
  });

  // команды
  context.subscriptions.push(
    vscode.commands.registerCommand('air.openPreview', () => preview.open()),
    vscode.commands.registerCommand('air.reloadPreview', () => preview.reload()),
    vscode.commands.registerCommand('air.pickElement', () => preview.startElementPicker()),

    // автоперезагрузка при сохранении файла
    vscode.workspace.onDidSaveTextDocument(() => preview.reload())
  );

    // --- Инициализация Telegram ---
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  if (tgToken && tgChatId) {
    const telegram = new TelegramService(tgToken, tgChatId);

    telegram.startPolling(async (text, from) => {
    const request: ChatRequest = {
      conversationId: `tg-${tgChatId}`,
      messages: [
        { id: `tg-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }
      ],
      context: orchestrator.buildChatContext(),
      modelId: 'default'
    };

    // ← вот это добавь: сначала показываем user реплику в UI
    provider.postMessage({
      type: 'user-message',
      text,
      from,
      conversationId: request.conversationId
    });

    let fullResponse = '';

    provider.postMessage({ type: 'stream-start', conversationId: request.conversationId });

    await orchestrator.streamChatResponse(request, (delta) => {
      fullResponse += delta;
      provider.postMessage({ type: 'delta', delta, conversationId: request.conversationId });
    });

    provider.postMessage({ type: 'done', conversationId: request.conversationId });

    if (fullResponse) {
      await telegram.send(fullResponse);
    }
  });

    context.subscriptions.push({ dispose: () => telegram.stopPolling() });
  }
  // ------------------------------
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatProvider.viewId,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('air.helloWorld', () => {
      vscode.window.showInformationMessage('AIR is running!');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('air.testStream', async () => {
      vscode.window.showInformationMessage('AIR: test stream started');
      const request: ChatRequest = {
        conversationId: 'test',
        messages: [
          { id: '1', role: 'user', content: 'Hello from test stream', createdAt: Date.now() }
        ],
        context: { taskKind: 'chat' },
        modelId: 'default'
      };

      await orchestrator.streamChatResponse(request, (delta) => {
        provider.postMessage({ type: 'delta', delta });
      });
      provider.postMessage({ type: 'done' });
      vscode.window.showInformationMessage('AIR: test stream finished');
    })
  );

  // open chat in Explorer (user-visible view)
  context.subscriptions.push(
    vscode.commands.registerCommand('air.openChat', async () => {
      // try to reveal Explorer where the WebviewView is registered
      await vscode.commands.executeCommand('workbench.view.explorer');
      vscode.window.showInformationMessage('AIR: Opened Explorer — please expand "AIR Chat" view to see the chat panel.');
    })
  );

  // send a message programmatically to a conversation
  context.subscriptions.push(
    vscode.commands.registerCommand('air.sendMessage', async () => {
      const convId = await vscode.window.showInputBox({ prompt: 'Conversation ID', value: 'default' });
      if (convId === undefined) {return;}
      const text = await vscode.window.showInputBox({ prompt: 'Message text' });
      if (!text) {return;}

      const request: ChatRequest = {
        conversationId: convId,
        messages: [
          { id: `user-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }
        ],
        context: { taskKind: 'chat' },
        modelId: 'default'
      };

      vscode.window.showInformationMessage(`AIR: sending message to "${convId}"`);
      await orchestrator.streamChatResponse(request, (delta) => {
        provider.postMessage({ type: 'delta', delta });
      });
      provider.postMessage({ type: 'done', conversationId: convId });

      // post final assembled assistant response (UI expects 'response')
      try {
        const hist = orchestrator.getHistory(convId);
        if (Array.isArray(hist)) {
          const lastAssistant = [...hist].reverse().find((m: any) => m.role === 'assistant');
          if (lastAssistant) {
            provider.postMessage({ type: 'response', text: lastAssistant.content, conversationId: convId });
          }
        }
      } catch (e) {
        // ignore
      }
    })
  );
}

export function deactivate() {}