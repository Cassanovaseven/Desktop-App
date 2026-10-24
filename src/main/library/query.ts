import type Database from 'better-sqlite3'
import type { AssetStatus } from '../../shared/board-types'
import { JENIS, type Jenis, type LibraryItem, type LibraryPage, type LibraryQuery } from '../../shared/library-types'
import { getAsset } from '../board/repo'
import { kindForFile } from '../ingest/importer'
import { toFtsQuery } from '../search'

type DB = Database.Database

export const MAX_LIMIT = 500

const ORDER: Record<NonNullable<LibraryQuery['sort']>, string> = {
  terbaru: 'a.created_at DESC, a.rowid DESC',
  terlama: 'a.created_at ASC, a.rowid ASC',
  nama: 'a.original_name COLLATE NOCASE ASC, a.rowid ASC',
  ukuran: 'a.size_bytes DESC, a.rowid DESC'
}

const placeholders = (n: number): string => Array(n).fill('?').join(', ')

// Semua nilai filter masuk lewat parameter `?`; yang disambung ke SQL hanya potongan tetap di atas.
export function listAssets(db: DB, query: LibraryQuery): LibraryPage {
  const where: string[] = []
  const params: unknown[] = []
  const match = query.q ? toFtsQuery(query.q) : ''
  let from = 'assets a'
  let snippetCol = 'NULL'
  if (match) {
    from = `assets a JOIN (SELECT asset_id, rank, snippet(assets_fts, -1, '', '', '…', 12) AS snippet FROM assets_fts WHERE assets_fts MATCH ?) f ON f.asset_id = a.id`
    params.push(match)
    snippetCol = 'f.snippet'
  }
  if (query.jenis?.length) {
    where.push(`EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag IN (${placeholders(query.jenis.length)}))`)
    params.push(...query.jenis.map((j) => `jenis:${j}`))
  }
  if (query.status?.length) {
    where.push(`a.extract_status IN (${placeholders(query.status.length)})`)
    params.push(...query.status)
  }
  for (const tag of query.tags ?? []) {
    where.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)')
    params.push(tag)
  }
  if (query.scope === 'proyek') {
    if (!query.projectId) throw new Error('Proyek belum dipilih')
    where.push('a.id IN (SELECT c.asset_id FROM cards c JOIN boards b ON b.id = c.board_id WHERE b.project_id = ? AND c.asset_id IS NOT NULL)')
    params.push(query.projectId)
  } else if (query.scope === 'belum-dipakai') {
    where.push('a.id NOT IN (SELECT asset_id FROM cards WHERE asset_id IS NOT NULL)')
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const order = match && !query.sort ? 'f.rank, a.rowid' : ORDER[query.sort ?? 'terbaru']
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), MAX_LIMIT)
  const offset = Math.max(Math.floor(query.offset ?? 0), 0)

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${whereSql}`).get(...params) as { n: number }).n
  const rows = db
    .prepare(`SELECT a.id, a.original_name, a.created_at, ${snippetCol} AS snippet FROM ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as { id: string; original_name: string; created_at: string; snippet: string | null }[]
  const items = rows.map(
    (r): LibraryItem => ({ asset: getAsset(db, r.id)!, jenis: kindForFile(r.original_name).jenis, createdAt: r.created_at, snippet: r.snippet })
  )
  return { items, total }
}

const SCOPES = ['semua', 'proyek', 'belum-dipakai']
const SORTS = Object.keys(ORDER)
const STATUSES = ['memproses', 'siap', 'gagal']
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 200) : [])

/** Validasi kueri dari renderer: nilai yang tidak dikenal dibuang, tipe yang salah ditolak. */
export function parseLibraryQuery(v: unknown): LibraryQuery {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Kueri Library tidak valid')
  const o = v as Record<string, unknown>
  const out: LibraryQuery = {}
  if (o.q !== undefined) {
    if (typeof o.q !== 'string' || o.q.length > 1000) throw new Error('Kata kunci tidak valid')
    out.q = o.q
  }
  const jenis = strings(o.jenis).filter((j): j is Jenis => (JENIS as string[]).includes(j))
  if (jenis.length) out.jenis = jenis
  const status = strings(o.status).filter((s): s is AssetStatus => STATUSES.includes(s))
  if (status.length) out.status = status
  const tags = strings(o.tags)
  if (tags.length) out.tags = tags
  if (typeof o.scope === 'string' && SCOPES.includes(o.scope)) out.scope = o.scope as LibraryQuery['scope']
  if (typeof o.projectId === 'string') out.projectId = o.projectId
  if (typeof o.sort === 'string' && SORTS.includes(o.sort)) out.sort = o.sort as LibraryQuery['sort']
  if (Number.isInteger(o.offset) && (o.offset as number) >= 0) out.offset = o.offset as number
  if (Number.isInteger(o.limit) && (o.limit as number) > 0) out.limit = o.limit as number
  return out
}
