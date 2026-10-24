import { useEffect, useState } from 'react'
import { openBoard } from '../navigation'

interface Entry { boardId: string; projectId: string; label: string }

/** Ctrl+K → "Pindah ke board…": daftar semua board dengan saringan per kata. */
export function BoardPicker(props: { onClose: () => void }): React.JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    void window.alfonso.projects.list().then((ps) =>
      setEntries(ps.flatMap((p) => p.boards.map((b) => ({ boardId: b.id, projectId: p.id, label: `${p.name} › ${b.name}` }))))
    )
  }, [])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter((e) => words.every((w) => e.label.toLowerCase().includes(w)))

  const pick = (e: Entry | undefined): void => {
    if (!e) return
    void openBoard(e.boardId, e.projectId).finally(props.onClose)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(shown[selected])
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={props.onClose}>
      <div className="palette" role="dialog" aria-label="Pindah ke board" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          aria-label="Cari board"
          placeholder="Nama proyek atau board…"
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox">
          {shown.map((e, i) => (
            <li
              key={e.boardId}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'palette-item selected' : 'palette-item'}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(e)}
            >
              {e.label}
            </li>
          ))}
          {entries.length > 0 && shown.length === 0 && <li className="palette-empty">Tidak ada board yang cocok</li>}
        </ul>
      </div>
    </div>
  )
}
