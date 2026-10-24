import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../db/database'
import type { CostEstimate, Lane } from '../../shared/studio-types'

const KEY = 'studio.biaya'

/** Kredit per generate per model Higgsfield, diisi sendiri oleh pengguna (SDK tidak punya endpoint harga). */
export function getCostTable(db: Database.Database): Record<string, number> {
  try {
    const v = JSON.parse(getSetting(db, KEY) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && n >= 0)) as Record<string, number> : {}
  } catch {
    return {}
  }
}

/** null menghapus harga model. */
export function setModelCost(db: Database.Database, model: string, credits: number | null): void {
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Model tidak valid.')
  if (credits !== null && !(typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 && credits <= 1_000_000)) throw new Error('Biaya harus angka 0 atau lebih.')
  const table = getCostTable(db)
  if (credits === null) delete table[model.trim()]
  else table[model.trim()] = credits
  setSetting(db, KEY, JSON.stringify(table))
}

export function estimate(db: Database.Database, lane: Lane, model: string, count: number): CostEstimate {
  if (lane !== 'cloud') return { perItem: 0, count, total: 0 }
  const perItem = getCostTable(db)[model] ?? null
  return { perItem, count, total: perItem === null ? null : perItem * count }
}
