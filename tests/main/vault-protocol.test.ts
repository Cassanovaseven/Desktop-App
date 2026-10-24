import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { handleVaultRequest } from '../../src/main/vault-protocol'
import { vaultUrl } from '../../src/main/board/repo'

let t: TmpVault
beforeEach(() => {
  t = tmpVault()
  fs.mkdirSync(path.join(t.vault.files, 'ab'), { recursive: true })
  fs.writeFileSync(path.join(t.vault.files, 'ab', 'abc.png'), 'png')
  fs.writeFileSync(path.join(t.vault.thumbs, 'aset 1.webp'), 'webp')
})
afterEach(() => t.cleanup())

test('file di files/ dan thumbs/ dilayani', () => {
  expect(handleVaultRequest(t.vault.root, 'alfonso-vault://files/ab/abc.png')).toEqual({ path: path.join(t.vault.files, 'ab', 'abc.png') })
  expect(handleVaultRequest(t.vault.root, vaultUrl('thumbs/aset 1.webp'))).toEqual({ path: path.join(t.vault.thumbs, 'aset 1.webp') })
})
test('file yang tidak ada → 404', () => {
  expect(handleVaultRequest(t.vault.root, 'alfonso-vault://files/ab/hilang.png')).toEqual({ status: 404 })
})
test('traversal, folder lain, dan URL aneh → 400 atau tidak keluar dari folder', () => {
  for (const u of [
    'alfonso-vault://alfonso.db/',
    'alfonso-vault://logs/x.log',
    'alfonso-vault://files/%2e%2e/alfonso.db',
    'alfonso-vault://files/..%2F..%2Falfonso.db',
    'alfonso-vault://files/ab/..%5C..%5Calfonso.db',
    'alfonso-vault://thumbs/%2Fetc%2Fpasswd',
    'alfonso-vault://mods/x/manifest.json',
    'bukan url'
  ]) {
    const r = handleVaultRequest(t.vault.root, u)
    if ('path' in r) expect(r.path.startsWith(path.join(t.vault.root, 'files')) || r.path.startsWith(path.join(t.vault.root, 'thumbs'))).toBe(true)
    else expect([400, 404]).toContain(r.status)
  }
  expect(handleVaultRequest(t.vault.root, 'alfonso-vault://files/%2e%2e/alfonso.db')).not.toHaveProperty('path')
})
test('hasil generate di generated/ dilayani (Fase 3), prompts/ tidak', () => {
  fs.mkdirSync(path.join(t.vault.generated, '2026-10'), { recursive: true })
  fs.writeFileSync(path.join(t.vault.generated, '2026-10', 'a_b.png'), 'png')
  fs.writeFileSync(path.join(t.vault.prompts, 'p.json'), '{}')
  expect(handleVaultRequest(t.vault.root, vaultUrl('generated/2026-10/a_b.png'))).toEqual({ path: path.join(t.vault.generated, '2026-10', 'a_b.png') })
  expect(handleVaultRequest(t.vault.root, vaultUrl('prompts/p.json'))).toEqual({ status: 400 })
})
