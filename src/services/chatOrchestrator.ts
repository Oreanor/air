import { ChatRequest, ChatContext, ChatMessage } from '../types';
import { HistoryService } from './history';

export class ChatOrchestrator {
  constructor(private readonly history?: HistoryService) {}

  buildChatContext(options: Partial<ChatContext> = {}): ChatContext {
    return Object.assign({ taskKind: 'chat' }, options) as ChatContext;
  }

  getHistory(conversationId: string) {
    return this.history?.getHistory(conversationId) ?? [];
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    const convId = request.conversationId ?? 'default';
    const last = request.messages?.at(-1);
    if (last && this.history) {
      await this.history.addMessage(convId, last);
    }
  }

  async streamChatResponse(
    request: ChatRequest,
    onDelta: (delta: string) => void
  ): Promise<void> {
    try {
      const convId = request.conversationId ?? 'default';
      const userMsg = request.messages?.at(-1);

      // 1. сохраняем входящее user сообщение
      if (userMsg && this.history) {
        await this.history.addMessage(convId, userMsg);
      }

      // 2. формируем ответ ассистента
      //    сейчас — заглушка, сюда потом подключишь Anthropic
      const responseText = `Репорт по задаче: «${userMsg?.content ?? ''}»`; 

      // 3. стримим по словам
      const chunks = responseText.split(/(\s+)/).filter(Boolean);
      let assembled = '';
      for (const chunk of chunks) {
        onDelta(chunk);
        assembled += chunk;
        await new Promise(r => setTimeout(r, 40));
      }

      // 4. сохраняем ответ ассистента в историю
      if (this.history) {
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: assembled,
          createdAt: Date.now(),
        };
        await this.history.addMessage(convId, assistantMsg);
      }
    } catch (err) {
      onDelta('[ошибка]');
    }
  }

  async handleToolCall(call: any): Promise<any> {
    return null;
  }
}