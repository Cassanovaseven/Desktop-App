import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { VaultPaths } from '../../shared/types'
import { CODE_MODELS, type Lane, type PromptDTO, type PromptInput, type PromptParams, type PromptVersionSummary } from '../../shared/studio-types'
import { newId } from '../board/repo'

type DB = Database.Database

export const MAX_NAME = 80
export const MAX_TEMPLATE = 200_000
const LANES: Lane[] = ['cloud', 'lokal', 'kode']
const VAR_RE = /\[([A-Z][A-Z0-9_]*)\]/g

/** Variabel `[NAMA]` (spec 10) sesuai urutan kemunculan, tanpa duplikat. */
export function parseVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR_RE)].map((m) => m[1]))]
}

/** Mengisi semua `[NAMA]`; variabel yang kosong ditolak. `escape` dipakai untuk nilai (mis. XML di SVG). */
export function fillTemplate(template: string, values: Record<string, string>, escape: (s: string) => string = (s) => s): string {
  const missing = parseVariables(template).filter((v) => !(values[v] ?? '').trim())
  if (missing.length) throw new Error(`Variabel belum diisi: ${missing.join(', ')}`)
  // Satu kali replace: nilai yang berisi "[X]" tidak diproses ulang.
  return template.replace(VAR_RE, (_m, name: string) => escape(values[name]))
}

interface PromptRow {
  id: string; project_id: string | null; name: string; lane: Lane; target_model: string | null; template: string
  variables_json: string | null; examples_json: string | null; version: number; parent_version_id: string | null
  params_json: string | null; created_at: string | null
}

const toDTO = (r: PromptRow): PromptDTO => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  lane: r.lane,
  targetModel: r.target_model ?? '',
  template: r.template,
  variables: r.variables_json ? JSON.parse(r.variables_json) : parseVariables(r.template),
  params: r.params_json ? JSON.parse(r.params_json) : {},
  examples: r.examples_json ? JSON.parse(r.examples_json) : [],
  version: r.version,
  parentVersionId: r.parent_version_id,
  createdAt: r.created_at
})

const row = (db: DB, id: string): PromptRow | undefined => db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as PromptRow | undefined

export function getPrompt(db: DB, id: string): PromptDTO | null {
  const r = row(db, id)
  return r ? toDTO(r) : null
}

/** Versi paling baru dari keluarga prompt yang memuat `id` (versi tidak pernah bercabang). */
function latestId(db: DB, id: string): string {
  const child = db.prepare('SELECT id FROM prompts WHERE parent_version_id = ? ORDER BY version DESC LIMIT 1')
  let cur = id
  for (let r = child.get(cur) as { id: string } | undefined; r; r = child.get(cur) as { id: string } | undefined) cur = r.id
  return cur
}

function rootId(db: DB, id: string): string {
  let cur = row(db, id)
  while (cur?.parent_version_id) {
    const parent = row(db, cur.parent_version_id)
    if (!parent) break
    cur = parent
  }
  return cur?.id ?? id
}

export function promptHistory(db: DB, id: string): PromptVersionSummary[] {
  const out: PromptVersionSummary[] = []
  let cur = row(db, latestId(db, id))
  while (cur) {
    out.push({ id: cur.id, version: cur.version, createdAt: cur.created_at })
    cur = cur.parent_version_id ? row(db, cur.parent_version_id) : undefined
  }
  return out
}

export function listPrompts(db: DB, f: { q?: string; lane?: Lane } = {}): PromptDTO[] {
  const where = ['NOT EXISTS (SELECT 1 FROM prompts c WHERE c.parent_version_id = p.id)']
  const args: unknown[] = []
  if (f.lane) { where.push('p.lane = ?'); args.push(f.lane) }
  const q = f.q?.trim()
  if (q) {
    // LIKE dengan escape supaya % dan _ dicari apa adanya.
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.template LIKE ? ESCAPE '\\')")
    args.push(like, like)
  }
  const rows = db.prepare(`SELECT p.* FROM prompts p WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE, p.rowid`).all(...args) as PromptRow[]
  return rows.map(toDTO)
}

