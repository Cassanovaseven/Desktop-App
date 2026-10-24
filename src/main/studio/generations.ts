import crypto from 'crypto'
import type Database from 'better-sqlite3'
import type { Point } from '../../shared/board-types'
import type { GenSource, GenerateRequest, GenerationDTO, GenStatus, Lane, PromptParams } from '../../shared/studio-types'
import { getCard, newId } from '../board/repo'
import { insertJob } from '../jobs/store'
import { fillTemplate, getPrompt } from './prompts'
import { estimate } from './costs'

type DB = Database.Database

/** Jenis job per jalur: jalur kode dijalankan satu per satu (satu jendela render), cloud/lokal boleh bersamaan. */
export const genJobKind = (lane: Lane): string => `generate:${lane}`
export const GEN_JOB_KINDS = ['generate:kode', 'generate:cloud', 'generate:lokal']
export const MAX_COUNT = 8

export interface GenJobPayload { generationId: string; boardId: string; at: Point | null }

const xmlEscape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export function sourceFor(lane: Lane, model: string): GenSource {
  if (lane === 'cloud') return 'higgsfield'
  if (lane === 'lokal') return 'comfyui'
  return model === 'svg' ? 'svg' : 'p5'
}

interface GenRow {
  id: string; prompt_id: string | null; prompt_version: number | null; variables_json: string | null; model: string | null
  params_json: string | null; lane: Lane; credit_cost: number | null; status: GenStatus; result_asset_id: string | null
  source_card_id: string | null; created_at: string; prompt_text: string | null; source: GenSource | null
  error: string | null; updated_at: string | null; prompt_name?: string | null
}

const toDTO = (r: GenRow): GenerationDTO => ({
  id: r.id,
  promptId: r.prompt_id,
  promptName: r.prompt_name ?? null,
  promptVersion: r.prompt_version,
  promptText: r.prompt_text,
  variables: r.variables_json ? JSON.parse(r.variables_json) : {},
  model: r.model,
  params: r.params_json ? JSON.parse(r.params_json) : {},
  lane: r.lane,
  source: r.source,
  creditCost: r.credit_cost,
  status: r.status,
  error: r.error,
  resultAssetId: r.result_asset_id,
  sourceCardId: r.source_card_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const SELECT = 'SELECT g.*, p.name AS prompt_name FROM generations g LEFT JOIN prompts p ON p.id = g.prompt_id'

export function getGeneration(db: DB, id: string): GenerationDTO | null {
  const r = db.prepare(`${SELECT} WHERE g.id = ?`).get(id) as GenRow | undefined
  return r ? toDTO(r) : null
}

/** Terbaru dulu. */
export function listGenerations(db: DB, opts: { limit?: number; status?: GenStatus } = {}): GenerationDTO[] {
  const where = opts.status ? 'WHERE g.status = ?' : ''
  const args: unknown[] = opts.status ? [opts.status] : []
  const rows = db.prepare(`${SELECT} ${where} ORDER BY g.created_at DESC, g.rowid DESC LIMIT ?`).all(...args, Math.min(opts.limit ?? 100, 500)) as GenRow[]
  return rows.map(toDTO)
}

export function generationForAsset(db: DB, assetId: string): GenerationDTO | null {
  const r = db.prepare(`${SELECT} WHERE g.result_asset_id = ? ORDER BY g.created_at DESC LIMIT 1`).get(assetId) as GenRow | undefined
  return r ? toDTO(r) : null
}

/** Jumlah hasil dari parameter `jumlah` (1–8). */
export function countOf(params: PromptParams): number {
  const n = Number(params.jumlah ?? 1)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_COUNT) : 1
}

const randomSeed = (): number => crypto.randomInt(1, 2 ** 31 - 1)

/**
 * Membuat satu Generation (status `antre`) + satu job per hasil. `jumlah: N` → N baris, masing-masing `jumlah: 1`
 * dengan seed berurutan, supaya tiap hasil bisa diulang persis.
 */
export function createGenerations(db: DB, req: GenerateRequest, ctx: { boardId: string }): GenerationDTO[] {
  const prompt = getPrompt(db, req.promptId)
  if (!prompt) throw new Error('Prompt tidak ditemukan.')
  if (req.sourceCardId && !getCard(db, req.sourceCardId)) throw new Error('Kartu sumber tidak ditemukan.')
  const vars = Object.fromEntries(prompt.variables.map((v) => [v, String(req.variables?.[v] ?? '')]))
  const text = fillTemplate(prompt.template, vars, prompt.targetModel === 'svg' ? xmlEscape : undefined)
  const params: PromptParams = { ...prompt.params, ...(req.params ?? {}) }
  const count = countOf(params)
  const cost = estimate(db, prompt.lane, prompt.targetModel, count)
  if (prompt.lane === 'cloud' && req.confirmedCost !== true) throw new Error('Generate cloud harus dikonfirmasi setelah melihat perkiraan biaya.')
  // Jalur lokal dan p5 selalu punya seed (dicatat) supaya hasilnya bisa diulang; cloud hanya bila diisi sendiri.
  const needsSeed = prompt.lane === 'lokal' || prompt.targetModel.startsWith('p5')
  const seed0 = typeof params.seed === 'number' ? params.seed : needsSeed ? randomSeed() : null
  const source = sourceFor(prompt.lane, prompt.targetModel)
  const ids: string[] = []
  const insert = db.prepare(
    `INSERT INTO generations (id, prompt_id, prompt_version, variables_json, model, params_json, lane, credit_cost, status,
       result_asset_id, source_card_id, created_at, prompt_text, source, external_id, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'antre', NULL, ?, ?, ?, ?, NULL, NULL, ?)`
  )
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = newId()
      const p: PromptParams = { ...params, jumlah: 1, ...(seed0 !== null ? { seed: seed0 + i } : {}) }
      const ts = new Date(Date.now() + i).toISOString()
      insert.run(id, prompt.id, prompt.version, JSON.stringify(vars), prompt.targetModel, JSON.stringify(p), prompt.lane, cost.perItem,
        req.sourceCardId ?? null, ts, text, source, ts)
      const payload: GenJobPayload = { generationId: id, boardId: ctx.boardId, at: req.at ?? null }
      insertJob(db, genJobKind(prompt.lane), payload as unknown as Record<string, unknown>)
      ids.push(id)
    }
  })()
  return ids.map((id) => getGeneration(db, id)!)
}

