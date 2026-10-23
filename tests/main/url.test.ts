import { test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { downloadUrl, isBlockedAddress } from '../../src/main/ingest/url'

let server: http.Server
let base: string
let tmp: string
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    if (u.pathname === '/artikel') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end('<html><head><title>Putusan MA: Korporasi &amp; Pidana</title></head><body><p>isi artikel</p></body></html>')
    }
    if (u.pathname === '/dok/laporan%20akhir.pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end('%PDF-1.4 isi') }
    if (u.pathname === '/gambar') { res.setHeader('Content-Type', 'image/png'); return res.end('png') }
    if (u.pathname === '/besar') { res.setHeader('Content-Type', 'application/octet-stream'); res.write(Buffer.alloc(600)); return res.end(Buffer.alloc(600)) }
    if (u.pathname === '/lambat') { res.setHeader('Content-Type', 'text/plain'); res.write('a'); return }
    if (u.pathname === '/putar') { res.statusCode = 302; res.setHeader('Location', '/putar'); return res.end() }
    if (u.pathname === '/pindah') { res.statusCode = 301; res.setHeader('Location', '/artikel'); return res.end() }
    res.statusCode = 404; res.end('tidak ada')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-urltest-')) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

// Server tes ada di 127.0.0.1, jadi pemeriksaan alamat lokal dimatikan khusus untuk tes ini.
const dl = (u: string, o: Partial<Parameters<typeof downloadUrl>[1]> = {}) => downloadUrl(u, { dir: tmp, allowPrivate: true, ...o })

test('halaman HTML disimpan dengan judulnya sebagai nama', async () => {
  const r = await dl(`${base}/artikel`)
  expect(r.originalName).toBe('Putusan MA - Korporasi & Pidana.html')
  expect(r.contentType).toBe('text/html')
  expect(fs.readFileSync(r.path, 'utf8')).toContain('isi artikel')
  expect(path.dirname(r.path).startsWith(tmp)).toBe(true)
})
test('file biasa memakai nama dari URL', async () => {
  const r = await dl(`${base}/dok/laporan%20akhir.pdf`)
  expect(r.originalName).toBe('laporan akhir.pdf')
})
test('tanpa ekstensi di URL: ekstensi dari Content-Type', async () => {
  expect((await dl(`${base}/gambar`)).originalName).toBe('gambar.png')
})
test('pengalihan diikuti', async () => {
  expect((await dl(`${base}/pindah`)).originalName).toBe('Putusan MA - Korporasi & Pidana.html')
})
test('batas ukuran, waktu, dan jumlah pengalihan', async () => {
  await expect(dl(`${base}/besar`, { maxBytes: 1000 })).rejects.toThrow('File terlalu besar (maks. 50 MB).')
  await expect(dl(`${base}/lambat`, { timeoutMs: 300 })).rejects.toThrow('Waktu habis saat mengunduh.')
  await expect(dl(`${base}/putar`)).rejects.toThrow('Terlalu banyak pengalihan.')
  await expect(dl(`${base}/hilang`)).rejects.toThrow('Server menjawab 404.')
  expect(fs.readdirSync(tmp)).toEqual([])
})
test('hanya http/https', async () => {
  await expect(dl('file:///etc/passwd')).rejects.toThrow('Hanya tautan http/https yang bisa diunduh.')
  await expect(dl('ftp://contoh.id/a')).rejects.toThrow('Hanya tautan http/https yang bisa diunduh.')
})
test('alamat lokal dan jaringan privat ditolak di mode normal', async () => {
  await expect(downloadUrl(`${base}/artikel`, { dir: tmp })).rejects.toThrow('Alamat lokal atau jaringan privat tidak diizinkan.')
  await expect(downloadUrl('http://localhost:1/x', { dir: tmp })).rejects.toThrow('Alamat lokal atau jaringan privat tidak diizinkan.')
})
test('isBlockedAddress', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
    expect(isBlockedAddress(a), a).toBe(true)
  }
  for (const a of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) expect(isBlockedAddress(a), a).toBe(false)
})
