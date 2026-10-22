import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensureVault, readVaultConfig, writeVaultConfig } from '../../src/main/vault'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-vault-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

test('membuat struktur vault lengkap', () => {
  const p = ensureVault(tmp)
  for (const d of [p.files, p.thumbs, p.generated, p.prompts, p.mods, p.logs]) expect(fs.existsSync(d)).toBe(true)
  expect(p.db).toBe(path.join(tmp, 'alfonso.db'))
})
test('idempoten dan tidak menyentuh file yang ada', () => {
  ensureVault(tmp); fs.writeFileSync(path.join(tmp, 'files', 'milikku.txt'), 'halo')
  ensureVault(tmp)
  expect(fs.readFileSync(path.join(tmp, 'files', 'milikku.txt'), 'utf8')).toBe('halo')
})
test('path dengan spasi dan non-ASCII', () => {
  const root = path.join(tmp, 'Dokumen Kerja', 'Vault Alfonsó')
  expect(fs.existsSync(ensureVault(root).files)).toBe(true)
})
test('config rusak dibaca sebagai null', () => {
  fs.writeFileSync(path.join(tmp, 'alfonso-config.json'), '{rusak')
  expect(readVaultConfig(tmp)).toBeNull()
})
test('config ditulis lalu dibaca kembali', () => {
  writeVaultConfig(tmp, path.join(tmp, 'Vault Alfonsó'))
  expect(readVaultConfig(tmp)).toEqual({ vaultPath: path.join(tmp, 'Vault Alfonsó') })
})
