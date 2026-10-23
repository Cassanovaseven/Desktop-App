import crypto from 'crypto'
import type Database from 'better-sqlite3'
import type {
  AssetDTO, AssetStatus, BoardDTO, CardDTO, CardPatch, CardType, LinkDTO, TranscriptStatus, Viewport
} from '../../shared/board-types'

type DB = Database.Database

export const newId = (): string => crypto.randomUUID()
const now = (): string => new Date().toISOString()

export const DEFAULT_SIZE: Record<CardType, { w: number; h: number }> = {
  catatan: { w: 240, h: 160 },
  file: { w: 240, h: 120 },
  gambar: { w: 240, h: 200 },
  tautan: { w: 280, h: 100 },
  kode: { w: 320, h: 200 },
  grup: { w: 600, h: 400 }
}

export interface BoardRow { id: string; name: string; viewport: Viewport | null }

export function getOrCreateDefaultBoard(db: DB): BoardRow {
  const row = db.prepare('SELECT id, name, viewport_json FROM boards ORDER BY rowid LIMIT 1').get() as
    | { id: string; name: string; viewport_json: string | null }
    | undefined
  if (row) return { id: row.id, name: row.name, viewport: row.viewport_json ? JSON.parse(row.viewport_json) : null }
  const projectId = newId()
  const boardId = newId()
  db.transaction(() => {
    db.prepare('INSERT INTO projects (id, name, icon, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)').run(projectId, 'Proyek Pertama', now(), now())
    db.prepare('INSERT INTO boards (id, project_id, name, viewport_json, background) VALUES (?, ?, ?, NULL, NULL)').run(boardId, projectId, 'Board Utama')
  })()
  return { id: boardId, name: 'Board Utama', viewport: null }
}

// ---- Asset ----

interface AssetRow {
  id: string; vault_path: string; original_name: string; mime: string | null; size_bytes: number | null
  thumb_path: string | null; extract_status: AssetStatus; meta_json: string | null
}

export function vaultUrl(relPath: string): string {
  return 'alfonso-vault://' + relPath.split(/[\\/]/).map(encodeURIComponent).join('/')
}

function lastError(db: DB, assetId: string): string | null {
  const r = db
    .prepare("SELECT last_error FROM jobs WHERE kind = 'ekstrak' AND json_extract(payload_json, '$.assetId') = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1")
    .get(assetId) as { last_error: string | null } | undefined
  return r?.last_error ?? null
}

/** Pesan sidecar (409) bila model Whisper belum ada; transkrip lalu ditandai 'belum', bukan 'gagal'. */
export const MSG_NO_MODEL = 'Model transkrip belum diunduh'

function transcriptStatus(db: DB, assetId: string): TranscriptStatus | null {
  const r = db
    .prepare("SELECT status, last_error FROM jobs WHERE kind = 'transkrip' AND json_extract(payload_json, '$.assetId') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(assetId) as { status: string; last_error: string | null } | undefined
  if (!r) return null
  if (r.status === 'selesai') return 'selesai'
  if (r.status === 'gagal') return r.last_error === MSG_NO_MODEL ? 'belum' : 'gagal'
  return 'memproses'
}

// Format yang bisa ditampilkan browser langsung, sebelum thumbnail jadi.
const BROWSER_IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])

function assetToDTO(db: DB, r: AssetRow): AssetDTO {
  const previewUrl = r.thumb_path ? vaultUrl(r.thumb_path) : r.mime && BROWSER_IMAGE.has(r.mime) ? vaultUrl(r.vault_path) : null
  return {
    id: r.id,
    originalName: r.original_name,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    status: r.extract_status,
    previewUrl,
    error: r.extract_status === 'gagal' ? lastError(db, r.id) : null,
    transkrip: transcriptStatus(db, r.id),
    meta: r.meta_json ? JSON.parse(r.meta_json) : null
  }
}

export function getAsset(db: DB, id: string): AssetDTO | null {
  const r = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
  return r ? assetToDTO(db, r) : null
}

export function findAssetBySha(db: DB, sha256: string): { id: string; vaultPath: string } | null {
  const r = db.prepare('SELECT id, vault_path FROM assets WHERE sha256 = ?').get(sha256) as { id: string; vault_path: string } | undefined
  return r ? { id: r.id, vaultPath: r.vault_path } : null
}

export function insertAsset(
  db: DB,
  a: { sha256: string; vaultPath: string; originalName: string; mime: string | null; sizeBytes: number }
): AssetDTO {
  const id = newId()
  db.prepare(
    "INSERT INTO assets (id, sha256, vault_path, original_name, mime, size_bytes, extracted_text, thumb_path, extract_status, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'memproses', ?)"
  ).run(id, a.sha256, a.vaultPath, a.originalName, a.mime, a.sizeBytes, now())
  return getAsset(db, id)!
}

