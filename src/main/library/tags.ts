import type Database from 'better-sqlite3'
import type { TagCount } from '../../shared/library-types'
import { kindForFile } from '../ingest/importer'
import { writeFtsRow } from '../search'

type DB = Database.Database

/** Kelompok tag yang dibuat otomatis saat impor/ekstraksi; dibuat ulang saat ekstraksi ulang, jadi tidak bisa dihapus. */
export const AUTO_TAG_GROUPS = ['jenis', 'jalur']
export const MAX_TAG = 64

export const isAutoTag = (tag: string): boolean => AUTO_TAG_GROUPS.includes(tag.split(':')[0])

export function autoTagsFor(originalName: string): string[] {
  return [`jenis:${kindForFile(originalName).jenis}`, 'jalur:impor']
}

export function normalizeTag(raw: string): string {
  const tag = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s*:\s*/g, ':')
    .replace(/\s+/g, '-')
  if (!tag || tag.length > MAX_TAG) throw new Error(`Tag harus diisi, maksimal ${MAX_TAG} karakter.`)
  return tag
}

/** Menulis ulang baris FTS aset dari tabel assets + asset_tags (nama, tag, dan teks ekstraksi yang sudah ada). */
export function refreshFts(db: DB, assetId: string): void {
  const row = db.prepare('SELECT original_name, extracted_text FROM assets WHERE id = ?').get(assetId) as
    | { original_name: string; extracted_text: string | null }
    | undefined
  if (!row) return
  const tags = (db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(assetId) as { tag: string }[]).map((r) => r.tag)
  writeFtsRow(db, assetId, row.original_name, tags.join(' '), row.extracted_text ?? '')
}

export function addTag(db: DB, assetId: string, raw: string): string {
  const tag = normalizeTag(raw)
  if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) throw new Error('Aset tidak ditemukan')
  db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)').run(assetId, tag)
  refreshFts(db, assetId)
  return tag
}

export function removeTag(db: DB, assetId: string, tag: string): void {
  if (isAutoTag(tag)) throw new Error('Tag otomatis tidak bisa dihapus.')
  db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag = ?').run(assetId, tag)
  refreshFts(db, assetId)
}

export function listTags(db: DB): TagCount[] {
  return db.prepare('SELECT tag, COUNT(*) AS count FROM asset_tags GROUP BY tag ORDER BY tag').all() as TagCount[]
}

/** Aset dari Fase 1 yang ekstraksinya gagal belum punya tag jenis/jalur; dilengkapi saat aplikasi dibuka. */
export function ensureAutoTags(db: DB): number {
  const rows = db
    .prepare("SELECT id, original_name FROM assets a WHERE NOT EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag LIKE 'jenis:%')")
    .all() as { id: string; original_name: string }[]
  const ins = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)')
  db.transaction(() => {
    for (const r of rows) {
      for (const tag of autoTagsFor(r.original_name)) ins.run(r.id, tag)
      refreshFts(db, r.id)
    }
  })()
  return rows.length
}
