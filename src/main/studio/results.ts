import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { AssetDTO, CardDTO, LinkDTO, Point } from '../../shared/board-types'
import type { VaultPaths } from '../../shared/types'
import { DEFAULT_SIZE, createLink, findAssetBySha, getAsset, getBoardRow, getCard, insertAsset, insertCard } from '../board/repo'
import { sha256File } from '../ingest/hash'
import { kindForFile } from '../ingest/importer'
import { insertJob } from '../jobs/store'
import { refreshFts } from '../library/tags'
import { getGeneration, markDone } from './generations'
import { generatedFileName, yearMonth } from './naming'

type DB = Database.Database

export interface SaveResultInput {
  generationId: string
  boardId: string
  at: Point | null
  /** File hasil sementara (di luar vault); disalin, bukan dipindah. */
  file: string
  ext: string
  date?: Date
}

export interface SavedResult { asset: AssetDTO; card: CardDTO; link: LinkDTO | null }

const GAP = 60

function placement(db: DB, boardId: string, sourceCardId: string | null, at: Point | null, h: number): Point {
  const src = sourceCardId ? getCard(db, sourceCardId) : null
  if (src && src.boardId === boardId) {
    const k = (db.prepare("SELECT COUNT(*) AS n FROM links WHERE from_card_id = ? AND kind = 'hasil'").get(src.id) as { n: number }).n
    return { x: src.x + src.w + GAP, y: src.y + k * (h + 20) }
  }
  // Tanpa posisi: perkiraan tengah layar dari viewport React Flow yang tersimpan (x/y = geseran layar, bukan koordinat kanvas).
  const v = getBoardRow(db, boardId)?.viewport ?? { x: 0, y: 0, zoom: 1 }
  const p = at ?? { x: Math.round((-v.x + 300) / v.zoom), y: Math.round((-v.y + 200) / v.zoom) }
  // Beberapa hasil di titik yang sama disusun ke bawah, bukan ditumpuk persis.
  const taken = db.prepare('SELECT 1 FROM cards WHERE board_id = ? AND x = ? AND y = ?')
  let y = p.y
  for (let i = 0; i < 50 && taken.get(boardId, p.x, y); i++) y += h + 20
  return { x: p.x, y }
}

/**
 * Menyimpan hasil generate sebagai aset baru di `generated/YYYY-MM/` (spec 9.1–9.3), membuat kartunya di board asal
 * (di sebelah kartu sumber, dengan panah `hasil`), dan menandai Generation selesai. Hasil yang identik memakai aset lama.
 */
export async function saveResultAsset(db: DB, vault: VaultPaths, input: SaveResultInput): Promise<SavedResult> {
  const g = getGeneration(db, input.generationId)
  if (!g) throw new Error('Riwayat generate tidak ditemukan.')
  const board = getBoardRow(db, input.boardId)
  if (!board) throw new Error('Board tujuan tidak ditemukan.')
  const date = input.date ?? new Date()
  const ext = input.ext.toLowerCase().replace(/^\./, '')
  const kind = kindForFile(`x.${ext}`)
  const sha = await sha256File(input.file)

  let assetId = findAssetBySha(db, sha)?.id ?? null
  if (!assetId) {
    const project = (db.prepare('SELECT name FROM projects WHERE id = ?').get(board.projectId) as { name: string } | undefined)?.name ?? 'alfonso'
    const relDir = path.posix.join('generated', yearMonth(date))
    const dir = path.join(vault.root, relDir)
    await fs.promises.mkdir(dir, { recursive: true })
    const name = generatedFileName(dir, {
      project, jenis: kind.jenis === 'video' ? 'motion' : kind.jenis, subject: g.promptName ?? 'generate', lane: g.lane, date, ext
    })
    await fs.promises.copyFile(input.file, path.join(dir, name), fs.constants.COPYFILE_EXCL)
    const size = (await fs.promises.stat(input.file)).size
    assetId = db.transaction(() => {
      const asset = insertAsset(db, { sha256: sha, vaultPath: path.posix.join(relDir, name), originalName: name, mime: kind.mime, sizeBytes: size })
      const tag = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)')
      for (const t of [`jenis:${kind.jenis}`, `jalur:${g.lane}`, `sumber:${g.source ?? 'manual'}`, 'status:draf']) tag.run(asset.id, t)
      refreshFts(db, asset.id)
      insertJob(db, 'ekstrak', { assetId: asset.id })
      return asset.id
    })()
  }

  const type = kind.tipeKartu === 'gambar' ? 'gambar' : 'file'
  const h = type === 'gambar' || kind.jenis === 'video' ? DEFAULT_SIZE.gambar.h : DEFAULT_SIZE.file.h
  return db.transaction(() => {
    const pos = placement(db, board.id, g.sourceCardId, input.at, h)
    const card = insertCard(db, { boardId: board.id, type, x: pos.x, y: pos.y, h, assetId })
    const src = g.sourceCardId ? getCard(db, g.sourceCardId) : null
    const link = src && src.boardId === board.id ? createLink(db, src.id, card.id, 'hasil') : null
    markDone(db, g.id, assetId!)
    return { asset: getAsset(db, assetId!)!, card: getCard(db, card.id)!, link }
  })()
}
