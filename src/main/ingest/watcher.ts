import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { CardDTO, Point } from '../../shared/board-types'
import type { Logger } from '../logger'
import { getSetting, setSetting } from '../db/database'

const KEY = 'ingest.watchFolders'
const MAX_SCAN = 10_000
const BATCH = 50
// Kolom "Masuk" di kiri Board, supaya kartu dari folder tidak menimpa susunan yang ada.
const INBOX_X = -1700
const INBOX_RIGHT = -400

export const MSG_VAULT_FOLDER = 'Folder vault tidak bisa dipantau.'
export const MSG_NO_FOLDER = 'Folder tidak ditemukan.'

export interface FolderWatcherOptions {
  db: Database.Database
  vaultRoot: string
  log: Logger
  /** Mengimpor file (hanya dibaca dan disalin ke vault; file sumber tidak pernah diubah). */
  importPaths: (paths: string[], at: Point) => Promise<CardDTO[]>
  stableMs?: number
}

/** File sementara unduhan/editor dan file tersembunyi tidak diimpor. */
export function isIgnored(relOrName: string): boolean {
  const parts = relOrName.split(/[\\/]/)
  if (parts.some((p) => p.startsWith('.'))) return true
  const name = parts[parts.length - 1]
  return name.startsWith('~$') || /\.(crdownload|part|tmp|download|partial)$/i.test(name)
}

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function createFolderWatcher(o: FolderWatcherOptions) {
  const stableMs = o.stableMs ?? 2000
  const vaultRoot = path.resolve(o.vaultRoot)
  const watchers = new Map<string, fs.FSWatcher>()
  const pending = new Map<string, { size: number; mtimeMs: number; timer: NodeJS.Timeout }>()
  // Impor berurutan, supaya file yang sama tidak diimpor dua kali bersamaan.
  let chain: Promise<unknown> = Promise.resolve()

  const list = (): string[] => {
    try {
      const v = JSON.parse(getSetting(o.db, KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  const save = (dirs: string[]): void => setSetting(o.db, KEY, JSON.stringify(dirs))

  function inboxPosition(): Point {
    const r = o.db.prepare('SELECT MAX(y + h) AS bottom FROM cards WHERE x >= ? AND x < ?').get(INBOX_X, INBOX_RIGHT) as { bottom: number | null }
    return { x: INBOX_X, y: r.bottom === null ? 0 : r.bottom + 20 }
  }

  function enqueueImport(paths: string[]): Promise<unknown> {
    chain = chain
      .then(() => o.importPaths(paths, inboxPosition()))
      .catch((err) => o.log.warn(`Impor dari folder dipantau gagal: ${(err as Error).message}`))
    return chain
  }

  function schedule(file: string): void {
    const prev = pending.get(file)
    if (prev) clearTimeout(prev.timer)
    const timer = setTimeout(() => void check(file), stableMs)
    pending.set(file, { size: prev?.size ?? -1, mtimeMs: prev?.mtimeMs ?? -1, timer })
  }

  async function check(file: string): Promise<void> {
    const prev = pending.get(file)
    let st: fs.Stats
    try {
      st = await fs.promises.stat(file)
    } catch {
      pending.delete(file)
      return
    }
    if (!st.isFile()) {
      pending.delete(file)
      return
    }
    // Diimpor hanya bila ukuran dan waktu ubah sama seperti pemeriksaan sebelumnya (file selesai ditulis).
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
      pending.delete(file)
      void enqueueImport([file])
      return
    }
    const timer = setTimeout(() => void check(file), stableMs)
    pending.set(file, { size: st.size, mtimeMs: st.mtimeMs, timer })
  }

  async function scan(dir: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (d: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= MAX_SCAN) return
        if (isIgnored(e.name)) continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) out.push(p)
      }
    }
    await walk(dir)
    if (out.length >= MAX_SCAN) o.log.warn(`Folder dipantau berisi lebih dari ${MAX_SCAN} file; sisanya tidak dipindai`)
    return out
  }

  async function watch(dir: string): Promise<void> {
    if (watchers.has(dir)) return
    const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || isIgnored(filename.toString())) return
      schedule(path.join(dir, filename.toString()))
    })
    w.on('error', (err) => o.log.warn(`Pemantauan folder berhenti: ${err.message}`))
    watchers.set(dir, w)
    const files = await scan(dir)
    for (let i = 0; i < files.length; i += BATCH) await enqueueImport(files.slice(i, i + BATCH))
  }

  async function validate(dir: string): Promise<string> {
    const abs = path.resolve(dir)
    const st = await fs.promises.stat(abs).catch(() => null)
    if (!st?.isDirectory()) throw new Error(MSG_NO_FOLDER)
    const real = await fs.promises.realpath(abs)
    const realVault = await fs.promises.realpath(vaultRoot).catch(() => vaultRoot)
    // Memantau vault (atau induknya) akan mengimpor file vault itu sendiri berulang-ulang.
    if (isInside(real, realVault) || isInside(realVault, real)) throw new Error(MSG_VAULT_FOLDER)
    return abs
  }

  return {
    list,
    /** Memantau semua folder tersimpan (saat aplikasi mulai). */
    async start(): Promise<void> {
      for (const dir of list()) {
        try {
          await validate(dir)
          await watch(dir)
        } catch (err) {
          o.log.warn(`Folder dipantau dilewati: ${(err as Error).message}`)
        }
      }
    },
    async add(dir: string): Promise<string> {
      const abs = await validate(dir)
      if (!list().includes(abs)) save([...list(), abs])
      await watch(abs)
      return abs
    },
    async remove(dir: string): Promise<void> {
      const abs = path.resolve(dir)
      save(list().filter((d) => d !== abs))
      watchers.get(abs)?.close()
      watchers.delete(abs)
      for (const [file, p] of pending) {
        if (isInside(file, abs)) {
          clearTimeout(p.timer)
          pending.delete(file)
        }
      }
    },
    async close(): Promise<void> {
      for (const w of watchers.values()) w.close()
      watchers.clear()
      for (const p of pending.values()) clearTimeout(p.timer)
      pending.clear()
      await chain
    }
  }
}

export type FolderWatcher = ReturnType<typeof createFolderWatcher>
