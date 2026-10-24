import { test, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { getActiveBoard, insertAsset, insertCard, deleteCards } from '../../src/main/board/repo'
import { indexAsset } from '../../src/main/search'
import { createProject } from '../../src/main/projects/repo'
import { listAssets } from '../../src/main/library/query'
import { normalizeTag, addTag, removeTag, listTags, ensureAutoTags } from '../../src/main/library/tags'
import { getAssetDetail, assetFilePath, PREVIEW_CHARS } from '../../src/main/library/detail'
import { kindForFile } from '../../src/main/ingest/importer'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

let seq = 0
function seed(name: string, o: { text?: string; size?: number; status?: 'memproses' | 'siap' | 'gagal'; createdAt?: string; tags?: string[] } = {}): string {
  seq++
  const sha = seq.toString(16).padStart(64, '0')
  const a = insertAsset(t.db, { sha256: sha, vaultPath: `files/${sha.slice(0, 2)}/${sha}${path.extname(name)}`, originalName: name, mime: kindForFile(name).mime, sizeBytes: o.size ?? seq })
  if (o.createdAt) t.db.prepare('UPDATE assets SET created_at = ? WHERE id = ?').run(o.createdAt, a.id)
  const tags = [`jenis:${kindForFile(name).jenis}`, 'jalur:impor', ...(o.tags ?? [])]
  const ins = t.db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)')
  for (const tag of tags) ins.run(a.id, tag)
  indexAsset(t.db, a.id, o.text ?? '', tags, o.status ?? 'siap')
  return a.id
}
const names = (r: { items: { asset: { originalName: string } }[] }): string[] => r.items.map((i) => i.asset.originalName)

// ---- Task 3: kueri Library ----

test('tanpa filter → terbaru dulu, dengan total', () => {
  seed('lama.pdf', { createdAt: '2026-01-01T00:00:00Z' })
  seed('baru.png', { createdAt: '2026-10-01T00:00:00Z' })
  seed('tengah.mp3', { createdAt: '2026-05-01T00:00:00Z' })
  const r = listAssets(t.db, {})
  expect(names(r)).toEqual(['baru.png', 'tengah.mp3', 'lama.pdf'])
  expect(r.total).toBe(3)
  expect(r.items[0]).toMatchObject({ jenis: 'gambar', createdAt: '2026-10-01T00:00:00Z', snippet: null })
})

test('filter jenis (gabungan), status, dan tag (semua harus ada)', () => {
  seed('a.pdf'); seed('b.png', { tags: ['status:final'] }); seed('c.mp4', { status: 'gagal', tags: ['status:final', 'gaya:retro'] }); seed('d.mp3')
  expect(names(listAssets(t.db, { jenis: ['gambar', 'video'], sort: 'nama' }))).toEqual(['b.png', 'c.mp4'])
  expect(names(listAssets(t.db, { status: ['gagal'] }))).toEqual(['c.mp4'])
  expect(names(listAssets(t.db, { tags: ['status:final'], sort: 'nama' }))).toEqual(['b.png', 'c.mp4'])
  expect(names(listAssets(t.db, { tags: ['status:final', 'gaya:retro'] }))).toEqual(['c.mp4'])
})

test('cakupan: proyek (lewat kartu di board proyek) dan belum dipakai', () => {
  const a = seed('a.pdf'); const b = seed('b.pdf'); seed('c.pdf')
  const board1 = getActiveBoard(t.db)
  const p2 = createProject(t.db, 'Dua')
  insertCard(t.db, { boardId: board1.id, type: 'file', x: 0, y: 0, assetId: a })
  const cb = insertCard(t.db, { boardId: p2.boards[0].id, type: 'file', x: 0, y: 0, assetId: b })
  expect(names(listAssets(t.db, { scope: 'proyek', projectId: board1.projectId }))).toEqual(['a.pdf'])
  expect(names(listAssets(t.db, { scope: 'proyek', projectId: p2.id }))).toEqual(['b.pdf'])
  expect(names(listAssets(t.db, { scope: 'belum-dipakai' }))).toEqual(['c.pdf'])
  deleteCards(t.db, [cb.id])
  expect(names(listAssets(t.db, { scope: 'belum-dipakai', sort: 'nama' }))).toEqual(['b.pdf', 'c.pdf'])
  expect(() => listAssets(t.db, { scope: 'proyek' })).toThrow()
})

