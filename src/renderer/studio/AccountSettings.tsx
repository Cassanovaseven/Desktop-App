import { useState } from 'react'
import type { StudioSettings } from '../../shared/studio-types'

const KEY_LABEL = { belum: 'Belum diatur', tersimpan: 'Tersimpan (terenkripsi)', ditolak: 'Ditolak Higgsfield — perlu kunci baru' } as const

export function AccountSettings(props: { settings: StudioSettings; onChange(s: StudioSettings): void }): React.JSX.Element {
  const api = window.alfonso.studio
  const s = props.settings
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [comfy, setComfy] = useState(s.comfyUrl)
  const [comfyState, setComfyState] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [credits, setCredits] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<StudioSettings>): Promise<void> => {
    setError(null)
    try {
      props.onChange(await fn())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="studio-account" aria-label="Akun & biaya">
      <h3>Higgsfield</h3>
      <p>
        Status kunci: <strong>{KEY_LABEL[s.higgsfield]}</strong>
      </p>
      <p className="inspector-muted">API key dan secret dari cloud.higgsfield.ai. Disimpan terenkripsi oleh Windows dan tidak pernah ditampilkan lagi.</p>
      <div className="studio-row">
        <input aria-label="API key Higgsfield" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API key" />
        <input aria-label="Secret Higgsfield" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret" />
        <button
          type="button"
          disabled={!key.trim() || !secret.trim()}
          onClick={() =>
            void run(async () => {
              const r = await api.saveKey(key, secret)
              setKey('')
              setSecret('')
              return r
            })
          }
        >
          Simpan kunci
        </button>
        {s.higgsfield !== 'belum' && (
          <button type="button" onClick={() => void run(() => api.clearKey())}>
            Hapus kunci
          </button>
        )}
      </div>

      <h3>ComfyUI lokal</h3>
      <div className="studio-row">
        <input aria-label="Alamat ComfyUI" value={comfy} onChange={(e) => setComfy(e.target.value)} />
        <button type="button" onClick={() => void run(() => api.setComfyUrl(comfy))}>
          Simpan alamat
        </button>
        <button type="button" onClick={() => void api.comfyStatus().then((ok) => setComfyState(ok ? 'ComfyUI berjalan.' : 'ComfyUI tidak menjawab.'))}>
          Cek
        </button>
      </div>
      {comfyState && <p role="status">{comfyState}</p>}

      <h3>Biaya per generate</h3>
      <p className="inspector-muted">Isi kredit per hasil untuk tiap model Higgsfield. Angka ini dipakai untuk perkiraan di dialog konfirmasi.</p>
      <ul className="studio-costs">
        {Object.entries(s.costs).map(([m, c]) => (
          <li key={m}>
            <span>{m}</span>
            <span>{`${c} kredit`}</span>
            <button type="button" aria-label={`Hapus harga ${m}`} onClick={() => void run(() => api.setCost(m, null))}>
              Hapus
            </button>
          </li>
        ))}
      </ul>
      <div className="studio-row">
        <input aria-label="Model untuk harga" value={model} onChange={(e) => setModel(e.target.value)} placeholder="bytedance/seedream/v4/text-to-image" />
        <input aria-label="Kredit per hasil" value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="decimal" placeholder="kredit" />
        <button
          type="button"
          disabled={!model.trim() || credits.trim() === ''}
          onClick={() =>
            void run(async () => {
              const r = await api.setCost(model.trim(), Number(credits.replace(',', '.')))
              setModel('')
              setCredits('')
              return r
            })
          }
        >
          Simpan harga
        </button>
      </div>
      {error && <div className="panel-error" role="alert">{error}</div>}
    </section>
  )
}
