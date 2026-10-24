import path from 'path'
import type Database from 'better-sqlite3'
import type { AssetDetail, AssetUsage } from '../../shared/library-types'
import type { VaultPaths } from '../../shared/types'
import { getAsset } from '../board/repo'
import { kindForFile } from '../ingest/importer'
import { isAutoTag } from './tags'

type DB = Database.Database

export const PREVIEW_CHARS = 5000

export function getAssetDetail(db: DB, id: string): AssetDetail | null {
  const asset = getAsset(db, id)
  if (!asset) return null
  const row = db.prepare('SELECT created_at, extracted_text FROM assets WHERE id = ?').get(id) as { created_at: string; extracted_text: string | null }
  const text = row.extracted_text ?? ''
  const tags = (db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(id) as { tag: string }[]).map((r) => ({
    tag: r.tag,
    auto: isAutoTag(r.tag)
  }))
  const rows = db
    .prepare(
      `SELECT c.id AS card_id, b.id AS board_id, b.name AS board_name, p.id AS project_id, p.name AS project_name
       FROM cards c JOIN boards b ON b.id = c.board_id JOIN projects p ON p.id = b.project_id
       WHERE c.asset_id = ? ORDER BY p.rowid, b.rowid, c.rowid`
    )
    .all(id) as { card_id: string; board_id: string; board_name: string; project_id: string; project_name: string }[]
  const usages: AssetUsage[] = []
  for (const r of rows) {
    let u = usages.find((x) => x.boardId === r.board_id)
    if (!u) {
      u = { boardId: r.board_id, boardName: r.board_name, projectId: r.project_id, projectName: r.project_name, cardIds: [] }
      usages.push(u)
    }
    u.cardIds.push(r.card_id)
  }
  return {
    asset,
    jenis: kindForFile(asset.originalName).jenis,
    createdAt: row.created_at,
    tags,
    textPreview: text.slice(0, PREVIEW_CHARS),
    textLength: text.length,
    usages
  }
}

/** Path absolut file aset, hanya bila berada di dalam folder files/ vault (untuk shell.showItemInFolder). */
export function assetFilePath(db: DB, vault: VaultPaths, id: string): string {
  const row = db.prepare('SELECT vault_path FROM assets WHERE id = ?').get(id) as { vault_path: string } | undefined
  if (!row) throw new Error('Aset tidak ditemukan')
  const full = path.resolve(vault.root, row.vault_path)
  const rel = path.relative(vault.files, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Lokasi file aset tidak valid')
  return full
}
