import type Database from 'better-sqlite3'
import { getSetting, setSetting } from './db/database'
import type { TranscriptModelResult } from '../shared/types'

/** Sama dengan transkrip.MODELS di sidecar: nama → perkiraan ukuran unduhan (MB). */
export const WHISPER_MODELS: Record<string, number> = { small: 480, 'large-v3-turbo': 1600 }
const DEFAULT_MODEL = 'small'
const KEY = 'transkrip.model'

export interface TranscriptModelClient {
  status(model: string): Promise<{ model: string; siap: boolean }>
  download(model: string): Promise<void>
}

export interface TranscriptModelOptions {
  db: Database.Database
  client: TranscriptModelClient
  /** Dialog konfirmasi; unduhan hanya terjadi bila mengembalikan true. */
  confirm: (model: string, sizeMb: number) => Promise<boolean>
  /** Setelah model siap: menjalankan lagi transkrip yang tertunda, mengembalikan jumlahnya. */
  onReady: () => number
}

export function createTranscriptModel(o: TranscriptModelOptions) {
  let pending: Promise<TranscriptModelResult> | null = null

  const modelName = (): string => {
    const v = getSetting(o.db, KEY)
    return v && v in WHISPER_MODELS ? v : DEFAULT_MODEL
  }

  async function run(): Promise<TranscriptModelResult> {
    const model = modelName()
    try {
      if (!(await o.client.status(model)).siap) {
        if (!(await o.confirm(model, WHISPER_MODELS[model]))) return { state: 'batal', model, message: 'Unduhan dibatalkan.' }
        await o.client.download(model)
      }
      const n = o.onReady()
      return { state: 'siap', model, message: n > 0 ? `Model transkrip siap. ${n} file akan ditranskrip.` : 'Model transkrip siap.' }
    } catch (err) {
      return { state: 'gagal', model, message: (err as Error).message }
    }
  }

  return {
    modelName,
    setModel(name: string): void {
      if (!(name in WHISPER_MODELS)) throw new Error('Model tidak dikenal')
      setSetting(o.db, KEY, name)
    },
    download(): Promise<TranscriptModelResult> {
      pending ??= run().finally(() => {
        pending = null
      })
      return pending
    }
  }
}

export type TranscriptModel = ReturnType<typeof createTranscriptModel>
