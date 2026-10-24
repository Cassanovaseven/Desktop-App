import type Database from 'better-sqlite3'
import type { BoardSummary, ProjectDTO } from '../../shared/library-types'
import { setSetting } from '../db/database'
import { ACTIVE_BOARD_KEY, getBoardRow, getOrCreateDefaultBoard, newId } from '../board/repo'

type DB = Database.Database

const now = (): string => new Date().toISOString()
export const MAX_NAME = 80

function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n || n.length > MAX_NAME) throw new Error(`Nama harus diisi, maksimal ${MAX_NAME} karakter.`)
  return n
}

export function listProjects(db: DB): ProjectDTO[] {
  getOrCreateDefaultBoard(db)
  const projects = db.prepare('SELECT id, name FROM projects ORDER BY rowid').all() as { id: string; name: string }[]
  const boards = db.prepare('SELECT id, project_id, name FROM boards ORDER BY rowid').all() as { id: string; project_id: string; name: string }[]
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    boards: boards.filter((b) => b.project_id === p.id).map((b): BoardSummary => ({ id: b.id, name: b.name }))
  }))
}

function getProject(db: DB, id: string): ProjectDTO {
  const p = listProjects(db).find((x) => x.id === id)
  if (!p) throw new Error('Proyek tidak ditemukan')
  return p
}

export function createProject(db: DB, name: string): ProjectDTO {
  const n = cleanName(name)
  getOrCreateDefaultBoard(db)
  const id = newId()
  db.transaction(() => {
    db.prepare('INSERT INTO projects (id, name, icon, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)').run(id, n, now(), now())
    db.prepare('INSERT INTO boards (id, project_id, name, viewport_json, background) VALUES (?, ?, ?, NULL, NULL)').run(newId(), id, 'Board Utama')
  })()
  return getProject(db, id)
}

export function renameProject(db: DB, id: string, name: string): void {
  const n = cleanName(name)
  const r = db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(n, now(), id)
  if (r.changes === 0) throw new Error('Proyek tidak ditemukan')
}

export function createBoard(db: DB, projectId: string, name: string): BoardSummary {
  const n = cleanName(name)
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('Proyek tidak ditemukan')
  const id = newId()
  db.prepare('INSERT INTO boards (id, project_id, name, viewport_json, background) VALUES (?, ?, ?, NULL, NULL)').run(id, projectId, n)
  return { id, name: n }
}

export function renameBoard(db: DB, id: string, name: string): void {
  const n = cleanName(name)
  const r = db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(n, id)
  if (r.changes === 0) throw new Error('Board tidak ditemukan')
}

export function setActiveBoard(db: DB, id: string): void {
  if (!getBoardRow(db, id)) throw new Error('Board tidak ditemukan')
  setSetting(db, ACTIVE_BOARD_KEY, id)
}
