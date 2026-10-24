import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { generatedFileName, slug } from '../../src/main/studio/naming'
import { saveResultAsset } from '../../src/main/studio/results'
import { savePrompt } from '../../src/main/studio/prompts'
import { createGenerations, getGeneration } from '../../src/main/studio/generations'
import { getActiveBoard, insertCard, loadBoard, saveViewport } from '../../src/main/board/repo'
import { createBoard, createProject, setActiveBoard } from '../../src/main/projects/repo'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

const d = new Date(2026, 9, 23, 10, 0, 0)

test('slug: huruf kecil ASCII, aman untuk Windows, tidak kosong', () => {
  expect(slug('Ikon Aplikasi — Alfonsó!')).toBe('ikon-aplikasi-alfonso')
  expect(slug('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  expect(slug('  ')).toBe('tanpa-nama')
  expect(slug('x'.repeat(100)).length).toBeLessThanOrEqual(40)
})

test('nama file spec 9.2 dengan nomor urut per hari', () => {
  const dir = path.join(t.vault.generated, '2026-10')
  const n1 = generatedFileName(dir, { project: 'Alfonso', jenis: 'ikon', subject: 'Board', lane: 'cloud', date: d, ext: 'png' })
  expect(n1).toBe('alfonso_ikon_board_cloud_20261023_001.png')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, n1), 'x')
  fs.writeFileSync(path.join(dir, 'alfonso_ikon_board_cloud_20261023_007.png'), 'x')
  expect(generatedFileName(dir, { project: 'Alfonso', jenis: 'ikon', subject: 'Board', lane: 'cloud', date: d, ext: 'png' })).toBe('alfonso_ikon_board_cloud_20261023_008.png')
  expect(generatedFileName(dir, { project: 'Alfonso', jenis: 'ikon', subject: 'Board', lane: 'kode', date: d, ext: 'svg' })).toBe('alfonso_ikon_board_kode_20261023_001.svg')
})

function setup(lane: 'kode' | 'cloud' = 'kode') {
  const p = lane === 'kode'
    ? savePrompt(t.db, t.vault, { name: 'Lencana Biru', lane: 'kode', targetModel: 'svg', template: '<svg>[X]</svg>' })
    : savePrompt(t.db, t.vault, { name: 'Ikon', lane: 'cloud', targetModel: 'm/x', template: '[X]' })
  return p
}
const tmpFile = (name: string, content: string): string => {
  const f = path.join(t.base, name)
  fs.writeFileSync(f, content)
  return f
}

