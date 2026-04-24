import React from 'react'
import { Session } from '../types'
import { styles } from '../styles'

interface Props {
  sessions: Session[]
  activeSessionId: string
  busySessionId: string | null
  onSwitch: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
}

export default function SessionTabs({ sessions, activeSessionId, busySessionId, onSwitch, onNew, onClose }: Props) {
  return (
    <div style={styles.sessionBar}>
      {sessions.map(s => {
        const isActive = s.id === activeSessionId
        const isBusy = s.id === busySessionId
        return (
          <button
            key={s.id}
            style={isActive ? { ...styles.sessionTab, ...styles.sessionTabActive } : styles.sessionTab}
            onClick={() => onSwitch(s.id)}
            title={s.name}
          >
            {isBusy && <span style={{ fontSize: 8, opacity: 0.7 }}>●</span>}
            {s.name}
            {sessions.length > 1 && (
              <span
                style={styles.sessionTabClose}
                onClick={e => { e.stopPropagation(); onClose(s.id) }}
                title="Close"
              >×</span>
            )}
          </button>
        )
      })}
      <button style={styles.sessionTabAdd} onClick={onNew} title="New session">＋</button>
    </div>
  )
}
