import { Message, PickedElement, ModelOption, FolderItem, CustomPrompt, ScheduledTaskInfo, ProviderInfo, Session, STREAMING_ID } from '../types'

export interface AppState {
  sessions: Session[]
  activeSessionId: string
  busySessionId: string | null
  messages: Message[]
  isStreaming: boolean
  pickedElement: PickedElement | null
  locale: string
  models: ModelOption[]
  disabledProviders: string[]
  selectedModel: string
  npmScripts: string[]
  selectedScript: string
  gitBranch: string
  gitBranches: string[]
  gitBusy: boolean
  newBranchMode: boolean
  newBranchName: string
  selectedPrompt: string
  selectedScope: string
  scopeFolders: FolderItem[]
  activeFile: string | null
  workspaceRoot: string | null
  input: string
  customPrompts: CustomPrompt[]
  newPromptMode: boolean
  scheduledTasks: ScheduledTaskInfo[]
  calendarOpen: boolean
  providers: ProviderInfo[]
  providersOpen: boolean
}

export type AppAction =
  | { type: 'SET_LOCALE'; locale: string }
  | { type: 'SET_MODELS'; models: ModelOption[]; disabledProviders?: string[] }
  | { type: 'SET_PROVIDERS'; providers: ProviderInfo[]; disabledProviders?: string[] }
  | { type: 'SET_SESSIONS'; sessions: Session[] }
  | { type: 'SWITCH_SESSION'; sessionId: string }
  | { type: 'SET_BUSY_SESSION'; sessionId: string | null }
  | { type: 'SET_MODEL'; modelId: string }
  | { type: 'SET_NPM_SCRIPTS'; scripts: string[] }
  | { type: 'SET_SELECTED_SCRIPT'; script: string }
  | { type: 'SET_GIT_INFO'; branch: string; branches: string[] }
  | { type: 'SET_GIT_BUSY'; busy: boolean }
  | { type: 'SET_NEW_BRANCH_MODE'; active: boolean }
  | { type: 'SET_NEW_BRANCH_NAME'; name: string }
  | { type: 'SET_SELECTED_PROMPT'; key: string }
  | { type: 'SET_SELECTED_SCOPE'; scope: string }
  | { type: 'SET_WORKSPACE_TREE'; root: string | null; folders: FolderItem[] }
  | { type: 'SET_ACTIVE_FILE'; relativePath: string | null }
  | { type: 'SET_PICKED_ELEMENT'; element: PickedElement | null }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'STREAM_START' }
  | { type: 'STREAM_DELTA'; delta: string }
  | { type: 'STREAM_DONE' }
  | { type: 'STREAM_STOPPED' }
  | { type: 'STREAM_ERROR'; error: string }
  | { type: 'USER_MESSAGE_SENT'; displayText: string }
  | { type: 'QUICK_PROMPT_SENT'; label: string }
  | { type: 'EXT_USER_MESSAGE'; text: string; source: Message['source'] }
  | { type: 'RESPONSE'; text: string }
  | { type: 'ADD_MESSAGE'; id: string; text: string }
  | { type: 'UPDATE_OR_ADD_MESSAGE'; id: string; text: string }
  | { type: 'HISTORY_LOADED'; messages: Message[] }
  | { type: 'SET_CUSTOM_PROMPTS'; prompts: CustomPrompt[] }
  | { type: 'SET_NEW_PROMPT_MODE'; active: boolean }
  | { type: 'SET_SCHEDULED_TASKS'; tasks: ScheduledTaskInfo[] }
  | { type: 'TOGGLE_CALENDAR' }
  | { type: 'PATCH_LAST_MESSAGE'; text: string }
  | { type: 'TOGGLE_PROVIDERS' }

