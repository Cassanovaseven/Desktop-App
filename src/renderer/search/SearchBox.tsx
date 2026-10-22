import { useEffect, useState } from 'react'
import type { SearchHit } from '../../shared/board-types'

export function SearchBox(props: {
  query: (q: string) => Promise<SearchHit[]>
  onPick: (cardId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { query } = props
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!q.trim()) {
      setHits(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      query(q).then((h) => {
        if (!cancelled) {
          setHits(h)
          setSelected(0)
        }
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, query])

  const pick = (h: SearchHit | undefined): void => {
    if (!h) return
    if (h.cardIds[0]) props.onPick(h.cardIds[0])
    props.onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, (hits?.length ?? 1) - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(hits?.[selected])
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={props.onClose}>
      <div className="palette" role="dialog" aria-label="Pencarian isi file" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          aria-label="Cari isi file"
          placeholder="Cari kata di dalam file…"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox">
          {hits?.map((h, i) => (
            <li
              key={h.assetId}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'palette-item selected' : 'palette-item'}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(h)}
            >
              <div>{h.originalName}</div>
              {h.snippet && <div className="search-snippet">{h.snippet}</div>}
            </li>
          ))}
          {hits && hits.length === 0 && <li className="palette-empty">Tidak ada file yang cocok</li>}
        </ul>
      </div>
    </div>
  )
}
