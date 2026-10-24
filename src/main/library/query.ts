import type Database from 'better-sqlite3'
import type { LibraryItem, LibraryPage, LibraryQuery } from '../../shared/library-types'
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
