import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import type { AssetStatus, CardDTO, IngestEvent, Point } from '../../shared/board-types'
import type { VaultPaths } from '../../shared/types'
import type { Logger } from '../logger'
import { JobQueue } from '../jobs/queue'
import { importFiles, kindForFile, type ImportOptions } from './importer'
import { cardsForAsset, getAsset, getCard, getOrCreateDefaultBoard, insertCard, DEFAULT_SIZE, MSG_NO_MODEL } from '../board/repo'
import { indexAsset } from '../search'

export interface ExtractResult {
  text: string
  meta: Record<string, unknown>
  thumb: string | null
}

/** Ekstraksi gagal karena isi file (rusak, terenkripsi); mencoba ulang otomatis tidak ada gunanya. */
export class PermanentError extends Error {
  readonly permanent = true
}

export interface IngestServiceOptions {
  db: Database.Database
  vault: VaultPaths
  log: Logger
  extract: (vaultRelPath: string, assetId: string) => Promise<ExtractResult>
  /** Transkrip audio/video; tanpa ini, audio/video tidak ditranskrip. */
  transcribe?: (vaultRelPath: string, assetId: string) => Promise<{ text: string }>
  notify: (e: IngestEvent) => void
  secrets?: () => string[]
  retryDelayMs?: number
}

const URL_RE = /^https?:\/\/\S+$/i

// Folder sementara ZIP dibuat sidecar dengan prefiks ini di folder temp sistem; hanya itu yang boleh dihapus.
function isSidecarTempDir(dir: string): boolean {
  const resolved = path.resolve(dir)
  return path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('alfonso-zip-')
}