// ---- Card ----

interface CardRow {
  id: string; board_id: string; type: CardType; x: number; y: number; w: number; h: number; z: number
  asset_id: string | null; content: string | null; style_json: string | null
}

function cardToDTO(db: DB, r: CardRow): CardDTO {
  return {
    id: r.id, boardId: r.board_id, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z,
    assetId: r.asset_id, content: r.content,
    style: r.style_json ? JSON.parse(r.style_json) : null,
    asset: r.asset_id ? getAsset(db, r.asset_id) : null
  }
}

export interface NewCard {
  boardId: string; type: CardType; x: number; y: number
  w?: number; h?: number; z?: number; assetId?: string | null; content?: string | null; style?: Record<string, unknown> | null
}

export function insertCard(db: DB, c: NewCard): CardDTO {
  const id = newId()
  const size = DEFAULT_SIZE[c.type]
  db.prepare('INSERT INTO cards (id, board_id, type, x, y, w, h, z, asset_id, content, style_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, c.boardId, c.type, c.x, c.y, c.w ?? size.w, c.h ?? size.h, c.z ?? 0,
    c.assetId ?? null, c.content ?? null, c.style ? JSON.stringify(c.style) : null
  )
  return getCard(db, id)!
}

export function getCard(db: DB, id: string): CardDTO | null {
  const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined
  return r ? cardToDTO(db, r) : null
}

export function cardsForAsset(db: DB, assetId: string): string[] {
  return (db.prepare('SELECT id FROM cards WHERE asset_id = ?').all(assetId) as { id: string }[]).map((r) => r.id)
}

const PATCH_FIELDS = ['x', 'y', 'w', 'h', 'z', 'content'] as const

export function saveCards(db: DB, patches: CardPatch[]): void {
  const stmts = new Map<string, Database.Statement>()
  db.transaction(() => {
    for (const p of patches) {
      const fields = PATCH_FIELDS.filter((f) => p[f] !== undefined)
      if (fields.length === 0) continue
      const key = fields.join(',')
      let stmt = stmts.get(key)
      if (!stmt) {
        stmt = db.prepare(`UPDATE cards SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
        stmts.set(key, stmt)
      }
      stmt.run(...fields.map((f) => p[f]), p.id)
    }
  })()
}

// Hanya kartu dan link-nya; asset dan file di vault tidak pernah dihapus.
export function deleteCards(db: DB, ids: string[]): void {
  const delLinks = db.prepare('DELETE FROM links WHERE from_card_id = ? OR to_card_id = ?')
  const delCard = db.prepare('DELETE FROM cards WHERE id = ?')
  db.transaction(() => {
    for (const id of ids) {
      delLinks.run(id, id)
      delCard.run(id)
    }
  })()
}

// ---- Link ----

export function createLink(db: DB, fromId: string, toId: string, kind = 'panah'): LinkDTO {
  const id = newId()
  db.prepare('INSERT INTO links (id, from_card_id, to_card_id, kind) VALUES (?, ?, ?, ?)').run(id, fromId, toId, kind)
  return { id, fromId, toId, kind }
}

export function deleteLink(db: DB, id: string): void {
  db.prepare('DELETE FROM links WHERE id = ?').run(id)
}

// ---- Board ----

export function saveViewport(db: DB, v: Viewport): void {
  const board = getOrCreateDefaultBoard(db)
  db.prepare('UPDATE boards SET viewport_json = ? WHERE id = ?').run(JSON.stringify({ x: v.x, y: v.y, zoom: v.zoom }), board.id)
}

export function loadBoard(db: DB): BoardDTO {
  const board = getOrCreateDefaultBoard(db)
  const cards = (db.prepare('SELECT * FROM cards WHERE board_id = ? ORDER BY z, rowid').all(board.id) as CardRow[]).map((r) => cardToDTO(db, r))
  const links = (
    db
      .prepare('SELECT l.id, l.from_card_id, l.to_card_id, l.kind FROM links l JOIN cards c ON c.id = l.from_card_id WHERE c.board_id = ? ORDER BY l.rowid')
      .all(board.id) as { id: string; from_card_id: string; to_card_id: string; kind: string }[]
  ).map((r) => ({ id: r.id, fromId: r.from_card_id, toId: r.to_card_id, kind: r.kind }))
  return { id: board.id, name: board.name, viewport: board.viewport, cards, links }
}
