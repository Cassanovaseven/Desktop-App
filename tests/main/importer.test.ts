import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { importFiles, kindForFile, MSG_FOLDER } from '../../src/main/ingest/importer'
import { sha256File } from '../../src/main/ingest/hash'
import { loadBoard } from '../../src/main/board/repo'

let t: TmpVault
let src: string
beforeEach(() => { t = tmpVault(); src = path.join(t.base, 'Dokumen Kerja'); fs.mkdirSync(src) })
afterEach(() => t.cleanup())

const write = (name: string, content: string | Buffer): string => { const p = path.join(src, name); fs.writeFileSync(p, content); return p }
const jobs = () => t.db.prepare('SELECT kind, status, payload_json FROM jobs').all() as { kind: string; status: string; payload_json: string }[]

test('kindForFile mengenali kelompok dan tipe kartu', () => {
  expect(kindForFile('Laporan.PDF')).toEqual({ jenis: 'dokumen', tipeKartu: 'file', mime: 'application/pdf' })
  expect(kindForFile('foto.jpg')).toMatchObject({ jenis: 'gambar', tipeKartu: 'gambar', mime: 'image/jpeg' })
  expect(kindForFile('main.py')).toMatchObject({ jenis: 'kode', tipeKartu: 'kode' })
  expect(kindForFile('arsip.zip')).toMatchObject({ jenis: 'arsip', tipeKartu: 'grup' })
  expect(kindForFile('desain.psd')).toMatchObject({ jenis: 'gambar', tipeKartu: 'gambar', mime: 'image/vnd.adobe.photoshop' })
  expect(kindForFile('data.xyz')).toMatchObject({ jenis: 'lainnya', tipeKartu: 'file', mime: null })
})
test('impor menyalin ke files/<2 huruf>/<hash>.pdf, membuat asset memproses, kartu, dan job antre', async () => {
  const p = write('Laporan Akhír.pdf', '%PDF-palsu')
  const hash = await sha256File(p)
  const cards = await importFiles(t.db, t.vault, [p], { x: 100, y: 50 })
  expect(cards).toHaveLength(1)
  expect(cards[0]).toMatchObject({ type: 'file', x: 100, y: 50, asset: { status: 'memproses', originalName: 'Laporan Akhír.pdf' } })
  const dest = path.join(t.vault.files, hash.slice(0, 2), `${hash}.pdf`)
  expect(fs.readFileSync(dest, 'utf8')).toBe('%PDF-palsu')
  expect(jobs()).toEqual([{ kind: 'ekstrak', status: 'antre', payload_json: JSON.stringify({ assetId: cards[0].assetId }) }])
})
test('file yang sama dua kali: satu asset, dua kartu, satu job', async () => {
  const p = write('a.txt', 'isi sama')
  const [a] = await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  const [b] = await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(a.assetId).toBe(b.assetId)
  expect(loadBoard(t.db).cards).toHaveLength(2)
  expect(t.db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 })
  expect(jobs()).toHaveLength(1)
})
test('file sumber tidak diubah', async () => {
  const p = write('sumber.md', '# judul'); const before = fs.statSync(p).mtimeMs
  await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(fs.readFileSync(p, 'utf8')).toBe('# judul'); expect(fs.statSync(p).mtimeMs).toBe(before)
})
test('file vault yang sudah ada tidak pernah ditimpa', async () => {
  const p = write('b.txt', 'asli'); const hash = await sha256File(p)
  const dest = path.join(t.vault.files, hash.slice(0, 2), `${hash}.txt`)
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'sudah ada')
  await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(fs.readFileSync(dest, 'utf8')).toBe('sudah ada')
})
test('20 file kecil selesai < 1 detik tanpa menunggu ekstraksi', async () => {
  const paths = Array.from({ length: 20 }, (_, i) => write(`f${i}.txt`, `isi ${i}`))
  const start = performance.now()
  const cards = await importFiles(t.db, t.vault, paths, { x: 0, y: 0 })
  expect(performance.now() - start).toBeLessThan(1000)
  expect(cards).toHaveLength(20)
  expect(new Set(cards.map(c => `${c.x},${c.y}`)).size).toBe(20)
})
test('folder ditolak dengan pesan', async () => {
  const dir = path.join(src, 'sebuah folder'); fs.mkdirSync(dir)
  await expect(importFiles(t.db, t.vault, [dir], { x: 0, y: 0 })).rejects.toThrow(MSG_FOLDER)
  const p = write('c.txt', 'c')
  expect(await importFiles(t.db, t.vault, [dir, p], { x: 0, y: 0 })).toHaveLength(1)
})
test('ZIP menjadi kartu grup', async () => {
  const p = write('arsip.zip', 'PK palsu')
  const [c] = await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(c.type).toBe('grup')
})
test('dua impor bersamaan untuk file yang sama tidak bentrok', async () => {
  const p = write('d.txt', 'bersamaan')
  const [a, b] = await Promise.all([importFiles(t.db, t.vault, [p], { x: 0, y: 0 }), importFiles(t.db, t.vault, [p], { x: 0, y: 0 })])
  expect(a[0].assetId).toBe(b[0].assetId)
  expect(t.db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 })
})
test('video mendapat kartu setinggi kartu gambar supaya frame kuncinya terlihat', async () => {
  const [v] = await importFiles(t.db, t.vault, [write('rapat.mp4', 'vid')], { x: 0, y: 0 })
  expect(v).toMatchObject({ type: 'file', h: 200 })
})

test('Fase 2: aset baru langsung punya tag jenis/jalur dan namanya bisa dicari sebelum ekstraksi', async () => {
  const { searchAssets } = await import('../../src/main/search')
  const p = path.join(t.base, 'rekaman rapat.mp3')
  fs.writeFileSync(p, 'ID3')
  const [card] = await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(t.db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(card.assetId)).toEqual([{ tag: 'jalur:impor' }, { tag: 'jenis:audio' }])
  expect(searchAssets(t.db, 'rapat').map((h) => h.assetId)).toEqual([card.assetId])
})
