import { test, expect, beforeEach, afterEach } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { openDatabase, setSetting } from '../../src/main/db/database'
import { getActiveBoard, insertCard, loadBoard, saveViewport } from '../../src/main/board/repo'
import {
  listProjects, createProject, renameProject, createBoard, renameBoard, setActiveBoard
} from '../../src/main/projects/repo'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

test('database kosong → "Proyek Pertama" dengan "Board Utama" dibuat sekali dan jadi board aktif', () => {
  const a = getActiveBoard(t.db)
  const b = getActiveBoard(t.db)
  expect(a.id).toBe(b.id)
  const projects = listProjects(t.db)
  expect(projects).toHaveLength(1)
  expect(projects[0]).toMatchObject({ name: 'Proyek Pertama', boards: [{ id: a.id, name: 'Board Utama' }] })
})

test('proyek baru otomatis punya satu board; daftar urut sesuai dibuat', () => {
  getActiveBoard(t.db)
  const p = createProject(t.db, '  Riset Hukum ')
  expect(p.name).toBe('Riset Hukum')
  expect(p.boards).toHaveLength(1)
  expect(p.boards[0].name).toBe('Board Utama')
  const b2 = createBoard(t.db, p.id, 'Sketsa')
  const list = listProjects(t.db)
  expect(list.map((x) => x.name)).toEqual(['Proyek Pertama', 'Riset Hukum'])
  expect(list[1].boards.map((b) => b.id)).toEqual([p.boards[0].id, b2.id])
})

test('nama kosong atau lebih dari 80 karakter ditolak', () => {
  expect(() => createProject(t.db, '   ')).toThrow(/Nama/)
  expect(() => createProject(t.db, 'x'.repeat(81))).toThrow(/Nama/)
  const p = createProject(t.db, 'A')
  expect(() => createBoard(t.db, p.id, '')).toThrow(/Nama/)
  expect(() => createBoard(t.db, 'tidak-ada', 'B')).toThrow(/Proyek/)
})

test('ganti nama proyek dan board', () => {
  const p = createProject(t.db, 'Lama')
  renameProject(t.db, p.id, 'Baru')
  renameBoard(t.db, p.boards[0].id, 'Papan')
  const got = listProjects(t.db).find((x) => x.id === p.id)!
  expect(got.name).toBe('Baru')
  expect(got.boards[0].name).toBe('Papan')
  expect(() => renameProject(t.db, 'tidak-ada', 'X')).toThrow()
  expect(() => renameBoard(t.db, p.boards[0].id, ' ')).toThrow(/Nama/)
})

test('setActiveBoard: id tak dikenal ditolak; pilihan bertahan setelah database dibuka ulang', () => {
  getActiveBoard(t.db)
  const p = createProject(t.db, 'Dua')
  expect(() => setActiveBoard(t.db, 'tidak-ada')).toThrow(/Board/)
  setActiveBoard(t.db, p.boards[0].id)
  t.db.close()
  const db = openDatabase(t.vault.db)
  expect(getActiveBoard(db).id).toBe(p.boards[0].id)
  db.close()
})

test('setting board aktif rusak → board pertama', () => {
  const first = getActiveBoard(t.db)
  createProject(t.db, 'Dua')
  setSetting(t.db, 'board.active', 'sudah-dihapus')
  expect(getActiveBoard(t.db).id).toBe(first.id)
})

test('loadBoard dan saveViewport hanya menyentuh board yang diminta', () => {
  const first = getActiveBoard(t.db)
  const p = createProject(t.db, 'Dua')
  const second = p.boards[0]
  insertCard(t.db, { boardId: first.id, type: 'catatan', x: 0, y: 0, content: 'satu' })
  insertCard(t.db, { boardId: second.id, type: 'catatan', x: 0, y: 0, content: 'dua' })
  saveViewport(t.db, { x: 1, y: 2, zoom: 2 }, second.id)
  expect(loadBoard(t.db, second.id).cards.map((c) => c.content)).toEqual(['dua'])
  expect(loadBoard(t.db, second.id).viewport).toEqual({ x: 1, y: 2, zoom: 2 })
  expect(loadBoard(t.db).viewport).toBeNull()
  // Tanpa id → board aktif.
  setActiveBoard(t.db, second.id)
  expect(loadBoard(t.db).id).toBe(second.id)
  expect(loadBoard(t.db).name).toBe('Board Utama')
})

test('locateCard: board dan proyek sebuah kartu', async () => {
  const { locateCard } = await import('../../src/main/board/repo')
  const p = createProject(t.db, 'Dua')
  const c = insertCard(t.db, { boardId: p.boards[0].id, type: 'catatan', x: 0, y: 0 })
  expect(locateCard(t.db, c.id)).toEqual({ boardId: p.boards[0].id, projectId: p.id })
  expect(locateCard(t.db, 'tidak-ada')).toBeNull()
})
