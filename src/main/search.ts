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

export function indexAsset(db: Database.Database, assetId: string, text: string, tags: string[], status: AssetStatus, thumbPath: string | null = null): void {
  db.transaction(() => {
    db.prepare('UPDATE assets SET extracted_text = ?, extract_status = ?, thumb_path = COALESCE(?, thumb_path) WHERE id = ?').run(text, status, thumbPath, assetId)
    const { original_name } = db.prepare('SELECT original_name FROM assets WHERE id = ?').get(assetId) as { original_name: string }
    db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').run(assetId)
    db.prepare('INSERT INTO assets_fts (asset_id, original_name, tags, extracted_text) VALUES (?, ?, ?, ?)').run(assetId, original_name, tags.join(' '), text)
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
