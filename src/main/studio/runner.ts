import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import type { IngestEvent } from '../../shared/board-types'
import type { VaultPaths } from '../../shared/types'
import type { GenerateRequest, GenerationDTO, StudioEvent } from '../../shared/studio-types'
import type { Logger } from '../logger'
import { JobQueue } from '../jobs/queue'
import type { JobRow } from '../jobs/store'
import { PermanentError } from '../ingest/service'
import { getActiveBoard, getBoardRow, getCard } from '../board/repo'
import type { AdapterResult } from './adapters/code'
import {
  createGenerations, genJobKind, getExternalId, getGeneration, markFailed, markQueued, markRunning, setExternalId, type GenJobPayload
} from './generations'
import { saveResultAsset } from './results'

type DB = Database.Database

/** Higgsfield menolak kunci (401/403). Permanen, dan tombol generate cloud dimatikan sampai kunci diganti. */
export class KeyRejectedError extends PermanentError {}

export interface AdapterContext {
  /** Path relatif vault gambar kartu sumber (referensi), bila ada. */
  referencePath: string | null
}

/** Adapter dua langkah (spec 6, alur asinkron): id permintaan disimpan sebelum menunggu, supaya coba ulang tidak mengirim ulang. */
export interface RemoteAdapter {
  submit(g: GenerationDTO, ctx: AdapterContext): Promise<string>
  wait(g: GenerationDTO, externalId: string): Promise<AdapterResult>
}

export interface StudioRunnerOptions {
  db: DB
  vault: VaultPaths
  log: Logger
  kode: { run(g: GenerationDTO, ctx: AdapterContext): Promise<AdapterResult> }
  cloud: RemoteAdapter
  lokal: RemoteAdapter
  notify: (e: StudioEvent) => void
  /** Kartu/panah baru untuk Board (lewat saluran ingest:event yang sama dengan impor). */
  notifyBoard: (e: IngestEvent) => void
  onKeyRejected?: () => void
  /** Dipanggil setelah aset hasil dibuat (job ekstraksi thumbnail sudah antre). */
  afterSave?: () => void
  secrets?: () => string[]
  retryDelayMs?: number
}

function isOwnTempDir(dir: string): boolean {
  const resolved = path.resolve(dir)
  return path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('alfonso-gen-')
}

