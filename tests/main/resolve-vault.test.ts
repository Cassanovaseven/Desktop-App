import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveVaultPath, readVaultConfig } from '../../src/main/vault'

let tmp: string
let ud: string
let base: string
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-resolve-'))
  tmp = path.join(base, 'Vault Alfonsó'); ud = path.join(base, 'userData')
})
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

test('env ALFONSO_VAULT dipakai tanpa bertanya', async () => {
  const ask = vi.fn()
  const p = await resolveVaultPath({ env: { ALFONSO_VAULT: tmp }, userDataDir: ud, ask, notify: vi.fn() })
  expect(p?.root).toBe(tmp); expect(ask).not.toHaveBeenCalled()
})
test('config tersimpan dipakai tanpa bertanya', async () => {
  await resolveVaultPath({ env: {}, userDataDir: ud, ask: async () => tmp, notify: vi.fn() })
  const ask = vi.fn()
  const p = await resolveVaultPath({ env: {}, userDataDir: ud, ask, notify: vi.fn() })
  expect(p?.root).toBe(tmp); expect(ask).not.toHaveBeenCalled()
})
test('dialog dibatalkan → null', async () => {
  expect(await resolveVaultPath({ env: {}, userDataDir: ud, ask: async () => null, notify: vi.fn() })).toBeNull()
})

// Membuat folder tak bisa ditulisi hanya bisa diandalkan lewat icacls di Windows.
test.skipIf(process.platform !== 'win32')('folder tidak bisa ditulisi → beri tahu lalu tanya ulang', async () => {
  const readOnlyDir = path.join(base, 'Hanya Baca')
  fs.mkdirSync(readOnlyDir)
  const user = process.env.USERNAME as string
  execFileSync('icacls', [readOnlyDir, '/deny', `${user}:(OI)(CI)W`])
  try {
    const ask = vi.fn().mockResolvedValueOnce(readOnlyDir).mockResolvedValueOnce(tmp)
    const notify = vi.fn()
    const p = await resolveVaultPath({ env: {}, userDataDir: ud, ask, notify })
    expect(notify).toHaveBeenCalledWith('Folder ini tidak bisa ditulisi. Pilih folder lain.')
    expect(p?.root).toBe(tmp); expect(readVaultConfig(ud)?.vaultPath).toBe(tmp)
  } finally {
    execFileSync('icacls', [readOnlyDir, '/remove:d', user])
  }
})

test('folder yang tidak bisa dibuat (path berupa file) → beri tahu lalu tanya ulang', async () => {
  const bukanFolder = path.join(base, 'bukan-folder.txt')
  fs.writeFileSync(bukanFolder, 'x')
  const ask = vi.fn().mockResolvedValueOnce(bukanFolder).mockResolvedValueOnce(tmp)
  const notify = vi.fn()
  const p = await resolveVaultPath({ env: {}, userDataDir: ud, ask, notify })
  expect(notify).toHaveBeenCalledWith('Folder ini tidak bisa ditulisi. Pilih folder lain.')
  expect(p?.root).toBe(tmp); expect(readVaultConfig(ud)?.vaultPath).toBe(tmp)
  expect(fs.readFileSync(bukanFolder, 'utf8')).toBe('x')
})
