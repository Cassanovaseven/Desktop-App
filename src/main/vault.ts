import fs from 'fs'
import path from 'path'
import type { VaultPaths } from '../shared/types'

export class VaultNotWritableError extends Error {
  constructor(root: string) {
    super(`Folder vault tidak bisa ditulisi: ${root}`)
    this.name = 'VaultNotWritableError'
  }
}

const CONFIG_FILE = 'alfonso-config.json'
const WRITE_TEST_FILE = '.alfonso-write-test'

export function vaultPaths(root: string): VaultPaths {
  return {
    root,
    db: path.join(root, 'alfonso.db'),
    files: path.join(root, 'files'),
    thumbs: path.join(root, 'thumbs'),
    generated: path.join(root, 'generated'),
    prompts: path.join(root, 'prompts'),
    mods: path.join(root, 'mods'),
    logs: path.join(root, 'logs')
  }
}

// Hanya membuat folder yang belum ada; file yang sudah ada tidak pernah disentuh.
export function ensureVault(root: string): VaultPaths {
  const p = vaultPaths(root)
  try {
    for (const d of [p.root, p.files, p.thumbs, p.generated, p.prompts, p.mods, p.logs]) {
      fs.mkdirSync(d, { recursive: true })
    }
    const probe = path.join(root, WRITE_TEST_FILE)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
  } catch {
    throw new VaultNotWritableError(root)
  }
  return p
}

export function readVaultConfig(userDataDir: string): { vaultPath: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, CONFIG_FILE), 'utf8'))
    return typeof raw?.vaultPath === 'string' ? { vaultPath: raw.vaultPath } : null
  } catch {
    return null
  }
}

export function writeVaultConfig(userDataDir: string, vaultPath: string): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, CONFIG_FILE), JSON.stringify({ vaultPath }, null, 2), 'utf8')
}
