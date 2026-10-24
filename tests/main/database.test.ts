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

test('semua tabel ada dan versi skema terbaru (3)', () => {
  const db = open(dbPath)
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r: any) => r.name)
  for (const n of ['projects','boards','assets','asset_tags','cards','links','prompts','generations','jobs','settings','assets_fts']) expect(t).toContain(n)
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  expect(db.prepare('SELECT name FROM pragma_table_info(?)').all('assets').map((r: any) => r.name)).toContain('meta_json')
})
test('database versi 1 dimigrasi ke versi terbaru tanpa kehilangan data', () => {
  // Database Fase 1A: skema asli tanpa meta_json.
  const Database = require('better-sqlite3')
  const old = new Database(dbPath)
  old.exec(require('fs').readFileSync(require('path').join(__dirname, '../../src/main/db/schema.sql'), 'utf8'))
  old.exec('PRAGMA user_version = 1')
  old.prepare("INSERT INTO assets (id, sha256, vault_path, original_name, extract_status, created_at) VALUES ('a1','s','files/x','x.pdf','siap','t')").run()
  old.close()
  const db = open(dbPath)
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  expect(db.prepare('SELECT original_name, meta_json FROM assets').get()).toEqual({ original_name: 'x.pdf', meta_json: null })
  db.close()
  expect(open(dbPath).pragma('user_version', { simple: true })).toBe(3)
})
const cols = (db: Database.Database, t: string): string[] => db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map((r: any) => r.name)
test('migrasi v3: kolom prompt dan generation baru, data v2 tetap utuh', () => {
  const Database = require('better-sqlite3')
  const old = new Database(dbPath)
  old.exec(require('fs').readFileSync(require('path').join(__dirname, '../../src/main/db/schema.sql'), 'utf8'))
  old.exec('ALTER TABLE assets ADD COLUMN meta_json TEXT')
  old.exec('PRAGMA user_version = 2')
  old.prepare("INSERT INTO prompts (id, name, lane, template) VALUES ('p1','Ikon','cloud','App icon [SIMBOL]')").run()
  old.prepare("INSERT INTO generations (id, prompt_id, lane, status, created_at) VALUES ('g1','p1','cloud','selesai','t')").run()
  old.close()
  const db = open(dbPath)
  expect(db.pragma('user_version', { simple: true })).toBe(3)
  expect(cols(db, 'prompts')).toEqual(expect.arrayContaining(['params_json', 'created_at']))
  expect(cols(db, 'generations')).toEqual(expect.arrayContaining(['prompt_text', 'source', 'external_id', 'error', 'updated_at']))
  expect(db.prepare('SELECT name, template, version FROM prompts').get()).toEqual({ name: 'Ikon', template: 'App icon [SIMBOL]', version: 1 })
  expect(db.prepare('SELECT prompt_id, status, error FROM generations').get()).toEqual({ prompt_id: 'p1', status: 'selesai', error: null })
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
