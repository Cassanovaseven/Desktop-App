import Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

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
  return db
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
