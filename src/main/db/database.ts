import Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

// Migrasi berurutan: indeks i menaikkan versi i+1 → i+2. Hanya menambah, tidak pernah menghapus data.
const MIGRATIONS = [
  // v2 (2026-10-23, disetujui Cassanova): metadata hasil ekstraksi per asset (durasi, ukuran, warna).
  'ALTER TABLE assets ADD COLUMN meta_json TEXT'
]
export const SCHEMA_VERSION = 1 + MIGRATIONS.length

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL', { simple: true })
  db.pragma('foreign_keys = ON')
  if (db.pragma('user_version', { simple: true }) === 0) {
    db.transaction(() => {
      db.exec(schemaSql)
      db.exec('PRAGMA user_version = 1')
    })()
  }
  let version = db.pragma('user_version', { simple: true }) as number
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONS[version - 1]
    db.transaction(() => {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })()
    version++
  }
  return db
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
