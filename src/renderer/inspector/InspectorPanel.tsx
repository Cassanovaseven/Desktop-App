import { useCallback, useEffect, useState } from 'react'
import type { AssetDetail } from '../../shared/library-types'
import { useWorkspace, workspace } from '../workspace'
import { goToCard } from '../navigation'
import { boardController } from '../board/Board'
import { JENIS_LABEL } from '../library/LibraryPanel'
import { formatDuration, TRANSKRIP_LABEL } from '../board/cards/CardBody'
import { TagEditor } from './TagEditor'

const CARD_LABEL: Record<string, string> = { catatan: 'Catatan', tautan: 'Tautan', kode: 'Kode', grup: 'Grup', file: 'File', gambar: 'Gambar' }
const num = (n: number, digits = 0): string => n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${num(bytes / 1024, 1)} KB`
  if (bytes < 1024 ** 3) return `${num(bytes / 1024 ** 2, 1)} MB`
  return `${num(bytes / 1024 ** 3, 1)} GB`
}

const formatDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function AssetView(props: { assetId: string }): React.JSX.Element {
  const api = window.alfonso
  const { assetId } = props
  const libraryVersion = useWorkspace((s) => s.libraryVersion)
  const [detail, setDetail] = useState<AssetDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => api.library.detail(assetId).then(setDetail, (e: Error) => setError(e.message)), [api, assetId])
  useEffect(() => {
    void reload()
  }, [reload, libraryVersion])
  useEffect(() => api.ingest.onEvent((e) => e.asset?.id === assetId && void reload()), [api, assetId, reload])

  if (error) return <div className="panel-error" role="alert">{error}</div>
  if (detail === undefined) return <div className="panel-placeholder">Memuat…</div>
  if (detail === null) return <div className="panel-placeholder">Aset tidak ditemukan.</div>

  const { asset } = detail
  const meta = asset.meta ?? {}
  const changed = async (): Promise<void> => {
    await reload()
    workspace.bumpLibrary()
  }

  return (
    <div className="inspector-asset">
      {asset.previewUrl && <img className="inspector-preview" src={asset.previewUrl} alt={asset.originalName} />}
      <h2 className="inspector-title">{asset.originalName}</h2>
      <dl className="inspector-facts">
        <dt>Jenis</dt>
        <dd>{JENIS_LABEL[detail.jenis]}</dd>
        <dt>Ukuran</dt>
        <dd>{formatBytes(asset.sizeBytes)}</dd>
        {typeof meta.durasi === 'number' && (
          <>
            <dt>Durasi</dt>
            <dd>{formatDuration(meta.durasi)}</dd>
          </>
        )}
        {typeof meta.lebar === 'number' && typeof meta.tinggi === 'number' && (
          <>
            <dt>Dimensi</dt>
            <dd>{`${meta.lebar} × ${meta.tinggi}`}</dd>
          </>
        )}
        <dt>Diimpor</dt>
        <dd>{formatDate(detail.createdAt)}</dd>
      </dl>
      {asset.status === 'memproses' && <div className="library-status">Memproses…</div>}
      {asset.status === 'gagal' && (
        <div className="inspector-failed">
          <div>Gagal ekstrak</div>
          {asset.error && <div className="card-error">{asset.error}</div>}
          <button type="button" onClick={() => void api.ingest.retry(asset.id)}>
            Coba lagi
          </button>
        </div>
      )}
      {asset.transkrip && <div className="card-meta">{TRANSKRIP_LABEL[asset.transkrip]}</div>}
      <div className="inspector-actions">
        <button type="button" onClick={() => boardController.addAsset(asset.id)}>
          Tambahkan ke Board
        </button>
        <button type="button" onClick={() => void api.library.showInFolder(asset.id).catch((e: Error) => setError(e.message))}>
          Tampilkan di folder
        </button>
      </div>

      <h3>Tag</h3>
      <TagEditor
        tags={detail.tags}
        onAdd={async (tag) => {
          await api.library.addTag(asset.id, tag)
          await changed()
        }}
        onRemove={async (tag) => {
          await api.library.removeTag(asset.id, tag)
          await changed()
        }}
      />

      <h3>Dipakai di</h3>
      {detail.usages.length === 0 ? (
        <p className="inspector-muted">Belum dipakai di board mana pun.</p>
      ) : (
        <ul className="inspector-usages">
          {detail.usages.map((u) => (
            <li key={u.boardId}>
              <button type="button" onClick={() => void goToCard(u.cardIds[0], { boardId: u.boardId, projectId: u.projectId })}>
                {`${u.projectName} › ${u.boardName}`}
                {u.cardIds.length > 1 && <span className="inspector-muted">{` · ${u.cardIds.length} kartu`}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail.textLength > 0 && (
        <>
          <h3>Isi</h3>
          {detail.textLength > detail.textPreview.length && (
            <p className="inspector-muted">{`Cuplikan ${num(detail.textPreview.length)} dari ${num(detail.textLength)} karakter`}</p>
          )}
          <pre className="inspector-text">{detail.textPreview}</pre>
        </>
      )}
    </div>
  )
}

export function InspectorPanel(): React.JSX.Element {
  const selection = useWorkspace((s) => s.selection)
  return (
    <div className="inspector-panel">
      {selection === null && <div className="panel-placeholder">Pilih kartu atau aset untuk melihat detailnya.</div>}
      {selection?.kind === 'cards' && <div className="panel-placeholder">{`${selection.count} kartu dipilih`}</div>}
      {selection?.kind === 'card' && (
        <div className="inspector-card">
          <div className="inspector-muted">{CARD_LABEL[selection.type] ?? selection.type}</div>
          <pre className="inspector-text">{selection.content || '(kosong)'}</pre>
        </div>
      )}
      {selection?.kind === 'asset' && <AssetView key={selection.assetId} assetId={selection.assetId} />}
    </div>
  )
}
