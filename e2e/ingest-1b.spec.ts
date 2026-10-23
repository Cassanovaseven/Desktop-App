import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import { makeDirs, launch, fixture, type E2EDirs, type AlfonsoTestHook } from './helpers'

let dirs: E2EDirs
let server: http.Server
let base: string
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/artikel') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end('<html><head><title>Analisis Putusan</title></head><body><p>doktrin vicarious liability</p></body></html>')
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => { server.closeAllConnections(); server.close() })
test.beforeEach(() => { dirs = makeDirs() })
test.afterEach(() => { fs.rmSync(dirs.base, { recursive: true, force: true }) })

const hook = (app: ElectronApplication) => ({
  importPaths: (paths: string[], at: { x: number; y: number }) =>
    app.evaluate((_e, a) => (globalThis as unknown as { __alfonsoTest: AlfonsoTestHook }).__alfonsoTest.importPaths(a.paths, a.at), { paths, at }),
  watchFolder: (dir: string) =>
    app.evaluate((_e, d) => (globalThis as unknown as { __alfonsoTest: AlfonsoTestHook }).__alfonsoTest.watchFolder(d), dir)
})
const node = (win: Page, name: string | RegExp) => win.locator('.react-flow__node', { hasText: name }).first()

async function ready(app: ElectronApplication): Promise<Page> {
  const win = await app.firstWindow()
  await expect(win.getByText(/Sidecar: siap/)).toBeVisible({ timeout: 20000 })
  return win
}

// Diketik ulang sampai hasilnya muncul, karena ekstraksi/indeks berjalan di latar belakang.
async function searchFor(win: Page, q: string, expected: string): Promise<void> {
  await win.keyboard.press('Control+K')
  await win.getByLabel('Cari perintah').fill('cari isi')
  await win.keyboard.press('Enter')
  const box = win.getByLabel('Cari isi file')
  await expect(async () => {
    await box.fill('')
    await box.fill(q)
    await expect(win.locator('.palette-list')).toContainText(expected, { timeout: 1000 })
  }).toPass({ timeout: 20000 })
}

test('OCR gambar dan kartu video', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)
  await hook(app).importPaths([fixture('memo-teks.png'), fixture('klip.mp4')], { x: 40, y: 40 })
  await expect(win.getByText('Memproses…')).toHaveCount(0, { timeout: 30000 })

  // Teks di dalam gambar bisa dicari (OCR).
  await searchFor(win, 'yurisprudensi', 'memo-teks.png')
  await win.keyboard.press('Escape')

  // Video: frame kunci jadi thumbnail; model transkrip belum diunduh.
  const video = node(win, 'klip.mp4')
  await expect(video.getByText('Video')).toBeVisible()
  const img = video.locator('img.card-image')
  await expect(img).toHaveAttribute('src', /^alfonso-vault:\/\/thumbs\//)
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(video.getByText(/Transkrip belum tersedia/)).toBeVisible({ timeout: 15000 })
  await app.close()
})

test('folder dipantau: file baru masuk Board, file aslinya tetap', async () => {
  const watched = path.join(dirs.base, 'Unduhan')
  fs.mkdirSync(watched)
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)
  await hook(app).watchFolder(watched)
  const src = path.join(watched, 'notulen rapat.md')
  fs.writeFileSync(src, '# Notulen\nkeputusan anggaran disetujui')
  // Kartu masuk di kolom "Masuk" di kiri Board (di luar layar); hasil pencarian memusatkan Board ke kartunya.
  await searchFor(win, 'anggaran', 'notulen rapat.md')
  await win.keyboard.press('Enter')
  await expect(node(win, 'notulen rapat.md')).toBeVisible()
  expect(fs.readFileSync(src, 'utf8')).toBe('# Notulen\nkeputusan anggaran disetujui')
  await app.close()
})

test('tempel URL dan tempel gambar dari clipboard', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)
  await win.getByTestId('board').click({ position: { x: 20, y: 20 } })

  await app.evaluate(({ clipboard }, u) => clipboard.writeText(u), `${base}/artikel`)
  await win.keyboard.press('Control+V')
  await expect(node(win, `${base}/artikel`)).toBeAttached()
  await expect(node(win, 'Analisis Putusan.html')).toBeAttached({ timeout: 15000 })
  await expect(win.getByText('Memproses…')).toHaveCount(0, { timeout: 15000 })
  await searchFor(win, 'vicarious', 'Analisis Putusan.html')
  await win.keyboard.press('Escape')

  // Electron 45: clipboard.write menerima ClipboardItem (gaya Web), tanpa writeImage.
  await app.evaluate(async ({ clipboard, ClipboardItem }, p) => {
    const fs = process.getBuiltinModule('fs') as typeof import('fs')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([fs.readFileSync(p)], { type: 'image/png' }) })])
  }, fixture('foto.png'))
  await win.getByTestId('board').click({ position: { x: 20, y: 20 } })
  await win.keyboard.press('Control+V')
  await expect(node(win, /^Gambartempel-\d{8}-\d{6}\.png/)).toBeAttached({ timeout: 10000 })
  await app.close()
})
