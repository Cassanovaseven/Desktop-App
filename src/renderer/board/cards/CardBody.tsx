import { memo, useState } from 'react'
import type { AssetDTO, CardDTO } from '../../../shared/board-types'

const JENIS_LABEL: Record<CardDTO['type'], string> = {
  catatan: 'Catatan', file: 'File', gambar: 'Gambar', tautan: 'Tautan', kode: 'Kode', grup: 'Arsip'
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AssetStatus({ asset }: { asset: AssetDTO }): React.JSX.Element | null {
  if (asset.status === 'memproses') return <div className="card-status card-status-memproses">Memproses…</div>
  if (asset.status === 'gagal') {
    return (
      <div className="card-status card-status-gagal">
        <div>Gagal ekstrak</div>
        {asset.error && <div className="card-error">{asset.error}</div>}
        <button className="card-retry nodrag" onClick={() => void window.alfonso.ingest.retry(asset.id)}>
          Coba lagi
        </button>
      </div>
    )
  }
  return null
}

const TRANSKRIP_LABEL: Record<NonNullable<AssetDTO['transkrip']>, string> = {
  memproses: 'Mentranskrip…',
  selesai: 'Transkrip siap',
  belum: 'Transkrip belum tersedia. Ctrl+K → Unduh model transkrip…',
  gagal: 'Transkrip gagal'
}

export function formatDuration(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Label jenis untuk kartu file: audio/video dikenali dari MIME.
function kindLabel(card: CardDTO): string {
  const mime = card.asset?.mime ?? ''
  if (card.type === 'file' && mime.startsWith('video/')) return 'Video'
  if (card.type === 'file' && mime.startsWith('audio/')) return 'Audio'
  return JENIS_LABEL[card.type]
}

function NoteBody({ card }: { card: CardDTO }): React.JSX.Element {
  const [text, setText] = useState(card.content ?? '')
  return (
    <textarea
      className="card-note nodrag nowheel"
      aria-label="Isi catatan"
      placeholder="Tulis catatan…"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== (card.content ?? '')) void window.alfonso.board.saveCards([{ id: card.id, content: text }])
      }}
    />
  )
}

export const CardBody = memo(function CardBody({ card }: { card: CardDTO }): React.JSX.Element {
  const asset = card.asset
  if (card.type === 'catatan') return <div className="card card-catatan"><NoteBody card={card} /></div>
  if (card.type === 'tautan') {
    const unduh = card.style as { unduh?: string; pesan?: string } | null
    return (
      <div className="card card-tautan">
        <div className="card-kind">{JENIS_LABEL.tautan}</div>
        {asset && <div className="card-title">{asset.originalName}</div>}
        <div className={asset ? 'card-meta card-url' : 'card-title'}>{card.content}</div>
        {asset && <AssetStatus asset={asset} />}
        {!asset && unduh?.unduh === 'gagal' && <div className="card-status card-status-gagal">Isi tidak bisa diunduh: {unduh.pesan}</div>}
      </div>
    )
  }
  return (
    <div className={`card card-${card.type}`}>
      {(card.type === 'gambar' || asset?.mime?.startsWith('video/')) && asset?.previewUrl && (
        <img className="card-image" src={asset.previewUrl} alt={asset.originalName} draggable={false} />
      )}
      <div className="card-kind">{kindLabel(card)}</div>
      <div className="card-title">{asset?.originalName ?? 'Tanpa nama'}</div>
      {asset && card.type !== 'grup' && <div className="card-meta">{formatSize(asset.sizeBytes)}</div>}
      {typeof asset?.meta?.durasi === 'number' && <div className="card-meta card-durasi">{formatDuration(asset.meta.durasi)}</div>}
      {asset && <AssetStatus asset={asset} />}
      {asset?.transkrip && <div className={`card-status card-transkrip-${asset.transkrip}`}>{TRANSKRIP_LABEL[asset.transkrip]}</div>}
    </div>
  )
})
