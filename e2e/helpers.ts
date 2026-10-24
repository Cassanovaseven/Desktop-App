import { _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface E2EDirs { base: string; vault: string; userData: string }

export function makeDirs(): E2EDirs {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-e2e-'))
  return { base, vault: path.join(base, 'Dokumen Kerja', 'Vault Alfonsó'), userData: path.join(base, 'userData') }
}

export function launch(dirs: E2EDirs, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  // Chromium menolak berjalan sebagai root di Linux tanpa --no-sandbox (hanya untuk CI/container).
  const rootOnLinux = process.platform === 'linux' && process.getuid?.() === 0
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ALFONSO_VAULT: dirs.vault, ALFONSO_USER_DATA: dirs.userData, ...extraEnv }
  if (!('ALFONSO_E2E' in extraEnv)) delete env.ALFONSO_E2E
  const args = rootOnLinux ? ['.', '--no-sandbox'] : ['.']
  // Linux tanpa keyring (xvfb/CI): safeStorage memakai penyimpanan "basic" supaya alur kunci terenkripsi bisa diuji.
  // Di Windows safeStorage selalu memakai DPAPI, jadi tidak perlu.
  if (process.platform === 'linux') args.push('--password-store=basic')
  return electron.launch({ args, env })
}

export const fixture = (name: string): string => path.resolve(__dirname, 'fixtures', name)

// Kait __alfonsoTest hanya ada di proses utama (lihat src/main/index.ts).
export interface AlfonsoTestHook {
  importPaths(paths: string[], at: { x: number; y: number }): Promise<unknown>
  fillBoard(count: number): void
  fillLibrary(count: number): void
  watchFolder(dir: string): Promise<string>
}
