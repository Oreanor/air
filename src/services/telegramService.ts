import * as https from 'https';

export class TelegramService {
  private offset = 0;
  private _running = false;
  private _onIncoming?: (text: string, from: string) => Promise<void>;
  private _retryDelay = 1000;
  private _maxRetryDelay = 30_000;

  constructor(
    private readonly token: string,
    private readonly chatId: string
  ) {}

  // ── отправить сообщение ───────────────────────────────────────────────

  async send(text: string): Promise<void> {
    // Telegram ограничивает 4096 символов на сообщение
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      await this.request('sendMessage', {
        chat_id: this.chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    }
  }

  // ── запустить long-polling ────────────────────────────────────────────

  startPolling(onIncoming: (text: string, from: string) => Promise<void>): void {
    if (this._running) { return; }
    this._onIncoming = onIncoming;
    this._running = true;
    this._retryDelay = 1000;
    void this._pollLoop();
  }

  stopPolling(): void {
    this._running = false;
  }

  // ── внутренний цикл long-polling ──────────────────────────────────────

  private async _pollLoop(): Promise<void> {
    while (this._running) {
      try {
        const data = await this.request('getUpdates', {
          offset: this.offset,
          timeout: 25,     // long-poll на 25 секунд
          limit: 10,
          allowed_updates: ['message'],
        });

        // успешный ответ — сбрасываем задержку
        this._retryDelay = 1000;

        for (const update of data.result ?? []) {
          this.offset = update.update_id + 1;
          const text = update.message?.text;
          const from =
            update.message?.from?.username
              ? `@${update.message.from.username}`
              : (update.message?.from?.first_name ?? 'unknown');
          if (text && this._onIncoming) {
            try {
              await this._onIncoming(text, from);
            } catch (e: any) {
              console.error('[Kludge] Telegram handler error:', e?.message ?? e);
            }
          }
        }
      } catch (e: any) {
        if (!this._running) { break; }
        console.error('[Kludge] Telegram polling error:', e?.message ?? e);
        // экспоненциальный backoff при ошибках сети
        await sleep(this._retryDelay);
        this._retryDelay = Math.min(this._retryDelay * 2, this._maxRetryDelay);
      }
    }
  }

  // ── базовый HTTP запрос к Telegram API ────────────────────────────────

  private request(method: string, body: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);

      // таймаут чуть больше telegram-timeout чтобы не обрывать раньше
      const timeoutMs = ('timeout' in (body as any))
        ? ((body as any).timeout * 1000 + 5000)
        : 10_000;

      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.token}/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (!parsed.ok) {
                reject(new Error(`Telegram API error: ${parsed.description ?? 'unknown'}`));
              } else {
                resolve(parsed);
              }
            } catch (e) {
              reject(new Error(`Failed to parse Telegram response: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Telegram request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }
}

// ── утилиты ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) { return [text]; }
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}