test('hasil disimpan di generated/YYYY-MM dengan nama spec, tag otomatis, job ekstrak, generation selesai', async () => {
  const p = setup()
  const board = getActiveBoard(t.db)
  const [g] = createGenerations(t.db, { promptId: p.id, variables: { X: 'a' } }, { boardId: board.id })
  const r = await saveResultAsset(t.db, t.vault, { generationId: g.id, boardId: board.id, at: { x: 10, y: 20 }, file: tmpFile('hasil.svg', '<svg/>'), ext: 'svg', date: d })
  expect(r.asset.originalName).toBe('proyek-pertama_gambar_lencana-biru_kode_20261023_001.svg')
  const row = t.db.prepare('SELECT vault_path, mime FROM assets WHERE id = ?').get(r.asset.id) as { vault_path: string; mime: string }
  expect(row).toEqual({ vault_path: 'generated/2026-10/proyek-pertama_gambar_lencana-biru_kode_20261023_001.svg', mime: 'image/svg+xml' })
  expect(fs.readFileSync(path.join(t.vault.root, row.vault_path), 'utf8')).toBe('<svg/>')
  const tags = (t.db.prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(r.asset.id) as { tag: string }[]).map((x) => x.tag)
  expect(tags).toEqual(['jalur:kode', 'jenis:gambar', 'status:draf', 'sumber:svg'])
  expect(t.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'ekstrak'").get()).toEqual({ n: 1 })
  expect(getGeneration(t.db, g.id)).toMatchObject({ status: 'selesai', resultAssetId: r.asset.id })
  expect(r.card).toMatchObject({ boardId: board.id, type: 'gambar', x: 10, y: 20, assetId: r.asset.id })
  expect(r.link).toBeNull()
  // Bisa dicari lewat tag sumber.
  expect(t.db.prepare("SELECT asset_id FROM assets_fts WHERE assets_fts MATCH '\"sumber:svg\"'").get()).toEqual({ asset_id: r.asset.id })
})

test('kartu sumber → hasil di kanannya, bertumpuk ke bawah, dengan panah hasil', async () => {
  const p = setup()
  const board = getActiveBoard(t.db)
  const src = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 100, y: 50, w: 240, h: 160, content: 'ide' })
  const gens = createGenerations(t.db, { promptId: p.id, variables: { X: 'a' }, sourceCardId: src.id, params: { jumlah: 2 } }, { boardId: board.id })
  const r1 = await saveResultAsset(t.db, t.vault, { generationId: gens[0].id, boardId: board.id, at: null, file: tmpFile('a.svg', '<svg>1</svg>'), ext: 'svg', date: d })
  const r2 = await saveResultAsset(t.db, t.vault, { generationId: gens[1].id, boardId: board.id, at: null, file: tmpFile('b.svg', '<svg>2</svg>'), ext: 'svg', date: d })
  expect([r1.card.x, r1.card.y]).toEqual([400, 50])
  expect([r2.card.x, r2.card.y]).toEqual([400, 270])
  expect(r1.link).toMatchObject({ fromId: src.id, toId: r1.card.id, kind: 'hasil' })
  expect(loadBoard(t.db, board.id).links.map((l) => l.kind)).toEqual(['hasil', 'hasil'])
  expect(r2.asset.originalName).toMatch(/_002\.svg$/)
})

test('hasil identik → aset lama dipakai, tanpa file baru; board asal dipakai walau board aktif pindah', async () => {
  const p = setup()
  const first = getActiveBoard(t.db)
  const [g1, g2] = createGenerations(t.db, { promptId: p.id, variables: { X: 'a' }, params: { jumlah: 2 } }, { boardId: first.id })
  const a = await saveResultAsset(t.db, t.vault, { generationId: g1.id, boardId: first.id, at: { x: 0, y: 0 }, file: tmpFile('a.svg', '<svg/>'), ext: 'svg', date: d })
  const other = createProject(t.db, 'Lain')
  setActiveBoard(t.db, other.boards[0].id)
  const b = await saveResultAsset(t.db, t.vault, { generationId: g2.id, boardId: first.id, at: { x: 0, y: 300 }, file: tmpFile('b.svg', '<svg/>'), ext: 'svg', date: d })
  expect(b.asset.id).toBe(a.asset.id)
  expect(b.card.boardId).toBe(first.id)
  expect(fs.readdirSync(path.join(t.vault.generated, '2026-10'))).toHaveLength(1)
  expect(getGeneration(t.db, g2.id)?.resultAssetId).toBe(a.asset.id)
})

test('tanpa posisi dan tanpa sumber → dekat tengah viewport board; video → kartu file dan jenis motion di nama', async () => {
  const p = savePrompt(t.db, t.vault, { name: 'Splash', lane: 'kode', targetModel: 'p5-motion', template: 'function draw(){}' })
  const board = createBoard(t.db, getActiveBoard(t.db).projectId, 'Kedua')
  saveViewport(t.db, { x: -1000, y: -500, zoom: 1 }, board.id)
  const [g] = createGenerations(t.db, { promptId: p.id, variables: {} }, { boardId: board.id })
  const r = await saveResultAsset(t.db, t.vault, { generationId: g.id, boardId: board.id, at: null, file: tmpFile('v.mp4', 'video'), ext: 'mp4', date: d })
  expect(r.card).toMatchObject({ type: 'file', boardId: board.id })
  expect(r.card.x).toBeGreaterThan(1000)
  expect(r.card.y).toBeGreaterThan(500)
  expect(r.asset.originalName).toBe('proyek-pertama_motion_splash_kode_20261023_001.mp4')
})
