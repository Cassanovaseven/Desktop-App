import { test, expect, beforeEach, afterEach } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { createKeyStore, type SafeStorageLike } from '../../src/main/studio/keys'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

// Tiruan safeStorage: "enkripsi" = membalik byte + penanda, cukup untuk memastikan teks polos tidak tersimpan.
const fake = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.concat([Buffer.from('ENC'), Buffer.from(s, 'utf8').reverse()]),
  decryptString: (b) => {
    if (b.subarray(0, 3).toString() !== 'ENC') throw new Error('rusak')
    return Buffer.from(b.subarray(3)).reverse().toString('utf8')
  }
})
const settings = () => t.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]

test('simpan → hanya ciphertext base64 di settings; status, baca, hapus', () => {
  const ks = createKeyStore(t.db, fake())
  expect(ks.status()).toBe('belum')
  expect(ks.read()).toBeNull()
  ks.save('kunci-abc', 'rahasia-xyz')
  expect(ks.status()).toBe('tersimpan')
  expect(ks.read()).toBe('kunci-abc:rahasia-xyz')
  const all = JSON.stringify(settings())
  expect(all).not.toContain('kunci-abc')
  expect(all).not.toContain('rahasia-xyz')
  expect(settings().find((s) => s.key === 'kunci.higgsfield')!.value).toMatch(/^[A-Za-z0-9+/=]+$/)
  // Dibaca ulang dari database oleh instance baru (mis. setelah aplikasi dibuka lagi).
  expect(createKeyStore(t.db, fake()).read()).toBe('kunci-abc:rahasia-xyz')
  expect(ks.secrets()).toEqual(expect.arrayContaining(['kunci-abc', 'rahasia-xyz', 'kunci-abc:rahasia-xyz']))
  ks.clear()
  expect(ks.status()).toBe('belum')
  expect(ks.read()).toBeNull()
  expect(ks.secrets()).toEqual([])
  expect(settings().some((s) => s.key.startsWith('kunci.'))).toBe(false)
})

test('ditolak → status ditolak sampai kunci diganti', () => {
  const ks = createKeyStore(t.db, fake())
  ks.save('a', 'b')
  ks.markRejected()
  expect(ks.status()).toBe('ditolak')
  ks.save('c', 'd')
  expect(ks.status()).toBe('tersimpan')
})

test('enkripsi tidak tersedia → error jelas, tidak ada yang disimpan', () => {
  const ks = createKeyStore(t.db, fake(false))
  expect(() => ks.save('a', 'b')).toThrow('Enkripsi')
  expect(settings()).toEqual([])
})

test('input tidak valid ditolak; ciphertext rusak dianggap belum diatur', () => {
  const ks = createKeyStore(t.db, fake())
  expect(() => ks.save('', 'b')).toThrow()
  expect(() => ks.save('a', ' ')).toThrow()
  expect(() => ks.save('a\nb', 'c')).toThrow()
  expect(() => ks.save('a'.repeat(501), 'c')).toThrow()
  t.db.prepare("INSERT INTO settings (key, value) VALUES ('kunci.higgsfield', 'bm90LWVuYw==')").run()
  expect(createKeyStore(t.db, fake()).read()).toBeNull()
  expect(createKeyStore(t.db, fake()).status()).toBe('belum')
})
