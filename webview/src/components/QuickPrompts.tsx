import React, { useState, useEffect } from 'react'
import { ModelOption, FolderItem } from '../types'
import { I18n } from '../i18n'
import { styles } from '../styles'

interface QuickPrompt {
  key: string
  label: string
  text: string
}

interface Props {
  models: ModelOption[]
  selectedModel: string
  onModelChange: (id: string) => void
  scopeFolders: FolderItem[]
  selectedScope: string
  onScopeChange: (scope: string) => void
  activeFile: string | null
  quickPrompts: QuickPrompt[]
  selectedPrompt: string
  onPromptChange: (key: string) => void
  isStreaming: boolean
  onSendQuickPrompt: () => void
  onSchedulePrompt: (scheduledAt: string) => void
  onOpenPreview: () => void
  onNewChat: () => void
  newPromptMode: boolean
  onSaveNewPrompt: (label: string, text: string) => void
  onCancelNewPrompt: () => void
  t: I18n
}

export default function QuickPrompts({
  models, selectedModel, onModelChange,
  scopeFolders, selectedScope, onScopeChange, activeFile,
  quickPrompts, selectedPrompt, onPromptChange,
  isStreaming, onSendQuickPrompt, onSchedulePrompt, onOpenPreview, onNewChat,
  newPromptMode, onSaveNewPrompt, onCancelNewPrompt, t,
}: Props) {
  const [newLabel, setNewLabel] = useState('')
  const [newText, setNewText] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'action' | 'task'>('action')
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 3_600_000)
    return d.toISOString().slice(0, 16)
  })

  useEffect(() => {
    if (newPromptMode) {
      setNewLabel('')
      setNewText(t.newPromptBoilerplate)
    }
  }, [newPromptMode, t.newPromptBoilerplate])

  const handleSave = () => {
    const label = newLabel.trim()
    const text = newText.trim()
    if (!label || !text) return
    onSaveNewPrompt(label, text)
  }

  return (
    <>
      {/* Строка 1: превью, модель, очистить */}
      <div style={styles.toolRow}>
        <button style={styles.previewButton} onClick={onOpenPreview} title={t.btnPreview}>⬡</button>

        {models.length > 0 && (
          <>
            <span style={styles.rowLabel}>{t.modelLabel}</span>
            <select
              value={selectedModel}
              onChange={e => onModelChange(e.target.value)}
              style={styles.promptSelect}
            >
              <option value="auto">{t.modelAuto}</option>
              <optgroup label="Gemini">
                {models.filter(m => m.provider === 'gemini').map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="Groq">
                {models.filter(m => m.provider === 'groq').map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </>
        )}

        <button style={styles.iconButton} onClick={onNewChat}>{t.btnClear}</button>
      </div>

      {/* Строка 2: действие — либо выбор, либо форма нового */}
      {!newPromptMode ? (
        <div style={styles.toolRow}>
          <span style={styles.rowLabel}>{t.quickActionLabel}</span>

          <select
            value={selectedPrompt}
            onChange={e => onPromptChange(e.target.value)}
            style={styles.promptSelect}
            disabled={isStreaming}
            title={t.quickPromptTooltip}
          >
            {quickPrompts.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
            <option value="__new__">{t.newPromptOption}</option>
          </select>

          <span style={styles.rowLabel}>{t.quickActionWith}</span>

          <select
            value={selectedScope}
            onChange={e => onScopeChange(e.target.value)}
            style={styles.promptSelect}
            title="scope"
          >
            <option value="file">
              📄 {activeFile ? activeFile.split('/').pop() : t.scopeLabelFile}
            </option>
            {scopeFolders.map(f => (
              <option key={f.path} value={`folder:${f.path}`}>
                {' '.repeat(f.depth * 3)}📁 {f.name}
              </option>
            ))}
            <option value="project">🗂 {t.scopeLabelProject}</option>
          </select>

          <select
            value={scheduleMode}
            onChange={e => setScheduleMode(e.target.value as 'action' | 'task')}
            style={styles.scheduleSelect}
            disabled={isStreaming}
          >
            <option value="action">{t.modeAction}</option>
            <option value="task">{t.modeTask}</option>
          </select>

          {scheduleMode === 'task' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={styles.scheduleDatetime}
            />
          )}

          <button
            style={isStreaming ? { ...styles.quickRunButton, opacity: 0.5, cursor: 'not-allowed' } : styles.quickRunButton}
            onClick={() => scheduleMode === 'action' ? onSendQuickPrompt() : onSchedulePrompt(scheduledAt)}
            disabled={isStreaming || (scheduleMode === 'task' && !scheduledAt)}
            title={t.quickPromptTooltip}
          >＋</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={styles.toolRow}>
            <input
              autoFocus
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancelNewPrompt() }}
              placeholder={t.newPromptLabelPlaceholder}
              style={styles.newPromptInput}
            />
            <button
              style={newLabel.trim() && newText.trim() ? styles.branchConfirm : { ...styles.branchConfirm, opacity: 0.45, cursor: 'not-allowed' }}
              onClick={handleSave}
              disabled={!newLabel.trim() || !newText.trim()}
              title={t.newPromptSave}
            >{t.newPromptSave}</button>
            <button style={styles.branchCancel} onClick={onCancelNewPrompt} title={t.newPromptCancel}>{t.newPromptCancel}</button>
          </div>
          <textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            style={styles.newPromptTextarea}
            rows={4}
          />
        </div>
      )}
    </>
  )
}
