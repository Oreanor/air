import * as vscode from 'vscode';
import { ChatMessage, ConversationState } from '../types';

const MAX_TURNS     = 4;   // пар (user+assistant) хранить в контексте
const USER_MAX      = 180; // символов из user-сообщения
const ASSISTANT_MAX = 200; // символов из ответа ассистента

export class HistoryService {
  constructor(private readonly state: vscode.Memento) {}

  private keyState(id: string) { return `conv.state.${id}`; }
  private keyFile(id: string, p: string) { return `conv.file.${id}.${p}`; }

  getState(conversationId: string): ConversationState {
    const stored = this.state.get<any>(this.keyState(conversationId), null);
    if (!stored) { return { turns: [], lastUserMessage: null, fileCache: {} }; }
    // migrate old string-summary format
    if (!Array.isArray(stored.turns)) {
      return { turns: [], lastUserMessage: stored.lastUserMessage ?? null, fileCache: {} };
    }
    return { turns: stored.turns, lastUserMessage: stored.lastUserMessage ?? null, fileCache: {} };
  }

  private async saveState(id: string, s: ConversationState): Promise<void> {
    const { fileCache: _fc, ...rest } = s;
    await this.state.update(this.keyState(id), rest);
  }

  async addUserMessage(conversationId: string, msg: ChatMessage): Promise<void> {
    const s = this.getState(conversationId);
    s.lastUserMessage = msg;
    await this.saveState(conversationId, s);
  }

  async addAssistantSummary(conversationId: string, response: string): Promise<void> {
    const s = this.getState(conversationId);
    if (!s.lastUserMessage) { return; }

    const userText = s.lastUserMessage.content.length > USER_MAX
      ? s.lastUserMessage.content.slice(0, USER_MAX) + '…'
      : s.lastUserMessage.content;

    const asstText = response.length > ASSISTANT_MAX
      ? response.slice(0, ASSISTANT_MAX) + '…'
      : response;

    s.turns = [...s.turns, { user: userText, assistant: asstText }].slice(-MAX_TURNS);
    await this.saveState(conversationId, s);
  }

  async cacheFile(conversationId: string, filePath: string, content: string): Promise<void> {
    await this.state.update(this.keyFile(conversationId, filePath), content);
  }

  getCachedFile(conversationId: string, filePath: string): string | undefined {
    return this.state.get<string>(this.keyFile(conversationId, filePath));
  }

  async evictFile(conversationId: string, filePath: string): Promise<void> {
    await this.state.update(this.keyFile(conversationId, filePath), undefined);
  }

  async clearHistory(conversationId: string): Promise<void> {
    await this.state.update(this.keyState(conversationId), undefined);
  }

  getHistory(conversationId: string): ChatMessage[] {
    const s = this.getState(conversationId);
    return s.lastUserMessage ? [s.lastUserMessage] : [];
  }

  /** @deprecated */
  async addMessage(conversationId: string, msg: ChatMessage): Promise<void> {
    if (msg.role === 'user') { await this.addUserMessage(conversationId, msg); }
    else if (msg.role === 'assistant') { await this.addAssistantSummary(conversationId, msg.content); }
  }
}