export function createStudioRunner(o: StudioRunnerOptions) {
  const { db, vault, log } = o

  const emit = (id: string, extra: Omit<StudioEvent, 'generation'> = {}): void => {
    const generation = getGeneration(db, id)
    if (generation) o.notify({ generation, ...extra })
  }

  const referenceOf = (g: GenerationDTO): string | null => {
    const card = g.sourceCardId ? getCard(db, g.sourceCardId) : null
    if (!card?.assetId || !card.asset?.mime?.startsWith('image/')) return null
    const r = db.prepare('SELECT vault_path FROM assets WHERE id = ?').get(card.assetId) as { vault_path: string } | undefined
    return r?.vault_path ?? null
  }

  async function runJob(job: JobRow): Promise<void> {
    const p = job.payload as unknown as GenJobPayload
    const g = getGeneration(db, p.generationId)
    if (!g) throw new PermanentError('Riwayat generate tidak ditemukan.')
    if (g.status === 'selesai') return
    markRunning(db, g.id)
    emit(g.id)
    const ctx: AdapterContext = { referencePath: referenceOf(g) }
    let out: AdapterResult
    if (g.lane === 'kode') {
      out = await o.kode.run(g, ctx)
    } else {
      const adapter = g.lane === 'cloud' ? o.cloud : o.lokal
      let ext = getExternalId(db, g.id)
      if (!ext) {
        ext = await adapter.submit(g, ctx)
        setExternalId(db, g.id, ext)
      }
      out = await adapter.wait(g, ext)
    }
    try {
      // Board asal sudah dihapus? Hasil tetap disimpan, kartunya di board aktif.
      const boardId = getBoardRow(db, p.boardId) ? p.boardId : getActiveBoard(db).id
      const saved = await saveResultAsset(db, vault, { generationId: g.id, boardId, at: p.at, file: out.file, ext: out.ext })
      o.afterSave?.()
      o.notifyBoard({ asset: saved.asset, newCards: [saved.card], newLinks: saved.link ? [saved.link] : [] })
      emit(g.id, { card: saved.card, link: saved.link })
    } finally {
      if (isOwnTempDir(out.tempDir)) await fs.promises.rm(out.tempDir, { recursive: true, force: true })
      else log.warn('Folder hasil sementara di luar folder temp sistem tidak dihapus')
    }
  }

  const common = {
    db,
    log,
    secrets: o.secrets,
    retryDelayMs: o.retryDelayMs ?? 3000,
    // 1 percobaan + coba ulang otomatis maksimal 2 kali dengan jeda bertambah (spec 7).
    maxAttempts: 3,
    run: async (job: JobRow) => {
      try {
        await runJob(job)
      } catch (err) {
        if (err instanceof KeyRejectedError) o.onKeyRejected?.()
        throw err
      }
    },
    onFinalFailure: (job: JobRow, message: string) => {
      const id = String(job.payload.generationId)
      markFailed(db, id, message)
      emit(id)
    }
  }
  // Jalur kode satu per satu (satu jendela render); cloud/lokal menunggu server lain, jadi boleh bersamaan.
  const codeQueue = new JobQueue({ ...common, kinds: [genJobKind('kode')], concurrency: 1 })
  const remoteQueue = new JobQueue({ ...common, kinds: [genJobKind('cloud'), genJobKind('lokal')], concurrency: 3 })
  const queues = [codeQueue, remoteQueue]

  const kick = (): void => {
    for (const q of queues) q.kick()
  }

  const boardFor = (req: GenerateRequest): string => {
    const card = req.sourceCardId ? getCard(db, req.sourceCardId) : null
    return card?.boardId ?? getActiveBoard(db).id
  }

  return {
    start(): void {
      for (const q of queues) q.start()
    },
    async stop(): Promise<void> {
      await Promise.all(queues.map((q) => q.stop()))
    },
    generate(req: GenerateRequest, ctx?: { boardId?: string }): GenerationDTO[] {
      const gens = createGenerations(db, req, { boardId: ctx?.boardId ?? boardFor(req) })
      for (const g of gens) o.notify({ generation: g })
      kick()
      return gens
    },
    /** Coba ulang manual dari Studio. Cloud: biaya dikonfirmasi lagi, dan permintaan lama tidak dipakai (bisa jadi sudah gagal di server). */
    retry(id: string, confirmedCost: boolean): GenerationDTO {
      const g = getGeneration(db, id)
      if (!g) throw new Error('Riwayat generate tidak ditemukan.')
      if (g.status !== 'gagal') throw new Error('Hanya generate yang gagal yang bisa dicoba ulang.')
      if (g.lane === 'cloud' && !confirmedCost) throw new Error('Generate cloud harus dikonfirmasi setelah melihat perkiraan biaya.')
      const last = db
        .prepare("SELECT payload_json FROM jobs WHERE kind LIKE 'generate:%' AND json_extract(payload_json, '$.generationId') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(id) as { payload_json: string } | undefined
      const prev = last ? (JSON.parse(last.payload_json) as GenJobPayload) : null
      const payload: GenJobPayload = { generationId: id, boardId: prev?.boardId ?? getActiveBoard(db).id, at: prev?.at ?? null }
      setExternalId(db, id, null)
      markQueued(db, id)
      const queue = g.lane === 'kode' ? codeQueue : remoteQueue
      queue.enqueue(genJobKind(g.lane), payload as unknown as Record<string, unknown>)
      emit(id)
      return getGeneration(db, id)!
    }
  }
}

export type StudioRunner = ReturnType<typeof createStudioRunner>
