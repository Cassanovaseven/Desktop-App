import type Database from 'better-sqlite3'
import type { Logger } from '../logger'
import { redact } from '../logger'
import { insertJob, type JobRow, type JobStatus } from './store'

export interface JobQueueOptions {
  db: Database.Database
  run: (job: JobRow) => Promise<void>
  log: Logger
  concurrency?: number
  maxAttempts?: number
  retryDelayMs?: number
  secrets?: () => string[]
  onFinalFailure?: (job: JobRow, message: string) => void
}

interface DbJob { id: string; kind: string; payload_json: string | null; status: JobStatus; attempts: number }

export class JobQueue {
  private readonly o: Required<Omit<JobQueueOptions, 'onFinalFailure'>> & Pick<JobQueueOptions, 'onFinalFailure'>
  private running = false
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly timers = new Set<NodeJS.Timeout>()

  constructor(opts: JobQueueOptions) {
    this.o = { concurrency: 2, maxAttempts: 3, retryDelayMs: 1000, secrets: () => [], ...opts }
  }

  start(): void {
    // Job yang tertinggal 'berjalan' karena crash dilanjutkan dari awal.
    this.o.db.prepare("UPDATE jobs SET status = 'antre', updated_at = ? WHERE status = 'berjalan'").run(new Date().toISOString())
    this.running = true
    this.pump()
  }

  async stop(): Promise<void> {
    this.running = false
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    await Promise.all(this.inFlight.values())
  }

  enqueue(kind: string, payload: Record<string, unknown>): string {
    const id = insertJob(this.o.db, kind, payload)
    this.pump()
    return id
  }

  kick(): void {
    this.pump()
  }

  private setStatus(id: string, status: JobStatus, extra: { attempts?: number; lastError?: string | null } = {}): void {
    const sets = ['status = ?', 'updated_at = ?']
    const args: unknown[] = [status, new Date().toISOString()]
    if (extra.attempts !== undefined) { sets.push('attempts = ?'); args.push(extra.attempts) }
    if (extra.lastError !== undefined) { sets.push('last_error = ?'); args.push(extra.lastError) }
    this.o.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
  }

  private nextJob(): DbJob | undefined {
    const busy = [...this.inFlight.keys()]
    const placeholders = busy.map(() => '?').join(',')
    const sql = `SELECT id, kind, payload_json, status, attempts FROM jobs WHERE status = 'antre'${busy.length ? ` AND id NOT IN (${placeholders})` : ''} ORDER BY created_at, rowid LIMIT 1`
    return this.o.db.prepare(sql).get(...busy) as DbJob | undefined
  }

  private pump(): void {
    while (this.running && this.inFlight.size < this.o.concurrency) {
      const j = this.nextJob()
      if (!j) return
      const attempts = j.attempts + 1
      this.setStatus(j.id, 'berjalan', { attempts })
      const job: JobRow = { id: j.id, kind: j.kind, payload: j.payload_json ? JSON.parse(j.payload_json) : {}, status: 'berjalan', attempts }
      const p = this.execute(job).finally(() => {
        this.inFlight.delete(job.id)
        this.pump()
      })
      this.inFlight.set(job.id, p)
    }
  }

  private async execute(job: JobRow): Promise<void> {
    try {
      await this.o.run(job)
      this.setStatus(job.id, 'selesai', { lastError: null })
    } catch (err) {
      const message = redact((err as Error).message || String(err), this.o.secrets())
      if (job.attempts >= this.o.maxAttempts) {
        this.setStatus(job.id, 'gagal', { lastError: message })
        this.o.log.warn(`Job ${job.kind} ${job.id} gagal: ${message}`)
        this.o.onFinalFailure?.(job, message)
      } else if (this.o.retryDelayMs > 0) {
        // Ditahan sebagai 'berjalan' sampai jeda selesai supaya tidak langsung diambil lagi.
        this.setStatus(job.id, 'berjalan', { lastError: message })
        const t = setTimeout(() => {
          this.timers.delete(t)
          this.setStatus(job.id, 'antre')
          this.pump()
        }, this.o.retryDelayMs * job.attempts)
        this.timers.add(t)
      } else {
        this.setStatus(job.id, 'antre', { lastError: message })
      }
    }
  }
}
