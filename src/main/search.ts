import type Database from 'better-sqlite3'
import type { AssetStatus, SearchHit } from '../shared/board-types'

// Setiap kata dibungkus kutip ganda (kutip di dalamnya digandakan), jadi sintaks FTS5 di input pengguna tidak ditafsirkan.
export function toFtsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(' ')
}

/**
 * Baris FTS memakai rowid yang sama dengan baris `assets`, jadi bisa dihapus/diganti lewat rowid
 * tanpa memindai seluruh indeks (kolom asset_id UNINDEXED tidak punya indeks).
 */
export function writeFtsRow(db: Database.Database, assetId: string, name: string, tags: string, text: string): void {
  const r = db.prepare('SELECT rowid AS r FROM assets WHERE id = ?').get(assetId) as { r: number } | undefined
  if (!r) return
  db.prepare('DELETE FROM assets_fts WHERE rowid = ?').run(r.r)
  db.prepare('INSERT INTO assets_fts (rowid, asset_id, original_name, tags, extracted_text) VALUES (?, ?, ?, ?, ?)').run(r.r, assetId, name, tags, text)
}

/** Sekali saat aplikasi dibuka: baris FTS dari Fase 1 (rowid acak) dipindah ke rowid asetnya; baris tanpa aset dibuang. */
export function alignFtsRowids(db: Database.Database): number {
  const rows = db
    .prepare('SELECT f.rowid AS fr, f.asset_id, f.original_name, f.tags, f.extracted_text, a.rowid AS ar FROM assets_fts f LEFT JOIN assets a ON a.id = f.asset_id WHERE a.rowid IS NULL OR a.rowid != f.rowid')
    .all() as { fr: number; asset_id: string; original_name: string; tags: string; extracted_text: string; ar: number | null }[]
  if (rows.length === 0) return 0
  let moved = 0
  db.transaction(() => {
    const del = db.prepare('DELETE FROM assets_fts WHERE rowid = ?')
    for (const r of rows) del.run(r.fr)
    for (const r of rows) {
      if (r.ar === null) continue
      writeFtsRow(db, r.asset_id, r.original_name, r.tags, r.extracted_text)
      moved++
    }
  })()
  return moved
}

export function indexAsset(db: Database.Database, assetId: string, text: string, tags: string[], status: AssetStatus, thumbPath: string | null = null): void {
  db.transaction(() => {
    db.prepare('UPDATE assets SET extracted_text = ?, extract_status = ?, thumb_path = COALESCE(?, thumb_path) WHERE id = ?').run(text, status, thumbPath, assetId)
    const { original_name } = db.prepare('SELECT original_name FROM assets WHERE id = ?').get(assetId) as { original_name: string }
    writeFtsRow(db, assetId, original_name, tags.join(' '), text)
  })()
}

export function searchAssets(db: Database.Database, q: string, limit = 50): SearchHit[] {
  const match = toFtsQuery(q)
  if (!match) return []
  const rows = db
    .prepare(
      "SELECT asset_id, original_name, snippet(assets_fts, -1, '', '', '…', 12) AS snippet FROM assets_fts WHERE assets_fts MATCH ? ORDER BY rank LIMIT ?"
    )
    .all(match, limit) as { asset_id: string; original_name: string; snippet: string }[]
  const cardsStmt = db.prepare('SELECT id FROM cards WHERE asset_id = ? ORDER BY rowid')
  return rows.map((r) => ({
    assetId: r.asset_id,
    originalName: r.original_name,
    snippet: r.snippet,
    cardIds: (cardsStmt.all(r.asset_id) as { id: string }[]).map((c) => c.id)
  }))
}
