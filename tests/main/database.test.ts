import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import { openDatabase, getSetting, setSetting } from '../../src/main/db/database'

let tmp: string
let dbPath: string
const opened: Database.Database[] = []
const open = (p: string): Database.Database => { const db = openDatabase(p); opened.push(db); return db }

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-db-')); dbPath = path.join(tmp, 'alfonso.db') })
afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('semua tabel ada dan versi skema 1', () => {
  const db = open(dbPath)
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r: any) => r.name)
  for (const n of ['projects','boards','assets','asset_tags','cards','links','prompts','generations','jobs','settings','assets_fts']) expect(t).toContain(n)
  expect(db.pragma('user_version', { simple: true })).toBe(1)
})
test('WAL dan foreign key aktif', () => {
  const db = open(dbPath)
  expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  expect(() => db.prepare("INSERT INTO boards VALUES ('b1','tidak-ada','x',NULL,NULL)").run()).toThrow()
})
test('membuka ulang tidak menghapus data', () => {
  let db = open(dbPath); setSetting(db, 'theme.active', 'alfonso-terang'); db.close()
  db = open(dbPath); expect(getSetting(db, 'theme.active')).toBe('alfonso-terang')
})
test('pencarian FTS5 bekerja', () => {
  const db = open(dbPath)
  db.prepare('INSERT INTO assets_fts VALUES (?,?,?,?)').run('a1', 'laporan.pdf', 'riset', 'pertanggungjawaban pidana')
  expect(db.prepare("SELECT asset_id FROM assets_fts WHERE assets_fts MATCH 'pidana'").get()).toEqual({ asset_id: 'a1' })
})
test('getSetting untuk kunci tak ada = null', () => { expect(getSetting(open(dbPath), 'tidak.ada')).toBeNull() })
