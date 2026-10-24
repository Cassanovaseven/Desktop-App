import type { GenerateRequest, PromptInput, PromptParams } from '../../shared/studio-types'

const bad = (msg = 'Permintaan tidak valid'): never => { throw new Error(msg) }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optStr = (v: unknown, max = 200): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' && v.length <= max ? v : bad())

export function parseParams(v: unknown): PromptParams {
  if (!isObj(v)) return bad('Parameter tidak valid')
  for (const x of Object.values(v)) if (!['string', 'number', 'boolean'].includes(typeof x)) bad('Parameter tidak valid')
  return v as PromptParams
}

export function parsePromptInput(v: unknown): PromptInput {
  if (!isObj(v)) return bad()
  const { name, lane, targetModel, template } = v
  if (typeof name !== 'string' || typeof lane !== 'string' || typeof targetModel !== 'string' || typeof template !== 'string') return bad()
  const out: PromptInput = { name, lane: lane as PromptInput['lane'], targetModel, template, projectId: optStr(v.projectId) ?? null }
  if (v.params !== undefined) out.params = parseParams(v.params)
  const baseId = optStr(v.baseId)
  if (baseId !== undefined) out.baseId = baseId
  return out
}

export const MAX_VAR = 20_000

export function parseGenerateRequest(v: unknown): GenerateRequest {
  if (!isObj(v) || typeof v.promptId !== 'string' || !isObj(v.variables)) return bad()
  const variables: Record<string, string> = {}
  for (const [k, x] of Object.entries(v.variables)) {
    if (typeof x !== 'string' || x.length > MAX_VAR || !/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) bad('Isi variabel tidak valid')
    variables[k] = x as string
  }
  let at: GenerateRequest['at'] = null
  if (v.at !== undefined && v.at !== null) {
    const p = v.at as { x?: unknown; y?: unknown }
    if (!isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) bad()
    at = { x: p.x as number, y: p.y as number }
  }
  if (v.confirmedCost !== undefined && typeof v.confirmedCost !== 'boolean') bad()
  const out: GenerateRequest = { promptId: v.promptId, variables, at, confirmedCost: v.confirmedCost === true, sourceCardId: optStr(v.sourceCardId) ?? null }
  if (v.params !== undefined) out.params = parseParams(v.params)
  return out
}

/** ComfyUI hanya boleh di komputer ini: http://127.0.0.1:<port> atau http://localhost:<port>. */
export function parseComfyUrl(v: unknown): string {
  if (typeof v !== 'string') return bad()
  let u: URL
  try {
    u = new URL(v.trim())
  } catch {
    return bad('Alamat ComfyUI tidak valid.')
  }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || (u.pathname !== '/' && u.pathname !== '') || u.search || u.username || u.password) {
    return bad('Alamat ComfyUI harus http://127.0.0.1:<port> atau http://localhost:<port>.')
  }
  return `http://${u.hostname}${u.port ? ':' + u.port : ''}`
}
