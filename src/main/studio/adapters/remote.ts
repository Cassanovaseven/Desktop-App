import type Database from 'better-sqlite3'
import type { SidecarManager } from '../../sidecar'
import { PermanentError } from '../../ingest/service'
import type { GenerationDTO } from '../../../shared/studio-types'
import { KeyRejectedError, type RemoteAdapter } from '../runner'
import type { AdapterResult } from './code'
import { renderSize } from './code'

const MINUTE = 60_000

type SidecarLike = Pick<SidecarManager, 'token' | 'getStatus'>

async function call<T>(sidecar: SidecarLike, method: 'GET' | 'POST', route: string, body: unknown, timeoutMs: number, key?: string): Promise<T> {
  const { state, port } = sidecar.getStatus()
  if (state !== 'ready' || !port) throw new Error('Sidecar belum siap')
  const headers: Record<string, string> = { 'X-Alfonso-Token': sidecar.token, 'Content-Type': 'application/json' }
  if (key) headers['X-Alfonso-Key'] = key
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)
  })
  if (res.ok) return (await res.json()) as T
  const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `HTTP ${res.status}`
  if (res.status === 403) throw new KeyRejectedError(detail)
  // 4xx (selain 408/429) = permintaan/hasil yang tidak akan berubah bila diulang; 5xx = sementara.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentError(detail)
  throw new Error(detail)
}

const RENAME: Record<string, string> = { rasio: 'aspect_ratio', resolusi: 'resolution', negatif: 'negative_prompt' }
// Parameter milik Alfonso (jumlah hasil, nama parameter referensi, workflow lokal, ukuran untuk jalur kode).
const INTERNAL = new Set(['jumlah', 'kunci_referensi', 'workflow', 'lebar', 'tinggi', 'durasi', 'fps'])

/** Argumen untuk model Higgsfield: teks prompt + parameter prompt (nama Indonesia diterjemahkan), sisanya apa adanya. */
export function higgsfieldArguments(g: GenerationDTO): Record<string, unknown> {
  const args: Record<string, unknown> = { prompt: g.promptText ?? '' }
  for (const [k, v] of Object.entries(g.params)) if (!INTERNAL.has(k)) args[RENAME[k] ?? k] = v
  return args
}

/** Nilai penanda workflow ComfyUI ({{PROMPT}}, {{NEGATIF}}, {{SEED}}, {{LEBAR}}, {{TINGGI}}). */
export function comfyValues(g: GenerationDTO): Record<string, string | number> {
  const size = renderSize(g.params)
  return {
    PROMPT: g.promptText ?? '',
    NEGATIF: typeof g.params.negatif === 'string' ? g.params.negatif : '',
    SEED: typeof g.params.seed === 'number' ? g.params.seed : 1,
    LEBAR: size.width,
    TINGGI: size.height
  }
}

interface FileOut { path: string; ext: string; temp_dir: string }
const toResult = (r: FileOut): AdapterResult => ({ file: r.path, ext: r.ext, tempDir: r.temp_dir })

export interface RemoteDeps {
  sidecar: SidecarLike
  db: Database.Database
  /** Kunci Higgsfield `key:secret` dari brankas (hanya di proses utama). */
  readKey: () => string | null
  comfyUrl: () => string
}

export function createRemoteAdapters(d: RemoteDeps) {
  const key = (): string => {
    const k = d.readKey()
    if (!k) throw new PermanentError('Kunci Higgsfield belum diatur. Isi di Studio → Akun.')
    return k
  }
  const cloud: RemoteAdapter = {
    async submit(g, ctx) {
      const refKey = typeof g.params.kunci_referensi === 'string' ? g.params.kunci_referensi : 'image_url'
      const r = await call<{ request_id: string }>(d.sidecar, 'POST', '/generate/higgsfield/submit', {
        model: g.model, arguments: higgsfieldArguments(g), reference_path: ctx.referencePath, reference_key: refKey
      }, 5 * MINUTE, key())
      return r.request_id
    },
    async wait(_g, externalId) {
      return toResult(await call<FileOut>(d.sidecar, 'POST', '/generate/higgsfield/wait', { request_id: externalId }, 20 * MINUTE, key()))
    }
  }
  const lokal: RemoteAdapter = {
    async submit(g, ctx) {
      const wfId = typeof g.params.workflow === 'string' ? g.params.workflow : ''
      const row = wfId ? (d.db.prepare('SELECT vault_path FROM assets WHERE id = ?').get(wfId) as { vault_path: string } | undefined) : undefined
      if (!row) throw new PermanentError('Pilih file workflow ComfyUI (hasil "Export (API)") untuk prompt ini.')
      const r = await call<{ prompt_id: string }>(d.sidecar, 'POST', '/generate/comfyui/submit', {
        base_url: d.comfyUrl(), workflow_path: row.vault_path, values: comfyValues(g), reference_path: ctx.referencePath
      }, 5 * MINUTE)
      return r.prompt_id
    },
    async wait(_g, externalId) {
      return toResult(await call<FileOut>(d.sidecar, 'POST', '/generate/comfyui/wait', { base_url: d.comfyUrl(), prompt_id: externalId }, 20 * MINUTE))
    }
  }
  return {
    cloud,
    lokal,
    encodeVideo: async (framesDir: string, fps: number) => {
      const r = await call<FileOut>(d.sidecar, 'POST', '/encode/video', { frames_dir: framesDir, fps }, 10 * MINUTE)
      return { path: r.path, tempDir: r.temp_dir }
    },
    comfyRunning: async (url: string): Promise<boolean> =>
      (await call<{ berjalan: boolean }>(d.sidecar, 'GET', `/generate/comfyui/status?base_url=${encodeURIComponent(url)}`, undefined, 10_000)).berjalan
  }
}