export function createIngestService(o: IngestServiceOptions) {
  const { db, vault, log } = o

  // Tag otomatis + tag yang sudah tersimpan (mis. sumber:folder dari impor folder dipantau).
  const tagsFor = (name: string, assetId?: string): string[] => {
    const base = [`jenis:${kindForFile(name).jenis}`, 'jalur:impor']
    if (!assetId) return base
    const saved = (db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ?').all(assetId) as { tag: string }[]).map((r) => r.tag)
    return [...new Set([...base, ...saved])]
  }

  const saveTags = (assetId: string, tags: string[]): void => {
    const stmt = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)')
    for (const tag of tags) stmt.run(assetId, tag)
  }

  async function expandZip(zipAssetId: string, meta: Record<string, unknown>): Promise<CardDTO[]> {
    const entries = (meta.entri as { name: string; path: string }[] | undefined) ?? []
    const tempDir = typeof meta.temp_dir === 'string' ? meta.temp_dir : null
    try {
      const grupId = cardsForAsset(db, zipAssetId)[0]
      const grup = grupId ? getCard(db, grupId) : null
      if (!grup || entries.length === 0) return []
      const pad = 20
      const cards = await importFiles(db, vault, entries.map((e) => e.path), { x: grup.x + pad, y: grup.y + 48 })
      const style = JSON.stringify({ grupId: grup.id })
      const setStyle = db.prepare('UPDATE cards SET style_json = ? WHERE id = ?')
      for (const c of cards) setStyle.run(style, c.id)
      // Bingkai grup diperbesar supaya semua kartu isinya muat.
      const right = Math.max(...cards.map((c) => c.x + c.w)) + pad
      const bottom = Math.max(...cards.map((c) => c.y + c.h)) + pad
      db.prepare('UPDATE cards SET w = MAX(w, ?), h = MAX(h, ?) WHERE id = ?').run(right - grup.x, bottom - grup.y, grup.id)
      return cards.map((c) => getCard(db, c.id)!)
    } finally {
      if (tempDir && isSidecarTempDir(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
      else if (tempDir) log.warn('Folder sementara ZIP di luar folder temp sistem tidak dihapus')
    }
  }

  const assetRow = (assetId: string) =>
    db.prepare('SELECT vault_path, original_name, extracted_text, extract_status FROM assets WHERE id = ?').get(assetId) as
      | { vault_path: string; original_name: string; extracted_text: string | null; extract_status: AssetStatus }
      | undefined

  const isMedia = (name: string): boolean => ['audio', 'video'].includes(kindForFile(name).jenis)

  async function runJob(assetId: string): Promise<void> {
    const row = assetRow(assetId)
    if (!row) throw new PermanentError('Asset tidak ditemukan')
    const result = await o.extract(row.vault_path, assetId)
    const newCards = kindForFile(row.original_name).jenis === 'arsip' ? await expandZip(assetId, result.meta) : []
    const tags = tagsFor(row.original_name, assetId)
    saveTags(assetId, tags)
    indexAsset(db, assetId, result.text, tags, 'siap', result.thumb)
    // Transkrip dijalankan di antrean terpisah (satu per satu) supaya video panjang tidak menahan file lain.
    if (o.transcribe && isMedia(row.original_name)) transcribeQueue.enqueue('transkrip', { assetId })
    o.notify({ asset: getAsset(db, assetId)!, newCards })
  }

  async function runTranscribe(assetId: string): Promise<void> {
    const row = assetRow(assetId)
    if (!row || !o.transcribe) throw new PermanentError('Asset tidak ditemukan')
    const { text } = await o.transcribe(row.vault_path, assetId)
    indexAsset(db, assetId, text, tagsFor(row.original_name, assetId), row.extract_status)
  }

  const queue = new JobQueue({
    db,
    log,
    secrets: o.secrets,
    retryDelayMs: o.retryDelayMs,
    kinds: ['ekstrak'],
    run: async (job) => {
      if (job.kind !== 'ekstrak') throw new PermanentError(`Jenis job tidak dikenal: ${job.kind}`)
      await runJob(String(job.payload.assetId))
    },
    onFinalFailure: (job, message) => {
      const assetId = String(job.payload.assetId)
      const row = db.prepare('SELECT original_name FROM assets WHERE id = ?').get(assetId) as { original_name: string } | undefined
      if (!row) return
      // Nama file tetap bisa dicari walau isinya gagal diekstrak.
      indexAsset(db, assetId, '', tagsFor(row.original_name, assetId), 'gagal')
      log.warn(`Ekstraksi ${row.original_name} gagal: ${message}`)
      o.notify({ asset: getAsset(db, assetId)!, newCards: [] })
    }
  })

  const notifyAsset = (assetId: string): void => {
    const asset = getAsset(db, assetId)
    if (asset) o.notify({ asset, newCards: [] })
  }

  const transcribeQueue = new JobQueue({
    db,
    log,
    secrets: o.secrets,
    retryDelayMs: o.retryDelayMs,
    kinds: ['transkrip'],
    concurrency: 1,
    maxAttempts: 2,
    run: async (job) => {
      const assetId = String(job.payload.assetId)
      notifyAsset(assetId)
      await runTranscribe(assetId)
    },
    onDone: (job) => notifyAsset(String(job.payload.assetId)),
    onFinalFailure: (job, message) => {
      if (message !== MSG_NO_MODEL) log.warn(`Transkrip gagal: ${message}`)
      notifyAsset(String(job.payload.assetId))
    }
  })

  return {
    queue,
    transcribeQueue,
    /** Setelah model diunduh: jalankan lagi transkrip yang tertunda karena model belum ada. */
    requeueTranscripts(): number {
      const rows = db
        .prepare(
          `SELECT DISTINCT json_extract(j.payload_json, '$.assetId') AS id FROM jobs j
           WHERE j.kind = 'transkrip' AND j.status = 'gagal' AND j.last_error = ?
             AND NOT EXISTS (SELECT 1 FROM jobs k WHERE k.kind = 'transkrip' AND k.status != 'gagal'
                             AND json_extract(k.payload_json, '$.assetId') = json_extract(j.payload_json, '$.assetId'))`
        )
        .all(MSG_NO_MODEL) as { id: string }[]
      for (const r of rows) transcribeQueue.enqueue('transkrip', { assetId: r.id })
      return rows.length
    },
    async importPaths(paths: string[], at: Point, opts?: ImportOptions): Promise<CardDTO[]> {
      const cards = await importFiles(db, vault, paths, at, opts)
      // Semua sumber impor (drop, isi ZIP, nanti folder dipantau) memberi tahu Board lewat event yang sama.
      for (const c of cards) if (c.asset) o.notify({ asset: c.asset, newCards: [c] })
      queue.kick()
      return cards
    },
    async pasteText(text: string, at: Point): Promise<CardDTO> {
      const board = getOrCreateDefaultBoard(db)
      const trimmed = text.trim()
      if (URL_RE.test(trimmed)) return insertCard(db, { boardId: board.id, type: 'tautan', x: at.x, y: at.y, content: trimmed })
      return insertCard(db, { boardId: board.id, type: 'catatan', x: at.x, y: at.y, content: text, ...DEFAULT_SIZE.catatan })
    },
    async retry(assetId: string): Promise<void> {
      if (!getAsset(db, assetId)) throw new Error('Asset tidak ditemukan')
      db.prepare("UPDATE assets SET extract_status = 'memproses' WHERE id = ?").run(assetId)
      o.notify({ asset: getAsset(db, assetId)!, newCards: [] })
      queue.enqueue('ekstrak', { assetId })
    }
  }
}

export type IngestService = ReturnType<typeof createIngestService>