test('kata kunci mencari nama, tag, dan isi, dengan cuplikan', () => {
  seed('putusan.pdf', { text: 'pertanggungjawaban pidana korporasi' })
  seed('foto.png', { tags: ['gaya:retro'] })
  seed('memo.txt', { text: 'rapat mingguan' })
  const r = listAssets(t.db, { q: 'pidana' })
  expect(names(r)).toEqual(['putusan.pdf'])
  expect(r.items[0].snippet).toContain('pidana')
  expect(names(listAssets(t.db, { q: 'retro' }))).toEqual(['foto.png'])
  expect(names(listAssets(t.db, { q: 'memo' }))).toEqual(['memo.txt'])
  expect(listAssets(t.db, { q: 'pidana', jenis: ['gambar'] }).total).toBe(0)
})

test('urut nama, ukuran, terlama', () => {
  seed('b.pdf', { size: 10, createdAt: '2026-02-01T00:00:00Z' })
  seed('A.pdf', { size: 30, createdAt: '2026-03-01T00:00:00Z' })
  seed('c.pdf', { size: 20, createdAt: '2026-01-01T00:00:00Z' })
  expect(names(listAssets(t.db, { sort: 'nama' }))).toEqual(['A.pdf', 'b.pdf', 'c.pdf'])
  expect(names(listAssets(t.db, { sort: 'ukuran' }))).toEqual(['A.pdf', 'c.pdf', 'b.pdf'])
  expect(names(listAssets(t.db, { sort: 'terlama' }))).toEqual(['c.pdf', 'b.pdf', 'A.pdf'])
})

test('halaman: offset/limit, total tetap', () => {
  for (let i = 0; i < 25; i++) seed(`f${String(i).padStart(2, '0')}.txt`)
  const r = listAssets(t.db, { sort: 'nama', offset: 20, limit: 10 })
  expect(r.total).toBe(25)
  expect(names(r)).toEqual(['f20.txt', 'f21.txt', 'f22.txt', 'f23.txt', 'f24.txt'])
})

test('input FTS aneh tidak error', () => {
  seed('a.txt', { text: 'halo' })
  for (const q of ['"', '*', 'NEAR(', 'a OR', '-', '(((', 'kata"kutip']) expect(() => listAssets(t.db, { q })).not.toThrow()
})

test('10.000 aset: satu halaman (dengan filter dan kata kunci) < 100 ms', () => {
  const board = getActiveBoard(t.db)
  t.db.transaction(() => {
    for (let i = 0; i < 10000; i++) {
      const id = seed(i % 3 === 0 ? `gambar-${i}.png` : `dok-${i}.pdf`, { text: `isi nomor ${i} ${i % 7 === 0 ? 'khusus' : ''}`, tags: i % 5 === 0 ? ['status:final'] : [] })
      if (i % 2 === 0) insertCard(t.db, { boardId: board.id, type: 'file', x: 0, y: 0, assetId: id })
      t.db.prepare("INSERT INTO jobs (id, kind, payload_json, status, created_at, updated_at) VALUES (?, 'ekstrak', ?, 'selesai', '', '')").run(`j${i}`, JSON.stringify({ assetId: id }))
    }
  })()
  for (const q of [{}, { jenis: ['gambar' as const], sort: 'nama' as const }, { scope: 'belum-dipakai' as const }, { q: 'khusus', tags: ['status:final'] }, { scope: 'proyek' as const, projectId: board.projectId, offset: 4900 }]) {
    const start = performance.now()
    const r = listAssets(t.db, { ...q, limit: 100 })
    const ms = performance.now() - start
    expect(r.items.length).toBeGreaterThan(0)
    expect(ms, JSON.stringify(q)).toBeLessThan(100)
  }
}, 60_000)

// ---- Task 4: tag ----

test('normalisasi tag', () => {
  expect(normalizeTag('  Status:Final ')).toBe('status:final')
  expect(normalizeTag('gaya : retro  futuristik')).toBe('gaya:retro-futuristik')
  expect(() => normalizeTag('   ')).toThrow(/Tag/)
  expect(() => normalizeTag('x'.repeat(65))).toThrow(/Tag/)
})

test('tambah tag → bisa dicari; hapus → hilang; tag otomatis tidak bisa dihapus', () => {
  const id = seed('a.pdf', { text: 'isi' })
  addTag(t.db, id, 'Status:Pilihan')
  expect(names(listAssets(t.db, { q: 'pilihan' }))).toEqual(['a.pdf'])
  expect(names(listAssets(t.db, { tags: ['status:pilihan'] }))).toEqual(['a.pdf'])
  removeTag(t.db, id, 'status:pilihan')
  expect(listAssets(t.db, { q: 'pilihan' }).total).toBe(0)
  expect(() => removeTag(t.db, id, 'jenis:dokumen')).toThrow(/otomatis/)
  expect(() => addTag(t.db, 'tidak-ada', 'x')).toThrow()
  // Isi file tetap bisa dicari setelah tag berubah.
  expect(names(listAssets(t.db, { q: 'isi' }))).toEqual(['a.pdf'])
})

