import { useEffect, useState } from 'react'
import { filterCommands, type Command } from './commands'

export function CommandPalette(props: { commands: Command[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setSelected(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  const results = filterCommands(props.commands, query)
  const close = (): void => setOpen(false)

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = results[selected]
      close()
      if (cmd) void cmd.run()
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          aria-label="Cari perintah"
          placeholder="Ketik perintah…"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox">
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'palette-item selected' : 'palette-item'}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                close()
                void c.run()
              }}
            >
              {c.label}
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">Tidak ada perintah yang cocok</li>}
        </ul>
      </div>
    </div>
  )
}
