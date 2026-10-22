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
    return (
      <div className="card card-tautan">
        <div className="card-kind">{JENIS_LABEL.tautan}</div>
        <div className="card-title">{card.content}</div>
      </div>
    )
  }
  return (
    <div className={`card card-${card.type}`}>
      {card.type === 'gambar' && asset?.previewUrl && (
        <img className="card-image" src={asset.previewUrl} alt={asset.originalName} draggable={false} />
      )}
      <div className="card-kind">{JENIS_LABEL[card.type]}</div>
      <div className="card-title">{asset?.originalName ?? 'Tanpa nama'}</div>
      {asset && card.type !== 'grup' && <div className="card-meta">{formatSize(asset.sizeBytes)}</div>}
      {asset && <AssetStatus asset={asset} />}
    </div>
  )
})
