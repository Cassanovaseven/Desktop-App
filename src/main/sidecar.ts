import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import path from 'path'
import type { SidecarStatus } from '../shared/types'
import type { Logger } from './logger'

export const MSG_PYTHON_MISSING = 'Python sidecar tidak ditemukan. Jalankan: npm run sidecar:setup'
export const MSG_CRASH_LOOP = 'Sidecar berhenti berulang kali. Lihat log.'

const RESTART_DELAYS_MS = [1000, 2000, 4000]
const CRASH_WINDOW_MS = 60_000
const HEALTH_INTERVAL_MS = 250

// Peluncur `py` sengaja tidak dipakai: ia membuat proses anak yang sulit dimatikan.
export function findPython(appRoot: string): string | null {
  if (process.env.ALFONSO_PYTHON) return process.env.ALFONSO_PYTHON
  const venv = path.join(appRoot, 'sidecar', '.venv', 'Scripts', 'python.exe')
  return fs.existsSync(venv) ? venv : null
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

export interface SidecarManagerOptions {
  command: string | null
  args: string[]
  cwd: string
  log: Logger
  env?: NodeJS.ProcessEnv
  healthTimeoutMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class SidecarManager {
  private readonly opts: SidecarManagerOptions
  private readonly healthTimeoutMs: number
  private status: SidecarStatus = { state: 'stopped', port: null, message: null, restarts: 0 }
  private readonly listeners = new Set<(s: SidecarStatus) => void>()
  private child: ChildProcess | null = null
  private childExited: Promise<void> = Promise.resolve()
  private currentToken = ''
  private stopping = false
  private crashTimes: number[] = []
  private restartTimer: NodeJS.Timeout | null = null

  constructor(opts: SidecarManagerOptions) {
    this.opts = opts
    this.healthTimeoutMs = opts.healthTimeoutMs ?? 15000
  }

  get token(): string {
    return this.currentToken
  }

  getStatus(): SidecarStatus {
    return { ...this.status }
  }

  onStatus(cb: (s: SidecarStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async start(): Promise<void> {
    this.stopping = false
    this.crashTimes = []
    this.status.restarts = 0
    await this.launch()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
          const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          k.once('exit', () => resolve())
          k.once('error', () => resolve())
        })
      } else {
        child.kill()
      }
      await this.childExited
    }
    this.child = null
    this.setStatus({ state: 'stopped', port: null, message: null })
  }

  private setStatus(patch: Partial<SidecarStatus>): void {
    this.status = { ...this.status, ...patch }
    const snapshot = this.getStatus()
    for (const cb of this.listeners) cb(snapshot)
  }

  private async launch(): Promise<void> {
    const { command, args, cwd, log } = this.opts
    if (command === null) {
      log.error(MSG_PYTHON_MISSING)
      this.setStatus({ state: 'failed', port: null, message: MSG_PYTHON_MISSING })
      return
    }

    this.currentToken = crypto.randomBytes(32).toString('hex')
    const port = await getFreePort()
    if (this.status.state !== 'restarting') this.setStatus({ state: 'starting', port: null, message: null })

    let spawnFailed = false
    let exited = false
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...this.opts.env, ALFONSO_SIDECAR_TOKEN: this.currentToken, ALFONSO_SIDECAR_PORT: String(port) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    this.childExited = new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })
    child.stdout?.on('data', (d: Buffer) => log.info(`sidecar: ${d.toString().trimEnd()}`))
    child.stderr?.on('data', (d: Buffer) => log.warn(`sidecar: ${d.toString().trimEnd()}`))
    child.once('error', (err: NodeJS.ErrnoException) => {
      spawnFailed = true
      log.error(`Sidecar gagal dijalankan (${err.code ?? err.message})`)
      this.setStatus({ state: 'failed', port: null, message: MSG_PYTHON_MISSING })
    })
    child.once('exit', (code, signal) => {
      exited = true
      if (this.stopping || spawnFailed || this.child !== child) return
      log.warn(`Sidecar keluar (kode ${code}, sinyal ${signal})`)
      this.handleCrash()
    })

    const healthy = await this.waitHealthy(port, () => exited || spawnFailed || this.stopping)
    if (healthy && this.child === child && !this.stopping) {
      log.info(`Sidecar siap di port ${port}`)
      this.setStatus({ state: 'ready', port, message: null })
    } else if (!healthy && !exited && !spawnFailed && !this.stopping) {
      log.warn('Sidecar tidak menjawab /health tepat waktu; dihentikan')
      child.kill()
    }
  }

  private async waitHealthy(port: number, aborted: () => boolean): Promise<boolean> {
    const deadline = Date.now() + this.healthTimeoutMs
    while (Date.now() < deadline && !aborted()) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { 'X-Alfonso-Token': this.currentToken },
          signal: AbortSignal.timeout(1000)
        })
        if (res.status === 200) return true
      } catch {
        // belum siap
      }
      await sleep(HEALTH_INTERVAL_MS)
    }
    return false
  }

  private handleCrash(): void {
    const now = Date.now()
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now]
    this.child = null
    if (this.crashTimes.length > RESTART_DELAYS_MS.length) {
      this.opts.log.error(MSG_CRASH_LOOP)
      this.setStatus({ state: 'failed', port: null, message: MSG_CRASH_LOOP })
      return
    }
    const delay = RESTART_DELAYS_MS[this.crashTimes.length - 1]
    this.setStatus({ state: 'restarting', port: null, message: null, restarts: this.status.restarts + 1 })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) void this.launch()
    }, delay)
  }
}
