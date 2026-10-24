import type { GenerationDTO } from '../../shared/studio-types'
import { workspace } from '../workspace'
import { COMFY_OFF, STATUS_LABEL } from './params'

export function GenerationList(props: {
  items: GenerationDTO[]
  onRetry(g: GenerationDTO): void
  onSwitchToCloud(g: GenerationDTO): void
}): React.JSX.Element {
  if (props.items.length === 0) return <p className="inspector-muted">Belum ada riwayat generate.</p>
  return (
    <ul className="studio-generations" aria-label="Riwayat generate">
      {props.items.map((g) => (
        <li key={g.id} className={`studio-gen studio-gen-${g.status}`}>
          <div className="studio-gen-head">
            <span className="studio-gen-name">{`${g.promptName ?? 'Prompt'} · v${g.promptVersion ?? 1}`}</span>
            <span className={`studio-badge ${g.status}`}>{STATUS_LABEL[g.status]}</span>
          </div>
          <div className="inspector-muted">
            {[g.source, g.model, g.lane === 'cloud' && g.creditCost !== null ? `${g.creditCost} kredit` : null, typeof g.params.seed === 'number' ? `seed ${g.params.seed}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {g.error && <div className="card-error">{g.error}</div>}
          <div className="studio-actions">
            {g.resultAssetId && (
              <button type="button" onClick={() => workspace.select({ kind: 'asset', assetId: g.resultAssetId! })}>
                Lihat hasil
              </button>
            )}
            {g.status === 'gagal' && (
              <button type="button" onClick={() => props.onRetry(g)}>
                Coba ulang
              </button>
            )}
            {g.status === 'gagal' && g.lane === 'lokal' && g.error?.includes(COMFY_OFF) && (
              <button type="button" onClick={() => props.onSwitchToCloud(g)}>
                Pindah ke cloud
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Memasukkan / mengganti satu generation di daftar (terbaru di atas). */
export function upsertGeneration(list: GenerationDTO[], g: GenerationDTO, max = 50): GenerationDTO[] {
  const i = list.findIndex((x) => x.id === g.id)
  if (i >= 0) return list.map((x) => (x.id === g.id ? g : x))
  return [g, ...list].slice(0, max)
}
