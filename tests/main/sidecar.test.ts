import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SidecarManager, findPython, getFreePort } from '../../src/main/sidecar'
import { createLogger } from '../../src/main/logger'

const fixture = path.resolve(__dirname, '../fixtures/fake-sidecar.mjs')
let tmp: string
let logsDir: string
const managers: SidecarManager[] = []

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-sidecar-'))
  logsDir = path.join(tmp, 'logs'); fs.mkdirSync(logsDir)
})
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function manager(env: Record<string, string> = {}, opts: { healthTimeoutMs?: number; cwd?: string } = {}): SidecarManager {
  const cwd = opts.cwd ?? tmp
  fs.mkdirSync(cwd, { recursive: true })
  let m: SidecarManager | null = null
  const log = createLogger(logsDir, () => (m ? [m.token] : []))
  m = new SidecarManager({ command: process.execPath, args: [fixture], cwd, log, env, healthTimeoutMs: opts.healthTimeoutMs })
  managers.push(m)
  return m
}
const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }
const logText = (): string => fs.readdirSync(logsDir).map(f => fs.readFileSync(path.join(logsDir, f), 'utf8')).join('')
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

test('start sampai ready dengan port', async () => {
  const m = manager(); await m.start()
  expect(m.getStatus()).toMatchObject({ state: 'ready', restarts: 0 }); expect(m.getStatus().port).toBeGreaterThan(0)
  await m.stop()
})
test('python tidak ada → failed dengan pesan jelas, tanpa throw', async () => {
  const m = new SidecarManager({ command: null, args: [], cwd: tmp, log })
  await m.start()
  expect(m.getStatus()).toMatchObject({ state: 'failed', message: 'Python sidecar tidak ditemukan. Jalankan: npm run sidecar:setup' })
})
test('perintah yang tidak ada (ENOENT) → failed, tanpa crash', async () => {
  const m = new SidecarManager({ command: path.join(tmp, 'tidak-ada', 'python.exe'), args: [], cwd: tmp, log })
  managers.push(m)
  await m.start()
  expect(m.getStatus()).toMatchObject({ state: 'failed', message: 'Python sidecar tidak ditemukan. Jalankan: npm run sidecar:setup' })
})
test('crash berulang berakhir failed', async () => {
  const m = manager({ FAKE_CRASH: '1' }, { healthTimeoutMs: 500 }); await m.start()
  await vi.waitFor(() => expect(m.getStatus().state).toBe('failed'), { timeout: 20000 })
  expect(m.getStatus()).toMatchObject({ message: 'Sidecar berhenti berulang kali. Lihat log.', restarts: 3 })
}, 25000)
test('stop tidak meninggalkan proses', async () => {
  const m = manager(); await m.start(); const pid = (m as any).child.pid; await m.stop()
  expect(isAlive(pid)).toBe(false); expect(m.getStatus().state).toBe('stopped')
})
test('cwd berspasi dan non-ASCII', async () => {
  const m = manager({}, { cwd: path.join(tmp, 'Dokumen Kerja', 'Vault Alfonsó') }); await m.start()
  expect(m.getStatus().state).toBe('ready'); await m.stop()
})
test('token tidak pernah masuk log', async () => {
  const m = manager(); await m.start(); await m.stop()
  expect(m.token).toMatch(/^[0-9a-f]{64}$/)
  expect(logText()).not.toContain(m.token)
})
test('onStatus memberi tahu perubahan status dan bisa berhenti berlangganan', async () => {
  const m = manager(); const seen: string[] = []
  const off = m.onStatus(s => seen.push(s.state))
  await m.start(); off(); await m.stop()
  expect(seen).toEqual(['starting', 'ready'])
})
test('getFreePort memberi port di 127.0.0.1', async () => {
  expect(await getFreePort()).toBeGreaterThan(0)
})
test('findPython: ALFONSO_PYTHON didahulukan, venv kosong → null', () => {
  const saved = process.env.ALFONSO_PYTHON
  try {
    process.env.ALFONSO_PYTHON = 'C:/py/python.exe'
    expect(findPython(tmp)).toBe('C:/py/python.exe')
    delete process.env.ALFONSO_PYTHON
    expect(findPython(tmp)).toBeNull()
    const exe = path.join(tmp, 'sidecar', '.venv', 'Scripts', 'python.exe')
    fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '')
    expect(findPython(tmp)).toBe(exe)
  } finally {
    if (saved === undefined) delete process.env.ALFONSO_PYTHON; else process.env.ALFONSO_PYTHON = saved
  }
})
