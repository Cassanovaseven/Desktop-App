import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { ensureVault } from '../../src/main/vault'
import type { VaultPaths } from '../../src/shared/types'

export interface TmpVault { base: string; vault: VaultPaths; db: Database.Database; cleanup(): void }

export function tmpVault(): TmpVault {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-f1-'))
  const vault = ensureVault(path.join(base, 'Vault Alfonsó'))
  const db = openDatabase(vault.db)
  return {
    base, vault, db,
    cleanup() { if (db.open) db.close(); fs.rmSync(base, { recursive: true, force: true }) }
  }
}
