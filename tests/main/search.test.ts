import { test, expect, beforeEach, afterEach } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { searchAssets, indexAsset, toFtsQuery } from '../../src/main/search'
import { getOrCreateDefaultBoard, insertAsset, insertCard } from '../../src/main/board/repo'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

function asset(name: string, text: string, status: 'siap' | 'gagal' = 'siap') {
  const board = getOrCreateDefaultBoard(t.db)
  const a = insertAsset(t.db, { sha256: name.padEnd(64, '0'), vaultPath: `files/aa/${name}`, originalName: name, mime: null, sizeBytes: 1 })
  const c = insertCard(t.db, { boardId: board.id, type: 'file', x: 0, y: 0, assetId: a.id })
  indexAsset(t.db, a.id, text, ['jenis:dokumen', 'jalur:impor'], status)
  return { asset: a, card: c }
}

test('kata di isi file ditemukan beserta kartu dan cuplikan', () => {
  const { asset: a, card } = asset('laporan.pdf', 'Analisis pertanggungjawaban pidana korporasi')
  asset('lain.txt', 'resep masakan')
  const hits = searchAssets(t.db, 'pidana')
  expect(hits).toHaveLength(1)
  expect(hits[0]).toMatchObject({ assetId: a.id, cardIds: [card.id], originalName: 'laporan.pdf' })
  expect(hits[0].snippet).toContain('pidana')
})
test('indexAsset menyimpan teks dan status di assets', () => {
  const { asset: a } = asset('x.md', 'isi')
  expect(t.db.prepare('SELECT extracted_text, extract_status FROM assets WHERE id = ?').get(a.id)).toEqual({ extracted_text: 'isi', extract_status: 'siap' })
})
test('mengindeks ulang tidak menggandakan baris FTS', () => {
  const { asset: a } = asset('y.md', 'versi satu')
  indexAsset(t.db, a.id, 'versi dua', [], 'siap')
  expect(searchAssets(t.db, 'versi')).toHaveLength(1)
  expect(searchAssets(t.db, 'satu')).toHaveLength(0)
})
test('query kosong → []', () => { expect(searchAssets(t.db, '   ')).toEqual([]) })
test('karakter khusus FTS5 tidak melempar error', () => {
  asset('z.md', 'kata biasa')
  for (const q of ['"', 'a"b', '-x', 'kolom:nilai', '*', 'AND OR NOT', '(kurung']) expect(() => searchAssets(t.db, q)).not.toThrow()
  expect(toFtsQuery('tema "terang" -x')).toBe('"tema" """terang""" "-x"')
})
test('nama file juga dicari', () => {
  asset('Anggaran 2026.xlsx', 'angka')
  expect(searchAssets(t.db, 'anggaran')).toHaveLength(1)
})

test('Fase 2: baris FTS memakai rowid aset (hapus/ganti tanpa memindai seluruh indeks)', async () => {
  const { insertAsset } = await import('../../src/main/board/repo')
  const { alignFtsRowids } = await import('../../src/main/search')
  const a = insertAsset(t.db, { sha256: '1'.repeat(64), vaultPath: 'files/11/a.txt', originalName: 'a.txt', mime: 'text/plain', sizeBytes: 1 })
  indexAsset(t.db, a.id, 'satu', [], 'siap')
  indexAsset(t.db, a.id, 'dua', [], 'siap')
  const assetRowid = (t.db.prepare('SELECT rowid AS r FROM assets WHERE id = ?').get(a.id) as { r: number }).r
  expect(t.db.prepare('SELECT rowid AS r, extracted_text FROM assets_fts').all()).toEqual([{ r: assetRowid, extracted_text: 'dua' }])
  // Baris lama dari Fase 1 (rowid acak) diselaraskan sekali saat aplikasi dibuka.
  t.db.prepare('DELETE FROM assets_fts').run()
  t.db.prepare('INSERT INTO assets_fts (rowid, asset_id, original_name, tags, extracted_text) VALUES (999, ?, ?, ?, ?)').run(a.id, 'a.txt', 'x', 'lama')
  t.db.prepare('INSERT INTO assets_fts (rowid, asset_id, original_name, tags, extracted_text) VALUES (998, ?, ?, ?, ?)').run('yatim', 'y.txt', '', 'yatim')
  expect(alignFtsRowids(t.db)).toBe(1)
  expect(alignFtsRowids(t.db)).toBe(0)
  expect(t.db.prepare('SELECT rowid AS r, asset_id, extracted_text FROM assets_fts').all()).toEqual([{ r: assetRowid, asset_id: a.id, extracted_text: 'lama' }])
  expect(searchAssets(t.db, 'lama').map((h) => h.assetId)).toEqual([a.id])
})