/** Nilai yang sama persis (versi prompt, variabel, parameter termasuk seed) untuk "Generate ulang". */
export function regenerateRequest(db: DB, id: string): Required<Pick<GenerateRequest, 'promptId' | 'variables' | 'params'>> & { sourceCardId: string | null } {
  const g = getGeneration(db, id)
  if (!g || !g.promptId) throw new Error('Riwayat generate tidak ditemukan.')
  const card = g.sourceCardId && getCard(db, g.sourceCardId) ? g.sourceCardId : null
  return { promptId: g.promptId, variables: g.variables, sourceCardId: card, params: g.params }
}

const touch = (db: DB, id: string, sets: string, ...args: unknown[]): void => {
  db.prepare(`UPDATE generations SET ${sets}, updated_at = ? WHERE id = ?`).run(...args, new Date().toISOString(), id)
}

export const markRunning = (db: DB, id: string): void => touch(db, id, "status = 'berjalan', error = NULL")
export const markQueued = (db: DB, id: string): void => touch(db, id, "status = 'antre', error = NULL")
export const markFailed = (db: DB, id: string, message: string): void => touch(db, id, "status = 'gagal', error = ?", message.slice(0, 2000))
export const markDone = (db: DB, id: string, assetId: string): void => touch(db, id, "status = 'selesai', error = NULL, result_asset_id = ?", assetId)
export const setExternalId = (db: DB, id: string, externalId: string | null): void => touch(db, id, 'external_id = ?', externalId)
export const getExternalId = (db: DB, id: string): string | null =>
  (db.prepare('SELECT external_id FROM generations WHERE id = ?').get(id) as { external_id: string | null } | undefined)?.external_id ?? null