export const initialState: AppState = {
  sessions: [{ id: 'default', name: 'Chat 1', createdAt: 0 }],
  activeSessionId: 'default',
  busySessionId: null,
  messages: [],
  isStreaming: false,
  pickedElement: null,
  locale: 'en',
  models: [],
  disabledProviders: [],
  selectedModel: 'auto',
  npmScripts: [],
  selectedScript: 'build',
  gitBranch: '',
  gitBranches: [],
  gitBusy: false,
  newBranchMode: false,
  newBranchName: '',
  selectedPrompt: 'refactor',
  selectedScope: 'file',
  scopeFolders: [],
  activeFile: null,
  workspaceRoot: null,
  input: '',
  customPrompts: [],
  newPromptMode: false,
  scheduledTasks: [],
  calendarOpen: false,
  providers: [],
  providersOpen: false,
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOCALE': return { ...state, locale: action.locale }
    case 'SET_MODELS': {
      const dp = action.disabledProviders ?? state.disabledProviders
      const selectedProvider = state.models.find(m => m.id === state.selectedModel)?.provider ?? ''
      const selected = selectedProvider && dp.includes(selectedProvider) ? 'auto' : state.selectedModel
      return { ...state, models: action.models, disabledProviders: dp, selectedModel: selected }
    }
    case 'SET_MODEL': return { ...state, selectedModel: action.modelId }
    case 'SET_NPM_SCRIPTS': {
      const preferred = ['dev', 'build', 'start']
      const def = preferred.find(s => action.scripts.includes(s)) ?? action.scripts[0]
      return { ...state, npmScripts: action.scripts, selectedScript: def ?? state.selectedScript }
    }
    case 'SET_SELECTED_SCRIPT': return { ...state, selectedScript: action.script }
    case 'SET_GIT_INFO': return { ...state, gitBranch: action.branch, gitBranches: action.branches }
    case 'SET_GIT_BUSY': return { ...state, gitBusy: action.busy }
    case 'SET_NEW_BRANCH_MODE':
      return { ...state, newBranchMode: action.active, newBranchName: action.active ? state.newBranchName : '' }
    case 'SET_NEW_BRANCH_NAME': return { ...state, newBranchName: action.name }
    case 'SET_SELECTED_PROMPT': return { ...state, selectedPrompt: action.key }
    case 'SET_SELECTED_SCOPE': return { ...state, selectedScope: action.scope }
    case 'SET_WORKSPACE_TREE': return { ...state, workspaceRoot: action.root, scopeFolders: action.folders }
    case 'SET_ACTIVE_FILE': return { ...state, activeFile: action.relativePath }
    case 'SET_PICKED_ELEMENT': return { ...state, pickedElement: action.element }
    case 'SET_INPUT': return { ...state, input: action.value }
    case 'CLEAR_MESSAGES': return { ...state, messages: [] }

    case 'STREAM_START': {
      if (state.messages.some(m => m.id === STREAMING_ID)) return { ...state, isStreaming: true }
      return {
        ...state,
        isStreaming: true,
        messages: [...state.messages, { id: STREAMING_ID, role: 'assistant', text: '' }],
      }
    }

    case 'STREAM_DELTA':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === STREAMING_ID ? { ...m, text: m.text + action.delta } : m
        ),
      }

    case 'STREAM_DONE':
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.map(m =>
          m.id === STREAMING_ID ? { ...m, id: `msg-${Date.now()}` } : m
        ),
      }

    case 'STREAM_STOPPED':
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.filter(m => m.id !== STREAMING_ID),
      }

    case 'STREAM_ERROR':
      return {
        ...state,
        isStreaming: false,
        messages: [
          ...state.messages.filter(m => m.id !== STREAMING_ID),
          { id: `err-${Date.now()}`, role: 'assistant', text: `⚠ ${action.error}` },
        ],
      }

    case 'USER_MESSAGE_SENT':
      return {
        ...state,
        isStreaming: true,
        input: '',
        pickedElement: null,
        messages: [
          ...state.messages,
          { id: `user-${Date.now()}`, role: 'user', text: action.displayText },
          { id: STREAMING_ID, role: 'assistant', text: '' },
        ],
      }

    case 'QUICK_PROMPT_SENT':
      return {
        ...state,
        isStreaming: true,
        messages: [
          ...state.messages,
          { id: `user-${Date.now()}`, role: 'user', text: action.label },
          { id: STREAMING_ID, role: 'assistant', text: '' },
        ],
      }

    case 'EXT_USER_MESSAGE':
      return {
        ...state,
        isStreaming: true,
        messages: [
          ...state.messages,
          { id: `ext-user-${Date.now()}`, role: 'user', text: action.text, source: action.source },
          { id: STREAMING_ID, role: 'assistant', text: '' },
        ],
      }

    case 'RESPONSE': {
      const idx = state.messages.findIndex(m => m.id === STREAMING_ID)
      const newMsg: Message = { id: `msg-${Date.now()}`, role: 'assistant', text: action.text }
      return {
        ...state,
        isStreaming: false,
        messages: idx !== -1
          ? state.messages.map((m, i) => i === idx ? newMsg : m)
          : [...state.messages, newMsg],
      }
    }

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, { id: action.id, role: 'assistant', text: action.text }],
      }

    case 'UPDATE_OR_ADD_MESSAGE': {
      const idx = state.messages.findIndex(m => m.id === action.id)
      if (idx !== -1) {
        const next = [...state.messages]
        next[idx] = { ...next[idx], text: action.text }
        return { ...state, messages: next }
      }
      return {
        ...state,
        messages: [...state.messages, { id: action.id, role: 'assistant', text: action.text }],
      }
    }

    case 'HISTORY_LOADED':
      if (action.messages.length === 0) return state
      return { ...state, messages: action.messages }

    case 'SET_CUSTOM_PROMPTS': return { ...state, customPrompts: action.prompts }
    case 'SET_NEW_PROMPT_MODE': return { ...state, newPromptMode: action.active }
    case 'SET_SCHEDULED_TASKS': return { ...state, scheduledTasks: action.tasks }
    case 'TOGGLE_CALENDAR': return { ...state, calendarOpen: !state.calendarOpen }
    case 'SET_PROVIDERS': {
      const dp = action.disabledProviders ?? state.disabledProviders
      return { ...state, providers: action.providers, disabledProviders: dp }
    }
    case 'TOGGLE_PROVIDERS': return { ...state, providersOpen: !state.providersOpen }
    case 'SET_SESSIONS': return { ...state, sessions: action.sessions }
    case 'SWITCH_SESSION':
      if (action.sessionId === state.activeSessionId) { return state }
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: [],
        isStreaming: false,
      }
    case 'SET_BUSY_SESSION': return { ...state, busySessionId: action.sessionId }
    case 'PATCH_LAST_MESSAGE': {
      const idx = [...state.messages].map((m, i) => ({ m, i })).reverse()
        .find(({ m }) => m.role === 'assistant' && m.id !== STREAMING_ID)?.i ?? -1
      if (idx === -1) { return state }
      const next = [...state.messages]
      next[idx] = { ...next[idx], text: action.text }
      return { ...state, messages: next }
    }

    default:
      return state
  }
}
