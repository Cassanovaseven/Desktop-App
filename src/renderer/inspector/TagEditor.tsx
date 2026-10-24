import { useState } from 'react'

// Kelompok tag dari spec 9.3 sebagai saran; tag bebas tanpa kelompok juga boleh.
const SUGGESTIONS = ['status:draf', 'status:pilihan', 'status:final', 'status:arsip', 'proyek:', 'gaya:', 'sumber:manual']

export function TagEditor(props: {
  tags: { tag: string; auto: boolean }[]
  onAdd: (tag: string) => Promise<void>
  onRemove: (tag: string) => Promise<void>
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  return (
    <div className="tag-editor">
      <ul className="tag-list">
        {props.tags.map((t) => (
          <li key={t.tag} className={t.auto ? 'chip chip-tag auto' : 'chip chip-tag'} title={t.auto ? 'Tag otomatis' : undefined}>
            <span>{t.tag}</span>
            {!t.auto && (
              <button type="button" aria-label={`Hapus tag ${t.tag}`} onClick={() => void run(() => props.onRemove(t.tag))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <input
        aria-label="Tambah tag"
        placeholder="Tambah tag, mis. status:final"
        list="alfonso-tag-saran"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const tag = value
          void run(() => props.onAdd(tag)).then((ok) => ok && setValue(''))
        }}
      />
      <datalist id="alfonso-tag-saran">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