function cleanParams(p: unknown): PromptParams {
  if (p === undefined || p === null) return {}
  const bad = (): never => { throw new Error('Parameter harus berupa pasangan nama → teks/angka/ya-tidak.') }
  if (typeof p !== 'object' || Array.isArray(p)) bad()
  const entries = Object.entries(p as Record<string, unknown>)
  if (entries.length > 30) bad()
  for (const [k, v] of entries) {
    if (!/^[A-Za-z_][\w-]{0,39}$/.test(k)) bad()
    if (!(typeof v === 'string' ? v.length <= 2000 : typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) bad()
  }
  return Object.fromEntries(entries) as PromptParams
}

function validate(input: PromptInput): { name: string; lane: Lane; model: string; template: string; params: PromptParams } {
  // Prompt yang langsung dipakai generate tanpa diberi nama tetap disimpan (rencana Fase 3, keputusan 3).
  const name = (typeof input.name === 'string' ? input.name.trim() : '') || `Tanpa judul ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  if (name.length > MAX_NAME) throw new Error(`Nama prompt maksimal ${MAX_NAME} karakter.`)
  if (!LANES.includes(input.lane)) throw new Error('Jalur tidak dikenal.')
  const model = typeof input.targetModel === 'string' ? input.targetModel.trim() : ''
  const okModel =
    input.lane === 'kode' ? (CODE_MODELS as readonly string[]).includes(model)
      : input.lane === 'lokal' ? model === 'comfyui'
        : /^[\w.\-/:]{1,200}$/.test(model)
  if (!okModel) throw new Error(input.lane === 'cloud' ? 'Model Higgsfield harus diisi (mis. bytedance/seedream/v4/text-to-image).' : 'Model tidak dikenal untuk jalur ini.')
  if (typeof input.template !== 'string' || !input.template.trim() || input.template.length > MAX_TEMPLATE) throw new Error('Template harus diisi, maksimal 200.000 karakter.')
  return { name, lane: input.lane, model, template: input.template, params: cleanParams(input.params) }
}

const sameParams = (a: PromptParams, b: PromptParams): boolean => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** Ekspor (spec 9.1 `prompts/`, format spec 10.1) untuk backup; satu file per keluarga prompt. */
export function exportPrompt(db: DB, vault: VaultPaths, id: string): void {
  const p = getPrompt(db, latestId(db, id))
  if (!p) return
  const root = rootId(db, p.id)
  const json = {
    id: root, nama: p.name, jalur: p.lane, target_model: p.targetModel, template: p.template,
    variabel: p.variables, parameter: p.params, contoh_hasil: p.examples, versi: p.version
  }
  fs.mkdirSync(vault.prompts, { recursive: true })
  const file = path.join(vault.prompts, `${root}.json`)
  fs.writeFileSync(file + '.tmp', JSON.stringify(json, null, 2), 'utf8')
  fs.renameSync(file + '.tmp', file)
}

/** Menyimpan prompt. Mengedit tidak pernah menimpa: hasilnya baris versi baru yang berinduk ke versi terbaru. */
export function savePrompt(db: DB, vault: VaultPaths, input: PromptInput): PromptDTO {
  const v = validate(input)
  let parent: PromptDTO | null = null
  if (input.baseId !== undefined) {
    parent = getPrompt(db, latestId(db, input.baseId))
    if (!parent || !row(db, input.baseId)) throw new Error('Prompt tidak ditemukan.')
    const unchanged = parent.name === v.name && parent.lane === v.lane && parent.targetModel === v.model && parent.template === v.template && sameParams(parent.params, v.params)
    if (unchanged) return parent
  }
  const id = newId()
  db.prepare(
    `INSERT INTO prompts (id, project_id, name, lane, target_model, template, variables_json, examples_json, version, parent_version_id, params_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, parent ? parent.projectId : (input.projectId ?? null), v.name, v.lane, v.model, v.template,
    JSON.stringify(parseVariables(v.template)), JSON.stringify(parent?.examples ?? []),
    parent ? parent.version + 1 : 1, parent?.id ?? null, JSON.stringify(v.params), new Date().toISOString()
  )
  exportPrompt(db, vault, id)
  return getPrompt(db, id)!
}

/** "Contoh hasil" (spec 10.1) dicatat di versi terbaru; ini bukan perubahan isi prompt, jadi tidak membuat versi baru. */
export function addExample(db: DB, vault: VaultPaths, promptId: string, assetId: string): PromptDTO {
  const p = getPrompt(db, latestId(db, promptId))
  if (!p) throw new Error('Prompt tidak ditemukan.')
  if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) throw new Error('Aset tidak ditemukan.')
  if (!p.examples.includes(assetId)) {
    db.prepare('UPDATE prompts SET examples_json = ? WHERE id = ?').run(JSON.stringify([...p.examples, assetId]), p.id)
    exportPrompt(db, vault, p.id)
  }
  return getPrompt(db, p.id)!
}
