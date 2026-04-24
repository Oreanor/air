export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  source?: 'telegram' | 'preview-picker' | 'extension'
}

export interface PickedElement {
  selector: string
  tagName: string
  rect: { width: number; height: number; top: number; left: number }
  styles: Record<string, string>
  crossOrigin?: boolean
}

export interface ModelOption {
  id: string
  label: string
  provider?: string
}

export interface FolderItem {
  name: string
  path: string
  depth: number
}

export interface ScheduledTaskInfo {
  id: string
  text: string
  scheduledAt: number
  completedAt?: number
}

export interface CustomPrompt {
  key: string
  label: string
  text: string
}

export interface ProviderInfo {
  id: string
  name: string
  configured: boolean
  maskedKey?: string
  pendingRemoval?: boolean
  pendingMasked?: string
  placeholder?: string
}

export interface Session {
  id: string
  name: string
  createdAt: number
}

export const STREAMING_ID = '__streaming__'
