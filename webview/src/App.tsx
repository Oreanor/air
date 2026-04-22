import React, { useState, useEffect, useRef } from 'react'

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void
}

const vscode = acquireVsCodeApi()

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  source?: 'telegram'
}

const STREAMING_ID = '__streaming__'

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const openPreview = () => vscode.postMessage({ type: 'command', command: 'air.openPreview' })
  const pickElement  = () => vscode.postMessage({ type: 'command', command: 'air.pickElement' })

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {

        // ── история при открытии панели ───────────────────────────────
        case 'history': {
          const msgs: Message[] = Array.isArray(msg.messages)
            ? msg.messages.map((m: any, i: number) => ({
                id: `hist-${i}`,
                role: m.role === 'assistant' ? 'assistant' : 'user',
                text: m.content ?? '',
              }))
            : []
          setMessages(msgs)
          break
        }

        // ── входящее из Telegram — показываем как user реплику ────────
        case 'user-message': {
          setMessages(prev => [
            ...prev,
            {
              id: `tg-user-${Date.now()}`,
              role: 'user',
              text: msg.text ?? '',
              source: 'telegram',
            },
            {
              id: STREAMING_ID,
              role: 'assistant',
              text: '',
            },
          ])
          setIsStreaming(true)
          break
        }

        // ── начало стриминга из чата расширения ───────────────────────
        case 'stream-start': {
          setMessages(prev => {
            // не дублируем если уже есть streaming placeholder
            if (prev.some(m => m.id === STREAMING_ID)) return prev
            return [...prev, { id: STREAMING_ID, role: 'assistant', text: '' }]
          })
          setIsStreaming(true)
          break
        }

        // ── токен стриминга ───────────────────────────────────────────
        case 'delta': {
          const delta = String(msg.delta ?? '')
          setMessages(prev => prev.map(m =>
            m.id === STREAMING_ID ? { ...m, text: m.text + delta } : m
          ))
          break
        }

        // ── стриминг завершён ─────────────────────────────────────────
        case 'done': {
          setMessages(prev => prev.map(m =>
            m.id === STREAMING_ID ? { ...m, id: `msg-${Date.now()}` } : m
          ))
          setIsStreaming(false)
          break
        }

        // ── финальный ответ (если стриминг не использовался) ─────────
        case 'response': {
          const text = String(msg.text ?? '')
          setMessages(prev => {
            // заменяем streaming placeholder или последний assistant
            const idx = prev.findIndex(m => m.id === STREAMING_ID)
            if (idx !== -1) {
              const updated = [...prev]
              updated[idx] = { id: `msg-${Date.now()}`, role: 'assistant', text }
              return updated
            }
            // если streaming placeholder нет — добавляем новое
            return [...prev, { id: `msg-${Date.now()}`, role: 'assistant', text }]
          })
          setIsStreaming(false)
          break
        }

        case 'error': {
          setMessages(prev => {
            // убираем streaming placeholder если был
            const filtered = prev.filter(m => m.id !== STREAMING_ID)
            return [...filtered, {
              id: `err-${Date.now()}`,
              role: 'assistant',
              text: `⚠ ${msg.error ?? 'Ошибка'}`,
            }]
          })
          setIsStreaming(false)
          break
        }
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    if (!input.trim() || isStreaming) return
    const text = input.trim()
    setMessages(prev => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', text },
      { id: STREAMING_ID, role: 'assistant', text: '' },
    ])
    setIsStreaming(true)
    vscode.postMessage({ type: 'send', text })
    setInput('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.messages}>
        {messages.map(m => (
          <div key={m.id} style={
            m.role === 'user'
              ? { ...styles.bubble, ...styles.user, ...(m.source === 'telegram' ? styles.telegramUser : {}) }
              : { ...styles.bubble, ...styles.assistant }
          }>
            {m.source === 'telegram' && (
              <div style={styles.telegramBadge}>📱 Telegram</div>
            )}
            <span style={m.id === STREAMING_ID ? styles.streaming : undefined}>
              {m.text}
              {m.id === STREAMING_ID && <span style={styles.cursor}>▋</span>}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <textarea
          style={{ ...styles.textarea, opacity: isStreaming ? 0.6 : 1 }}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isStreaming ? 'Ожидание ответа...' : 'Напиши сообщение... (Enter — отправить)'}
          rows={3}
          disabled={isStreaming}
        />
        <div style={styles.buttons}>
          <button style={styles.sendButton} onClick={send} disabled={isStreaming}>
            {isStreaming ? '...' : 'Send'}
          </button>
          <button style={styles.iconButton} onClick={openPreview} title="Open Preview">⬡</button>
          <button style={styles.iconButton} onClick={pickElement}  title="Pick Element">⊕</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--vscode-font-size)',
    color: 'var(--vscode-foreground)',
    background: 'var(--vscode-sideBar-background)',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  bubble: {
    borderRadius: 8,
    padding: '6px 10px',
    maxWidth: '82%',
    wordBreak: 'break-word',
    lineHeight: 1.5,
  },
  user: {
    alignSelf: 'flex-end',
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
  },
  assistant: {
    alignSelf: 'flex-start',
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
  },
  telegramUser: {
    background: 'var(--vscode-activityBarBadge-background)',
    color: 'var(--vscode-activityBarBadge-foreground)',
  },
  telegramBadge: {
    fontSize: '10px',
    opacity: 0.7,
    marginBottom: 2,
  },
  streaming: {
    opacity: 0.9,
  },
  cursor: {
    animation: 'none',
    opacity: 0.7,
    marginLeft: 1,
  },
  inputRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 8,
    borderTop: '1px solid var(--vscode-panel-border)',
  },
  textarea: {
    width: '100%',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: 4,
    padding: 6,
    resize: 'none',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    boxSizing: 'border-box',
  },
  buttons: {
    display: 'flex',
    gap: 6,
  },
  sendButton: {
    flex: 1,
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 4,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  iconButton: {
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    border: 'none',
    borderRadius: 4,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 14,
  },
}