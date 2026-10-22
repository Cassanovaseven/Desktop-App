import type Database from 'better-sqlite3'
import crypto from 'crypto'

export type JobStatus = 'antre' | 'berjalan' | 'selesai' | 'gagal'
export interface JobRow { id: string; kind: string; payload: Record<string, unknown>; status: JobStatus; attempts: number }

export function insertJob(db: Database.Database, kind: string, payload: Record<string, unknown>): string {
  const id = crypto.randomUUID()
  const ts = new Date().toISOString()
  db.prepare("INSERT INTO jobs (id, kind, payload_json, status, attempts, last_error, created_at, updated_at) VALUES (?, ?, ?, 'antre', 0, NULL, ?, ?)").run(
    id, kind, JSON.stringify(payload), ts, ts
  )
  return id
}
