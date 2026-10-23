import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { createFolderWatcher, type FolderWatcher } from '../../src/main/ingest/watcher'
import { importFiles } from '../../src/main/ingest/importer'
import { getSetting } from '../../src/main/db/database'
import type { CardDTO } from '../../src/shared/board-types'

let t: TmpVault
let src: string
let w: FolderWatcher | null = null
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const imported: string[][] = []
beforeEach(() => {
  t = tmpVault(); src = path.join(t.base, 'Unduhan Saya'); fs.mkdirSync(src); imported.length = 0
})
afterEach(async () => { await w?.close(); w = null; t.cleanup() })
const sha = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

function watcher() {
  w = createFolderWatcher({
    db: t.db, vaultRoot: t.vault.root, log, stableMs: 150,
    importPaths: async (paths, at) => {
      imported.push(paths.map((p) => path.basename(p)))
      return importFiles(t.db, t.vault, paths, at, { skipKnown: true, tags: ['sumber:folder'] })
    }
  })
  return w
}

test('tambah folder: isi yang sudah ada dipindai sekali dan daftar disimpan', async () => {
  fs.writeFileSync(path.join(src, 'lama.txt'), 'isi lama')
  const fw = watcher()
  await fw.add(src)
  await vi.waitFor(() => expect(imported.flat()).toEqual(['lama.txt']))
  expect(JSON.parse(getSetting(t.db, 'ingest.watchFolders')!)).toEqual([path.resolve(src)])
  expect(fw.list()).toEqual([path.resolve(src)])
})
test('file baru (juga di subfolder) diimpor setelah ukurannya stabil; file sumber tidak berubah', async () => {
  const fw = watcher()
  await fw.add(src)
  fs.mkdirSync(path.join(src, 'sub'))
  const p = path.join(src, 'sub', 'baru.md')
  fs.writeFileSync(p, '# satu')
  const before = sha(p)
  await vi.waitFor(() => expect(imported.flat()).toContain('baru.md'), { timeout: 3000 })
  expect(sha(p)).toBe(before)
  expect(fs.readdirSync(path.join(src, 'sub'))).toEqual(['baru.md'])
  expect(t.db.prepare("SELECT tag FROM asset_tags WHERE tag = 'sumber:folder'").all()).toHaveLength(1)
})
test('file yang masih ditulis ditunggu sampai stabil', async () => {
  const fw = watcher()
  await fw.add(src)
  const p = path.join(src, 'besar.txt')
  const fd = fs.openSync(p, 'w')
  for (let i = 0; i < 4; i++) { fs.writeSync(fd, 'x'.repeat(1000)); await new Promise((r) => setTimeout(r, 80)) }
  expect(imported.flat()).not.toContain('besar.txt')
  fs.closeSync(fd)
  await vi.waitFor(() => expect(imported.flat()).toContain('besar.txt'), { timeout: 3000 })
  const size = (t.db.prepare("SELECT size_bytes FROM assets WHERE original_name = 'besar.txt'").get() as { size_bytes: number }).size_bytes
  expect(size).toBe(4000)
})
test('file sementara unduhan dan file tersembunyi dilewati', async () => {
  const fw = watcher()
  await fw.add(src)
  for (const n of ['a.crdownload', 'b.part', 'c.tmp', '~$draf.docx', '.DS_Store']) fs.writeFileSync(path.join(src, n), 'x')
  fs.writeFileSync(path.join(src, 'ok.txt'), 'ok')
  await vi.waitFor(() => expect(imported.flat()).toContain('ok.txt'), { timeout: 3000 })
  await new Promise((r) => setTimeout(r, 300))
  expect(imported.flat()).toEqual(['ok.txt'])
})
test('folder vault, folder di dalam vault, dan folder yang berisi vault ditolak', async () => {
  const fw = watcher()
  await expect(fw.add(t.vault.root)).rejects.toThrow('Folder vault tidak bisa dipantau.')
  await expect(fw.add(path.join(t.vault.root, 'files'))).rejects.toThrow('Folder vault tidak bisa dipantau.')
  await expect(fw.add(t.base)).rejects.toThrow('Folder vault tidak bisa dipantau.')
  await expect(fw.add(path.join(t.base, 'tidak-ada'))).rejects.toThrow('Folder tidak ditemukan.')
})
test('dibuka ulang: folder dipantau lagi; file yang sudah ada di vault tidak jadi kartu baru', async () => {
  fs.writeFileSync(path.join(src, 'lama.txt'), 'isi lama')
  const fw = watcher()
  await fw.add(src)
  await vi.waitFor(() => expect(imported.flat()).toEqual(['lama.txt']))
  await fw.close()
  const cardsBefore = (t.db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
  const fw2 = watcher()
  await fw2.start()
  await vi.waitFor(() => expect(imported).toHaveLength(2))
  expect((t.db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(cardsBefore)
  fs.writeFileSync(path.join(src, 'baru.txt'), 'baru')
  await vi.waitFor(() => expect(imported.flat()).toContain('baru.txt'), { timeout: 3000 })
})
test('berhenti memantau', async () => {
  const fw = watcher()
  await fw.add(src)
  await fw.remove(src)
  expect(fw.list()).toEqual([])
  fs.writeFileSync(path.join(src, 'x.txt'), 'x')
  await new Promise((r) => setTimeout(r, 400))
  expect(imported.flat()).not.toContain('x.txt')
})
test('importFiles skipKnown: hash yang sudah ada tidak membuat kartu', async () => {
  const p = path.join(src, 'a.txt'); fs.writeFileSync(p, 'sama')
  const first: CardDTO[] = await importFiles(t.db, t.vault, [p], { x: 0, y: 0 })
  expect(first).toHaveLength(1)
  expect(await importFiles(t.db, t.vault, [p], { x: 0, y: 0 }, { skipKnown: true })).toEqual([])
})
