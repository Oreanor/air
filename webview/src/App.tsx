import { useReducer, useEffect, useRef, useCallback } from 'react'
import { getStrings } from './i18n'
import { reducer, initialState } from './store/reducer'
import { styles } from './styles'
import ChatMessages from './components/ChatMessages'
import ChatInput from './components/ChatInput'
import QuickPrompts from './components/QuickPrompts'
import NpmPanel from './components/NpmPanel'
import GitPanel from './components/GitPanel'
import ElementChip from './components/ElementChip'
import ScheduleCalendar from './components/ScheduleCalendar'

declare const acquireVsCodeApi: () => { postMessage: (msg: unknown) => void }
const vscode = acquireVsCodeApi()

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const {
    messages, isStreaming, pickedElement, locale,
    models, selectedModel, npmScripts, selectedScript,
    gitBranch, gitBranches, gitBusy, newBranchMode, newBranchName,
    selectedPrompt, selectedScope, scopeFolders, activeFile, workspaceRoot, input,
    customPrompts, newPromptMode,
    scheduledTasks, calendarOpen,
  } = state

  const t = getStrings(locale)
  const builtinPrompts = [
    { key: 'refactor', label: t.quickRefactorLabel, text: t.quickRefactorPrompt },
    { key: 'tests',    label: t.quickTestsLabel,    text: t.quickTestsPrompt },
    { key: 'fix',      label: t.quickFixLabel,      text: t.quickFixPrompt },
  ]
  const allQuickPrompts = [...builtinPrompts, ...customPrompts]

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastUserInputRef = useRef('')

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 160
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [])

  useEffect(() => { resizeTextarea() }, [input, resizeTextarea])
  useEffect(() => { vscode.postMessage({ type: 'ready' }) }, [])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case 'workspace-tree':
          dispatch({ type: 'SET_WORKSPACE_TREE', root: msg.root ?? null, folders: Array.isArray(msg.folders) ? msg.folders : [] })
          break
        case 'active-file':
          dispatch({ type: 'SET_ACTIVE_FILE', relativePath: msg.relativePath ?? null })
          break
        case 'models':
          dispatch({ type: 'SET_MODELS', models: Array.isArray(msg.models) ? msg.models : [] })
          break
        case 'locale':
          if (msg.locale) dispatch({ type: 'SET_LOCALE', locale: String(msg.locale) })
          break
        case 'npm-scripts':
          dispatch({ type: 'SET_NPM_SCRIPTS', scripts: Array.isArray(msg.scripts) ? msg.scripts : [] })
          break
        case 'git-info':
          if (msg.branch) dispatch({ type: 'SET_GIT_INFO', branch: msg.branch, branches: Array.isArray(msg.branches) ? msg.branches : [] })
          break
        case 'git-busy':
          dispatch({ type: 'SET_GIT_BUSY', busy: !!msg.busy })
          break
        case 'git-op-done': {
          dispatch({ type: 'SET_GIT_BUSY', busy: false })
          const opId = `git-op-${msg.op}`
          if (msg.op === 'add') {
            dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: opId, text: t.msgGitAdded })
          } else if (msg.op === 'commit') {
            dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: opId, text: t.msgGitCommitted(msg.commitMsg) })
          } else if (msg.op === 'push') {
            dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: opId, text: t.msgGitPushed(msg.commitMsg) })
          }
          if (msg.op === 'commit' || msg.op === 'push') vscode.postMessage({ type: 'git-info' })
          break
        }
        case 'git-error':
          dispatch({ type: 'SET_GIT_BUSY', busy: false })
          dispatch({ type: 'ADD_MESSAGE', id: `git-err-${Date.now()}`, text: t.msgGitError(String(msg.error ?? '')) })
          break
        case 'dev-polling': {
          const ports: number[] = Array.isArray(msg.ports) ? msg.ports : []
          dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: 'dev-status', text: t.msgDevWaiting(ports.join(', ')) })
          break
        }
        case 'dev-server-ready':
          dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: 'dev-status', text: t.msgDevReady(msg.url) })
          break
        case 'dev-polling-timeout':
          dispatch({ type: 'UPDATE_OR_ADD_MESSAGE', id: 'dev-status', text: t.msgDevTimeout })
          break
        case 'history': {
          const msgs = Array.isArray(msg.messages)
            ? msg.messages.map((m: any, i: number) => ({
                id: `hist-${i}`,
                role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
                text: m.content ?? '',
              }))
            : []
          dispatch({ type: 'HISTORY_LOADED', messages: msgs })
          break
        }
        case 'user-message': {
          const from: string = msg.from ?? ''
          const source: 'telegram' | 'preview-picker' | 'extension' =
            from === 'Preview Picker' ? 'preview-picker'
            : from.startsWith('@') || msg.source === 'telegram' ? 'telegram'
            : 'extension'
          dispatch({ type: 'EXT_USER_MESSAGE', text: msg.text ?? '', source })
          break
        }
        case 'stream-start': dispatch({ type: 'STREAM_START' }); break
        case 'delta': dispatch({ type: 'STREAM_DELTA', delta: String(msg.delta ?? '') }); break
        case 'done':
        case 'stopped': dispatch({ type: 'STREAM_DONE' }); break
        case 'response': dispatch({ type: 'RESPONSE', text: String(msg.text ?? '') }); break
        case 'error': dispatch({ type: 'STREAM_ERROR', error: msg.error ?? 'Error' }); break
        case 'picked-element':
          if (msg.data) dispatch({ type: 'SET_PICKED_ELEMENT', element: msg.data })
          break
        case 'custom-prompts':
          if (Array.isArray(msg.prompts)) dispatch({ type: 'SET_CUSTOM_PROMPTS', prompts: msg.prompts })
          break
        case 'scheduled-tasks':
          if (Array.isArray(msg.tasks)) dispatch({ type: 'SET_SCHEDULED_TASKS', tasks: msg.tasks })
          break
        case 'patch-last-message':
          if (typeof msg.text === 'string') dispatch({ type: 'PATCH_LAST_MESSAGE', text: msg.text })
          break
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [locale])

  const send = () => {
    if (!input.trim() || isStreaming) return
    const text = input.trim()
    lastUserInputRef.current = text

    const displayText = pickedElement ? `${text}\n\`${pickedElement.selector}\`` : text
    dispatch({ type: 'USER_MESSAGE_SENT', displayText })

    let fullText = text
    if (pickedElement) {
      const el = pickedElement
      fullText += el.crossOrigin
        ? `\n\n[Координаты клика в preview: (${el.rect.left}, ${el.rect.top})]`
        : `\n\n[Элемент из preview: ${el.selector}` +
          ` | ${el.rect.width}×${el.rect.height}px` +
          ` | font: ${el.styles.fontSize} ${el.styles.fontWeight}` +
          ` | color: ${el.styles.color}` +
          ` | bg: ${el.styles.background}]`
    }

    vscode.postMessage({
      type: 'send',
      payload: {
        text: fullText,
        modelId: selectedModel !== 'auto' ? selectedModel : undefined,
        conversationId: 'default',
        context: { taskKind: pickedElement ? 'preview' : 'chat' },
      },
    })
  }

  const stop = () => {
    vscode.postMessage({ type: 'stop' })
    dispatch({ type: 'STREAM_STOPPED' })
    dispatch({ type: 'SET_INPUT', value: lastUserInputRef.current })
    setTimeout(() => {
      textareaRef.current?.focus()
      const len = textareaRef.current?.value.length ?? 0
      textareaRef.current?.setSelectionRange(len, len)
    }, 50)
  }

  const sendQuickPrompt = () => {
    const prompt = allQuickPrompts.find(p => p.key === selectedPrompt)
    if (!prompt || isStreaming) return

    let scopeSuffix = ''
    if (selectedScope === 'file') scopeSuffix = activeFile ? t.scopePromptFile(activeFile) : ''
    else if (selectedScope === 'project') scopeSuffix = t.scopePromptProject
    else if (selectedScope.startsWith('folder:')) scopeSuffix = t.scopePromptFolder(selectedScope.slice(7))

    dispatch({ type: 'SET_INPUT', value: prompt.text + scopeSuffix })
    setTimeout(() => {
      textareaRef.current?.focus()
      const len = textareaRef.current?.value.length ?? 0
      textareaRef.current?.setSelectionRange(len, len)
    }, 0)
  }

  const scheduleQuickPrompt = (scheduledAt: string) => {
    const prompt = allQuickPrompts.find(p => p.key === selectedPrompt)
    if (!prompt || isStreaming) return

    let scopeSuffix = ''
    if (selectedScope === 'file') scopeSuffix = activeFile ? t.scopePromptFile(activeFile) : ''
    else if (selectedScope === 'project') scopeSuffix = t.scopePromptProject
    else if (selectedScope.startsWith('folder:')) scopeSuffix = t.scopePromptFolder(selectedScope.slice(7))

    vscode.postMessage({ type: 'schedule-prompt', text: prompt.text + scopeSuffix, scheduledAt: new Date(scheduledAt).getTime() })
    const formatted = new Date(scheduledAt).toLocaleString()
    dispatch({ type: 'ADD_MESSAGE', id: `scheduled-${Date.now()}`, text: t.scheduleConfirm(formatted) })
  }

  const gitOp = (op: 'add' | 'commit' | 'push') => {
    dispatch({ type: 'ADD_MESSAGE', id: `git-op-${op}`, text: t.msgGitProgress(op) })
    vscode.postMessage({ type: `git-${op}` })
  }

  const newChat = () => {
    dispatch({ type: 'CLEAR_MESSAGES' })
    vscode.postMessage({ type: 'clear-history', conversationId: 'default' })
  }

  return (
    <div style={styles.root}>
      <ChatMessages messages={messages} t={t} bottomRef={bottomRef} />

      <div style={styles.inputRow}>

        {pickedElement && (
          <div style={styles.chipRow}>
            <ElementChip el={pickedElement} onRemove={() => dispatch({ type: 'SET_PICKED_ELEMENT', element: null })} t={t} />
          </div>
        )}

        <ChatInput
          input={input}
          isStreaming={isStreaming}
          textareaRef={textareaRef}
          onChange={value => { dispatch({ type: 'SET_INPUT', value }); resizeTextarea() }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          onSend={send}
          onStop={stop}
          t={t}
        />

        <QuickPrompts
          models={models}
          selectedModel={selectedModel}
          onModelChange={id => dispatch({ type: 'SET_MODEL', modelId: id })}
          scopeFolders={scopeFolders}
          selectedScope={selectedScope}
          onScopeChange={scope => dispatch({ type: 'SET_SELECTED_SCOPE', scope })}
          activeFile={activeFile}
          quickPrompts={allQuickPrompts}
          selectedPrompt={selectedPrompt}
          onPromptChange={key => {
            if (key === '__new__') { dispatch({ type: 'SET_NEW_PROMPT_MODE', active: true }); return }
            dispatch({ type: 'SET_SELECTED_PROMPT', key })
          }}
          isStreaming={isStreaming}
          onSendQuickPrompt={sendQuickPrompt}
          onSchedulePrompt={scheduleQuickPrompt}
          onOpenPreview={() => vscode.postMessage({ type: 'command', command: 'kludge.openPreview' })}
          onNewChat={newChat}
          newPromptMode={newPromptMode}
          onSaveNewPrompt={(label, text) => {
            vscode.postMessage({ type: 'save-custom-prompt', label, text })
            dispatch({ type: 'SET_NEW_PROMPT_MODE', active: false })
          }}
          onCancelNewPrompt={() => dispatch({ type: 'SET_NEW_PROMPT_MODE', active: false })}
          t={t}
        />

        <NpmPanel
          workspaceRoot={workspaceRoot}
          npmScripts={npmScripts}
          selectedScript={selectedScript}
          onScriptChange={script => dispatch({ type: 'SET_SELECTED_SCRIPT', script })}
          onRun={() => {
            const cmd = selectedScript === 'install' ? 'npm install' : `npm run ${selectedScript}`
            vscode.postMessage({ type: 'npm-run', script: selectedScript })
            if (selectedScript !== 'dev') {
              dispatch({ type: 'ADD_MESSAGE', id: `npm-${Date.now()}`, text: t.msgNpmStarted(cmd) })
            }
          }}
        />

        <GitPanel
          workspaceRoot={workspaceRoot}
          gitBranch={gitBranch}
          gitBranches={gitBranches}
          gitBusy={gitBusy}
          newBranchMode={newBranchMode}
          newBranchName={newBranchName}
          onBranchChange={value => {
            if (value === '__new__') { dispatch({ type: 'SET_NEW_BRANCH_MODE', active: true }); return }
            vscode.postMessage({ type: 'git-checkout', branch: value, isNew: false })
          }}
          onNewBranchNameChange={name => dispatch({ type: 'SET_NEW_BRANCH_NAME', name })}
          onCreateBranch={() => {
            const name = newBranchName.trim()
            if (!name) return
            vscode.postMessage({ type: 'git-checkout', branch: name, isNew: true })
            dispatch({ type: 'SET_NEW_BRANCH_MODE', active: false })
          }}
          onCancelNewBranch={() => dispatch({ type: 'SET_NEW_BRANCH_MODE', active: false })}
          onGitOp={gitOp}
          t={t}
        />

        <button
          style={{ ...styles.iconButton, alignSelf: 'flex-start', fontSize: 11, opacity: calendarOpen ? 1 : 0.6 }}
          onClick={() => dispatch({ type: 'TOGGLE_CALENDAR' })}
        >{t.calendarToggle}{scheduledTasks.length > 0 && ` (${scheduledTasks.length})`}</button>

        {calendarOpen && (
          <ScheduleCalendar
            tasks={scheduledTasks}
            onCancel={id => { vscode.postMessage({ type: 'cancel-scheduled-task', id }) }}
            t={t}
          />
        )}

        {!workspaceRoot && (
          <div style={styles.noWorkspaceHint}>{t.noWorkspaceHint}</div>
        )}
      </div>
    </div>
  )
}
