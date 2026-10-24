import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../db/database'
import type { KeyStatus } from '../../shared/studio-types'

/** Bagian `safeStorage` Electron yang dipakai (bisa ditiru di tes). Di Windows memakai DPAPI. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

const KEY = 'kunci.higgsfield'
const REJECTED = 'kunci.higgsfield.ditolak'

const clean = (v: unknown, label: string): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 500 || /[\s]/.test(s)) throw new Error(`${label} Higgsfield tidak valid.`)
  return s
}

/**
 * Brankas kunci Higgsfield. Hanya ciphertext (base64) yang masuk `settings`; teks polos hanya ada di memori proses utama
 * dan tidak pernah dikirim ke renderer.
 */
export function createKeyStore(db: Database.Database, storage: SafeStorageLike) {
  let cache: string | null | undefined

  const read = (): string | null => {
    if (cache !== undefined) return cache
    const enc = getSetting(db, KEY)
    try {
      cache = enc ? storage.decryptString(Buffer.from(enc, 'base64')) : null
    } catch {
      cache = null
    }
    return cache
  }

  return {
    save(apiKey: string, secret: string): void {
      const k = clean(apiKey, 'API key')
      const s = clean(secret, 'Secret')
      if (!storage.isEncryptionAvailable()) throw new Error('Enkripsi Windows tidak tersedia, kunci tidak disimpan.')
      const plain = `${k}:${s}`
      setSetting(db, KEY, storage.encryptString(plain).toString('base64'))
      db.prepare('DELETE FROM settings WHERE key = ?').run(REJECTED)
      cache = plain
    },
    read,
    status(): KeyStatus {
      if (!read()) return 'belum'
      return getSetting(db, REJECTED) ? 'ditolak' : 'tersimpan'
    },
    /** Higgsfield menolak kunci (401/403): tombol generate cloud dimatikan sampai kunci diganti. */
    markRejected(): void {
      setSetting(db, REJECTED, '1')
    },
    clear(): void {
      db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(KEY, REJECTED)
      cache = null
    },
    /** Untuk `redact()` di logger dan antrean. */
    secrets(): string[] {
      const v = read()
      if (!v) return []
      const i = v.indexOf(':')
      // Potongan yang sangat pendek tidak disensor terpisah, supaya log tidak penuh [DISEMBUNYIKAN].
      return [v, ...[v.slice(0, i), v.slice(i + 1)].filter((x) => x.length >= 8)]
    }
  }
}

export type KeyStore = ReturnType<typeof createKeyStore>
