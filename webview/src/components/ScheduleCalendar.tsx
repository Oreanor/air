import React, { useState } from 'react'
import { ScheduledTaskInfo } from '../types'
import { I18n } from '../i18n'

interface Props {
  tasks: ScheduledTaskInfo[]
  onCancel: (id: string) => void
  t: I18n
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstWeekday(year: number, month: number) {
  return (new Date(year, month, 1).getDay() + 6) % 7 // Mon=0
}

export default function ScheduleCalendar({ tasks, onCancel, t }: Props) {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [sel, setSel]     = useState<number>(today.getDate())

  const daysInMonth = getDaysInMonth(year, month)
  const firstWd     = getFirstWeekday(year, month)

  const monthTasks = tasks.filter(tk => {
    const d = new Date(tk.scheduledAt)
    return d.getFullYear() === year && d.getMonth() === month
  })

  // days with at least one pending task → blue dot; only completed → grey dot
  const pendingDays = new Set(
    monthTasks.filter(tk => !tk.completedAt).map(tk => new Date(tk.scheduledAt).getDate())
  )
  const completedDays = new Set(
    monthTasks.filter(tk => tk.completedAt).map(tk => new Date(tk.scheduledAt).getDate())
  )

  const selTasks = monthTasks
    .filter(tk => new Date(tk.scheduledAt).getDate() === sel)
    .sort((a, b) => a.scheduledAt - b.scheduledAt)

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else { setMonth(m => m - 1) }; setSel(0) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else { setMonth(m => m + 1) }; setSel(0) }

  const monthLabel = new Date(year, month, 1).toLocaleString([], { month: 'long', year: 'numeric' })
  const isToday = (d: number) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  const cells: Array<number | null> = [...Array(firstWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button style={s.nav} onClick={prevMonth}>‹</button>
        <span style={s.monthLabel}>{monthLabel}</span>
        <button style={s.nav} onClick={nextMonth}>›</button>
      </div>

      <div style={s.grid}>
        {t.calendarWeekdays.map(w => <div key={w} style={s.wd}>{w}</div>)}
        {cells.map((d, i) => d === null ? <div key={`e${i}`} /> : (
          <div
            key={d}
            onClick={() => setSel(d)}
            style={{
              ...s.day,
              ...(isToday(d) ? s.today : {}),
              ...(d === sel ? s.selected : {}),
            }}
          >
            {d}
            {pendingDays.has(d) && <span style={s.dot} />}
            {!pendingDays.has(d) && completedDays.has(d) && <span style={s.dotDone} />}
          </div>
        ))}
      </div>

      <div style={s.list}>
        {selTasks.length === 0
          ? <div style={s.empty}>{t.calendarNoTasks}</div>
          : selTasks.map(tk => {
              const time    = new Date(tk.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const preview = tk.text.length > 55 ? tk.text.slice(0, 55) + '…' : tk.text
              const done    = !!tk.completedAt
              const doneTime = done
                ? new Date(tk.completedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : null
              return (
                <div key={tk.id} style={{ ...s.task, ...(done ? s.taskDone : {}) }}>
                  <span style={s.taskTime}>{time}</span>
                  <span style={{ ...s.taskText, ...(done ? s.taskTextDone : {}) }}>
                    {done && <span style={s.check}>✓</span>}
                    {preview}
                  </span>
                  {done
                    ? <span style={s.doneTime}>{doneTime}</span>
                    : <button style={s.taskCancel} onClick={() => onCancel(tk.id)} title="Отменить">✕</button>
                  }
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 6px 4px',
    borderTop: '1px solid var(--vscode-panel-border)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nav: {
    background: 'none',
    border: 'none',
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 6px',
    opacity: 0.7,
    lineHeight: 1,
  },
  monthLabel: {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.8,
    textTransform: 'capitalize',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 2,
  },
  wd: {
    textAlign: 'center',
    fontSize: 9,
    opacity: 0.4,
    padding: '1px 0',
    userSelect: 'none',
  },
  day: {
    position: 'relative',
    textAlign: 'center',
    fontSize: 11,
    padding: '3px 0',
    borderRadius: 3,
    cursor: 'pointer',
    userSelect: 'none',
    lineHeight: 1.4,
  },
  today: {
    color: '#0ea5e9',
    fontWeight: 700,
  },
  selected: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
  },
  dot: {
    position: 'absolute',
    bottom: 1,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#0ea5e9',
    display: 'block',
  },
  dotDone: {
    position: 'absolute',
    bottom: 1,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.25)',
    display: 'block',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minHeight: 20,
  },
  empty: {
    fontSize: 10,
    opacity: 0.4,
    textAlign: 'center',
    padding: '2px 0',
  },
  task: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    padding: '3px 4px',
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
    borderRadius: 3,
  },
  taskDone: {
    opacity: 0.55,
  },
  taskTime: {
    flexShrink: 0,
    opacity: 0.6,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
  },
  taskText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.85,
  },
  taskTextDone: {
    textDecoration: 'line-through',
  },
  check: {
    color: '#4ade80',
    marginRight: 3,
    fontWeight: 700,
  },
  doneTime: {
    flexShrink: 0,
    fontSize: 9,
    opacity: 0.5,
    fontVariantNumeric: 'tabular-nums',
  },
  taskCancel: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    fontSize: 10,
    padding: '0 2px',
    lineHeight: 1,
  },
}
