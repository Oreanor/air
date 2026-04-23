import React from 'react'
import { styles } from '../styles'

interface Props {
  workspaceRoot: string | null
  npmScripts: string[]
  selectedScript: string
  onScriptChange: (script: string) => void
  onRun: () => void
}

export default function NpmPanel({ workspaceRoot, npmScripts, selectedScript, onScriptChange, onRun }: Props) {
  const baseStyle = { ...styles.toolRow, borderTop: '1px solid var(--vscode-panel-border)', paddingTop: 6 }
  const rowStyle = !workspaceRoot ? { ...baseStyle, opacity: 0.4 } : baseStyle

  return (
    <div style={rowStyle}>
      <span style={styles.rowLabel}>npm run</span>
      <select
        value={selectedScript}
        onChange={e => onScriptChange(e.target.value)}
        style={styles.promptSelect}
        disabled={!workspaceRoot}
        title="npm"
      >
        <option value="install">install</option>
        {npmScripts.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <button
        style={styles.runButton}
        disabled={!workspaceRoot}
        onClick={onRun}
        title={`npm ${selectedScript === 'install' ? 'install' : `run ${selectedScript}`}`}
      >▶</button>
    </div>
  )
}
