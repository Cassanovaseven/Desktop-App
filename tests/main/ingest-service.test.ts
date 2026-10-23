import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { createIngestService, PermanentError, type ExtractResult } from '../../src/main/ingest/service'
import { loadBoard } from '../../src/main/board/repo'
import { searchAssets } from '../../src/main/search'
import type { IngestEvent } from '../../src/shared/board-types'

let t: TmpVault
let src: string
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
beforeEach(() => { t = tmpVault(); src = path.join(t.base, 'sumber'); fs.mkdirSync(src) })
afterEach(() => t.cleanup())
const write = (name: string, content: string): string => { const p = path.join(src, name); fs.writeFileSync(p, content); return p }

function service(extract: (rel: string, assetId: string) => Promise<ExtractResult>) {
  const events: IngestEvent[] = []
  const s = createIngestService({ db: t.db, vault: t.vault, log, extract, notify: (e) => events.push(e), retryDelayMs: 0 })
  return { s, events }
}

test('impor → ekstraksi → asset siap, teks bisa dicari, tag otomatis, event dikirim', async () => {
  const { s, events } = service(async () => ({ text: 'pertanggungjawaban pidana', meta: {}, thumb: null }))
  s.queue.start()
  const [card] = await s.importPaths([write('laporan.pdf', '%PDF')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset.status).toBe('siap'))
  expect(searchAssets(t.db, 'pidana')[0].cardIds).toEqual([card.id])
  expect(t.db.prepare('SELECT tag FROM asset_tags ORDER BY tag').all()).toEqual([{ tag: 'jalur:impor' }, { tag: 'jenis:dokumen' }])
  await s.queue.stop()
})
test('thumbnail dari sidecar disimpan dan dipakai sebagai pratinjau', async () => {
  const { s, events } = service(async (_rel, id) => ({ text: '', meta: { warna: '#c81e1e' }, thumb: `thumbs/${id}.webp` }))
  s.queue.start()
  const [card] = await s.importPaths([write('foto.png', 'png')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset.status).toBe('siap'))
  expect(events.at(-1)?.asset.previewUrl).toBe(`alfonso-vault://thumbs/${card.assetId}.webp`)
  await s.queue.stop()
})
test('error permanen (file rusak) langsung gagal tanpa dicoba ulang, lalu retry bisa berhasil', async () => {
  let calls = 0; let broken = true
  const { s, events } = service(async () => { calls++; if (broken) throw new PermanentError('PDF rusak atau terenkripsi'); return { text: 'pulih', meta: {}, thumb: null } })
  s.queue.start()
  const [card] = await s.importPaths([write('r.pdf', 'x')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset.status).toBe('gagal'))
  expect(calls).toBe(1); expect(events.at(-1)?.asset.error).toBe('PDF rusak atau terenkripsi')
  broken = false
  await s.retry(card.assetId!)
  await vi.waitFor(() => expect(events.at(-1)?.asset.status).toBe('siap'))
  await s.queue.stop()
})
test('ZIP: isi menjadi kartu di dalam grup dan folder sementara dihapus', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-zip-'))
  fs.writeFileSync(path.join(temp, 'catatan.txt'), 'isi catatan'); fs.mkdirSync(path.join(temp, 'sub')); fs.writeFileSync(path.join(temp, 'sub', 'b.md'), '# b')
  const { s, events } = service(async (rel) => rel.endsWith('.zip')
    ? { text: 'catatan.txt\nsub/b.md', meta: { entri: [{ name: 'catatan.txt', path: path.join(temp, 'catatan.txt') }, { name: 'sub/b.md', path: path.join(temp, 'sub', 'b.md') }], temp_dir: temp, ditolak: 0 }, thumb: null }
    : { text: 'isi', meta: {}, thumb: null })
  s.queue.start()
  const [grup] = await s.importPaths([write('arsip.zip', 'PK')], { x: 100, y: 100 })
  await vi.waitFor(() => expect(events.find(e => e.asset.id === grup.assetId && e.asset.status === 'siap')).toBeTruthy())
  const zipEvent = events.find(e => e.asset.id === grup.assetId && e.asset.status === 'siap')!
  expect(zipEvent.newCards.map(c => c.asset?.originalName).sort()).toEqual(['b.md', 'catatan.txt'])
  for (const c of zipEvent.newCards) {
    expect(c.style).toEqual({ grupId: grup.id })
    expect(c.x).toBeGreaterThanOrEqual(100); expect(c.y).toBeGreaterThan(100)
  }
  expect(fs.existsSync(temp)).toBe(false)
  expect(loadBoard(t.db).cards).toHaveLength(3)
  await s.queue.stop()
})
test('folder sementara yang bukan milik sidecar tidak dihapus', async () => {
  const bukan = path.join(t.base, 'penting'); fs.mkdirSync(bukan)
  const { s, events } = service(async () => ({ text: '', meta: { entri: [], temp_dir: bukan, ditolak: 0 }, thumb: null }))
  s.queue.start()
  await s.importPaths([write('z.zip', 'PK')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset.status).toBe('siap'))
  expect(fs.existsSync(bukan)).toBe(true)
  await s.queue.stop()
})
test('pasteText: URL jadi kartu tautan, teks lain jadi catatan', async () => {
  const { s } = service(async () => ({ text: '', meta: {}, thumb: null }))
  expect(await s.pasteText('https://contoh.id/a?b=1', { x: 1, y: 2 })).toMatchObject({ type: 'tautan', content: 'https://contoh.id/a?b=1', x: 1, y: 2 })
  expect(await s.pasteText('ide baru\nbaris dua', { x: 0, y: 0 })).toMatchObject({ type: 'catatan', content: 'ide baru\nbaris dua' })
})
test('impor memberi tahu Board tentang kartu baru', async () => {
  const { s, events } = service(async () => ({ text: '', meta: {}, thumb: null }))
  const [card] = await s.importPaths([write('n.txt', 'n')], { x: 0, y: 0 })
  expect(events[0]).toMatchObject({ asset: { status: 'memproses' }, newCards: [{ id: card.id }] })
})
