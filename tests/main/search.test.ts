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
