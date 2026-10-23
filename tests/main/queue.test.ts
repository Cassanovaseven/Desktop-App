import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { JobQueue } from '../../src/main/jobs/queue'
import { insertJob, type JobRow } from '../../src/main/jobs/store'

let t: TmpVault
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

const row = (id: string) => t.db.prepare('SELECT status, attempts, last_error FROM jobs WHERE id = ?').get(id) as { status: string; attempts: number; last_error: string | null }
const deferred = () => { let resolve!: () => void; const p = new Promise<void>(r => (resolve = r)); return { p, resolve } }

test('job antre → berjalan → selesai, attempts naik', async () => {
  const seen: string[] = []
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, run: async (job) => { seen.push(row(job.id).status) } })
  const id = q.enqueue('ekstrak', { assetId: 'a1' })
  q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('selesai'))
  expect(seen).toEqual(['berjalan']); expect(row(id).attempts).toBe(1)
  await q.stop()
})
test('gagal dicoba ulang sampai maxAttempts, lalu gagal dengan last_error dan onFinalFailure', async () => {
  const onFinalFailure = vi.fn()
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, maxAttempts: 3, onFinalFailure, run: async () => { throw new Error('rusak') } })
  const id = q.enqueue('ekstrak', { assetId: 'a1' }); q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('gagal'))
  expect(row(id)).toMatchObject({ attempts: 3, last_error: 'rusak' })
  expect(onFinalFailure).toHaveBeenCalledWith(expect.objectContaining({ id, payload: { assetId: 'a1' } }), 'rusak')
  await q.stop()
})
test('start mengembalikan job berjalan (sisa crash) ke antre lalu menjalankannya', async () => {
  const id = insertJob(t.db, 'ekstrak', { assetId: 'x' })
  t.db.prepare("UPDATE jobs SET status = 'berjalan' WHERE id = ?").run(id)
  const run = vi.fn(async () => {})
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, run }); q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('selesai'))
  expect(run).toHaveBeenCalledTimes(1)
  await q.stop()
})
test('concurrency 2 dipatuhi', async () => {
  let active = 0; let peak = 0; const gate = deferred()
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, concurrency: 2, run: async () => { active++; peak = Math.max(peak, active); await gate.p; active-- } })
  const ids = [1, 2, 3, 4, 5].map(i => q.enqueue('ekstrak', { i })); q.start()
  await vi.waitFor(() => expect(active).toBe(2))
  gate.resolve()
  await vi.waitFor(() => expect(ids.every(id => row(id).status === 'selesai')).toBe(true))
  expect(peak).toBe(2)
  await q.stop()
})
test('stop menunggu job berjalan dan tidak mengambil job baru', async () => {
  const gate = deferred(); const started: JobRow[] = []
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, concurrency: 1, run: async (job) => { started.push(job); await gate.p } })
  const a = q.enqueue('ekstrak', { n: 1 }); const b = q.enqueue('ekstrak', { n: 2 }); q.start()
  await vi.waitFor(() => expect(started).toHaveLength(1))
  const stopping = q.stop(); gate.resolve(); await stopping
  expect(row(a).status).toBe('selesai'); expect(row(b).status).toBe('antre'); expect(started).toHaveLength(1)
})
test('pesan error disamarkan sebelum disimpan', async () => {
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, maxAttempts: 1, secrets: () => ['rahasia42'], run: async () => { throw new Error('gagal rahasia42') } })
  const id = q.enqueue('ekstrak', {}); q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('gagal'))
  expect(row(id).last_error).toBe('gagal [DISEMBUNYIKAN]')
  await q.stop()
})
test('kick menjalankan job yang dimasukkan dari luar antrean', async () => {
  const run = vi.fn(async () => {})
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, run }); q.start()
  const id = insertJob(t.db, 'ekstrak', {}); q.kick()
  await vi.waitFor(() => expect(row(id).status).toBe('selesai'))
  await q.stop()
})
test('error permanen langsung gagal tanpa dicoba ulang', async () => {
  const run = vi.fn(async () => { throw Object.assign(new Error('PDF rusak'), { permanent: true }) })
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, maxAttempts: 3, run })
  const id = q.enqueue('ekstrak', {}); q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('gagal'))
  expect(run).toHaveBeenCalledTimes(1)
  await q.stop()
})
test('start dua kali tidak mengembalikan job yang sedang berjalan ke antre', async () => {
  const gate = deferred(); const run = vi.fn(async () => { await gate.p })
  const q = new JobQueue({ db: t.db, log, retryDelayMs: 0, run })
  const id = q.enqueue('ekstrak', {}); q.start()
  await vi.waitFor(() => expect(row(id).status).toBe('berjalan'))
  q.start(); expect(row(id).status).toBe('berjalan')
  gate.resolve(); await vi.waitFor(() => expect(row(id).status).toBe('selesai'))
  expect(run).toHaveBeenCalledTimes(1)
  await q.stop()
})
