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
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
  expect(searchAssets(t.db, 'pidana')[0].cardIds).toEqual([card.id])
  expect(t.db.prepare('SELECT tag FROM asset_tags ORDER BY tag').all()).toEqual([{ tag: 'jalur:impor' }, { tag: 'jenis:dokumen' }])
  await s.queue.stop()
})
test('thumbnail dari sidecar disimpan dan dipakai sebagai pratinjau', async () => {
  const { s, events } = service(async (_rel, id) => ({ text: '', meta: { warna: '#c81e1e' }, thumb: `thumbs/${id}.webp` }))
  s.queue.start()
  const [card] = await s.importPaths([write('foto.png', 'png')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
  expect(events.at(-1)?.asset?.previewUrl).toBe(`alfonso-vault://thumbs/${card.assetId}.webp`)
  await s.queue.stop()
})
test('error permanen (file rusak) langsung gagal tanpa dicoba ulang, lalu retry bisa berhasil', async () => {
  let calls = 0; let broken = true
  const { s, events } = service(async () => { calls++; if (broken) throw new PermanentError('PDF rusak atau terenkripsi'); return { text: 'pulih', meta: {}, thumb: null } })
  s.queue.start()
  const [card] = await s.importPaths([write('r.pdf', 'x')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('gagal'))
  expect(calls).toBe(1); expect(events.at(-1)?.asset?.error).toBe('PDF rusak atau terenkripsi')
  broken = false
  await s.retry(card.assetId!)
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
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
  await vi.waitFor(() => expect(events.find(e => e.asset?.id === grup.assetId && e.asset?.status === 'siap')).toBeTruthy())
  const zipEvent = events.find(e => e.asset?.id === grup.assetId && e.asset?.status === 'siap')!
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
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
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

// ---- Fase 1B: transkrip ----

function serviceWithTranscribe(transcribe: (rel: string, assetId: string) => Promise<{ text: string }>) {
  const events: IngestEvent[] = []
  const s = createIngestService({
    db: t.db, vault: t.vault, log, notify: (e) => events.push(e), retryDelayMs: 0,
    extract: async () => ({ text: '', meta: { durasi: 2 }, thumb: null }),
    transcribe
  })
  return { s, events }
}

test('audio: setelah ekstraksi, transkrip berjalan dan teksnya bisa dicari', async () => {
  const { s, events } = serviceWithTranscribe(async () => ({ text: 'selamat pagi rapat dimulai' }))
  s.queue.start(); s.transcribeQueue.start()
  const [card] = await s.importPaths([write('rekaman.m4a', 'aud')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.transkrip).toBe('selesai'))
  expect(events.at(-1)?.asset?.status).toBe('siap')
  expect(searchAssets(t.db, 'rapat')[0].cardIds).toEqual([card.id])
  await s.queue.stop(); await s.transcribeQueue.stop()
})
test('model belum diunduh: asset tetap siap, transkrip "belum", lalu jalan setelah model ada', async () => {
  let ready = false
  const { s, events } = serviceWithTranscribe(async () => {
    if (!ready) throw new PermanentError('Model transkrip belum diunduh')
    return { text: 'isi video' }
  })
  s.queue.start(); s.transcribeQueue.start()
  await s.importPaths([write('klip.mp4', 'vid')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.transkrip).toBe('belum'))
  expect(events.at(-1)?.asset).toMatchObject({ status: 'siap', error: null })
  ready = true
  expect(s.requeueTranscripts()).toBe(1)
  await vi.waitFor(() => expect(events.at(-1)?.asset?.transkrip).toBe('selesai'))
  expect(searchAssets(t.db, 'video')).toHaveLength(1)
  await s.queue.stop(); await s.transcribeQueue.stop()
})
test('transkrip berjalan satu per satu', async () => {
  let active = 0; let peak = 0
  const { s } = serviceWithTranscribe(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 30)); active--; return { text: 'x' } })
  s.queue.start(); s.transcribeQueue.start()
  await s.importPaths([write('a.mp3', 'a'), write('b.wav', 'b'), write('c.ogg', 'c')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(t.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'transkrip' AND status = 'selesai'").get()).toEqual({ n: 3 }))
  expect(peak).toBe(1)
  await s.queue.stop(); await s.transcribeQueue.stop()
})
test('file bukan audio/video tidak ditranskrip', async () => {
  const transcribe = vi.fn(async () => ({ text: '' }))
  const { s, events } = serviceWithTranscribe(transcribe)
  s.queue.start(); s.transcribeQueue.start()
  await s.importPaths([write('catatan.txt', 'teks')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
  expect(events.at(-1)?.asset?.transkrip).toBeNull()
  expect(transcribe).not.toHaveBeenCalled()
  await s.queue.stop(); await s.transcribeQueue.stop()
})

// ---- Fase 1B: URL ----

function serviceWithDownload(download: (url: string, dir: string) => Promise<{ path: string; originalName: string; contentType: string | null }>) {
  const events: IngestEvent[] = []
  const s = createIngestService({
    db: t.db, vault: t.vault, log, notify: (e) => events.push(e), retryDelayMs: 0,
    extract: async () => ({ text: 'isi artikel tentang korporasi', meta: {}, thumb: null }),
    download
  })
  return { s, events }
}

test('URL ditempel: kartu tautan langsung, lalu isi diunduh dan menempel ke kartu itu', async () => {
  const dirs: string[] = []
  const { s, events } = serviceWithDownload(async (url, dir) => {
    dirs.push(dir)
    const p = path.join(dir, 'Artikel.html'); fs.writeFileSync(p, `<p>${url}</p>`)
    return { path: p, originalName: 'Artikel.html', contentType: 'text/html' }
  })
  s.queue.start()
  const card = await s.pasteText('https://contoh.id/artikel', { x: 5, y: 5 })
  expect(card).toMatchObject({ type: 'tautan', content: 'https://contoh.id/artikel', assetId: null })
  await vi.waitFor(() => expect(events.some((e) => e.asset?.status === 'siap')).toBe(true))
  const attached = events.find((e) => e.updatedCards?.length)!.updatedCards![0]
  expect(attached).toMatchObject({ id: card.id, type: 'tautan', assetId: expect.any(String) })
  expect(attached.asset?.originalName).toBe('Artikel.html')
  expect(searchAssets(t.db, 'korporasi')[0].cardIds).toEqual([card.id])
  expect(t.db.prepare('SELECT tag FROM asset_tags ORDER BY tag').all()).toEqual([{ tag: 'jalur:impor' }, { tag: 'jenis:dokumen' }, { tag: 'sumber:url' }])
  expect(fs.existsSync(dirs[0])).toBe(false)
  expect(loadBoard(t.db).cards).toHaveLength(1)
  await s.queue.stop()
})
test('URL gagal diunduh: kartu tautan tetap, ditandai dengan pesannya', async () => {
  const { s, events } = serviceWithDownload(async () => { throw new Error('Server menjawab 404.') })
  s.queue.start()
  const card = await s.pasteText('https://contoh.id/hilang', { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.find((e) => e.updatedCards?.length)).toBeTruthy())
  expect(events.find((e) => e.updatedCards?.length)!.updatedCards![0]).toMatchObject({ id: card.id, assetId: null, style: { unduh: 'gagal', pesan: 'Server menjawab 404.' } })
  await s.queue.stop()
})
test('teks biasa tidak memicu unduhan', async () => {
  const download = vi.fn()
  const { s } = serviceWithDownload(download)
  s.queue.start()
  await s.pasteText('catatan rapat https://contoh.id di tengah', { x: 0, y: 0 })
  await new Promise((r) => setTimeout(r, 50))
  expect(download).not.toHaveBeenCalled()
  await s.queue.stop()
})

// ---- Fase 1B: tempel gambar ----

test('pasteImage: byte gambar jadi file di vault dengan nama tempel-*, folder sementara dihapus', async () => {
  const { s } = service(async () => ({ text: '', meta: {}, thumb: null }))
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('alfonso-paste-')).length
  const [card] = await s.pasteImage(png, 'image/png', { x: 1, y: 2 })
  expect(card).toMatchObject({ type: 'gambar', x: 1, y: 2 })
  expect(card.asset?.originalName).toMatch(/^tempel-\d{8}-\d{6}\.png$/)
  const row = t.db.prepare('SELECT vault_path FROM assets WHERE id = ?').get(card.assetId) as { vault_path: string }
  expect(fs.readFileSync(path.join(t.vault.root, row.vault_path))).toEqual(png)
  expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('alfonso-paste-')).length).toBe(before)
})
test('pasteImage menolak tipe lain dan ukuran berlebih', async () => {
  const { s } = service(async () => ({ text: '', meta: {}, thumb: null }))
  await expect(s.pasteImage(Buffer.from('x'), 'application/pdf', { x: 0, y: 0 })).rejects.toThrow('Hanya gambar PNG, JPEG, WebP, atau GIF yang bisa ditempel.')
  await expect(s.pasteImage(Buffer.alloc(51 * 1024 * 1024), 'image/png', { x: 0, y: 0 })).rejects.toThrow('Gambar terlalu besar (maks. 50 MB).')
})

// ---- Metadata (kolom meta_json) ----

test('metadata ekstraksi disimpan per asset; data internal ZIP dan status transkrip tidak ikut', async () => {
  const { s, events } = service(async () => ({ text: '', meta: { durasi: 125.4, lebar: 64, transkrip: 'belum', entri: [], temp_dir: '/x', ditolak: 0 }, thumb: null }))
  s.queue.start()
  const [card] = await s.importPaths([write('rekaman.m4a', 'aud')], { x: 0, y: 0 })
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
  expect(events.at(-1)?.asset?.meta).toEqual({ durasi: 125.4, lebar: 64 })
  expect(loadBoard(t.db).cards.find((c) => c.id === card.id)?.asset?.meta).toEqual({ durasi: 125.4, lebar: 64 })
  await s.queue.stop()
})

test('Fase 2: drop, tempel teks, dan tempel gambar masuk ke board aktif', async () => {
  const { createProject, setActiveBoard } = await import('../../src/main/projects/repo')
  const { s } = service(async () => ({ text: '', meta: {}, thumb: null }))
  const first = loadBoard(t.db).id
  const p = createProject(t.db, 'Kedua')
  setActiveBoard(t.db, p.boards[0].id)
  const [a] = await s.importPaths([write('a.txt', 'a')], { x: 0, y: 0 })
  const note = await s.pasteText('catatan', { x: 0, y: 0 })
  const [img] = await s.pasteImage(new Uint8Array([137, 80, 78, 71]), 'image/png', { x: 0, y: 0 })
  for (const c of [a, note, img]) expect(c.boardId).toBe(p.boards[0].id)
  expect(loadBoard(t.db, first).cards).toEqual([])
})

test('Fase 2: isi ZIP masuk ke board kartu ZIP walau board aktif sudah pindah', async () => {
  const { createProject, setActiveBoard } = await import('../../src/main/projects/repo')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-zip-'))
  fs.writeFileSync(path.join(temp, 'c.txt'), 'isi c')
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const { s, events } = service(async (rel) => {
    if (!rel.endsWith('.zip')) return { text: 'isi', meta: {}, thumb: null }
    await gate
    return { text: 'c.txt', meta: { entri: [{ name: 'c.txt', path: path.join(temp, 'c.txt') }], temp_dir: temp, ditolak: 0 }, thumb: null }
  })
  s.queue.start()
  const [grup] = await s.importPaths([write('arsip.zip', 'PK')], { x: 0, y: 0 })
  setActiveBoard(t.db, createProject(t.db, 'Lain').boards[0].id)
  release()
  await vi.waitFor(() => expect(events.some((e) => e.newCards.length > 0)).toBe(true))
  const inner = events.find((e) => e.newCards.length > 0)!.newCards
  expect(inner.map((c) => c.boardId)).toEqual([grup.boardId])
  await s.queue.stop()
})
test('aset hasil generate tetap jalur:kode setelah diekstrak (tidak mendapat jalur:impor)', async () => {
  const { s, events } = service(async () => ({ text: '', meta: {}, thumb: null }))
  const { insertAsset } = await import('../../src/main/board/repo')
  const { insertJob } = await import('../../src/main/jobs/store')
  const a = insertAsset(t.db, { sha256: 'abc', vaultPath: 'generated/2026-10/x.svg', originalName: 'x.svg', mime: 'image/svg+xml', sizeBytes: 1 })
  for (const tag of ['jenis:gambar', 'jalur:kode', 'sumber:svg']) t.db.prepare('INSERT INTO asset_tags (asset_id, tag) VALUES (?, ?)').run(a.id, tag)
  insertJob(t.db, 'ekstrak', { assetId: a.id })
  s.queue.start()
  await vi.waitFor(() => expect(events.at(-1)?.asset?.status).toBe('siap'))
  expect((t.db.prepare('SELECT tag FROM asset_tags ORDER BY tag').all() as { tag: string }[]).map((r) => r.tag)).toEqual(['jalur:kode', 'jenis:gambar', 'sumber:svg'])
  await s.queue.stop()
})
