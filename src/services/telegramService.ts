import * as https from 'https';

export class TelegramService {
  private offset = 0;
  private timer?: ReturnType<typeof setInterval>;
  private onIncoming?: (text: string, from: string) => void;

  constructor(
    private readonly token: string,
    private readonly chatId: string
  ) {}

  // ── отправить сообщение ───────────────────────────────────────────────

  async send(text: string): Promise<void> {
    await this.request('sendMessage', {
      chat_id: this.chatId,
      text,
      parse_mode: 'Markdown',
    });
  }

  // ── запустить polling ─────────────────────────────────────────────────

  startPolling(onIncoming: (text: string, from: string) => void): void {
    this.onIncoming = onIncoming;
    this.timer = setInterval(() => this.poll(), 2000);
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // ── внутренний poll ───────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const data = await this.request('getUpdates', {
        offset: this.offset,
        timeout: 1,
      });

      for (const update of data.result ?? []) {
        this.offset = update.update_id + 1;
        const text = update.message?.text;
        const from = update.message?.from?.first_name ?? 'unknown';
        if (text) {
          this.onIncoming?.(text, from);
        }
      }
    } catch {
      // сеть пропала — просто пропускаем итерацию
    }
  }

  // ── базовый HTTP запрос к Telegram API ────────────────────────────────

  private request(method: string, body: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.token}/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(JSON.parse(data)));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}