test('aset yang masih memproses (belum diindeks) tetap bisa dicari namanya setelah diberi tag', () => {
  const a = insertAsset(t.db, { sha256: 'f'.repeat(64), vaultPath: 'files/ff/x.pdf', originalName: 'laporan.pdf', mime: 'application/pdf', sizeBytes: 1 })
  addTag(t.db, a.id, 'proyek:skripsi')
  expect(names(listAssets(t.db, { q: 'skripsi' }))).toEqual(['laporan.pdf'])
  expect(names(listAssets(t.db, { q: 'laporan' }))).toEqual(['laporan.pdf'])
})

test('daftar tag dengan jumlah aset', () => {
  seed('a.pdf', { tags: ['status:final'] }); seed('b.png', { tags: ['status:final'] })
  expect(listTags(t.db)).toEqual([
    { tag: 'jalur:impor', count: 2 }, { tag: 'jenis:dokumen', count: 1 }, { tag: 'jenis:gambar', count: 1 }, { tag: 'status:final', count: 2 }
  ])
})

test('ensureAutoTags melengkapi tag jenis/jalur untuk aset lama tanpa tag', () => {
  const a = insertAsset(t.db, { sha256: 'e'.repeat(64), vaultPath: 'files/ee/x.mp3', originalName: 'rekaman.mp3', mime: 'audio/mpeg', sizeBytes: 1 })
  ensureAutoTags(t.db)
  ensureAutoTags(t.db)
  expect(t.db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(a.id)).toEqual([{ tag: 'jalur:impor' }, { tag: 'jenis:audio' }])
  expect(names(listAssets(t.db, { jenis: ['audio'] }))).toEqual(['rekaman.mp3'])
})

// ---- Task 5: detail ----

test('detail: tag (otomatis ditandai), cuplikan ≤ 5.000 karakter, dipakai di board mana', () => {
  const id = seed('panjang.txt', { text: 'a'.repeat(12000), tags: ['status:draf'] })
  const b1 = getActiveBoard(t.db)
  const p2 = createProject(t.db, 'Riset')
  const c1 = insertCard(t.db, { boardId: b1.id, type: 'file', x: 0, y: 0, assetId: id })
  const c2 = insertCard(t.db, { boardId: p2.boards[0].id, type: 'file', x: 0, y: 0, assetId: id })
  const c3 = insertCard(t.db, { boardId: p2.boards[0].id, type: 'file', x: 9, y: 9, assetId: id })
  const d = getAssetDetail(t.db, id)!
  expect(d.textPreview.length).toBe(PREVIEW_CHARS)
  expect(d.textLength).toBe(12000)
  expect(d.jenis).toBe('dokumen')
  expect(d.tags).toEqual([
    { tag: 'jalur:impor', auto: true }, { tag: 'jenis:dokumen', auto: true }, { tag: 'status:draf', auto: false }
  ])
  expect(d.usages).toEqual([
    { boardId: b1.id, boardName: 'Board Utama', projectId: b1.projectId, projectName: 'Proyek Pertama', cardIds: [c1.id] },
    { boardId: p2.boards[0].id, boardName: 'Board Utama', projectId: p2.id, projectName: 'Riset', cardIds: [c2.id, c3.id] }
  ])
  expect(getAssetDetail(t.db, 'tidak-ada')).toBeNull()
})

test('path untuk "Tampilkan di folder" selalu di dalam files/', () => {
  const id = seed('a.pdf')
  const p = assetFilePath(t.db, t.vault, id)
  expect(path.relative(t.vault.files, p).startsWith('..')).toBe(false)
  t.db.prepare('UPDATE assets SET vault_path = ? WHERE id = ?').run('files/../alfonso.db', id)
  expect(() => assetFilePath(t.db, t.vault, id)).toThrow()
  t.db.prepare('UPDATE assets SET vault_path = ? WHERE id = ?').run('thumbs/x.webp', id)
  expect(() => assetFilePath(t.db, t.vault, id)).toThrow()
  expect(() => assetFilePath(t.db, t.vault, 'tidak-ada')).toThrow()
})
