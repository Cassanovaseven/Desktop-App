import { test, expect, beforeEach, afterEach } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import {
  getOrCreateDefaultBoard, loadBoard, insertCard, saveCards, deleteCards, createLink, deleteLink, saveViewport, insertAsset
} from '../../src/main/board/repo'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

test('database kosong → proyek dan board bawaan dibuat sekali', () => {
  const a = getOrCreateDefaultBoard(t.db); const b = getOrCreateDefaultBoard(t.db)
  expect(a.id).toBe(b.id); expect(a.name).toBe('Board Utama')
  expect(t.db.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'Proyek Pertama' }])
})
test('kartu catatan dibuat dan dimuat kembali', () => {
  const board = getOrCreateDefaultBoard(t.db)
  const c = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 10, y: 20, content: 'halo' })
  expect(c).toMatchObject({ type: 'catatan', x: 10, y: 20, content: 'halo', asset: null })
  expect(loadBoard(t.db).cards.map(x => x.id)).toEqual([c.id])
})
test('saveCards batch 5.000 patch dalam satu transaksi < 300 ms', () => {
  const board = getOrCreateDefaultBoard(t.db)
  const ids: string[] = []
  t.db.transaction(() => { for (let i = 0; i < 5000; i++) ids.push(insertCard(t.db, { boardId: board.id, type: 'catatan', x: 0, y: 0 }).id) })()
  const start = performance.now()
  saveCards(t.db, ids.map((id, i) => ({ id, x: i, y: i * 2 })))
  expect(performance.now() - start).toBeLessThan(300)
  const c = loadBoard(t.db).cards.find(x => x.id === ids[4999])!
  expect([c.x, c.y]).toEqual([4999, 9998])
})
test('deleteCards menghapus kartu dan link, tidak menghapus asset', () => {
  const board = getOrCreateDefaultBoard(t.db)
  const asset = insertAsset(t.db, { sha256: 'a'.repeat(64), vaultPath: 'files/aa/x.pdf', originalName: 'x.pdf', mime: 'application/pdf', sizeBytes: 3 })
  const a = insertCard(t.db, { boardId: board.id, type: 'file', x: 0, y: 0, assetId: asset.id })
  const b = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 0, y: 0 })
  createLink(t.db, a.id, b.id)
  deleteCards(t.db, [a.id])
  const loaded = loadBoard(t.db)
  expect(loaded.cards.map(c => c.id)).toEqual([b.id]); expect(loaded.links).toEqual([])
  expect(t.db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 })
})
test('link ke kartu yang tidak ada → error; unlink menghapus', () => {
  const board = getOrCreateDefaultBoard(t.db)
  const a = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 0, y: 0 })
  expect(() => createLink(t.db, a.id, 'tidak-ada')).toThrow()
  const b = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 0, y: 0 })
  const l = createLink(t.db, a.id, b.id)
  expect(loadBoard(t.db).links).toEqual([l]); deleteLink(t.db, l.id); expect(loadBoard(t.db).links).toEqual([])
})
test('viewport tersimpan di board', () => {
  saveViewport(t.db, { x: 5, y: -3, zoom: 1.5 })
  expect(loadBoard(t.db).viewport).toEqual({ x: 5, y: -3, zoom: 1.5 })
})
test('asset gambar memakai URL alfonso-vault, bukan path absolut', () => {
  const board = getOrCreateDefaultBoard(t.db)
  const asset = insertAsset(t.db, { sha256: 'b'.repeat(64), vaultPath: 'files/bb/y.png', originalName: 'y.png', mime: 'image/png', sizeBytes: 3 })
  insertCard(t.db, { boardId: board.id, type: 'gambar', x: 0, y: 0, assetId: asset.id })
  const c = loadBoard(t.db).cards[0]
  expect(c.asset).toMatchObject({ status: 'memproses', previewUrl: 'alfonso-vault://files/bb/y.png', originalName: 'y.png' })
})
test('PSD tanpa thumbnail tidak dipratinjau langsung (browser tidak bisa menampilkannya)', () => {
  const asset = insertAsset(t.db, { sha256: 'c'.repeat(64), vaultPath: 'files/cc/z.psd', originalName: 'z.psd', mime: 'image/vnd.adobe.photoshop', sizeBytes: 3 })
  expect(asset.previewUrl).toBeNull()
})
