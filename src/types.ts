export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom';
export type TaskKind = 'chat' | 'edit' | 'preview' | 'icons' | 'image' | 'search' | 'agent';

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  name: string;
  taskKinds: TaskKind[];
  maxTokens?: number;
  temperature?: number;
}

export interface ExtensionState {
  activeTaskId?: string;
  selectedModelByTask: Partial<Record<TaskKind, string>>;
  favorites: {
    icons: string[];
    prompts: string[];
  };
}

export interface SettingsState {
  savePreferences?: boolean;
  preferredCost?: 'low-cost' | 'balanced' | 'best-quality';
}

export interface TaskState {
  id: string;
  kind: TaskKind;
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: number;
}

export interface MessageToWebview {
  type: string;
  payload?: any;
}

export interface MessageFromWebview {
  type: string;
  payload?: any;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: number;
  toolName?: string;
}

export interface ChatContext {
  selectedText?: string;
  activeFile?: string;
  activeFileContent?: string;
  workspaceFiles?: string[];
  symbols?: string[];
  taskKind: TaskKind;
}

export interface ChatRequest {
  conversationId: string;
  messages: ChatMessage[];
  context: ChatContext;
  modelId: string;
  systemExtra?: string;
}

export interface EditRequest {
  uri: string;
  selection: any;
  instruction: string;
  languageId: string;
}

export interface EditPatch {
  uri: string;
  original: string;
  updated: string;
  diff: string;
}

export interface PreviewConfig {
  url?: string;
  entryFile?: string;
  devServerPort?: number;
  framework?: 'react' | 'next' | 'vite' | 'svelte' | 'static';
}

export interface IconItem {
  name: string;
  tags?: string[];
  category?: string;
}

export interface IconInsertRequest {
  name: string;
  targetUri: string;
  targetRange?: any;
  format: 'import' | 'jsx' | 'prop';
}

export interface ImageRequest {
  prompt: string;
  style?: 'realistic' | 'illustration' | 'icon' | 'ui';
  aspectRatio?: '1:1' | '16:9' | '9:16';
  size?: 'small' | 'medium' | 'large';
}

export interface ImageResult {
  uri: string;
  metadata?: any;
}

export interface ImageProvider {
  generate(request: ImageRequest): Promise<ImageResult>;
}

export interface RouteDecision {
  modelId: string;
  reason: string;
  fallbackModelId?: string;
}

export interface ModelRouter {
  route(task: TaskKind, context: ChatContext): RouteDecision;
}

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'fixer';

export interface AgentTask {
  id: string;
  role: AgentRole;
  input: string;
  status: 'queued' | 'running' | 'done' | 'failed';
}

export interface ConversationTurn {
  user: string;
  assistant: string;
}

export interface ConversationState {
  turns: ConversationTurn[];
  lastUserMessage: ChatMessage | null;
  /** path → content, загружается по запросу, не шлётся в API автоматически */
  fileCache: Record<string, string>;
}
