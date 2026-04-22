import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatOrchestrator, TelegramService } from './services';
import { ChatRequest } from './types';

export class ChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'air.chatView';
  private _view?: vscode.WebviewView;
  private telegram?: TelegramService;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly orchestrator?: ChatOrchestrator) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // send history for default conversation (if available)
    if (this.orchestrator && typeof (this.orchestrator as any).getHistory === 'function') {
      try {
        const hist = (this.orchestrator as any).getHistory('default');
        this._view?.webview.postMessage({ type: 'history', conversationId: 'default', messages: hist });
        console.log('[air] ChatProvider: posted history (default)', Array.isArray(hist) ? hist.length : 0);
      } catch (e) {
        // ignore
      }
    }

    webviewView.webview.onDidReceiveMessage(msg => {
      void this._handleMessage(msg);
    });
  }

  public postMessage(msg: any) {
    this._view?.webview.postMessage(msg);
  }

  private async _handleMessage(msg: any) {
    try {
      switch (msg?.type) {
        case 'send': {
          // build ChatRequest from payload or raw text
          const payload = msg.payload ?? { text: msg.text };

          let request: ChatRequest;
          if (payload && typeof payload.text === 'string') {
            // construct a minimal ChatRequest from plain text
            request = {
              conversationId: payload.conversationId ?? 'default',
              messages: [
                { id: `user-${Date.now()}`, role: 'user', content: payload.text, createdAt: Date.now() }
              ],
              context: payload.context ?? { taskKind: 'chat' },
              modelId: payload.modelId ?? 'default'
            } as ChatRequest;
          } else {
            request = payload as ChatRequest;
          }


          // inform webview that streaming starts
          this._view?.webview.postMessage({ type: 'stream-start', conversationId: request.conversationId });
          console.log('[air] ChatProvider: stream-start', request.conversationId);

          if (this.orchestrator) {
            await this.orchestrator.streamChatResponse(request, (delta) => {
              this._view?.webview.postMessage({ type: 'delta', delta });
            });
            this._view?.webview.postMessage({ type: 'done', conversationId: request.conversationId });

            console.log('[air] ChatProvider: stream finished', request.conversationId);
          } else {
            this._view?.webview.postMessage({ type: 'response', text: `Ты написал: ${msg.text ?? JSON.stringify(msg.payload)}` });
            console.log('[air] ChatProvider: no orchestrator, fallback echo');
          }

          break;
        }
        case 'command':
          vscode.commands.executeCommand(msg.command);
          break;
        default:
          this._view?.webview.postMessage({ type: 'unknown', payload: msg });
      }
    } catch (err) {
      this._view?.webview.postMessage({ type: 'error', error: String(err) });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const distPath = vscode.Uri.joinPath(
      this._extensionUri, 'dist', 'webview', 'webview'
    );

    // читаем собранный index.html и заменяем пути на webview URI
    const htmlPath = path.join(distPath.fsPath, 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
      return `<html><body>Error: Could not load index.html from ${htmlPath}. Please run 'npm run build' to generate the webview files. Error: ${error}</body></html>`;
    }

    // заменяем /assets/... на vscode-resource: URI
    html = html.replace(
      /(src|href)="([^"]+)"/g,
      (_, attr, val) => {
        if (val.startsWith('http')) {
          return `${attr}="${val}"`;
        }
        const uri = webview.asWebviewUri(
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', val)
        );
        return `${attr}="${uri}"`;
      }
    );

    // добавляем CSP
    const nonce = getNonce();
    html = html.replace(
      '<head>',
      `<head>
        <meta http-equiv="Content-Security-Policy" content="
          default-src 'none';
          script-src 'nonce-${nonce}' 'unsafe-eval';
          style-src ${webview.cspSource} 'unsafe-inline';
          img-src ${webview.cspSource} data:;
          connect-src *;
        ">`
    );

    // добавляем nonce к script тегам
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);

    // добавляем простой debug div и скрипт для отображения сообщений
    html = html.replace(
      '<body>',
      `<body>
        <div id="air-debug" style="padding: 10px; font-family: monospace; background: #f0f0f0; border-bottom: 1px solid #ccc;">
          <h3>AIR Debug Log</h3>
          <div id="air-log" style="max-height: 300px; overflow-y: auto;"></div>
        </div>
        <script nonce="${nonce}">
          const logDiv = document.getElementById('air-log');
          window.addEventListener('message', event => {
            const msg = event.data;
            if (msg && typeof msg === 'object') {
              const entry = document.createElement('div');
              entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + JSON.stringify(msg);
              logDiv.appendChild(entry);
              logDiv.scrollTop = logDiv.scrollHeight;
            }
          });
        </script>`
    );

    return html;
  }
}

function getNonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}